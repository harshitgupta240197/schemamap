#!/usr/bin/env python3
"""Local SQL Server lab for Schema Map (Python standard library only).

    uv run tools/lab.py up                  start SQL Server 2022 in Docker, wait until ready
    uv run tools/lab.py restore all         download and restore the sample databases
    uv run tools/lab.py status              show what is running and restored
    uv run tools/lab.py down [--purge]      stop the container (--purge also wipes its data)

The lab is a test fixture: it creates logins and restores databases, but only ever
inside the throwaway `schemamap-lab` container. Passwords are generated into `.env`
(gitignored) and are never printed. See docs/LAB.md.
"""

from __future__ import annotations

import argparse
import http.client
import json
import os
import re
import secrets
import shutil
import string
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path, PureWindowsPath
from typing import TypeVar

T = TypeVar("T")

REPO_ROOT = Path(__file__).resolve().parent.parent
COMPOSE_FILE = REPO_ROOT / "docker-compose.yml"
ENV_PATH = REPO_ROOT / ".env"
BACKUP_DIR = REPO_ROOT / "lab-data" / "backups"
DATA_DIR = REPO_ROOT / "lab-data" / "mssql"

CONTAINER = "schemamap-lab"
SERVICE = "sqlserver"
HOST_PORT = 14330
SQLCMD = "/opt/mssql-tools18/bin/sqlcmd"
SQL_DIR_IN_CONTAINER = "/lab-sql"
BACKUP_DIR_IN_CONTAINER = "/backups"
DATA_DIR_IN_CONTAINER = "/var/opt/mssql/data"

READER_LOGIN = "schemamap_reader"
EDGE_CASES_DB = "SchemaMapEdgeCases"
ENV_SA = "SCHEMAMAP_LAB_SA_PASSWORD"
ENV_READER = "SCHEMAMAP_LAB_READER_PASSWORD"
ENV_KEYS = (ENV_SA, ENV_READER)

MIN_DOCKER_MEMORY = 4 * 1024**3
READY_TIMEOUT_SECONDS = 240
RESTORE_TIMEOUT_SECONDS = 900
PASSWORD_LENGTH = 24

DOWNLOAD_ATTEMPTS = 3
BACKOFF_BASE_SECONDS = 2.0  # waits 2 s, then 4 s, between attempts
DOWNLOAD_TIMEOUT_SECONDS = 60
USER_AGENT = "schemamap-lab"
ENV_GITHUB_TOKEN = "GITHUB_TOKEN"

_SAFE_NAME = re.compile(r"^[A-Za-z0-9_.\-]+$")
_DB_NAME = re.compile(r"^[A-Za-z0-9_]+$")
_READER_PASSWORD = re.compile(r"^[A-Za-z0-9]+$")


class LabError(Exception):
    """A problem the user can act on; the CLI prints it and exits with status 1."""


@dataclass(frozen=True)
class Backup:
    """One official sample database backup."""

    database: str
    filename: str
    url: str
    size: int
    tag: str = ""  # release tag; lets a failed download fall back to the GitHub API


SAMPLES_REPO = "microsoft/sql-server-samples"
GITHUB_API = "https://api.github.com"
_ADVENTUREWORKS_TAG = "adventureworks"
_WWI_TAG = "wide-world-importers-v1.0"
_RELEASES = f"https://github.com/{SAMPLES_REPO}/releases/download"
_ADVENTUREWORKS = f"{_RELEASES}/{_ADVENTUREWORKS_TAG}"
_WWI = f"{_RELEASES}/{_WWI_TAG}"

# Sizes are the byte counts of the release assets, used to verify each download.
CATALOG: dict[str, Backup] = {
    b.database: b
    for b in (
        Backup(
            "AdventureWorks2022",
            "AdventureWorks2022.bak",
            f"{_ADVENTUREWORKS}/AdventureWorks2022.bak",
            209_838_080,
            _ADVENTUREWORKS_TAG,
        ),
        Backup(
            "AdventureWorksDW2022",
            "AdventureWorksDW2022.bak",
            f"{_ADVENTUREWORKS}/AdventureWorksDW2022.bak",
            101_834_752,
            _ADVENTUREWORKS_TAG,
        ),
        Backup(
            "WideWorldImporters",
            "WideWorldImporters-Full.bak",
            f"{_WWI}/WideWorldImporters-Full.bak",
            127_111_168,
            _WWI_TAG,
        ),
    )
}


@dataclass(frozen=True)
class Credentials:
    """Lab passwords. Held in memory only; never printed or logged."""

    sa: str
    reader: str

    def secrets(self) -> tuple[str, str]:
        return (self.sa, self.reader)


@dataclass(frozen=True)
class LogicalFile:
    """One file inside a backup, as reported by RESTORE FILELISTONLY."""

    name: str
    physical_name: str
    kind: str


# ---------------------------------------------------------------------------
# Pure helpers (unit tested, no I/O beyond the paths they are given)
# ---------------------------------------------------------------------------


def generate_password(length: int = PASSWORD_LENGTH) -> str:
    """Return a random password with upper, lower and digit characters, letters and digits only.

    Letters and digits only keeps the value safe in .env, in compose interpolation
    and inside a T-SQL string literal, and still satisfies the SQL Server policy.
    """
    if length < 16:
        raise ValueError("password length must be at least 16")
    classes = (string.ascii_lowercase, string.ascii_uppercase, string.digits)
    chars = [secrets.choice(c) for c in classes]
    pool = "".join(classes)
    chars.extend(secrets.choice(pool) for _ in range(length - len(chars)))
    secrets.SystemRandom().shuffle(chars)
    return "".join(chars)


def parse_env(text: str) -> dict[str, str]:
    """Parse KEY=VALUE lines. Blank lines and `#` comments are ignored; the last value wins."""
    values: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        values[key.strip()] = value
    return values


def render_env(values: dict[str, str]) -> str:
    """Render values as a .env file. Lab keys come first, then any others, each in order."""
    header = "# Generated by tools/lab.py. Gitignored. Never commit or share this file.\n"
    ordered = [k for k in ENV_KEYS if k in values] + [k for k in values if k not in ENV_KEYS]
    return header + "".join(f"{k}={values[k]}\n" for k in ordered)


def ensure_env(path: Path) -> dict[str, str]:
    """Return the env values at `path`, generating and saving any missing lab password.

    Existing values are never changed. The file is written with mode 0600.
    """
    existing = parse_env(path.read_text(encoding="utf-8")) if path.exists() else {}
    missing = [k for k in ENV_KEYS if not existing.get(k)]
    if not missing:
        return existing
    merged = {**existing, **{k: generate_password() for k in missing}}
    tmp = path.with_name(path.name + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(render_env(merged))
    os.replace(tmp, path)
    return merged


def redact(text: str, secret_values: Iterable[str]) -> str:
    """Replace every secret in `text` with `***`, so tool output is safe to show."""
    for secret in secret_values:
        if secret:
            text = text.replace(secret, "***")
    return text


def resolve_databases(name: str) -> list[Backup]:
    """Map a CLI argument (`all` or a catalog database name) to backups, in catalog order."""
    if name == "all":
        return list(CATALOG.values())
    if name not in CATALOG:
        known = ", ".join([*CATALOG, "all"])
        raise LabError(f"Unknown database {name!r}. Choose one of: {known}.")
    return [CATALOG[name]]


def parse_filelist(output: str) -> list[LogicalFile]:
    """Parse `sqlcmd -h -1 -W -s "|"` output of RESTORE FILELISTONLY (first three columns)."""
    files: list[LogicalFile] = []
    for line in output.splitlines():
        if not line.strip():
            continue
        fields = line.split("|")
        if len(fields) < 3:
            raise LabError(f"Unexpected RESTORE FILELISTONLY output line: {line!r}")
        files.append(LogicalFile(fields[0].strip(), fields[1].strip(), fields[2].strip()))
    if not files:
        raise LabError("RESTORE FILELISTONLY returned no files; is the backup valid?")
    return files


def build_moves(database: str, files: Sequence[LogicalFile]) -> str:
    """Build the `, MOVE ... TO ...` clauses that relocate a backup's files into the container.

    Logical names come from a downloaded file, so they are checked against a strict
    whitelist before being placed into T-SQL; nothing else is ever interpolated.
    """
    if not _DB_NAME.match(database):
        raise LabError(f"Unsafe database name {database!r}.")
    clauses: list[str] = []
    for file in files:
        if not _SAFE_NAME.match(file.name):
            raise LabError(f"Refusing to restore: unsafe logical file name {file.name!r}.")
        suffix = PureWindowsPath(file.physical_name).suffix
        if suffix and not _SAFE_NAME.match(suffix):
            raise LabError(f"Refusing to restore: unsafe file extension {suffix!r}.")
        target = f"{DATA_DIR_IN_CONTAINER}/{database}_{file.name}{suffix}"
        clauses.append(f", MOVE N'{file.name}' TO N'{target}'")
    return "".join(clauses)


def credentials_from_env(values: dict[str, str]) -> Credentials:
    """Validate env values into Credentials, with actionable errors."""
    sa = values.get(ENV_SA, "")
    reader = values.get(ENV_READER, "")
    if not sa or not reader:
        raise LabError("The lab passwords are not set. Run `uv run tools/lab.py up` first.")
    if not _READER_PASSWORD.match(reader):
        raise LabError(
            f"{ENV_READER} in .env must be letters and digits only. "
            "Delete that line and run `up` to generate a fresh one."
        )
    return Credentials(sa=sa, reader=reader)


def read_env(path: Path = ENV_PATH) -> dict[str, str]:
    """Read the lab .env if it exists (empty dict if not)."""
    return parse_env(path.read_text(encoding="utf-8")) if path.exists() else {}


# ---------------------------------------------------------------------------
# Downloading
# ---------------------------------------------------------------------------


class _Interrupted(Exception):
    """A failure worth retrying: a 5xx answer, a dropped connection or a short body."""


class _RangeRejected(_Interrupted):
    """The server refused a Range request, so the partial file cannot be extended."""


def _open(
    url: str, headers: dict[str, str], have: int, authorize: bool
) -> http.client.HTTPResponse:
    """Open `url`, asking for the bytes from offset `have` on when `have` is not zero.

    With `authorize`, GITHUB_TOKEN (if set) is sent as an *unredirected* header, so it
    reaches only this host and is dropped when GitHub redirects to its file storage.
    """
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **headers})
    if have:
        request.add_header("Range", f"bytes={have}-")
    token = os.environ.get(ENV_GITHUB_TOKEN)
    if authorize and token:
        request.add_unredirected_header("Authorization", f"Bearer {token}")
    try:
        response: http.client.HTTPResponse = urllib.request.urlopen(
            request, timeout=DOWNLOAD_TIMEOUT_SECONDS
        )
    except urllib.error.HTTPError as exc:
        exc.close()
        if exc.code == 416 and have:
            raise _RangeRejected("the server rejected the partial download") from exc
        if exc.code >= 500:
            raise _Interrupted(f"HTTP {exc.code} {exc.reason}") from exc
        raise LabError(f"HTTP {exc.code} {exc.reason}") from exc
    except (urllib.error.URLError, http.client.HTTPException, OSError) as exc:
        raise _Interrupted(str(exc)) from exc
    return response


def _stream(response: http.client.HTTPResponse, part: Path, expected: int, resumed: bool) -> None:
    """Append the body to `part`, printing progress every ten percent."""
    try:
        with part.open("ab" if resumed else "wb") as out:
            received = out.tell()
            next_report = received * 100 // expected // 10 * 10 + 10
            while chunk := response.read(1024 * 1024):
                out.write(chunk)
                received += len(chunk)
                percent = received * 100 // expected
                if percent >= next_report:
                    print(f"  {part.name}: {min(percent, 100)}%", flush=True)
                    next_report = percent // 10 * 10 + 10
    except (http.client.HTTPException, OSError) as exc:
        raise _Interrupted(f"connection lost: {exc}") from exc


def _attempt(url: str, part: Path, expected: int, headers: dict[str, str], authorize: bool) -> None:
    """Make one request, resuming `part` with a Range header if it already has bytes.

    Returns once `part` holds exactly `expected` bytes. Raises `_Interrupted` for failures
    worth retrying and `LabError` for ones that retrying cannot fix.
    """
    have = part.stat().st_size if part.exists() else 0
    if have > expected:
        part.unlink()
        have = 0
    if have == expected:
        return
    try:
        response = _open(url, headers, have, authorize)
    except _RangeRejected:
        part.unlink()  # the partial file does not belong to this file; start again
        raise
    with response:
        resumed = have > 0 and response.status == 206
        if resumed and not (response.headers.get("Content-Range") or "").startswith(
            f"bytes {have}-"
        ):
            part.unlink(missing_ok=True)
            raise LabError("the server answered a Range request with the wrong range.")
        remaining = expected - (have if resumed else 0)
        length = response.headers.get("Content-Length")
        if length is not None and int(length) != remaining:
            part.unlink(missing_ok=True)
            raise LabError(f"server reports {length} bytes, expected {remaining}.")
        _stream(response, part, expected, resumed)
    actual = part.stat().st_size
    if actual > expected:
        part.unlink()
        raise LabError(f"downloaded {actual} bytes, expected {expected}.")
    if actual < expected:
        raise _Interrupted(f"downloaded {actual} bytes, expected {expected}")


def _with_retries(action: Callable[[], T]) -> T:
    """Run `action`, retrying `_Interrupted` failures with exponential backoff."""
    for attempt in range(1, DOWNLOAD_ATTEMPTS + 1):
        try:
            return action()
        except _Interrupted as exc:
            if attempt == DOWNLOAD_ATTEMPTS:
                raise LabError(f"{exc} (gave up after {DOWNLOAD_ATTEMPTS} attempts)") from exc
            delay = BACKOFF_BASE_SECONDS * 2 ** (attempt - 1)
            print(f"  {exc}; retrying in {delay:g}s (attempt {attempt + 1} of {DOWNLOAD_ATTEMPTS})")
            time.sleep(delay)
    raise AssertionError("unreachable")  # pragma: no cover


def _find_asset(tag: str, filename: str, expected: int) -> str:
    """Ask the GitHub API for the asset endpoint URL of `filename` in release `tag`."""

    def lookup() -> bytes:
        url = f"{GITHUB_API}/repos/{SAMPLES_REPO}/releases/tags/{tag}"
        headers = {"Accept": "application/vnd.github+json"}
        with _open(url, headers, 0, authorize=True) as response:
            try:
                return bytes(response.read())
            except (http.client.HTTPException, OSError) as exc:
                raise _Interrupted(f"connection lost: {exc}") from exc

    try:
        release = json.loads(_with_retries(lookup))
        assets = release["assets"]
        asset = next(a for a in assets if a["name"] == filename)
        asset_url, size = str(asset["url"]), int(asset["size"])
    except (ValueError, KeyError, TypeError, StopIteration) as exc:
        raise LabError(f"release {tag!r} has no usable asset named {filename}.") from exc
    if not asset_url.startswith(f"{GITHUB_API}/"):
        raise LabError(f"release {tag!r} points {filename} at an unexpected host.")
    if size != expected:
        raise LabError(f"GitHub lists {filename} as {size} bytes, expected {expected}.")
    return asset_url


def _manual_instructions(dest: Path, backup_url: str, expected: int) -> str:
    try:
        folder = dest.parent.relative_to(REPO_ROOT)
    except ValueError:
        folder = dest.parent
    return (
        f"To continue without the script, download {backup_url} in a browser and save it as "
        f"{dest.name} ({expected:,} bytes) in the folder {folder}. "
        "Running `uv run tools/lab.py restore` again will pick it up."
    )


def download(url: str, dest: Path, expected_size: int, tag: str = "") -> None:
    """Download `url` to `dest` through a `.part` file, verifying the exact byte count.

    Retries 5xx answers and dropped connections with exponential backoff and resumes a
    partial file with a Range request. If the direct URL still fails and `tag` names a
    release of the samples repository, it looks the asset up through the GitHub API and
    tries that route too. `dest` appears only after the size check passes.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    try:
        _with_retries(lambda: _attempt(url, part, expected_size, {}, authorize=False))
    except LabError as direct:
        failures = [f"direct download: {direct}"]
        if tag:
            print(f"  {dest.name}: direct download failed ({direct}); trying the GitHub API...")
            try:
                asset_url = _find_asset(tag, dest.name, expected_size)
                headers = {"Accept": "application/octet-stream"}
                _with_retries(lambda: _attempt(asset_url, part, expected_size, headers, True))
            except LabError as api:
                failures.append(f"GitHub API: {api}")
            else:
                os.replace(part, dest)
                return
        reasons = "".join(f"\n  - {failure}" for failure in failures)
        raise LabError(
            f"Could not download {dest.name}.{reasons}\n"
            + _manual_instructions(dest, url, expected_size)
        ) from direct
    os.replace(part, dest)


def ensure_backup(backup: Backup, directory: Path = BACKUP_DIR) -> Path:
    """Return the path to a verified backup, downloading it first if needed."""
    dest = directory / backup.filename
    if dest.exists() and dest.stat().st_size == backup.size:
        print(f"{backup.filename}: already downloaded ({backup.size:,} bytes).")
        return dest
    print(f"{backup.filename}: downloading {backup.size:,} bytes from Microsoft...")
    download(backup.url, dest, backup.size, backup.tag)
    print(f"{backup.filename}: verified.")
    return dest


# ---------------------------------------------------------------------------
# Docker and sqlcmd plumbing
# ---------------------------------------------------------------------------


def _run(
    cmd: Sequence[str],
    *,
    env: dict[str, str] | None = None,
    timeout: float | None = None,
) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            list(cmd),
            env=env,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError as exc:
        raise LabError("Docker is not installed or not on PATH.") from exc
    except subprocess.TimeoutExpired as exc:
        raise LabError(f"Timed out after {timeout:.0f}s running: {' '.join(cmd[:4])} ...") from exc


def check_docker() -> None:
    """Fail early with a clear message if Docker or Compose is unavailable."""
    if shutil.which("docker") is None:
        raise LabError("Docker is not installed or not on PATH. Install Docker Desktop first.")
    if _run(["docker", "info"], timeout=30).returncode != 0:
        raise LabError("Docker is installed but not running. Start Docker Desktop and retry.")
    if _run(["docker", "compose", "version"], timeout=30).returncode != 0:
        raise LabError("`docker compose` (Compose v2) is required but was not found.")


def docker_memory_bytes() -> int | None:
    """Total memory available to Docker, or None if it cannot be determined."""
    result = _run(["docker", "info", "--format", "{{.MemTotal}}"], timeout=30)
    try:
        return int(result.stdout.strip())
    except ValueError:
        return None


def memory_hint() -> str:
    return (
        "SQL Server needs at least 4 GB of memory allocated to Docker "
        "(Docker Desktop > Settings > Resources > Memory). "
        "On Apple Silicon the amd64 image runs under emulation, which also makes startup slower."
    )


def container_state() -> str | None:
    """The container's status (`running`, `exited`, ...) or None if it does not exist."""
    result = _run(["docker", "inspect", "-f", "{{.State.Status}}", CONTAINER], timeout=30)
    return result.stdout.strip() if result.returncode == 0 else None


def compose(args: Sequence[str], sa_password: str | None = None) -> None:
    """Run `docker compose` against the lab compose file; raise LabError on failure."""
    env = dict(os.environ)
    if sa_password:
        env[ENV_SA] = sa_password
    cmd = [
        "docker",
        "compose",
        "--project-directory",
        str(REPO_ROOT),
        "-f",
        str(COMPOSE_FILE),
        *args,
    ]
    result = _run(cmd, env=env, timeout=600)
    if result.returncode != 0:
        output = redact((result.stdout + result.stderr).strip(), [sa_password or ""])
        raise LabError(f"`docker compose {args[0]}` failed:\n{output}")


def run_sqlcmd(
    user: str,
    password: str,
    *,
    sql_file: str | None = None,
    query: str | None = None,
    database: str | None = None,
    extra_env: dict[str, str] | None = None,
    tabular: bool = False,
    timeout: float = 60,
) -> subprocess.CompletedProcess[str]:
    """Run sqlcmd inside the lab container.

    Passwords and other variables travel as environment variables (`docker exec -e NAME`
    copies the value from this process), so they never appear in a command line. SQL
    files under tools/lab-sql read them as `$(NAME)` scripting variables.
    """
    extra_env = extra_env or {}
    cmd = ["docker", "exec", "-e", "SQLCMDPASSWORD"]
    for name in extra_env:
        cmd += ["-e", name]
    cmd += [CONTAINER, SQLCMD, "-S", "localhost", "-U", user, "-C", "-b", "-l", "10"]
    if database:
        cmd += ["-d", database]
    if tabular:
        cmd += ["-h", "-1", "-W", "-s", "|"]
    if sql_file is not None:
        cmd += ["-i", f"{SQL_DIR_IN_CONTAINER}/{sql_file}"]
    elif query is not None:
        cmd += ["-Q", query]
    env = {**os.environ, "SQLCMDPASSWORD": password, **extra_env}
    return _run(cmd, env=env, timeout=timeout)


def sql_or_raise(
    creds: Credentials,
    what: str,
    sql_file: str,
    *,
    extra_env: dict[str, str] | None = None,
    tabular: bool = False,
    timeout: float = 60,
) -> subprocess.CompletedProcess[str]:
    """Run a SQL file as SA; raise LabError (with secrets redacted) if it fails."""
    result = run_sqlcmd(
        "sa",
        creds.sa,
        sql_file=sql_file,
        extra_env=extra_env,
        tabular=tabular,
        timeout=timeout,
    )
    if result.returncode != 0:
        output = redact((result.stdout + result.stderr).strip(), creds.secrets())
        raise LabError(f"{what} failed:\n{output}")
    return result


def load_credentials() -> Credentials:
    return credentials_from_env(read_env())


def require_running() -> Credentials:
    """Return credentials after confirming the container is running and accepting logins."""
    check_docker()
    creds = load_credentials()
    if container_state() != "running":
        raise LabError("The lab container is not running. Run `uv run tools/lab.py up` first.")
    if run_sqlcmd("sa", creds.sa, sql_file="ready.sql").returncode != 0:
        raise LabError("SQL Server is not accepting connections yet. Wait a moment and retry.")
    return creds


def wait_ready(creds: Credentials, timeout: float = READY_TIMEOUT_SECONDS) -> float:
    """Block until SQL Server accepts logins; return seconds waited."""
    start = time.monotonic()
    while True:
        state = container_state()
        if state not in ("running", "restarting", "created"):
            logs = _run(["docker", "logs", "--tail", "15", CONTAINER], timeout=30)
            tail = redact((logs.stdout + logs.stderr).strip(), creds.secrets())
            raise LabError(
                f"The SQL Server container stopped (status: {state}).\n{memory_hint()}\n"
                f"Last log lines:\n{tail}"
            )
        probe = run_sqlcmd("sa", creds.sa, sql_file="ready.sql", timeout=30)
        if probe.returncode == 0:
            return time.monotonic() - start
        if time.monotonic() - start > timeout:
            raise LabError(
                f"SQL Server did not accept connections within {timeout:.0f}s.\n{memory_hint()}\n"
                f"If .env was deleted after the first start, the data folder still holds the old "
                f"SA password: run `uv run tools/lab.py down --purge` and then `up`."
            )
        time.sleep(3)


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------


def cmd_up(_: argparse.Namespace) -> None:
    check_docker()
    memory = docker_memory_bytes()
    if memory is not None and memory < MIN_DOCKER_MEMORY:
        print(f"warning: Docker has {memory / 1024**3:.1f} GB. {memory_hint()}", file=sys.stderr)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    creds = credentials_from_env(ensure_env(ENV_PATH))
    print("Starting the SQL Server container (image pull on first run can take a few minutes)...")
    compose(["up", "-d"], creds.sa)
    print(f"Waiting for SQL Server (up to {READY_TIMEOUT_SECONDS}s)...")
    waited = wait_ready(creds)
    print(f"Ready after {waited:.0f}s.")
    print(f"  Host: localhost,{HOST_PORT}   Admin login: sa   Reader login: {READER_LOGIN}")
    print("  Passwords are in .env (never printed). Next: `uv run tools/lab.py restore all`.")


def grant_reader(creds: Credentials, database: str, view_database_state: bool) -> None:
    """Create the reader login and user in `database` with VIEW DEFINITION and no SELECT."""
    if not _DB_NAME.match(database):
        raise LabError(f"Unsafe database name {database!r}.")
    sql_or_raise(
        creds,
        f"Creating {READER_LOGIN} in {database}",
        "grant_reader.sql",
        extra_env={
            "LAB_DB": database,
            "LAB_VIEW_DB_STATE": "1" if view_database_state else "0",
            ENV_READER: creds.reader,
        },
    )
    state = " + VIEW DATABASE STATE" if view_database_state else ""
    print(f"{database}: {READER_LOGIN} has VIEW DEFINITION{state}, no SELECT.")


def restore_one(creds: Credentials, backup: Backup) -> None:
    container_bak = f"{BACKUP_DIR_IN_CONTAINER}/{backup.filename}"
    listing = sql_or_raise(
        creds,
        f"Reading {backup.filename}",
        "filelist.sql",
        extra_env={"LAB_BAK": container_bak},
        tabular=True,
    )
    moves = build_moves(backup.database, parse_filelist(listing.stdout))
    print(f"{backup.database}: restoring (this can take a minute or two)...")
    sql_or_raise(
        creds,
        f"Restoring {backup.database}",
        "restore.sql",
        extra_env={"LAB_DB": backup.database, "LAB_BAK": container_bak, "LAB_MOVES": moves},
        timeout=RESTORE_TIMEOUT_SECONDS,
    )
    print(f"{backup.database}: restored.")


def cmd_restore(args: argparse.Namespace) -> None:
    backups = resolve_databases(args.database)
    creds = require_running()
    for backup in backups:
        ensure_backup(backup)
        restore_one(creds, backup)
        grant_reader(creds, backup.database, args.view_database_state)


def cmd_grant(args: argparse.Namespace) -> None:
    creds = require_running()
    existing = run_sqlcmd("sa", creds.sa, sql_file="list_databases.sql", tabular=True)
    if args.database not in existing.stdout.split():
        raise LabError(f"Database {args.database!r} does not exist in the lab.")
    grant_reader(creds, args.database, args.view_database_state)


def cmd_edgecases(_: argparse.Namespace) -> None:
    creds = require_running()
    print(f"{EDGE_CASES_DB}: creating (lab only; the sample databases are not touched)...")
    sql_or_raise(creds, f"Creating {EDGE_CASES_DB}", "edgecases.sql")
    grant_reader(creds, EDGE_CASES_DB, False)


def cmd_status(_: argparse.Namespace) -> None:
    check_docker()
    state = container_state()
    print(f"container {CONTAINER}: {state or 'not created'}  (localhost,{HOST_PORT})")
    for backup in CATALOG.values():
        path = BACKUP_DIR / backup.filename
        have = path.exists() and path.stat().st_size == backup.size
        print(f"backup {backup.filename}: {'downloaded' if have else 'not downloaded'}")
    if state != "running":
        raise LabError("The lab is not running. Run `uv run tools/lab.py up`.")
    creds = load_credentials()
    listing = run_sqlcmd("sa", creds.sa, sql_file="list_databases.sql", tabular=True)
    if listing.returncode != 0:
        raise LabError("The container is running but SQL Server is not accepting logins yet.")
    present = set(listing.stdout.split())
    for name in CATALOG:
        print(f"database {name}: {'restored' if name in present else 'missing'}")
    for extra in sorted(present - set(CATALOG)):
        print(f"database {extra}: extra")
    reader = run_sqlcmd("sa", creds.sa, sql_file="reader_exists.sql", tabular=True)
    exists = reader.stdout.strip() == "1"
    print(f"login {READER_LOGIN}: {'present' if exists else 'missing'}")


def cmd_down(args: argparse.Namespace) -> None:
    check_docker()
    sa_password = read_env().get(ENV_SA)
    compose(["down"], sa_password)
    print("Lab stopped." if args.purge else "Lab stopped. Data in lab-data/ is kept.")
    if args.purge:
        # Files are owned by the container user, so remove them from inside a throwaway run.
        compose(
            [
                "run",
                "--rm",
                "--no-deps",
                "--entrypoint",
                "find",
                SERVICE,
                "/var/opt/mssql",
                "-mindepth",
                "1",
                "-delete",
            ],
            sa_password,
        )
        print("Purged the SQL Server data folder (downloaded backups were kept).")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="lab.py", description="Schema Map SQL Server lab.")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser(
        "up", help="start SQL Server and wait until it accepts connections"
    ).set_defaults(func=cmd_up)

    restore = sub.add_parser("restore", help="download and restore sample databases")
    restore.add_argument("database", help=f"one of: {', '.join([*CATALOG, 'all'])}")
    restore.set_defaults(func=cmd_restore)

    grant = sub.add_parser("grant", help="(re)apply the reader login to an existing database")
    grant.add_argument("database")
    grant.set_defaults(func=cmd_grant)

    for p in (restore, grant):
        p.add_argument(
            "--view-database-state",
            action="store_true",
            help=f"also grant VIEW DATABASE STATE to {READER_LOGIN} (Query Store, DMVs)",
        )

    sub.add_parser(
        "edgecases",
        help=f"create the small {EDGE_CASES_DB} database of awkward schema shapes (lab only)",
    ).set_defaults(func=cmd_edgecases)

    sub.add_parser("status", help="show container, backups and databases").set_defaults(
        func=cmd_status
    )

    down = sub.add_parser("down", help="stop the container")
    down.add_argument(
        "--purge", action="store_true", help="also wipe the SQL Server data folder (keeps backups)"
    )
    down.set_defaults(func=cmd_down)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        args.func(args)
    except LabError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
