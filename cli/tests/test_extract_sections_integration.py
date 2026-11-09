"""Optional sections and graceful degradation against the lab, through both reader logins.

``schemamap_reader`` holds VIEW DEFINITION and SELECT on sys.sql_expression_dependencies;
``schemamap_reader_min`` holds VIEW DEFINITION only. Both are created by `lab.py grant`
(and `restore`), so run `uv run tools/lab.py grant <db>` once for each database tested here.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime, timezone
from types import ModuleType

import pytest
from raw_sql import run_raw_sql
from test_lab_integration import reader_config

from schemamap.connect import (
    ConnectionConfig,
    Permission,
    Status,
    connect,
    diagnose,
    held_permissions,
)
from schemamap.extract import DatabaseExtraction, extract_database
from schemamap.snapshot.models import Generator, QueryStoreState, Section, Snapshot, SourceInfo

pytestmark = pytest.mark.integration

ADVENTUREWORKS = "AdventureWorks2022"
WIDE_WORLD = "WideWorldImporters"
EDGE_DB = "SchemaMapEdgeCases"
DATABASES = [ADVENTUREWORKS, WIDE_WORLD, EDGE_DB]


def min_config(lab: ModuleType, password: str, database: str) -> ConnectionConfig:
    return ConnectionConfig(
        server="localhost",
        port=lab.HOST_PORT,
        database=database,
        user=lab.READER_MIN_LOGIN,
        password=password,
        trust_server_certificate=True,
    )


def extract_as(config: ConnectionConfig) -> DatabaseExtraction:
    with connect(config) as executor:
        return extract_database(executor)


def to_snapshot(result: DatabaseExtraction, database: str) -> Snapshot:
    """Build (and so validate) a snapshot from an extraction."""
    return Snapshot(
        generator=Generator(version="0.0.0"),
        captured_at=datetime.now(timezone.utc),
        source=SourceInfo(database=database, query_store=result.query_store),
        schemas=result.schemas,
        tables=result.tables,
        views=result.views,
        routines=result.routines,
        synonyms=result.synonyms,
        relationships=result.relationships,
        dependencies=result.dependencies,
        warnings=result.warnings,
        row_counts=result.row_counts,
    )


@pytest.fixture(scope="module")
def reader_with_database_state(
    lab: ModuleType, passwords: tuple[str, str]
) -> Iterator[dict[str, DatabaseExtraction]]:
    """Extractions as schemamap_reader after `lab grant --view-database-state`; the previous
    grant is put back afterwards."""
    creds = lab.load_credentials()
    results: dict[str, DatabaseExtraction] = {}
    previous: dict[str, bool] = {}
    for database in DATABASES:
        with connect(reader_config(lab, passwords[1], database)) as executor:
            previous[database] = Permission.VIEW_DATABASE_STATE in held_permissions(executor)
        lab.grant_reader(creds, database, True)
    try:
        for database in DATABASES:
            results[database] = extract_as(reader_config(lab, passwords[1], database))
        yield results
    finally:
        for database, was_granted in previous.items():
            lab.grant_reader(creds, database, was_granted)


@pytest.fixture(scope="module")
def minimal(lab: ModuleType, passwords: tuple[str, str]) -> dict[str, DatabaseExtraction]:
    return {db: extract_as(min_config(lab, passwords[1], db)) for db in DATABASES}


def test_row_counts_and_sizes_are_present_with_view_database_state(
    reader_with_database_state: dict[str, DatabaseExtraction],
) -> None:
    result = reader_with_database_state[ADVENTUREWORKS]
    assert result.warnings == ()
    assert result.row_counts is not None
    counts = {c.object: c for c in result.row_counts.items}
    assert counts["object:Person.Person"].rows == 19972
    assert counts["object:HumanResources.Department"].rows == 16
    person_size = counts["object:Person.Person"].reserved_bytes
    assert person_size is not None
    assert person_size > 8192 * 100
    # Every counted table is in the snapshot, and the snapshot validates.
    assert {c.object for c in result.row_counts.items} <= {t.id for t in result.tables}
    assert len(counts) == len(result.tables)
    assert to_snapshot(result, ADVENTUREWORKS).row_counts == result.row_counts
    assert result.query_store is not QueryStoreState.UNKNOWN


@pytest.mark.parametrize("database", [WIDE_WORLD, EDGE_DB])
def test_row_counts_validate_in_other_databases(
    reader_with_database_state: dict[str, DatabaseExtraction], database: str
) -> None:
    result = reader_with_database_state[database]
    assert result.warnings == ()
    assert result.row_counts is not None
    assert result.row_counts.items
    to_snapshot(result, database)


@pytest.mark.parametrize("database", DATABASES)
def test_minimal_login_completes_with_one_warning_per_skipped_section(
    minimal: dict[str, DatabaseExtraction], database: str
) -> None:
    result = minimal[database]
    assert result.row_counts is None
    assert result.dependencies == ()
    assert [w.section for w in result.warnings] == [Section.DEPENDENCIES, Section.ROW_COUNTS]
    assert all(w.code == "permission_missing" for w in result.warnings)
    assert (
        "GRANT SELECT ON sys.sql_expression_dependencies TO <login>;" in result.warnings[0].message
    )
    assert "GRANT VIEW DATABASE STATE TO <login>;" in result.warnings[1].message
    assert result.query_store is QueryStoreState.UNKNOWN
    snapshot = to_snapshot(result, database)
    assert snapshot.row_counts is None
    assert snapshot.source.query_store is QueryStoreState.UNKNOWN


@pytest.mark.parametrize("database", DATABASES)
def test_minimal_login_still_reads_everything_else(
    lab: ModuleType,
    passwords: tuple[str, str],
    minimal: dict[str, DatabaseExtraction],
    database: str,
) -> None:
    full = extract_as(reader_config(lab, passwords[1], database))
    result = minimal[database]
    assert result.tables
    assert result.tables == full.tables
    assert result.views == full.views
    assert result.routines == full.routines
    assert result.synonyms == full.synonyms
    assert result.relationships == full.relationships
    assert full.dependencies  # what the minimal login had to skip is real


def test_the_minimal_login_is_denied_exactly_what_the_warnings_say(
    lab: ModuleType, passwords: tuple[str, str]
) -> None:
    config = min_config(lab, passwords[1], ADVENTUREWORKS)
    with pytest.raises(Exception, match="SELECT permission was denied"):
        run_raw_sql(config, "SELECT COUNT(*) FROM sys.sql_expression_dependencies")
    with pytest.raises(Exception, match="permission denied"):
        run_raw_sql(config, "SELECT COUNT(*) FROM sys.dm_db_partition_stats")
    with pytest.raises(Exception, match="SELECT permission was denied"):
        run_raw_sql(config, "SELECT TOP 1 * FROM Person.Person")


def test_doctor_for_the_reader_shows_the_dependencies_check_ok(
    lab: ModuleType, passwords: tuple[str, str]
) -> None:
    report = diagnose(reader_config(lab, passwords[1], ADVENTUREWORKS))
    checks = {c.name: c for c in report.checks}
    assert checks["SELECT sys.sql_expression_dependencies"].status is Status.OK


def test_doctor_for_the_minimal_login_warns_with_the_exact_grant(
    lab: ModuleType, passwords: tuple[str, str]
) -> None:
    report = diagnose(min_config(lab, passwords[1], ADVENTUREWORKS))
    assert report.connected
    checks = {c.name: c for c in report.checks}
    dependencies = checks["SELECT sys.sql_expression_dependencies"]
    assert dependencies.status is Status.WARN
    assert dependencies.next_step is not None
    assert "GRANT SELECT ON sys.sql_expression_dependencies TO <login>;" in dependencies.next_step
    assert checks["VIEW DEFINITION"].status is Status.OK
    assert checks["VIEW DATABASE STATE"].status is Status.WARN
    assert checks["Query Store"].detail == "unknown"
    assert all(c.detail != "could not be checked" for c in report.checks)
