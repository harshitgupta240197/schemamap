"""Integration tests: the lab SQL Server must be up and restored.

Start it with `uv run tools/lab.py up && uv run tools/lab.py restore all`, then run
`uv run pytest -m integration`. These talk to SQL Server through `docker exec` and
sqlcmd; crumb 1.2 moves the reader checks onto the real driver.
"""

import os
import subprocess
from types import ModuleType

import pytest

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


@pytest.mark.parametrize(("database", "query"), PROTECTED_TABLES)
def test_reader_cannot_read_rows(
    lab: ModuleType, passwords: tuple[str, str], database: str, query: str
) -> None:
    result = sqlcmd(lab, lab.READER_LOGIN, passwords[1], database, query)
    assert result.returncode != 0
    assert "SELECT permission was denied" in result.stdout + result.stderr


@pytest.mark.parametrize("database", [db for db, _ in PROTECTED_TABLES])
def test_reader_can_read_catalog_metadata(
    lab: ModuleType, passwords: tuple[str, str], database: str
) -> None:
    result = sqlcmd(
        lab, lab.READER_LOGIN, passwords[1], database, "SELECT COUNT(*) FROM sys.tables"
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert int(result.stdout.strip()) > 0


def test_all_sample_databases_are_restored(lab: ModuleType, passwords: tuple[str, str]) -> None:
    result = sqlcmd(
        lab, "sa", passwords[0], "master", "SELECT name FROM sys.databases WHERE database_id > 4"
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert set(result.stdout.split()) >= set(lab.CATALOG)
