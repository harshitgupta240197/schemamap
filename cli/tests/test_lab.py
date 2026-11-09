"""Unit tests for the pure parts of tools/lab.py. No Docker or database needed."""

import http.server
import os
import subprocess
import threading
from collections.abc import Iterator
from pathlib import Path
from types import ModuleType

import pytest


def test_generate_password_is_strong_and_safe(lab: ModuleType) -> None:
    for _ in range(50):
        password = lab.generate_password()
        assert len(password) == 24
        assert password.isalnum()
        assert any(c.islower() for c in password)
        assert any(c.isupper() for c in password)
        assert any(c.isdigit() for c in password)


def test_generate_password_is_random(lab: ModuleType) -> None:
    assert len({lab.generate_password() for _ in range(20)}) == 20


def test_generate_password_rejects_short_length(lab: ModuleType) -> None:
    with pytest.raises(ValueError, match="at least 16"):
        lab.generate_password(8)


def test_parse_env_handles_comments_quotes_and_equals(lab: ModuleType) -> None:
    text = "# comment\n\nA=1\nB = two \nC='quoted'\nD=\"dq\"\nE=x=y\nnot a pair\nA=override\n"
    assert lab.parse_env(text) == {
        "A": "override",
        "B": "two",
        "C": "quoted",
        "D": "dq",
        "E": "x=y",
    }


def test_render_env_puts_lab_keys_first_and_round_trips(lab: ModuleType) -> None:
    values = {"OTHER": "z", lab.ENV_READER: "r", lab.ENV_SA: "s"}
    text = lab.render_env(values)
    lines = [ln for ln in text.splitlines() if not ln.startswith("#")]
    assert lines == [f"{lab.ENV_SA}=s", f"{lab.ENV_READER}=r", "OTHER=z"]
    assert lab.parse_env(text) == values


def test_ensure_env_creates_private_file_with_both_passwords(
    lab: ModuleType, tmp_path: Path
) -> None:
    path = tmp_path / ".env"
    values = lab.ensure_env(path)
    assert set(lab.ENV_KEYS) <= set(values)
    assert values[lab.ENV_SA] != values[lab.ENV_READER]
    assert lab.parse_env(path.read_text()) == values
    if os.name != "nt":
        assert path.stat().st_mode & 0o777 == 0o600
    assert not (tmp_path / ".env.tmp").exists()


def test_ensure_env_is_idempotent(lab: ModuleType, tmp_path: Path) -> None:
    path = tmp_path / ".env"
    first = lab.ensure_env(path)
    before = path.read_text()
    assert lab.ensure_env(path) == first
    assert path.read_text() == before


def test_ensure_env_fills_only_missing_or_empty_keys(lab: ModuleType, tmp_path: Path) -> None:
    path = tmp_path / ".env"
    path.write_text(f"KEEP=me\n{lab.ENV_SA}=existing-sa\n{lab.ENV_READER}=\n")
    values = lab.ensure_env(path)
    assert values["KEEP"] == "me"
    assert values[lab.ENV_SA] == "existing-sa"
    assert values[lab.ENV_READER].isalnum()
    assert lab.parse_env(path.read_text()) == values


def test_credentials_from_env_requires_both_passwords(lab: ModuleType) -> None:
    with pytest.raises(lab.LabError, match="not set"):
        lab.credentials_from_env({lab.ENV_SA: "x"})


def test_credentials_from_env_rejects_unsafe_reader_password(lab: ModuleType) -> None:
    with pytest.raises(lab.LabError, match="letters and digits"):
        lab.credentials_from_env({lab.ENV_SA: "x", lab.ENV_READER: "bad'; DROP"})


def test_redact_hides_secrets_and_ignores_empty(lab: ModuleType) -> None:
    assert lab.redact("login failed for hunter2 and s3cret", ["hunter2", "s3cret", ""]) == (
        "login failed for *** and ***"
    )


def test_catalog_has_the_three_official_backups(lab: ModuleType) -> None:
    assert list(lab.CATALOG) == ["AdventureWorks2022", "AdventureWorksDW2022", "WideWorldImporters"]
    for backup in lab.CATALOG.values():
        assert backup.url.startswith("https://github.com/microsoft/sql-server-samples/")
        assert backup.url.endswith(backup.filename)
        assert backup.size > 0


def test_resolve_databases(lab: ModuleType) -> None:
    assert [b.database for b in lab.resolve_databases("all")] == list(lab.CATALOG)
    assert [b.database for b in lab.resolve_databases("WideWorldImporters")] == [
        "WideWorldImporters"
    ]
    with pytest.raises(lab.LabError, match="Unknown database"):
        lab.resolve_databases("master")


FILELIST = (
    "WWI_Primary|D:\\Data\\WideWorldImporters.mdf|D|PRIMARY|1073741824\n"
    "WWI_Log|D:\\Data\\WideWorldImporters.ldf|L|NULL|104857600\n"
    "WWI_InMemory_Data_1|D:\\Data\\WideWorldImporters_InMemory_Data_1|S|WWI_InMemory_Data|0\n"
    "\n"
)


def test_parse_filelist_reads_first_three_columns(lab: ModuleType) -> None:
    files = lab.parse_filelist(FILELIST)
    assert [(f.name, f.kind) for f in files] == [
        ("WWI_Primary", "D"),
        ("WWI_Log", "L"),
        ("WWI_InMemory_Data_1", "S"),
    ]
    assert files[0].physical_name == "D:\\Data\\WideWorldImporters.mdf"


def test_parse_filelist_rejects_empty_and_malformed_output(lab: ModuleType) -> None:
    with pytest.raises(lab.LabError, match="no files"):
        lab.parse_filelist("\n")
    with pytest.raises(lab.LabError, match="Unexpected"):
        lab.parse_filelist("Msg 3201, Level 16: cannot open backup device\n")


def test_build_moves_relocates_files_and_keeps_extensions(lab: ModuleType) -> None:
    moves = lab.build_moves("WideWorldImporters", lab.parse_filelist(FILELIST))
    assert moves == (
        ", MOVE N'WWI_Primary' TO N'/var/opt/mssql/data/WideWorldImporters_WWI_Primary.mdf'"
        ", MOVE N'WWI_Log' TO N'/var/opt/mssql/data/WideWorldImporters_WWI_Log.ldf'"
        ", MOVE N'WWI_InMemory_Data_1'"
        " TO N'/var/opt/mssql/data/WideWorldImporters_WWI_InMemory_Data_1'"
    )


@pytest.mark.parametrize("name", ["a'b", "x'; DROP DATABASE y;--", "a b", "", "a]b"])
def test_build_moves_rejects_unsafe_logical_names(lab: ModuleType, name: str) -> None:
    files = [lab.LogicalFile(name, "C:\\x.mdf", "D")]
    with pytest.raises(lab.LabError, match="unsafe"):
        lab.build_moves("Db", files)


def test_build_moves_rejects_unsafe_extension_and_database(lab: ModuleType) -> None:
    with pytest.raises(lab.LabError, match="extension"):
        lab.build_moves("Db", [lab.LogicalFile("ok", "C:\\x.m'df", "D")])
    with pytest.raises(lab.LabError, match="database name"):
        lab.build_moves("D]b", [lab.LogicalFile("ok", "C:\\x.mdf", "D")])


class _Handler(http.server.BaseHTTPRequestHandler):
    payload = b"0123456789" * 1000

    def do_GET(self) -> None:
        if self.path == "/garbage":
            self.wfile.write(b"this is not http\r\n\r\n")
            return
        # /short: honest but too small. /lie: declares the full length, then cuts the body.
        body = self.payload[:5000] if self.path in ("/short", "/lie") else self.payload
        declared = len(self.payload) if self.path == "/lie" else len(body)
        self.send_response(200)
        self.send_header("Content-Length", str(declared))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        pass


@pytest.fixture(autouse=True)
def no_backoff(lab: ModuleType, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(lab, "BACKOFF_BASE_SECONDS", 0)


@pytest.fixture
def server() -> Iterator[str]:
    httpd = http.server.HTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()
    thread.join()


def test_download_saves_verified_file(lab: ModuleType, server: str, tmp_path: Path) -> None:
    dest = tmp_path / "sub" / "a.bak"
    lab.download(f"{server}/ok", dest, 10_000)
    assert dest.read_bytes() == _Handler.payload
    assert list(dest.parent.glob("*.part")) == []


def test_download_rejects_wrong_size_and_cleans_up(
    lab: ModuleType, server: str, tmp_path: Path
) -> None:
    dest = tmp_path / "a.bak"
    with pytest.raises(lab.LabError, match="expected 9999"):
        lab.download(f"{server}/ok", dest, 9_999)
    assert not dest.exists()
    assert list(tmp_path.glob("*.part")) == []


def test_download_rejects_truncated_body(lab: ModuleType, server: str, tmp_path: Path) -> None:
    dest = tmp_path / "a.bak"
    with pytest.raises(lab.LabError, match="downloaded 5000 bytes, expected 10000"):
        lab.download(f"{server}/lie", dest, 10_000)
    assert not dest.exists()
    # The bytes received so far are kept in the .part file so the next run can resume.
    assert (tmp_path / "a.bak.part").stat().st_size == 5000


def test_download_reports_malformed_http_response(
    lab: ModuleType, server: str, tmp_path: Path
) -> None:
    dest = tmp_path / "a.bak"
    with pytest.raises(lab.LabError, match="Could not download"):
        lab.download(f"{server}/garbage", dest, 10_000)
    assert list(tmp_path.glob("*.part")) == []


def test_download_rejects_mismatched_content_length(
    lab: ModuleType, server: str, tmp_path: Path
) -> None:
    dest = tmp_path / "a.bak"
    with pytest.raises(lab.LabError, match="server reports 5000 bytes"):
        lab.download(f"{server}/short", dest, 10_000)
    assert not dest.exists()
    assert list(tmp_path.glob("*.part")) == []


def test_ensure_backup_skips_complete_file_and_replaces_wrong_size(
    lab: ModuleType, server: str, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    backup = lab.Backup("Db", "a.bak", f"{server}/ok", 10_000)
    (tmp_path / "a.bak").write_bytes(b"truncated")
    assert lab.ensure_backup(backup, tmp_path).read_bytes() == _Handler.payload
    assert "downloading" in capsys.readouterr().out
    lab.ensure_backup(backup, tmp_path)
    assert "already downloaded" in capsys.readouterr().out


def test_minimal_reader_is_granted_view_definition_and_nothing_else(lab: ModuleType) -> None:
    script = (Path(lab.REPO_ROOT) / "tools" / "lab-sql" / "grant_reader.sql").read_text()
    statements = [s.strip() for s in script.split(";") if "schemamap_reader_min" in s]
    grants = [s.splitlines()[-1] for s in statements if s.splitlines()[-1].startswith("GRANT")]
    assert grants == ["GRANT VIEW DEFINITION TO [schemamap_reader_min]"]
    assert lab.READER_MIN_LOGIN == "schemamap_reader_min"


# --- CI mode: credentials from environment variables when .env is absent ---------------------

CI_SA = "CiSaSecretValue1234567"
CI_READER = "CiReaderSecretValue12345"


@pytest.fixture
def ci_env(lab: ModuleType, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """No .env, both lab passwords in the environment; returns the (absent) .env path."""
    env_path = tmp_path / ".env"
    monkeypatch.setattr(lab, "ENV_PATH", env_path)
    monkeypatch.setattr(lab, "BACKUP_DIR", tmp_path / "backups")
    monkeypatch.setattr(lab, "DATA_DIR", tmp_path / "mssql")
    monkeypatch.setenv(lab.ENV_SA, CI_SA)
    monkeypatch.setenv(lab.ENV_READER, CI_READER)
    return env_path


def test_environ_credentials_needs_both_passwords(lab: ModuleType) -> None:
    both = {lab.ENV_SA: "a", lab.ENV_READER: "b", "UNRELATED": "x"}
    assert lab.environ_credentials(both) == {lab.ENV_SA: "a", lab.ENV_READER: "b"}
    assert lab.environ_credentials({lab.ENV_SA: "a"}) == {}
    assert lab.environ_credentials({lab.ENV_SA: "a", lab.ENV_READER: ""}) == {}
    assert lab.environ_credentials({}) == {}


def test_read_env_falls_back_to_environment_only_without_a_file(
    lab: ModuleType, tmp_path: Path
) -> None:
    environ = {lab.ENV_SA: "from-env", lab.ENV_READER: "from-env"}
    assert lab.read_env(tmp_path / "absent.env", environ) == environ
    assert lab.read_env(tmp_path / "absent.env", {}) == {}
    present = tmp_path / ".env"
    present.write_text(f"{lab.ENV_SA}=from-file\n{lab.ENV_READER}=from-file\n", encoding="utf-8")
    assert lab.read_env(present, environ)[lab.ENV_SA] == "from-file"


def test_env_for_up_in_ci_mode_writes_nothing(lab: ModuleType, tmp_path: Path) -> None:
    path = tmp_path / ".env"
    environ = {lab.ENV_SA: "a", lab.ENV_READER: "b"}
    assert lab.env_for_up(path, environ) == environ
    assert not path.exists()
    assert list(tmp_path.iterdir()) == []


def test_env_for_up_without_ci_credentials_still_generates_the_file(
    lab: ModuleType, tmp_path: Path
) -> None:
    path = tmp_path / ".env"
    values = lab.env_for_up(path, {lab.ENV_SA: "only-one"})
    assert path.exists()
    assert values[lab.ENV_SA] != "only-one"


def test_up_with_environment_credentials_never_prints_a_password(
    lab: ModuleType,
    ci_env: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    passed: list[str | None] = []
    monkeypatch.setattr(lab, "check_docker", lambda: None)
    monkeypatch.setattr(lab, "docker_memory_bytes", lambda: None)
    monkeypatch.setattr(lab, "compose", lambda args, sa_password=None: passed.append(sa_password))
    monkeypatch.setattr(lab, "wait_ready", lambda creds: 1.0)

    assert lab.main(["up"]) == 0

    shown = capsys.readouterr()
    for secret in (CI_SA, CI_READER):
        assert secret not in shown.out
        assert secret not in shown.err
    assert passed == [CI_SA]  # the SA password still reaches compose, through the environment
    assert not ci_env.exists()


def test_failing_command_with_environment_credentials_redacts_the_output(
    lab: ModuleType,
    ci_env: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    leaky = subprocess.CompletedProcess(
        args=[], returncode=1, stdout=f"login {CI_SA}", stderr=f"retry with {CI_SA}"
    )
    monkeypatch.setattr(lab, "check_docker", lambda: None)
    monkeypatch.setattr(lab, "docker_memory_bytes", lambda: None)
    monkeypatch.setattr(lab, "_run", lambda *args, **kwargs: leaky)

    assert lab.main(["up"]) == 1

    shown = capsys.readouterr()
    assert CI_SA not in shown.out + shown.err
    assert "***" in shown.err


def test_down_with_environment_credentials_passes_the_password_only_as_environment(
    lab: ModuleType,
    ci_env: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    calls: list[tuple[list[str], dict[str, str] | None]] = []

    def fake_run(cmd: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        env = kwargs.get("env")
        calls.append((list(cmd), env if isinstance(env, dict) else None))
        return subprocess.CompletedProcess(args=cmd, returncode=0, stdout="", stderr="")

    monkeypatch.setattr(lab, "check_docker", lambda: None)
    monkeypatch.setattr(lab, "_run", fake_run)

    assert lab.main(["down"]) == 0

    shown = capsys.readouterr()
    assert CI_SA not in shown.out + shown.err
    assert calls
    for cmd, env in calls:
        assert not any(CI_SA in part or CI_READER in part for part in cmd)
        assert env is not None
        assert env[lab.ENV_SA] == CI_SA


def test_lab_host_is_the_address_compose_publishes_on(lab: ModuleType) -> None:
    # "localhost" resolves to ::1 first on Linux, where nothing listens (found in CI).
    compose = (Path(lab.REPO_ROOT) / "docker-compose.yml").read_text(encoding="utf-8")
    assert lab.HOST == "127.0.0.1"
    assert f'"{lab.HOST}:{lab.HOST_PORT}:1433"' in compose
