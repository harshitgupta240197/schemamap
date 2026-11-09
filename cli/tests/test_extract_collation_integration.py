"""Extraction on case-sensitive and binary-collation databases.

Needs `uv run tools/lab.py edgecases` to have been run once: it builds SchemaMapEdgeCasesCS
(Latin1_General_100_CS_AS) and SchemaMapEdgeCasesBIN2 (Latin1_General_100_BIN2), each holding
tables `Orders` and `orders`, columns `Name` and `name`, a foreign key between the tables, a view
and a procedure that each use one case-variant, and a user schema `SYS` with a table `TABLES`.
"""

from __future__ import annotations

from types import ModuleType

import pytest
from test_lab_integration import reader_config

from schemamap.connect import connect
from schemamap.extract import DatabaseExtraction, extract_database
from schemamap.snapshot.ids import IdKind, NameId, column_id, object_id, parse_id
from schemamap.snapshot.models import ReferenceScope, Section

pytestmark = pytest.mark.integration

DATABASES = ["SchemaMapEdgeCasesCS", "SchemaMapEdgeCasesBIN2"]
UPPER = object_id("dbo", "Orders")
LOWER = object_id("dbo", "orders")


@pytest.fixture(scope="module", params=DATABASES)
def extraction(
    request: pytest.FixtureRequest, lab: ModuleType, passwords: tuple[str, str]
) -> DatabaseExtraction:
    try:
        with connect(reader_config(lab, passwords[1], request.param)) as executor:
            return extract_database(executor)
    except Exception as exc:  # the database may simply not exist yet
        pytest.fail(f"{request.param} is not usable: run `uv run tools/lab.py edgecases` ({exc})")


def test_extraction_is_complete(extraction: DatabaseExtraction) -> None:
    # The lab grants these databases without VIEW DATABASE STATE, so row counts are skipped.
    assert [w.section for w in extraction.warnings] == [Section.ROW_COUNTS]
    assert {t.id for t in extraction.tables} >= {UPPER, LOWER}


def test_case_variant_tables_and_columns_have_distinct_round_tripping_ids(
    extraction: DatabaseExtraction,
) -> None:
    tables = {t.id: t for t in extraction.tables}
    assert tables[UPPER].name == "Orders"
    assert tables[LOWER].name == "orders"
    columns = {c.id for c in tables[UPPER].columns}
    assert {column_id("dbo", "Orders", "Name"), column_id("dbo", "Orders", "name")} <= columns
    all_ids = [c.id for t in extraction.tables for c in t.columns] + list(tables)
    assert len(all_ids) == len(set(all_ids))
    for text in all_ids:
        parsed = parse_id(text)
        assert isinstance(parsed, NameId)
        assert parsed.to_id() == text
    assert parse_id(UPPER, IdKind.OBJECT) != parse_id(LOWER, IdKind.OBJECT)


def test_foreign_key_resolves_to_the_right_case_variant(extraction: DatabaseExtraction) -> None:
    (fk,) = (r for r in extraction.relationships if r.name == "FK_orders_Orders")
    assert fk.from_object == LOWER
    assert fk.to_object == UPPER
    assert fk.from_columns == (column_id("dbo", "orders", "OrderRef"),)
    assert fk.to_columns == (column_id("dbo", "Orders", "Id"),)


def test_view_and_procedure_dependencies_resolve_to_the_right_case_variant(
    extraction: DatabaseExtraction,
) -> None:
    view = object_id("dbo", "LowerView")
    proc = object_id("dbo", "UpperProc")
    resolved = {
        (d.from_object, d.target.resolved)
        for d in extraction.dependencies
        if d.target.scope is ReferenceScope.LOCAL
    }
    assert (view, LOWER) in resolved
    assert (proc, UPPER) in resolved
    assert (view, UPPER) not in resolved
    assert (proc, LOWER) not in resolved


def test_user_sys_schema_is_a_user_schema_not_a_system_object(
    extraction: DatabaseExtraction,
) -> None:
    sys_table = object_id("SYS", "TABLES")
    assert sys_table in {t.id for t in extraction.tables}
    assert "SYS" in {s.name for s in extraction.schemas}
    assert all(t.schema_id != "schema:sys" for t in extraction.tables)
    assert all(t.name != "tables" for t in extraction.tables)
