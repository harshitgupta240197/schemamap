"""Section runner, permission probing and row counts, with a fake executor (no database)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import pytest

from schemamap.connect import MetadataExecutor, Permission, held_permissions, query_store_state
from schemamap.connect.executor import Params, Row
from schemamap.errors import PermissionMissing
from schemamap.extract import (
    Requirement,
    SectionRunner,
    build_row_counts,
    extract_database,
)
from schemamap.extract.rows import RowCountRow
from schemamap.queries import QueryName
from schemamap.snapshot.ids import object_id
from schemamap.snapshot.models import (
    ExtractionWarning,
    Generator,
    QueryStoreState,
    Section,
    Snapshot,
    SourceInfo,
)

ALL = frozenset(Permission)
MINIMAL = frozenset({Permission.VIEW_DEFINITION})
NONE: tuple[str, ...] = ()
NEEDS_STATE = Requirement(Permission.VIEW_DATABASE_STATE, "Row counts were skipped.")
NEEDS_DEPENDENCIES = Requirement(Permission.SELECT_DEPENDENCIES, "Dependencies were skipped.")


class DriverError(Exception):
    """Stands in for the driver's error: its text says "permission was denied" but it is not
    a PermissionMissing, so nothing may treat it as one."""


class FakeExecutor(MetadataExecutor):
    """Answers each named query from a table, records what was run, never touches a driver."""

    def __init__(self, answers: dict[QueryName, Any] | None = None) -> None:
        super().__init__(driver_connection=None)
        self.answers = answers or {}
        self.ran: list[QueryName] = []

    def run(self, query: QueryName, params: Params | None = None) -> list[Row]:
        self.ran.append(query)
        answer = self.answers.get(query, [])
        if isinstance(answer, Exception):
            raise answer
        return [tuple(row) for row in answer]


def permission_rows(held: frozenset[Permission]) -> list[tuple[str]]:
    return [(p.value,) for p in sorted(held, key=lambda p: p.value)]


# --- the runner ---------------------------------------------------------------------------


def test_runs_a_section_that_needs_nothing() -> None:
    runner = SectionRunner(MINIMAL)
    assert runner.run(Section.TABLES, lambda: ("t",), NONE) == ("t",)
    assert runner.warnings == ()


def test_runs_a_section_whose_permission_is_held() -> None:
    runner = SectionRunner(ALL)
    assert runner.run(Section.ROW_COUNTS, lambda: 5, None, NEEDS_STATE) == 5
    assert runner.warnings == ()


def test_skips_a_section_without_its_permission_and_never_runs_it() -> None:
    runner = SectionRunner(MINIMAL)
    calls: list[str] = []

    def read() -> int:
        calls.append("ran")
        return 5

    assert runner.run(Section.ROW_COUNTS, read, None, NEEDS_STATE) is None
    assert calls == []
    (warning,) = runner.warnings
    assert warning.section is Section.ROW_COUNTS
    assert warning.code == "permission_missing"
    assert warning.message == (
        "VIEW DATABASE STATE is not granted. Row counts were skipped. "
        "Ask a DBA to run GRANT VIEW DATABASE STATE TO <login>;"
    )


def test_permission_missing_raised_by_a_section_becomes_one_warning() -> None:
    runner = SectionRunner(ALL)

    def read() -> tuple[str, ...]:
        raise PermissionMissing("SELECT", "SELECT was denied. Ask a DBA.")

    assert runner.run(Section.VIEWS, read, NONE) == NONE
    assert runner.warnings == (
        ExtractionWarning(
            section=Section.VIEWS,
            code="permission_missing",
            message="SELECT was denied. Ask a DBA.",
        ),
    )


def test_sections_are_independent_and_each_skip_is_one_warning() -> None:
    runner = SectionRunner(MINIMAL)
    first = runner.run(Section.DEPENDENCIES, lambda: ("x",), NONE, NEEDS_DEPENDENCIES)
    middle = runner.run(Section.TABLES, lambda: ("t",), NONE)
    last = runner.run(Section.ROW_COUNTS, lambda: 1, None, NEEDS_STATE)
    assert (first, middle, last) == (NONE, ("t",), None)
    assert [w.section for w in runner.warnings] == [Section.DEPENDENCIES, Section.ROW_COUNTS]


def test_other_errors_propagate_and_record_nothing() -> None:
    runner = SectionRunner(ALL)

    def read() -> int:
        raise DriverError("The SELECT permission was denied on the object 'Person'")

    with pytest.raises(DriverError):
        runner.run(Section.TABLES, read, 0)
    assert runner.warnings == ()


def test_a_non_permission_error_in_one_section_stops_extraction() -> None:
    runner = SectionRunner(ALL)
    runner.run(Section.TABLES, lambda: 1, 0)

    def boom() -> int:
        raise RuntimeError("connection lost")

    with pytest.raises(RuntimeError, match="connection lost"):
        runner.run(Section.VIEWS, boom, 0)


# --- permissions and Query Store ----------------------------------------------------------


def test_held_permissions_reads_the_query_rows() -> None:
    executor = FakeExecutor(
        {
            QueryName.PERMISSIONS: [
                ("VIEW DEFINITION",),
                ("SELECT ON sys.sql_expression_dependencies",),
            ]
        }
    )
    assert held_permissions(executor) == {
        Permission.VIEW_DEFINITION,
        Permission.SELECT_DEPENDENCIES,
    }


def test_held_permissions_ignores_names_it_does_not_know() -> None:
    executor = FakeExecutor({QueryName.PERMISSIONS: [("CONNECT",)]})
    assert held_permissions(executor) == frozenset()


@pytest.mark.parametrize(
    ("rows", "expected"),
    [
        ([("READ_WRITE",)], QueryStoreState.ON),
        ([("READ_ONLY",)], QueryStoreState.ON),
        ([("OFF",)], QueryStoreState.OFF),
        ([], QueryStoreState.OFF),
        ([("ERROR_STATE",)], QueryStoreState.OFF),
    ],
)
def test_query_store_is_read_when_the_login_may_read_it(
    rows: list[tuple[str]], expected: QueryStoreState
) -> None:
    executor = FakeExecutor({QueryName.QUERY_STORE_STATE: rows})
    assert query_store_state(ALL, executor) is expected


def test_query_store_is_unknown_never_off_when_it_cannot_be_read() -> None:
    # The catalog would answer OFF here; the answer must not be trusted, or even requested.
    executor = FakeExecutor({QueryName.QUERY_STORE_STATE: [("OFF",)]})
    assert query_store_state(MINIMAL, executor) is QueryStoreState.UNKNOWN
    assert executor.ran == []


# --- row counts ---------------------------------------------------------------------------


def test_row_counts_are_sorted_and_carry_size() -> None:
    rows = [
        RowCountRow("sales", "Orders", 1200, 3 * 8192),
        RowCountRow("dbo", "Customers", 0, 0),
    ]
    counts = build_row_counts(rows, [object_id("dbo", "Customers"), object_id("sales", "Orders")])
    assert [(c.object, c.rows, c.reserved_bytes) for c in counts.items] == [
        (object_id("dbo", "Customers"), 0, 0),
        (object_id("sales", "Orders"), 1200, 24576),
    ]


def test_row_counts_ignore_tables_that_are_not_in_the_snapshot() -> None:
    rows = [RowCountRow("dbo", "Ghost", 1, 8192), RowCountRow("dbo", "Real", 2, 8192)]
    counts = build_row_counts(rows, [object_id("dbo", "Real")])
    assert [c.object for c in counts.items] == [object_id("dbo", "Real")]


# --- the whole database -------------------------------------------------------------------


def table_answers(held: frozenset[Permission]) -> dict[QueryName, Any]:
    return {
        QueryName.PERMISSIONS: permission_rows(held),
        QueryName.SCHEMAS: [("dbo",)],
        QueryName.TABLES: [("dbo", "Orders", 0, False)],
        QueryName.ROW_COUNTS: [("dbo", "Orders", 7, 16384), ("dbo", "Ghost", 1, 8192)],
        QueryName.QUERY_STORE_STATE: [("READ_WRITE",)],
    }


def as_snapshot(result: Any) -> Snapshot:
    return Snapshot(
        generator=Generator(version="0.0.0"),
        captured_at=datetime.now(timezone.utc),
        source=SourceInfo(database="d", query_store=result.query_store),
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


def test_full_permissions_read_everything() -> None:
    result = extract_database(FakeExecutor(table_answers(ALL)))
    assert result.warnings == ()
    assert result.row_counts is not None
    assert [(c.object, c.rows) for c in result.row_counts.items] == [("object:dbo.Orders", 7)]
    assert result.query_store is QueryStoreState.ON
    assert as_snapshot(result).row_counts == result.row_counts


def test_minimal_permissions_skip_exactly_the_gated_sections() -> None:
    executor = FakeExecutor(table_answers(MINIMAL))
    result = extract_database(executor)
    assert result.row_counts is None
    assert result.dependencies == ()
    assert [w.section for w in result.warnings] == [Section.DEPENDENCIES, Section.ROW_COUNTS]
    assert {w.code for w in result.warnings} == {"permission_missing"}
    assert (
        "GRANT SELECT ON sys.sql_expression_dependencies TO <login>;" in result.warnings[0].message
    )
    assert "GRANT VIEW DATABASE STATE TO <login>;" in result.warnings[1].message
    # The sections that need nothing still ran, and the gated queries were never sent.
    assert [t.id for t in result.tables] == ["object:dbo.Orders"]
    assert QueryName.DEPENDENCIES not in executor.ran
    assert QueryName.ROW_COUNTS not in executor.ran
    assert result.query_store is QueryStoreState.UNKNOWN
    assert QueryName.QUERY_STORE_STATE not in executor.ran
    assert as_snapshot(result).row_counts is None


def test_a_non_permission_error_in_any_section_propagates() -> None:
    answers = table_answers(ALL)
    answers[QueryName.VIEWS] = DriverError("The SELECT permission was denied")
    with pytest.raises(DriverError):
        extract_database(FakeExecutor(answers))
