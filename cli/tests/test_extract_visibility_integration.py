"""VIEW DEFINITION handling against the lab's real SQL Server.

Case A revokes VIEW DEFINITION from ``schemamap_reader_min`` on SchemaMapEdgeCases and puts it
back with ``lab.grant_reader`` afterwards. Cases B and C use two throwaway lab databases that
are created and dropped here; the sample databases are never touched.
"""

from __future__ import annotations

import subprocess
from collections.abc import Iterator
from pathlib import Path
from types import ModuleType

import pytest
from typer.testing import CliRunner

from schemamap.cli import app
from schemamap.connect import ConnectionConfig, Permission, Status, connect, diagnose
from schemamap.connect import held_permissions as held
from schemamap.snapshot.io import read_snapshot

pytestmark = pytest.mark.integration

EDGE_DB = "SchemaMapEdgeCases"
OWNER_DB = "SchemaMapVisibilityOwner"
EMPTY_DB = "SchemaMapVisibilityEmpty"
OWNER_LOGIN = "schemamap_vis_owner"


def sa_sql(lab: ModuleType, sa: str, reader: str, script: str) -> None:
    """Run ``script`` as sa; the lab reader password is available as $(SCHEMAMAP_LAB_READER_...)."""
    result: subprocess.CompletedProcess[str] = lab.run_sqlcmd(
        "sa", sa, script_text=script, extra_env={lab.ENV_READER: reader}
    )
    assert result.returncode == 0, result.stdout + result.stderr


def config(lab: ModuleType, user: str, password: str, database: str) -> ConnectionConfig:
    return ConnectionConfig(
        server=lab.HOST,
        port=lab.HOST_PORT,
        database=database,
        user=user,
        password=password,
        trust_server_certificate=True,
    )


def extract(
    lab: ModuleType, user: str, password: str, database: str, output: Path
) -> tuple[int, str]:
    args = [
        "extract",
        "--server",
        lab.HOST,
        "--port",
        str(lab.HOST_PORT),
        "--database",
        database,
        "--trust-server-certificate",
        "--output",
        str(output),
    ]
    env = {"SCHEMAMAP_USER": user, "SCHEMAMAP_PASSWORD": password}
    result = CliRunner().invoke(app, args, env=env)
    return result.exit_code, result.output


@pytest.fixture(scope="module")
def without_view_definition(lab: ModuleType, passwords: tuple[str, str]) -> Iterator[None]:
    """schemamap_reader_min on SchemaMapEdgeCases with VIEW DEFINITION revoked."""
    sa, reader = passwords
    revoke = f"USE [{EDGE_DB}];\nGO\nREVOKE VIEW DEFINITION FROM [{lab.READER_MIN_LOGIN}];\nGO\n"
    sa_sql(lab, sa, reader, revoke)
    try:
        yield
    finally:
        lab.grant_reader(lab.load_credentials(), EDGE_DB, False)
        with connect(config(lab, lab.READER_MIN_LOGIN, reader, EDGE_DB)) as executor:
            assert Permission.VIEW_DEFINITION in held(executor), "the lab grant was not restored"


@pytest.fixture(scope="module")
def scratch_databases(lab: ModuleType, passwords: tuple[str, str]) -> Iterator[None]:
    """An owner-only database (case B) and an empty database fully granted (case C)."""
    sa, reader = passwords
    drop = ""
    for name in (OWNER_DB, EMPTY_DB):
        drop += (
            f"IF DB_ID(N'{name}') IS NOT NULL\nBEGIN\n"
            f"    ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;\n"
            f"    DROP DATABASE [{name}];\nEND\nGO\n"
        )
    drop += f"IF SUSER_ID(N'{OWNER_LOGIN}') IS NOT NULL DROP LOGIN [{OWNER_LOGIN}];\nGO\n"
    sa_sql(lab, sa, reader, drop)
    build = (
        f"CREATE DATABASE [{OWNER_DB}];\nGO\nCREATE DATABASE [{EMPTY_DB}];\nGO\n"
        f"CREATE LOGIN [{OWNER_LOGIN}] WITH PASSWORD = N'$({lab.ENV_READER})', "
        "DEFAULT_DATABASE = [master];\nGO\n"
        f"USE [{OWNER_DB}];\nGO\n"
        f"CREATE USER [{OWNER_LOGIN}] FOR LOGIN [{OWNER_LOGIN}];\nGO\n"
        f"CREATE SCHEMA [owned] AUTHORIZATION [{OWNER_LOGIN}];\nGO\n"
        "CREATE TABLE [owned].[Mine] (id int NOT NULL);\nGO\n"
        "CREATE TABLE [dbo].[Hidden] (id int NOT NULL);\nGO\n"
    )
    sa_sql(lab, sa, reader, build)
    lab.grant_reader(lab.load_credentials(), EMPTY_DB, False)
    try:
        yield
    finally:
        sa_sql(lab, sa, reader, drop)


# --- case A ------------------------------------------------------------------------------


def test_case_a_no_view_definition_and_nothing_visible_exits_3_and_writes_no_file(
    lab: ModuleType,
    passwords: tuple[str, str],
    without_view_definition: None,
    tmp_path: Path,
) -> None:
    target = tmp_path / "edge.json"
    code, output = extract(lab, lab.READER_MIN_LOGIN, passwords[1], EDGE_DB, target)
    assert code == 3, output
    assert not target.exists()
    assert list(tmp_path.iterdir()) == []
    assert "VIEW DEFINITION" in output
    assert f"GRANT VIEW DEFINITION TO [{lab.READER_MIN_LOGIN}];" in output
    assert "may differ from the login name" in output
    assert passwords[1] not in output


def test_doctor_fails_without_view_definition_and_gives_the_grant(
    lab: ModuleType, passwords: tuple[str, str], without_view_definition: None
) -> None:
    report = diagnose(config(lab, lab.READER_MIN_LOGIN, passwords[1], EDGE_DB))
    assert report.connected
    check = {c.name: c for c in report.checks}["VIEW DEFINITION"]
    assert check.status is Status.FAIL
    assert check.next_step is not None
    assert f"GRANT VIEW DEFINITION TO [{lab.READER_MIN_LOGIN}];" in check.next_step
    with connect(config(lab, lab.READER_MIN_LOGIN, passwords[1], EDGE_DB)) as executor:
        assert Permission.VIEW_DEFINITION not in held(executor)


# --- case B ------------------------------------------------------------------------------


def test_case_b_a_login_that_owns_one_object_gets_a_partial_map(
    lab: ModuleType, passwords: tuple[str, str], scratch_databases: None, tmp_path: Path
) -> None:
    target = tmp_path / "owner.json"
    code, output = extract(lab, OWNER_LOGIN, passwords[1], OWNER_DB, target)
    assert code == 0, output
    assert output.splitlines()[0].startswith("WARNING: partial map.")
    assert f"The database user here is [{OWNER_LOGIN}]" in output
    snapshot = read_snapshot(target)
    assert [t.id for t in snapshot.tables] == ["object:owned.Mine"]  # dbo.Hidden is not visible
    (warning,) = [w for w in snapshot.warnings if w.code == "partial_visibility"]
    assert "GRANT VIEW DEFINITION TO [<user>];" in warning.message


# --- case C ------------------------------------------------------------------------------


def test_case_c_an_empty_database_with_full_grants_is_a_plain_note(
    lab: ModuleType, passwords: tuple[str, str], scratch_databases: None, tmp_path: Path
) -> None:
    target = tmp_path / "empty.json"
    code, output = extract(lab, lab.READER_LOGIN, passwords[1], EMPTY_DB, target)
    assert code == 0, output
    assert "0 user tables found" in output
    assert "WARNING" not in output
    snapshot = read_snapshot(target)
    assert snapshot.tables == ()
    assert [w for w in snapshot.warnings if w.code == "partial_visibility"] == []
