"""Tests for the resilient backup download in tools/lab.py, against a local HTTP server.

Nothing here touches the network beyond 127.0.0.1; the real GitHub path is not exercised.
"""

import http.server
import json
import re
import threading
from collections.abc import Callable, Iterator
from pathlib import Path
from types import ModuleType

import pytest

PAYLOAD = bytes(i % 251 for i in range(10_000))  # no repeating block, so a wrong offset shows
SIZE = len(PAYLOAD)
TAG = "rel"
RELEASE_PATH = f"/repos/microsoft/sql-server-samples/releases/tags/{TAG}"

Action = Callable[[http.server.BaseHTTPRequestHandler], None]


def _reply(
    handler: http.server.BaseHTTPRequestHandler,
    status: int,
    body: bytes = b"",
    headers: dict[str, str] | None = None,
    declared: int | None = None,
) -> None:
    handler.send_response(status)
    handler.send_header("Content-Length", str(len(body) if declared is None else declared))
    for name, value in (headers or {}).items():
        handler.send_header(name, value)
    handler.end_headers()
    handler.wfile.write(body)


def fail(status: int) -> Action:
    return lambda handler: _reply(handler, status)


def serve_file(handler: http.server.BaseHTTPRequestHandler) -> None:
    """Send PAYLOAD, honouring a Range header the way GitHub's file host does."""
    range_header = handler.headers.get("Range")
    if range_header is None:
        _reply(handler, 200, PAYLOAD)
        return
    start = int(range_header.removeprefix("bytes=").removesuffix("-"))
    _reply(
        handler,
        206,
        PAYLOAD[start:],
        {"Content-Range": f"bytes {start}-{SIZE - 1}/{SIZE}"},
    )


def ignore_range(handler: http.server.BaseHTTPRequestHandler) -> None:
    _reply(handler, 200, PAYLOAD)


def drop_after(sent: int) -> Action:
    """Promise the whole file, send `sent` bytes, then hang up."""

    def action(handler: http.server.BaseHTTPRequestHandler) -> None:
        _reply(handler, 200, PAYLOAD[:sent], declared=SIZE)

    return action


def redirect(location: str) -> Action:
    return lambda handler: _reply(handler, 302, headers={"Location": location})


def release_json(base: str, size: int = SIZE, name: str = "a.bak") -> Action:
    def action(handler: http.server.BaseHTTPRequestHandler) -> None:
        assets = [
            {"name": "other.bak", "size": 1, "url": "x"},
            {"name": name, "size": size, "url": f"{base}/assets/7"},
        ]
        _reply(handler, 200, json.dumps({"assets": assets}).encode())

    return action


class Scripted:
    """A local server whose answers are scripted per path; the last action repeats."""

    def __init__(self) -> None:
        self.script: dict[str, list[Action]] = {}
        self.requests: list[tuple[str, dict[str, str]]] = []
        owner = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                owner.requests.append((self.path, {k.lower(): v for k, v in self.headers.items()}))
                actions = owner.script.get(self.path)
                if actions is None:
                    _reply(self, 404)
                    return
                (actions.pop(0) if len(actions) > 1 else actions[0])(self)

            def log_message(self, format: str, *args: object) -> None:
                pass

        self.httpd = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        self.thread = threading.Thread(
            target=self.httpd.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True
        )

    def hits(self, path: str) -> list[dict[str, str]]:
        return [headers for p, headers in self.requests if p == path]


@pytest.fixture
def srv() -> Iterator[Scripted]:
    server = Scripted()
    server.thread.start()
    yield server
    server.httpd.shutdown()
    server.thread.join()


@pytest.fixture(autouse=True)
def fast_and_clean(lab: ModuleType, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(lab, "BACKOFF_BASE_SECONDS", 0)
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)


def test_retries_a_504_then_succeeds(
    lab: ModuleType, srv: Scripted, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    srv.script["/f"] = [fail(504), fail(502), serve_file]
    dest = tmp_path / "a.bak"
    lab.download(f"{srv.base}/f", dest, SIZE)
    assert dest.read_bytes() == PAYLOAD
    assert len(srv.hits("/f")) == 3
    assert "retrying" in capsys.readouterr().out
    assert list(tmp_path.glob("*.part")) == []


def test_backoff_doubles_between_attempts(
    lab: ModuleType, srv: Scripted, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    slept: list[float] = []
    monkeypatch.setattr(lab.time, "sleep", slept.append)
    monkeypatch.setattr(lab, "BACKOFF_BASE_SECONDS", 2.0)
    srv.script["/f"] = [fail(503)]
    with pytest.raises(lab.LabError):
        lab.download(f"{srv.base}/f", tmp_path / "a.bak", SIZE)
    assert slept == [2.0, 4.0]
    assert len(srv.hits("/f")) == 3


def test_does_not_retry_a_404(lab: ModuleType, srv: Scripted, tmp_path: Path) -> None:
    with pytest.raises(lab.LabError, match="HTTP 404"):
        lab.download(f"{srv.base}/missing", tmp_path / "a.bak", SIZE)
    assert len(srv.hits("/missing")) == 1


def test_retries_a_refused_connection(lab: ModuleType, tmp_path: Path) -> None:
    server = Scripted()  # bound but never started: connections are accepted by the OS, then hang
    server.httpd.server_close()  # now closed: connections are refused
    with pytest.raises(lab.LabError, match="gave up after 3 attempts"):
        lab.download(f"{server.base}/f", tmp_path / "a.bak", SIZE)


def test_resumes_with_a_range_request_after_a_dropped_connection(
    lab: ModuleType, srv: Scripted, tmp_path: Path
) -> None:
    srv.script["/f"] = [drop_after(4000), serve_file]
    dest = tmp_path / "a.bak"
    lab.download(f"{srv.base}/f", dest, SIZE)
    assert dest.read_bytes() == PAYLOAD
    first, second = srv.hits("/f")
    assert "range" not in first
    assert second["range"] == "bytes=4000-"


def test_resumes_a_part_file_left_by_an_earlier_run(
    lab: ModuleType, srv: Scripted, tmp_path: Path
) -> None:
    srv.script["/f"] = [serve_file]
    (tmp_path / "a.bak.part").write_bytes(PAYLOAD[:3000])
    dest = tmp_path / "a.bak"
    lab.download(f"{srv.base}/f", dest, SIZE)
    assert dest.read_bytes() == PAYLOAD
    assert srv.hits("/f")[0]["range"] == "bytes=3000-"


def test_restarts_cleanly_when_the_server_ignores_range(
    lab: ModuleType, srv: Scripted, tmp_path: Path
) -> None:
    srv.script["/f"] = [ignore_range]
    (tmp_path / "a.bak.part").write_bytes(PAYLOAD[:3000])
    dest = tmp_path / "a.bak"
    lab.download(f"{srv.base}/f", dest, SIZE)
    assert dest.read_bytes() == PAYLOAD


def test_restarts_when_the_server_rejects_the_range(
    lab: ModuleType, srv: Scripted, tmp_path: Path
) -> None:
    srv.script["/f"] = [fail(416), serve_file]
    (tmp_path / "a.bak.part").write_bytes(b"stale bytes from another file")
    dest = tmp_path / "a.bak"
    lab.download(f"{srv.base}/f", dest, SIZE)
    assert dest.read_bytes() == PAYLOAD


def test_an_oversized_part_file_is_discarded(
    lab: ModuleType, srv: Scripted, tmp_path: Path
) -> None:
    srv.script["/f"] = [serve_file]
    (tmp_path / "a.bak.part").write_bytes(PAYLOAD + b"extra")
    dest = tmp_path / "a.bak"
    lab.download(f"{srv.base}/f", dest, SIZE)
    assert dest.read_bytes() == PAYLOAD
    assert "range" not in srv.hits("/f")[0]


def test_a_complete_part_file_is_renamed_without_a_request(
    lab: ModuleType, srv: Scripted, tmp_path: Path
) -> None:
    (tmp_path / "a.bak.part").write_bytes(PAYLOAD)
    dest = tmp_path / "a.bak"
    lab.download(f"{srv.base}/f", dest, SIZE)
    assert dest.read_bytes() == PAYLOAD
    assert srv.requests == []


def test_falls_back_to_the_github_api_after_the_direct_route_fails(
    lab: ModuleType, srv: Scripted, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(lab, "GITHUB_API", srv.base)
    srv.script["/direct"] = [fail(504)]
    srv.script[RELEASE_PATH] = [release_json(srv.base)]
    srv.script["/assets/7"] = [redirect(f"{srv.base}/blob")]
    srv.script["/blob"] = [serve_file]
    dest = tmp_path / "a.bak"
    lab.download(f"{srv.base}/direct", dest, SIZE, TAG)
    assert dest.read_bytes() == PAYLOAD
    assert len(srv.hits("/direct")) == 3
    assert srv.hits("/assets/7")[0]["accept"] == "application/octet-stream"
    assert srv.hits(RELEASE_PATH)[0]["accept"] == "application/vnd.github+json"
    assert list(tmp_path.glob("*.part")) == []


def test_api_fallback_resumes_the_partial_file_from_the_direct_route(
    lab: ModuleType, srv: Scripted, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(lab, "GITHUB_API", srv.base)
    srv.script["/direct"] = [drop_after(2500), fail(504)]
    srv.script[RELEASE_PATH] = [release_json(srv.base)]
    srv.script["/assets/7"] = [serve_file]
    dest = tmp_path / "a.bak"
    lab.download(f"{srv.base}/direct", dest, SIZE, TAG)
    assert dest.read_bytes() == PAYLOAD
    assert srv.hits("/assets/7")[0]["range"] == "bytes=2500-"


def test_token_is_sent_to_the_api_but_not_to_the_redirect_target(
    lab: ModuleType,
    srv: Scripted,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr(lab, "GITHUB_API", srv.base)
    monkeypatch.setenv("GITHUB_TOKEN", "s3cret-token")
    srv.script["/direct"] = [fail(404)]
    srv.script[RELEASE_PATH] = [release_json(srv.base)]
    srv.script["/assets/7"] = [redirect(f"{srv.base}/blob")]
    srv.script["/blob"] = [serve_file]
    lab.download(f"{srv.base}/direct", tmp_path / "a.bak", SIZE, TAG)
    assert srv.hits(RELEASE_PATH)[0]["authorization"] == "Bearer s3cret-token"
    assert srv.hits("/assets/7")[0]["authorization"] == "Bearer s3cret-token"
    assert "authorization" not in srv.hits("/blob")[0]
    assert "authorization" not in srv.hits("/direct")[0]
    out = capsys.readouterr()
    assert "s3cret-token" not in out.out + out.err


def test_no_authorization_header_without_a_token(
    lab: ModuleType, srv: Scripted, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(lab, "GITHUB_API", srv.base)
    srv.script[RELEASE_PATH] = [release_json(srv.base)]
    srv.script["/assets/7"] = [serve_file]
    lab.download(f"{srv.base}/direct", tmp_path / "a.bak", SIZE, TAG)
    assert "authorization" not in srv.hits(RELEASE_PATH)[0]


def test_api_asset_with_the_wrong_size_is_refused(
    lab: ModuleType, srv: Scripted, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(lab, "GITHUB_API", srv.base)
    srv.script[RELEASE_PATH] = [release_json(srv.base, size=SIZE + 1)]
    srv.script["/assets/7"] = [serve_file]
    with pytest.raises(lab.LabError, match=re.escape("lists a.bak as 10001 bytes")):
        lab.download(f"{srv.base}/direct", tmp_path / "a.bak", SIZE, TAG)
    assert srv.hits("/assets/7") == []


def test_api_asset_on_another_host_is_refused(
    lab: ModuleType, srv: Scripted, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(lab, "GITHUB_API", srv.base)
    srv.script[RELEASE_PATH] = [release_json("http://example.invalid")]
    with pytest.raises(lab.LabError, match="unexpected host"):
        lab.download(f"{srv.base}/direct", tmp_path / "a.bak", SIZE, TAG)


def test_api_release_without_the_asset_is_reported(
    lab: ModuleType, srv: Scripted, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(lab, "GITHUB_API", srv.base)
    srv.script[RELEASE_PATH] = [release_json(srv.base, name="different.bak")]
    with pytest.raises(lab.LabError, match=re.escape("no usable asset named a.bak")):
        lab.download(f"{srv.base}/direct", tmp_path / "a.bak", SIZE, TAG)


def test_size_mismatch_deletes_the_part_file(
    lab: ModuleType, srv: Scripted, tmp_path: Path
) -> None:
    srv.script["/f"] = [serve_file]
    dest = tmp_path / "a.bak"
    with pytest.raises(lab.LabError, match="server reports 10000 bytes, expected 9999"):
        lab.download(f"{srv.base}/f", dest, SIZE - 1)
    assert not dest.exists()
    assert list(tmp_path.glob("*.part")) == []


def test_size_mismatch_on_a_resume_deletes_the_part_file(
    lab: ModuleType, srv: Scripted, tmp_path: Path
) -> None:
    srv.script["/f"] = [serve_file]
    (tmp_path / "a.bak.part").write_bytes(PAYLOAD[:3000])
    with pytest.raises(lab.LabError, match="server reports 7000 bytes, expected 7001"):
        lab.download(f"{srv.base}/f", tmp_path / "a.bak", SIZE + 1)
    assert list(tmp_path.glob("*.part")) == []


def test_wrong_content_range_is_refused(lab: ModuleType, srv: Scripted, tmp_path: Path) -> None:
    def wrong_range(handler: http.server.BaseHTTPRequestHandler) -> None:
        _reply(handler, 206, PAYLOAD[:7000], {"Content-Range": f"bytes 0-6999/{SIZE}"})

    srv.script["/f"] = [wrong_range]
    (tmp_path / "a.bak.part").write_bytes(PAYLOAD[:3000])
    with pytest.raises(lab.LabError, match="wrong range"):
        lab.download(f"{srv.base}/f", tmp_path / "a.bak", SIZE)
    assert list(tmp_path.glob("*.part")) == []


def test_existing_file_with_the_right_size_is_not_downloaded_again(
    lab: ModuleType, srv: Scripted, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    backup = lab.Backup("Db", "a.bak", f"{srv.base}/f", SIZE, TAG)
    (tmp_path / "a.bak").write_bytes(PAYLOAD)
    assert lab.ensure_backup(backup, tmp_path) == tmp_path / "a.bak"
    assert srv.requests == []
    assert "already downloaded" in capsys.readouterr().out


def test_ensure_backup_passes_the_release_tag_to_the_fallback(
    lab: ModuleType, srv: Scripted, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(lab, "GITHUB_API", srv.base)
    srv.script[RELEASE_PATH] = [release_json(srv.base)]
    srv.script["/assets/7"] = [serve_file]
    backup = lab.Backup("Db", "a.bak", f"{srv.base}/gone", SIZE, TAG)
    assert lab.ensure_backup(backup, tmp_path).read_bytes() == PAYLOAD


def test_catalog_entries_carry_their_release_tags(lab: ModuleType) -> None:
    for backup in lab.CATALOG.values():
        assert backup.tag
        assert f"/releases/download/{backup.tag}/" in backup.url


def test_total_failure_explains_how_to_place_the_file_manually(
    lab: ModuleType, srv: Scripted, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(lab, "GITHUB_API", srv.base)
    monkeypatch.setenv("GITHUB_TOKEN", "s3cret-token")
    folder = tmp_path / "lab-data" / "backups"
    srv.script["/gone"] = [fail(504)]
    srv.script[RELEASE_PATH] = [fail(403)]
    with pytest.raises(lab.LabError) as info:
        lab.download(f"{srv.base}/gone", folder / "AdventureWorks2022.bak", SIZE, TAG)
    message = str(info.value)
    assert "AdventureWorks2022.bak" in message
    assert str(Path("lab-data") / "backups") in message
    assert f"{SIZE:,} bytes" in message
    assert "restore" in message
    assert "again" in message
    assert "HTTP 504" in message
    assert "HTTP 403" in message
    assert "s3cret-token" not in message


def test_manual_folder_is_shown_relative_to_the_repo(lab: ModuleType) -> None:
    dest = lab.BACKUP_DIR / "AdventureWorks2022.bak"
    message = lab._manual_instructions(dest, "https://example.test/x.bak", 5)
    assert str(Path("lab-data") / "backups") in message
    assert str(lab.REPO_ROOT) not in message


def test_a_manually_placed_file_is_picked_up_on_the_next_run(
    lab: ModuleType, srv: Scripted, tmp_path: Path
) -> None:
    backup = lab.Backup("Db", "a.bak", f"{srv.base}/gone", SIZE, "")
    srv.script["/gone"] = [fail(404)]
    with pytest.raises(lab.LabError):
        lab.ensure_backup(backup, tmp_path)
    (tmp_path / "a.bak").write_bytes(PAYLOAD)
    srv.requests.clear()
    assert lab.ensure_backup(backup, tmp_path).read_bytes() == PAYLOAD
    assert srv.requests == []
