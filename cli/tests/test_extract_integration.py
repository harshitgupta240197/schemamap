"""Extraction against the lab's real databases, compared with fixtures captured once.

Fixtures in tests/fixtures/ were captured from the lab with the extract functions and
reviewed by hand; they pin counts and a few tables chosen for what they exercise.
"""

import json
import time
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest
from test_lab_integration import reader_config

from schemamap.connect import connect
from schemamap.extract import extract_schemas, extract_tables
from schemamap.snapshot.models import IndexKind, Table, TemporalType

pytestmark = pytest.mark.integration

FIXTURES = Path(__file__).parent / "fixtures"
MAX_SECONDS = 10.0


def load_fixture(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((FIXTURES / name).read_text(encoding="utf-8"))
    return data


def extract(
    lab: ModuleType,
    passwords: tuple[str, str],
    database: str,
) -> tuple[list[str], dict[str, Table], float]:
    with connect(reader_config(lab, passwords[1], database)) as executor:
        started = time.perf_counter()
        schemas = extract_schemas(executor)
        tables = extract_tables(executor)
        elapsed = time.perf_counter() - started
    return [s.name for s in schemas], {t.id: t for t in tables}, elapsed


@pytest.fixture(scope="module")
def adventureworks(
    lab: ModuleType,
    passwords: tuple[str, str],
) -> tuple[list[str], dict[str, Table], float]:
    return extract(lab, passwords, "AdventureWorks2022")


@pytest.fixture(scope="module")
def wide_world(
    lab: ModuleType,
    passwords: tuple[str, str],
) -> tuple[list[str], dict[str, Table], float]:
    return extract(lab, passwords, "WideWorldImporters")


def check_against_fixture(
    result: tuple[list[str], dict[str, Table], float], fixture_name: str
) -> None:
    schemas, tables, _ = result
    expected = load_fixture(fixture_name)
    assert schemas == expected["schemas"]
    assert len(tables) == expected["table_count"]
    assert sum(len(t.columns) for t in tables.values()) == expected["column_count"]
    assert sum(len(t.indexes) for t in tables.values()) == expected["index_count"]
    assert sum(len(t.key_constraints) for t in tables.values()) == expected["key_constraint_count"]
    assert (
        sum(len(t.check_constraints) for t in tables.values()) == expected["check_constraint_count"]
    )
    for name, frozen in expected["tables"].items():
        assert tables[f"object:{name}"].model_dump(mode="json") == frozen, name


def test_adventureworks_matches_fixture(
    adventureworks: tuple[list[str], dict[str, Table], float],
) -> None:
    check_against_fixture(adventureworks, "adventureworks2022_tables.json")


def test_wideworldimporters_matches_fixture(
    wide_world: tuple[list[str], dict[str, Table], float],
) -> None:
    check_against_fixture(wide_world, "wideworldimporters_tables.json")


def test_adventureworks_spot_checks(
    adventureworks: tuple[list[str], dict[str, Table], float],
) -> None:
    tables = adventureworks[1]
    history = tables["object:HumanResources.EmployeeDepartmentHistory"]
    (pk,) = history.key_constraints
    assert len(pk.columns) == 4  # composite primary key
    review = tables["object:Production.ProductReview"]
    assert any(i.included_columns for i in review.indexes)  # index with included columns
    stocked = next(
        c for c in tables["object:Production.WorkOrder"].columns if c.name == "StockedQty"
    )
    assert stocked.computed is not None  # computed column
    person = tables["object:Person.Person"]
    assert sum(i.kind is IndexKind.XML for i in person.indexes) == 5
    assert {c.collation for c in person.columns if c.collation} == {"SQL_Latin1_General_CP1_CI_AS"}


def test_wideworldimporters_temporal_memory_optimized_and_columnstore(
    wide_world: tuple[list[str], dict[str, Table], float],
) -> None:
    tables = wide_world[1]
    assert tables["object:Application.Cities"].temporal_type is TemporalType.SYSTEM_VERSIONED
    assert tables["object:Application.Cities_Archive"].temporal_type is TemporalType.HISTORY
    assert tables["object:Warehouse.ColdRoomTemperatures"].memory_optimized
    kinds = {i.kind for i in tables["object:Sales.OrderLines"].indexes}
    assert IndexKind.NONCLUSTERED_COLUMNSTORE in kinds
    collations = {c.collation for t in tables.values() for c in t.columns if c.collation}
    assert len(collations) > 1  # a column with a non-default collation exists here


def test_extraction_is_fast_enough(
    adventureworks: tuple[list[str], dict[str, Table], float],
) -> None:
    elapsed = adventureworks[2]
    print(f"AdventureWorks2022 schemas+tables extraction: {elapsed:.2f}s")
    assert elapsed < MAX_SECONDS
