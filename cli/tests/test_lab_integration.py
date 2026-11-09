"""Integration tests: the lab SQL Server must be up and restored.

Start it with `uv run tools/lab.py up && uv run tools/lab.py restore all`, then run
`uv run pytest -m integration`. The reader checks and doctor use the connect module (the
real driver); only the sa check of the restored databases still goes through `docker exec`.
"""

import os
import subprocess
from types import ModuleType

import pytest
from typer.testing import CliRunner

from schemamap.cli import app
from schemamap.connect import ConnectionConfig, Status, connect, diagnose
from schemamap.errors import ConnectError

pytestmark = pytest.mark.integration

# One user table per database that the reader must NOT be able to read.
PROTECTED_TABLES = [
    ("AdventureWorks2022", "SELECT TOP 1 * FROM Person.Person"),
    ("AdventureWorksDW2022", "SELECT TOP 1 * FROM dbo.DimCustomer"),
    ("WideWorldImporters", "SELECT TOP 1 * FROM Sales.Customers"),
]


@pytest.fixture(scope="module")
def passwords(lab: ModuleType) -> tuple[str, str]:
    """(sa, reader) passwords from the lab's .env; fails clearly if the lab is not set up."""
    env = lab.read_env()
    sa, reader = env.get(lab.ENV_SA), env.get(lab.ENV_READER)
    if not sa or not reader:
        pytest.fail("Lab not initialised: run `uv run tools/lab.py up` first.")
    state = subprocess.run(
        ["docker", "inspect", "-f", "{{.State.Status}}", lab.CONTAINER],
        capture_output=True,
        text=True,
        check=False,
    )
    if state.stdout.strip() != "running":
        pytest.fail("Lab container is not running: run `uv run tools/lab.py up` first.")
    return sa, reader


def sqlcmd(
    lab: ModuleType, user: str, password: str, database: str, query: str
) -> subprocess.CompletedProcess[str]:
    """Run one query via `docker exec schemamap-lab sqlcmd`; -b makes errors exit non-zero."""
    command = [
        "docker",
        "exec",
        "-e",
        "SQLCMDPASSWORD",
        lab.CONTAINER,
        "/opt/mssql-tools18/bin/sqlcmd",
        "-S",
        "localhost",
        "-U",
        user,
        "-C",
        "-b",
        "-h",
        "-1",
        "-W",
        "-d",
        database,
        "-Q",
        f"SET NOCOUNT ON; {query}",
    ]
    env = {**os.environ, "SQLCMDPASSWORD": password}
    return subprocess.run(command, env=env, capture_output=True, text=True, timeout=60, check=False)


def reader_config(lab: ModuleType, password: str, database: str) -> ConnectionConfig:
    return ConnectionConfig(
        server="localhost",
        port=lab.HOST_PORT,
        database=database,
        user=lab.READER_LOGIN,
        password=password,
        trust_server_certificate=True,
    )


@pytest.mark.parametrize(("database", "query"), PROTECTED_TABLES)
def test_reader_cannot_read_rows(
    lab: ModuleType, passwords: tuple[str, str], database: str, query: str
) -> None:
    with connect(reader_config(lab, passwords[1], database)) as conn:
        cursor = conn.cursor()
        with pytest.raises(Exception, match="SELECT permission was denied"):
            cursor.execute(query)
            cursor.fetchall()


@pytest.mark.parametrize("database", [db for db, _ in PROTECTED_TABLES])
def test_reader_can_read_catalog_metadata(
    lab: ModuleType, passwords: tuple[str, str], database: str
) -> None:
    with connect(reader_config(lab, passwords[1], database)) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM sys.tables")
        assert cursor.fetchone()[0] > 0


def test_wrong_password_is_connect_error_without_secrets(
    lab: ModuleType, passwords: tuple[str, str]
) -> None:
    config = reader_config(lab, "Wrong" + passwords[1], "AdventureWorks2022")
    with pytest.raises(ConnectError) as info:
        connect(config)
    assert config.password is not None
    assert config.password not in str(info.value)
    assert "PWD=" not in str(info.value)


def test_untrusted_certificate_is_rejected_by_default(
    lab: ModuleType, passwords: tuple[str, str]
) -> None:
    config = ConnectionConfig(
        server="localhost",
        port=lab.HOST_PORT,
        database="AdventureWorks2022",
        user=lab.READER_LOGIN,
        password=passwords[1],
    )
    with pytest.raises(ConnectError):
        connect(config)


def test_doctor_reports_lab_all_green(lab: ModuleType, passwords: tuple[str, str]) -> None:
    report = diagnose(reader_config(lab, passwords[1], "AdventureWorks2022"))
    detail = [(c.name, c.status.value, c.detail) for c in report.checks]
    assert report.connected, detail
    statuses = {c.name: c.status for c in report.checks}
    assert statuses["Driver"] is Status.OK
    assert statuses["Connection"] is Status.OK
    assert statuses["Server"] is Status.OK
    assert statuses["VIEW DEFINITION"] is Status.OK


def test_doctor_command_exit_code(lab: ModuleType, passwords: tuple[str, str]) -> None:
    args = [
        "doctor",
        "--server",
        "localhost",
        "--port",
        str(lab.HOST_PORT),
        "--database",
        "AdventureWorks2022",
        "--trust-server-certificate",
    ]
    env = {"SCHEMAMAP_USER": lab.READER_LOGIN, "SCHEMAMAP_PASSWORD": passwords[1]}
    result = CliRunner().invoke(app, args, env=env)
    assert result.exit_code == 0, result.output
    assert passwords[1] not in result.output
    bad = CliRunner().invoke(app, args, env={**env, "SCHEMAMAP_PASSWORD": "nope"})
    assert bad.exit_code == 3
    assert "nope" not in bad.output


def test_all_sample_databases_are_restored(lab: ModuleType, passwords: tuple[str, str]) -> None:
    result = sqlcmd(
        lab, "sa", passwords[0], "master", "SELECT name FROM sys.databases WHERE database_id > 4"
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert set(result.stdout.split()) >= set(lab.CATALOG)
