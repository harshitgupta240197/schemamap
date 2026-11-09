"""Foreign keys, code objects and dependencies against the lab's real databases.

Frozen fixtures in tests/fixtures/*_code.json pin counts and a few chosen objects. The
SchemaMapEdgeCases tests need `uv run tools/lab.py edgecases` to have been run once.
"""

from datetime import datetime, timezone
from types import ModuleType
from typing import Any, NamedTuple

import pytest
from test_extract_integration import load_fixture
from test_lab_integration import reader_config

from schemamap.connect import connect
from schemamap.extract import (
    extract_dependencies,
    extract_relationships,
    extract_routines,
    extract_schemas,
    extract_synonyms,
    extract_tables,
    extract_views,
)
from schemamap.snapshot.ids import NameId, parse_id
from schemamap.snapshot.models import (
    DefinitionStatus,
    Dependency,
    Generator,
    ReferenceScope,
    ReferentialAction,
    Relationship,
    Routine,
    RoutineKind,
    Snapshot,
    SourceInfo,
    Synonym,
    Table,
    TemporalType,
    View,
)

pytestmark = pytest.mark.integration

EDGE_DB = "SchemaMapEdgeCases"
ODD_TABLE = "Odd.Table [x] Ü☃"
ODD_COLUMN = "col.one [y] é"


class Extracted(NamedTuple):
    snapshot: Snapshot
    relationships: tuple[Relationship, ...]
    views: tuple[View, ...]
    routines: tuple[Routine, ...]
    synonyms: tuple[Synonym, ...]
    dependencies: tuple[Dependency, ...]
    tables: tuple[Table, ...]


def extract_all(lab: ModuleType, passwords: tuple[str, str], database: str) -> Extracted:
    with connect(reader_config(lab, passwords[1], database)) as executor:
        schemas = extract_schemas(executor)
        tables = extract_tables(executor)
        relationships = extract_relationships(executor)
        views = extract_views(executor)
        routines = extract_routines(executor)
        synonyms = extract_synonyms(executor)
        dependencies = extract_dependencies(executor)
    snapshot = Snapshot(
        generator=Generator(version="0.0.0"),
        captured_at=datetime.now(timezone.utc),
        source=SourceInfo(database=database),
        schemas=schemas,
        tables=tables,
        views=views,
        routines=routines,
        synonyms=synonyms,
        relationships=relationships,
        dependencies=dependencies,
    )
    return Extracted(snapshot, relationships, views, routines, synonyms, dependencies, tables)


@pytest.fixture(scope="module")
def adventureworks(lab: ModuleType, passwords: tuple[str, str]) -> Extracted:
    return extract_all(lab, passwords, "AdventureWorks2022")


@pytest.fixture(scope="module")
def wide_world(lab: ModuleType, passwords: tuple[str, str]) -> Extracted:
    return extract_all(lab, passwords, "WideWorldImporters")


@pytest.fixture(scope="module")
def edge(lab: ModuleType, passwords: tuple[str, str]) -> Extracted:
    try:
        return extract_all(lab, passwords, EDGE_DB)
    except Exception as exc:  # the database may simply not exist yet
        pytest.fail(f"{EDGE_DB} is not usable: run `uv run tools/lab.py edgecases` ({exc})")


def check_against_fixture(result: Extracted, fixture_name: str) -> None:
    expected = load_fixture(fixture_name)
    assert len(result.relationships) == expected["relationship_count"]
    multi = sum(len(r.from_columns) > 1 for r in result.relationships)
    assert multi == expected["multi_column_relationship_count"]
    assert len(result.views) == expected["view_count"]
    assert sum(len(v.columns) for v in result.views) == expected["view_column_count"]
    kinds: dict[str, int] = {}
    for routine in result.routines:
        kinds[routine.kind.value] = kinds.get(routine.kind.value, 0) + 1
    assert dict(sorted(kinds.items())) == expected["routine_counts"]
    scopes: dict[str, int] = {}
    for dependency in result.dependencies:
        scopes[dependency.target.scope.value] = scopes.get(dependency.target.scope.value, 0) + 1
    assert dict(sorted(scopes.items())) == expected["dependency_counts"]
    unresolved = sum(
        d.target.scope is ReferenceScope.LOCAL and d.target.resolved is None
        for d in result.dependencies
    )
    assert unresolved == expected["unresolved_local_dependency_count"]
    by_id: dict[str, Any] = {
        **{r.id: r for r in result.relationships},
        **{r.id: r for r in result.routines},
        **{v.id: v for v in result.views},
    }
    for section in ("relationships", "routines", "views"):
        for name, frozen in expected[section].items():
            assert by_id[name].model_dump(mode="json") == frozen, name
    for from_object, frozen_list in expected["dependencies"].items():
        actual = [
            d.model_dump(mode="json") for d in result.dependencies if d.from_object == from_object
        ]
        assert actual == frozen_list, from_object


def test_adventureworks_matches_fixture(adventureworks: Extracted) -> None:
    check_against_fixture(adventureworks, "adventureworks2022_code.json")


def test_wideworldimporters_matches_fixture(wide_world: Extracted) -> None:
    check_against_fixture(wide_world, "wideworldimporters_code.json")


def test_extracted_pieces_form_a_valid_snapshot(
    adventureworks: Extracted, wide_world: Extracted
) -> None:
    for result in (adventureworks, wide_world):
        assert Snapshot.model_validate_json(result.snapshot.model_dump_json()) == result.snapshot


def test_adventureworks_spot_checks(adventureworks: Extracted) -> None:
    assert len(adventureworks.relationships) == 90
    by_id = {r.id: r for r in adventureworks.relationships}
    composite = by_id[
        "foreign_key:Sales.FK_SalesOrderDetail_SpecialOfferProduct_SpecialOfferIDProductID"
    ]
    assert [c.rsplit(".", 1)[1] for c in composite.from_columns] == ["SpecialOfferID", "ProductID"]
    assert [c.rsplit(".", 1)[1] for c in composite.to_columns] == ["SpecialOfferID", "ProductID"]
    cascade = by_id["foreign_key:Sales.FK_SalesOrderDetail_SalesOrderHeader_SalesOrderID"]
    assert cascade.on_delete is ReferentialAction.CASCADE
    triggers = {r.id: r for r in adventureworks.routines if r.kind is RoutineKind.TRIGGER}
    assert triggers["object:HumanResources.dEmployee"].parent == "object:HumanResources.Employee"
    view = next(v for v in adventureworks.views if v.name == "vStateProvinceCountryRegion")
    assert [c.name for c in view.columns][:2] == ["StateProvinceID", "StateProvinceCode"]
    assert all(
        r.definition_status is DefinitionStatus.AVAILABLE
        for r in (*adventureworks.routines, *adventureworks.views)
    )


def test_wideworldimporters_spot_checks(wide_world: Extracted) -> None:
    assert len(wide_world.relationships) == 98
    assert all(not r.disabled and r.trusted for r in wide_world.relationships)
    view = next(v for v in wide_world.views if v.id == "object:Website.VehicleTemperatures")
    assert len(view.columns) == 6
    assert not wide_world.synonyms  # none in the sample database


def test_edge_encrypted_procedure_has_no_definition(edge: Extracted) -> None:
    secret = next(r for r in edge.routines if r.name == "SecretProc")
    assert secret.definition is None
    assert secret.definition_status is DefinitionStatus.ENCRYPTED
    assert secret.kind is RoutineKind.PROCEDURE


def test_edge_duplicate_foreign_keys_share_an_edge(edge: Extracted) -> None:
    first, second = edge.relationships
    assert first.id != second.id
    assert {first.id, second.id} == {
        "foreign_key:dbo.FK_Child_Parent_A",
        "foreign_key:dbo.FK_Child_Parent_B",
    }
    assert first.edge == second.edge == "edge:dbo.Child(ParentId)>dbo.Parent(Id)"
    assert {first.on_delete, second.on_delete} == {
        ReferentialAction.NO_ACTION,
        ReferentialAction.CASCADE,
    }


def test_edge_cross_database_references_are_flagged_and_unresolved(edge: Extracted) -> None:
    (view_dependency,) = [d for d in edge.dependencies if d.from_object == "object:dbo.RemoteView"]
    target = view_dependency.target
    assert target.scope is ReferenceScope.CROSS_DATABASE
    assert target.resolved is None
    assert (target.name.database, target.name.schema_name, target.name.name) == (
        "SchemaMapEdgeCasesOther",
        "dbo",
        "Remote",
    )
    (synonym,) = edge.synonyms
    assert synonym.id == "object:dbo.RemoteSynonym"
    assert synonym.target == target


def test_edge_unresolved_reference_is_recorded(edge: Extracted) -> None:
    (dependency,) = [d for d in edge.dependencies if d.from_object == "object:dbo.UsesMissing"]
    assert dependency.target.scope is ReferenceScope.LOCAL
    assert dependency.target.resolved is None
    assert dependency.target.name.name == "DoesNotExist"


def test_edge_filtered_index_and_temporal_table(edge: Extracted) -> None:
    tables = {t.id: t for t in edge.tables}
    (active,) = [i for i in tables["object:dbo.Child"].indexes if i.name == "IX_Child_Active"]
    assert active.filter is not None
    assert "Status" in active.filter
    assert tables["object:dbo.Versioned"].temporal_type is TemporalType.SYSTEM_VERSIONED
    assert tables["object:dbo.VersionedHistory"].temporal_type is TemporalType.HISTORY


def test_edge_odd_names_round_trip(edge: Extracted) -> None:
    table = next(t for t in edge.tables if t.name == ODD_TABLE)
    parsed = parse_id(table.id)
    assert isinstance(parsed, NameId)
    assert parsed.to_id() == table.id
    assert parsed.parts == ("dbo", ODD_TABLE)
    (column,) = table.columns
    assert column.name == ODD_COLUMN
    parsed_column = parse_id(column.id)
    assert isinstance(parsed_column, NameId)
    assert parsed_column.parts == ("dbo", ODD_TABLE, ODD_COLUMN)
