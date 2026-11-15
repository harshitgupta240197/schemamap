"""The job and map routes over a real socket, with a fake connection and extract."""

from __future__ import annotations

import gzip
import json
import logging
import threading
import time
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from test_ui_connection_routes import HOSTILE_PASSWORDS, assert_no_password, connection
from ui_fakes import Extractor, Opener, small_snapshot, stub_template
from ui_http import TOKEN, post_json, request, serving

from schemamap.errors import ConnectError
from schemamap.snapshot.io import dump_snapshot
from schemamap.snapshot.models import Section
from schemamap.ui import server as server_module
from schemamap.ui.jobs import JobManager
from schemamap.ui.library import MapLibrary, read_upload
from schemamap.ui.server import LauncherServer

AUTH = {"X-SchemaMap-Token": TOKEN}
ABSENT = "f" * 32
SETTINGS = {"connection": connection("pw-for-the-test")}


def rig_server(
    server: LauncherServer, opener: Opener | None = None, extractor: Extractor | None = None
) -> tuple[Opener, Extractor]:
    """Give the running server fakes in place of the real connection and extract."""
    opener = opener or Opener()
    extractor = extractor or Extractor()
    server.library = MapLibrary(server.data_dir, template=stub_template)
    server.jobs = JobManager(server.library, server.connections, opener=opener, extractor=extractor)
    return opener, extractor


@pytest.fixture
def server(tmp_path: Path) -> Iterator[LauncherServer]:
    with serving(tmp_path) as (running, _):
        yield running


def get(server: LauncherServer, path: str, **headers: str) -> tuple[int, dict[str, str], bytes]:
    return request(server, path, headers=AUTH | headers)


def post(
    server: LauncherServer, path: str, payload: object
) -> tuple[int, dict[str, str], dict[str, Any]]:
    status, headers, body = post_json(server, path, json.dumps(payload).encode("utf-8"), **AUTH)
    return status, headers, json.loads(body)


def start_job(server: LauncherServer, payload: object = SETTINGS) -> str:
    status, _, answer = post(server, "/api/jobs", payload)
    assert status == 202, answer
    return str(answer["job_id"])


def wait_for(server: LauncherServer, job_id: str) -> dict[str, Any]:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        status, _, body = get(server, f"/api/jobs/{job_id}")
        assert status == 200
        answer: dict[str, Any] = json.loads(body)
        if answer["state"] != "running":
            return answer
        time.sleep(0.005)
    raise AssertionError("the job did not finish")


def import_snapshot(
    server: LauncherServer,
    body: bytes,
    content_type: str = "application/json",
    **headers: str,
) -> tuple[int, dict[str, str], bytes]:
    sent = AUTH | {"Content-Type": content_type, "Content-Length": str(len(body))} | headers
    return request(server, "/api/maps/import", method="POST", headers=sent, body=body)


# -- running a job and finding its map --------------------------------------------------------


def test_a_job_runs_and_its_map_is_listed_served_downloaded_and_deleted(
    server: LauncherServer,
) -> None:
    rig_server(server)
    done = wait_for(server, start_job(server))
    assert done["state"] == "done"
    map_id = done["map_id"]

    status, _, body = get(server, "/api/maps")
    [entry] = json.loads(body)["maps"]
    assert status == 200
    snapshot = small_snapshot()
    assert entry["id"] == map_id
    assert (entry["database"], entry["server"], entry["tables"]) == (
        snapshot.source.database,
        "db-host.example",
        3,
    )
    assert set(entry) == {"id", "database", "server", "extracted_at", "tables", "bytes"}

    status, headers, page = request(server, f"/maps/{map_id}")
    assert status == 200 and len(page) == entry["bytes"]
    assert headers["Content-Type"] == "text/html; charset=utf-8"
    assert page == server.library.read_map(map_id)

    status, headers, downloaded = get(server, f"/api/maps/{map_id}/download")
    assert status == 200
    assert downloaded == page
    assert (
        headers["Content-Disposition"]
        == f'attachment; filename="{snapshot.source.database}-map.html"'
    )
    assert headers["Cache-Control"] == "no-store"
    assert headers["X-Content-Type-Options"] == "nosniff"

    status, _, body = request(server, f"/api/maps/{map_id}", method="DELETE", headers=AUTH)
    assert (status, json.loads(body)) == (200, {"deleted": True})
    assert json.loads(get(server, "/api/maps")[2]) == {"maps": []}
    assert request(server, f"/maps/{map_id}")[0] == 404
    assert get(server, f"/api/maps/{map_id}/download")[0] == 404
    assert request(server, f"/api/maps/{map_id}", method="DELETE", headers=AUTH)[0] == 404


def test_the_job_status_has_the_documented_shape(server: LauncherServer) -> None:
    rig_server(server)
    done = wait_for(server, start_job(server))
    assert set(done) == {"job_id", "state", "sections", "elapsed_ms", "map_id"}
    assert [s["name"] for s in done["sections"]][:2] == ["schemas", "tables"]
    assert set(done["sections"][0]) == {"name", "state", "count"}
    assert isinstance(done["elapsed_ms"], int)


def test_the_job_answers_202_and_a_second_start_is_409_while_it_runs(
    server: LauncherServer,
) -> None:
    _, extractor = rig_server(server, extractor=Extractor(pause_before=Section.TABLES))
    try:
        job_id = start_job(server)
        assert extractor.reached.wait(5)
        status, headers, answer = post(server, "/api/jobs", SETTINGS)
        assert status == 409
        assert answer["error"]["code"] == "job_running"
        assert answer["error"]["fix"]
        assert answer["error"]["job_id"] == job_id
        assert headers["Content-Type"] == "application/json"
        extractor.release.set()
        assert wait_for(server, job_id)["state"] == "done"
        assert post(server, "/api/jobs", SETTINGS)[0] == 202
    finally:
        extractor.release.set()


def test_cancel_answers_cancelling_then_the_job_ends_cancelled(server: LauncherServer) -> None:
    _, extractor = rig_server(server, extractor=Extractor(pause_before=Section.VIEWS))
    try:
        job_id = start_job(server)
        assert extractor.reached.wait(5)
        status, _, answer = post(server, f"/api/jobs/{job_id}/cancel", {})
        assert (status, answer) == (200, {"state": "cancelling"})
        extractor.release.set()
        assert wait_for(server, job_id)["state"] == "cancelled"
        assert json.loads(get(server, "/api/maps")[2]) == {"maps": []}
        assert post(server, f"/api/jobs/{job_id}/cancel", {})[2] == {"state": "cancelled"}
    finally:
        extractor.release.set()


def test_a_failed_login_is_a_failed_job_not_a_request_error(server: LauncherServer) -> None:
    rig_server(server, opener=Opener(failure=ConnectError("Cannot reach it. Fix: check the port.")))
    failed = wait_for(server, start_job(server))
    assert failed["state"] == "failed"
    assert failed["error"] == {
        "code": "connect_failed",
        "message": "Cannot reach it.",
        "fix": "check the port.",
    }


def test_remember_saves_the_connection_without_the_password(server: LauncherServer) -> None:
    rig_server(server)
    wait_for(server, start_job(server, {**SETTINGS, "remember": True}))
    [entry] = json.loads(get(server, "/api/connections")[2])["connections"]
    assert (entry["server"], entry["database"], entry["user"]) == (
        "db.example.test",
        "Sales",
        "reader",
    )
    assert "pw-for-the-test" not in (server.data_dir / "connections.json").read_text("utf-8")


# -- bad requests -----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("payload", "status", "code"),
    [
        ({}, 400, "bad_request"),
        ({"connection": "text"}, 400, "bad_request"),
        ({"connection": {"server": "h"}}, 400, "bad_request"),  # database is required for a job
        ({**SETTINGS, "extra": 1}, 400, "bad_request"),
        ({**SETTINGS, "remember": "yes"}, 400, "bad_request"),
        ({"connection": connection("x", auth="magic")}, 422, "invalid"),
        ({"connection": connection("x", port=0)}, 400, "bad_request"),
    ],
)
def test_a_bad_job_request_is_refused_and_no_job_starts(
    server: LauncherServer, payload: object, status: int, code: str
) -> None:
    opener, _ = rig_server(server)
    answered, _, answer = post(server, "/api/jobs", payload)
    assert (answered, answer["error"]["code"]) == (status, code)
    assert opener.seen == []


def test_a_refusal_never_names_a_field_that_could_be_a_secret(server: LauncherServer) -> None:
    rig_server(server)
    _, _, answer = post(server, "/api/jobs", {"connection": connection("x") | {"hunter2": 1}})
    assert "hunter2" not in json.dumps(answer)


# -- authentication, methods and ids ----------------------------------------------------------

ID_ROUTES = [
    ("GET", "/api/jobs/{id}"),
    ("POST", "/api/jobs/{id}/cancel"),
    ("GET", "/api/maps/{id}/download"),
    ("DELETE", "/api/maps/{id}"),
]
NEW_ROUTES = [
    ("POST", "/api/jobs"),
    ("GET", "/api/maps"),
    ("POST", "/api/maps/import"),
    *[(method, path.format(id=ABSENT)) for method, path in ID_ROUTES],
]


@pytest.mark.parametrize(("method", "path"), NEW_ROUTES)
def test_every_new_route_needs_the_token(server: LauncherServer, method: str, path: str) -> None:
    headers = {"Content-Type": "application/json", "Content-Length": "2"}
    for sent in (headers, headers | {"X-SchemaMap-Token": "wrong"}):
        status, _, body = request(server, path, method=method, headers=sent, body=b"{}")
        assert status == 401
        assert json.loads(body)["error"]["code"] == "unauthorized"


@pytest.mark.parametrize(
    ("path", "method", "allow"),
    [
        ("/api/jobs", "GET", "POST"),
        ("/api/jobs/" + ABSENT, "POST", "GET, HEAD"),
        ("/api/jobs/" + ABSENT + "/cancel", "GET", "POST"),
        ("/api/maps", "POST", "GET, HEAD"),
        ("/api/maps/import", "GET", "POST"),
        ("/api/maps/" + ABSENT, "GET", "DELETE"),
        ("/api/maps/" + ABSENT + "/download", "DELETE", "GET, HEAD"),
    ],
)
def test_the_wrong_method_is_405_with_allow(
    server: LauncherServer, path: str, method: str, allow: str
) -> None:
    headers = AUTH | {"Content-Type": "application/json", "Content-Length": "2"}
    status, answer, _ = request(server, path, method=method, headers=headers, body=b"{}")
    assert status == 405
    assert answer["Allow"] == allow


BAD_IDS = [
    "..",
    "../" + "a" * 29,
    "a" * 31,
    "a" * 33,
    "A" * 32,
    "g" * 32,
    "%2e%2e%2f" + "a" * 23,
    "..%2f..%2f" + "a" * 20,
    "a" * 32 + "%00",
    "a" * 32 + "/x",
    "a" * 30 + "..",
    "%61" * 32,
    "",
]


@pytest.mark.parametrize("bad", BAD_IDS)
@pytest.mark.parametrize(("method", "template"), ID_ROUTES)
def test_an_id_that_is_not_32_hex_characters_is_404_on_every_id_route(
    server: LauncherServer, tmp_path: Path, method: str, template: str, bad: str
) -> None:
    rig_server(server)
    (tmp_path / "secret.txt").write_text("secret", encoding="utf-8")
    start = wait_for(server, start_job(server))["map_id"]
    status, _, body = request(
        server,
        template.format(id=bad),
        method=method,
        headers=AUTH | {"Content-Type": "application/json", "Content-Length": "2"},
        body=b"{}",
    )
    assert status == 404
    assert json.loads(body)["error"]["code"] == "not_found"
    assert (tmp_path / "secret.txt").exists()
    assert [m["id"] for m in json.loads(get(server, "/api/maps")[2])["maps"]] == [start]


@pytest.mark.parametrize(("method", "template"), ID_ROUTES)
def test_an_unknown_but_well_formed_id_is_404(
    server: LauncherServer, method: str, template: str
) -> None:
    status, _, body = request(
        server,
        template.format(id=ABSENT),
        method=method,
        headers=AUTH | {"Content-Type": "application/json", "Content-Length": "2"},
        body=b"{}",
    )
    assert status == 404
    assert json.loads(body)["error"]["code"] == "not_found"


def test_no_route_takes_a_file_path() -> None:
    routes = [*server_module._API_ROUTES, *(p.pattern for p, _, _ in server_module._ID_ROUTES)]
    assert not [r for r in routes if "path" in r or "file" in r or ("{" in r and "id" not in r)]


# -- importing --------------------------------------------------------------------------------


def test_a_snapshot_can_be_imported_as_json(server: LauncherServer) -> None:
    rig_server(server)
    snapshot = small_snapshot()
    status, _, body = import_snapshot(server, dump_snapshot(snapshot).encode())
    assert status == 200
    map_id = json.loads(body)["map_id"]
    [entry] = json.loads(get(server, "/api/maps")[2])["maps"]
    assert entry["id"] == map_id and entry["tables"] == 3
    assert request(server, f"/maps/{map_id}")[0] == 200
    assert not list((server.data_dir / "tmp").iterdir())


def test_a_snapshot_can_be_imported_as_gzip_and_gives_the_same_map(server: LauncherServer) -> None:
    rig_server(server)
    raw = dump_snapshot(small_snapshot()).encode()
    plain = json.loads(import_snapshot(server, raw)[2])["map_id"]
    packed = json.loads(
        import_snapshot(server, gzip.compress(raw), "application/gzip; charset=binary")[2]
    )["map_id"]
    assert plain != packed
    assert server.library.read_map(plain) == server.library.read_map(packed)


def test_the_upload_is_streamed_to_a_server_named_file_in_tmp(
    server: LauncherServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    rig_server(server)
    seen: list[Path] = []
    real = read_upload

    def spy(path: Path) -> Any:
        seen.append(path)
        return real(path)

    monkeypatch.setattr("schemamap.ui.server.read_upload", spy)
    body = dump_snapshot(small_snapshot()).encode()
    status, _, _ = import_snapshot(server, body, **{"X-Filename": "../../etc/passwd"})
    assert status == 200
    [path] = seen
    assert path.parent == server.data_dir / "tmp" and path.name.startswith("upload-")
    assert not path.exists()


def test_a_snapshot_of_the_wrong_version_is_422_with_the_view_message(
    server: LauncherServer,
) -> None:
    rig_server(server)
    document = json.loads(dump_snapshot(small_snapshot()))
    document["format_version"] = "9.0"
    status, _, body = import_snapshot(server, json.dumps(document).encode())
    assert status == 422
    error = json.loads(body)["error"]
    assert error == {"code": "invalid", "message": "unsupported snapshot format version '9.0'"}
    assert json.loads(get(server, "/api/maps")[2]) == {"maps": []}
    assert not list((server.data_dir / "tmp").iterdir())


@pytest.mark.parametrize(
    ("body", "fragment"),
    [
        (b"", "not valid JSON"),
        (b"not json at all", "not valid JSON"),
        (b"\xff\xfe\xfd", "not valid JSON"),
        (b'{"format": "other"}', "not a Schema Map snapshot"),
        (b"[]", "not a Schema Map snapshot"),
        (gzip.compress(b"{broken"), "not valid JSON"),
        (b"\x1f\x8b" + b"junk" * 10, "not a valid snapshot file"),
    ],
)
def test_a_file_that_is_not_a_snapshot_is_422_with_a_plain_message(
    server: LauncherServer, body: bytes, fragment: str
) -> None:
    rig_server(server)
    status, _, answer = import_snapshot(server, body)
    assert status == 422
    error = json.loads(answer)["error"]
    assert error["code"] == "invalid" and fragment in error["message"]
    assert json.loads(get(server, "/api/maps")[2]) == {"maps": []}


def test_a_long_validation_report_is_cut_short(server: LauncherServer) -> None:
    rig_server(server)
    document = json.loads(dump_snapshot(small_snapshot()))
    document["tables"] = [{"nonsense": n} for n in range(200)]
    status, _, body = import_snapshot(server, json.dumps(document).encode())
    assert status == 422
    assert len(json.loads(body)["error"]["message"]) <= 1100


def test_an_upload_over_the_limit_is_413_before_it_is_read(
    server: LauncherServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    rig_server(server)
    monkeypatch.setattr(server_module, "MAX_IMPORT_BYTES", 100)
    status, _, body = import_snapshot(server, b"x" * 101)
    assert status == 413 and json.loads(body)["error"]["code"] == "too_large"
    assert (
        import_snapshot(server, b"x" * 100)[0] == 422
    )  # exactly the limit is read (and refused as not a snapshot)


def test_the_import_limit_is_100_megabytes_and_json_bodies_stay_at_one() -> None:
    assert server_module.MAX_IMPORT_BYTES == 100 * 1024 * 1024
    assert server_module.MAX_BODY_BYTES == 1024 * 1024


@pytest.mark.parametrize(
    "content_type", ["text/plain", "application/octet-stream", "", "image/png"]
)
def test_an_upload_of_another_media_type_is_415(server: LauncherServer, content_type: str) -> None:
    rig_server(server)
    status, _, body = import_snapshot(server, b"{}", content_type)
    assert status == 415
    assert json.loads(body)["error"]["code"] == "unsupported_media_type"


def test_an_upload_without_content_length_is_411(server: LauncherServer) -> None:
    status, _, body = request(
        server,
        "/api/maps/import",
        method="POST",
        headers=AUTH | {"Content-Type": "application/json"},
    )
    assert status == 411
    assert json.loads(body)["error"]["code"] == "length_required"


def test_a_chunked_upload_is_refused(server: LauncherServer) -> None:
    status, _, _ = request(
        server,
        "/api/maps/import",
        method="POST",
        headers=AUTH | {"Content-Type": "application/json", "Transfer-Encoding": "chunked"},
        body=b"2\r\n{}\r\n0\r\n\r\n",
    )
    assert status == 411


def test_an_import_with_a_missing_viewer_is_a_500_that_names_the_cause(
    server: LauncherServer,
) -> None:
    def no_viewer() -> Any:
        from schemamap.errors import ViewerUnavailableError

        raise ViewerUnavailableError("The packaged viewer is not built. Build it.")

    rig_server(server)
    server.library = MapLibrary(server.data_dir, template=no_viewer)
    status, _, body = import_snapshot(server, dump_snapshot(small_snapshot()).encode())
    assert status == 500
    assert json.loads(body)["error"]["code"] == "viewer_unavailable"
    assert not list((server.data_dir / "tmp").iterdir())


# -- tmp and shutdown -------------------------------------------------------------------------


def test_leftovers_in_tmp_are_cleared_when_the_server_starts(tmp_path: Path) -> None:
    leftover = tmp_path / "data" / "tmp" / "upload-old.tmp"
    leftover.parent.mkdir(parents=True)
    leftover.write_bytes(b"x")
    with serving(tmp_path):
        assert not leftover.exists()


def test_closing_the_server_cancels_a_running_job_and_empties_tmp(tmp_path: Path) -> None:
    with serving(tmp_path) as (running, _):
        _, extractor = rig_server(running, extractor=Extractor(pause_before=Section.TABLES))
        job_id = start_job(running)
        assert extractor.reached.wait(5)
        (running.data_dir / "tmp").mkdir(parents=True, exist_ok=True)
        (running.data_dir / "tmp" / "upload-x.tmp").write_bytes(b"x")
        # Shutdown asks the job to cancel first; the extract is let go a moment later.
        threading.Timer(0.2, extractor.release.set).start()
        running.server_close()
        status = running.jobs.status(job_id)
        assert status is not None and status["state"] == "cancelled"
        assert not (running.data_dir / "tmp").exists()


# -- the password -----------------------------------------------------------------------------

FAILURES: list[Callable[[str], Exception]] = [
    lambda pw: ConnectError(f"Login failed. Fix: Check it. Driver said: PWD={pw} {pw}"),
    lambda pw: ConnectError(f"bad string: UID=u;PWD={{{pw.replace('}', '}}')}}}"),
]


@pytest.mark.parametrize("password", HOSTILE_PASSWORDS)
@pytest.mark.parametrize("failure", FAILURES)
def test_a_hostile_password_is_in_no_response_log_or_file_even_when_the_job_fails(
    server: LauncherServer,
    password: str,
    failure: Callable[[str], Exception],
    caplog: pytest.LogCaptureFixture,
    capfd: pytest.CaptureFixture[str],
) -> None:
    caplog.set_level(logging.DEBUG)
    rig_server(server, opener=Opener(failure=failure(password)))
    bodies: list[bytes] = []
    status, _, body = post_json(
        server, "/api/jobs", json.dumps({"connection": connection(password)}).encode(), **AUTH
    )
    bodies.append(body)
    assert status == 202
    job_id = json.loads(body)["job_id"]
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        _, _, body = get(server, f"/api/jobs/{job_id}")
        bodies.append(body)
        if json.loads(body)["state"] != "running":
            break
        time.sleep(0.005)
    assert json.loads(body)["state"] == "failed"
    assert_no_password(password, bodies=bodies, server=server, caplog=caplog, capfd=capfd)


@pytest.mark.parametrize("password", HOSTILE_PASSWORDS)
def test_a_hostile_password_is_in_no_saved_file_when_the_job_succeeds(
    server: LauncherServer,
    password: str,
    caplog: pytest.LogCaptureFixture,
    capfd: pytest.CaptureFixture[str],
) -> None:
    caplog.set_level(logging.DEBUG)
    rig_server(server)
    job_id = start_job(server, {"connection": connection(password), "remember": True})
    done = wait_for(server, job_id)
    assert done["state"] == "done"
    bodies = [json.dumps(done).encode(), get(server, "/api/maps")[2]]
    assert_no_password(password, bodies=bodies, server=server, caplog=caplog, capfd=capfd)
