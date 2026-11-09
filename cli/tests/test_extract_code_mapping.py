"""Row-to-model mapping for foreign keys, code objects and dependencies; no database needed."""

import pytest

from schemamap.extract import (
    build_dependencies,
    build_relationships,
    build_routines,
    build_synonyms,
    build_views,
)
from schemamap.extract.code import definition_state
from schemamap.extract.rows import (
    ColumnRow,
    DependencyRow,
    ForeignKeyRow,
    RoutineRow,
    SynonymRow,
    ViewRow,
)
from schemamap.snapshot.models import (
    DefinitionStatus,
    ReferenceScope,
    ReferentialAction,
    RoutineKind,
)


def fk_row(ordinal: int, from_column: str, to_column: str, **overrides: object) -> ForeignKeyRow:
    base: dict[str, object] = {
        "fk_schema_name": "dbo",
        "fk_name": "FK_C_P",
        "from_schema_name": "dbo",
        "from_table_name": "C",
        "to_schema_name": "dbo",
        "to_table_name": "P",
        "ordinal": ordinal,
        "from_column_name": from_column,
        "to_column_name": to_column,
        "on_delete": 0,
        "on_update": 0,
        "is_disabled": False,
        "is_not_trusted": False,
    }
    return ForeignKeyRow(**{**base, **overrides})  # type: ignore[arg-type]


def test_multi_column_foreign_key_keeps_column_pairs_in_key_order() -> None:
    rows = [fk_row(2, "TenantId", "TenantId"), fk_row(1, "ParentId", "Id")]
    (fk,) = build_relationships(rows)
    assert fk.from_columns == ("column:dbo.C.ParentId", "column:dbo.C.TenantId")
    assert fk.to_columns == ("column:dbo.P.Id", "column:dbo.P.TenantId")
    assert fk.edge == "edge:dbo.C(ParentId,TenantId)>dbo.P(Id,TenantId)"
    assert fk.id == "foreign_key:dbo.FK_C_P"


def test_actions_and_flags_are_mapped() -> None:
    (fk,) = build_relationships(
        [fk_row(1, "a", "b", on_delete=1, on_update=3, is_disabled=True, is_not_trusted=True)]
    )
    assert fk.on_delete is ReferentialAction.CASCADE
    assert fk.on_update is ReferentialAction.SET_DEFAULT
    assert fk.disabled
    assert not fk.trusted
    (set_null,) = build_relationships([fk_row(1, "a", "b", on_delete=2)])
    assert set_null.on_delete is ReferentialAction.SET_NULL
    assert set_null.trusted


def test_foreign_keys_on_identical_columns_share_an_edge_but_not_an_id() -> None:
    rows = [fk_row(1, "a", "b", fk_name="FK_2"), fk_row(1, "a", "b", fk_name="FK_1")]
    first, second = build_relationships(rows)
    assert [first.id, second.id] == ["foreign_key:dbo.FK_1", "foreign_key:dbo.FK_2"]
    assert first.edge == second.edge


def test_foreign_keys_are_sorted_by_id_whatever_the_row_order() -> None:
    rows = [fk_row(1, "a", "b", fk_name="Z"), fk_row(1, "a", "b", fk_name="A")]
    assert [r.name for r in build_relationships(rows)] == ["A", "Z"]
    assert [r.name for r in build_relationships(reversed(rows))] == ["A", "Z"]


def view_row(**overrides: object) -> ViewRow:
    base: dict[str, object] = {
        "schema_name": "dbo",
        "view_name": "V",
        "is_schema_bound": False,
        "definition": "CREATE VIEW dbo.V AS SELECT 1 AS One",
        "is_encrypted": False,
    }
    return ViewRow(**{**base, **overrides})  # type: ignore[arg-type]


def view_column(name: str, ordinal: int, view: str = "V") -> ColumnRow:
    return ColumnRow("dbo", view, ordinal, name, "int", False, "sys", None, 4, 10, 0, True,
                     False, None, None, None, None, None, None)  # fmt: skip


def test_view_gets_its_own_columns_and_definition() -> None:
    views = build_views(
        [view_row(is_schema_bound=True), view_row(view_name="W", definition=None)],
        [view_column("B", 2), view_column("A", 1), view_column("X", 1, view="W")],
    )
    v, w = views
    assert [c.name for c in v.columns] == ["A", "B"]
    assert v.schema_bound
    assert v.definition_status is DefinitionStatus.AVAILABLE
    assert [c.id for c in w.columns] == ["column:dbo.W.X"]
    assert w.definition is None
    assert w.definition_status is DefinitionStatus.NOT_PERMITTED


def test_columns_of_a_view_not_in_the_rows_are_ignored() -> None:
    assert build_views([], [view_column("A", 1)]) == ()


@pytest.mark.parametrize(
    ("definition", "encrypted", "has_module", "status"),
    [
        ("CREATE ...", False, True, DefinitionStatus.AVAILABLE),
        (None, True, True, DefinitionStatus.ENCRYPTED),
        (None, False, False, DefinitionStatus.NOT_APPLICABLE),
        (None, False, True, DefinitionStatus.NOT_PERMITTED),
    ],
)
def test_definition_state(
    definition: str | None, encrypted: bool, has_module: bool, status: DefinitionStatus
) -> None:
    text, actual = definition_state(definition, encrypted=encrypted, has_module=has_module)
    assert actual is status
    assert text == definition


def routine_row(name: str, type_code: str, **overrides: object) -> RoutineRow:
    base: dict[str, object] = {
        "schema_name": "dbo",
        "routine_name": name,
        "type_code": type_code,
        "parent_schema_name": None,
        "parent_name": None,
        "definition": "CREATE ...",
        "is_encrypted": False,
        "has_module": True,
    }
    return RoutineRow(**{**base, **overrides})  # type: ignore[arg-type]


def test_routine_kinds_ignore_the_padding_of_the_catalog_type_code() -> None:
    rows = [
        routine_row("a", "P "),
        routine_row("b", "FN"),
        routine_row("c", "IF"),
        routine_row("d", "TF"),
        routine_row("e", "TR"),
        routine_row("f", "ZZ"),
    ]
    assert [r.kind for r in build_routines(rows)] == [
        RoutineKind.PROCEDURE,
        RoutineKind.SCALAR_FUNCTION,
        RoutineKind.INLINE_TABLE_FUNCTION,
        RoutineKind.TABLE_FUNCTION,
        RoutineKind.TRIGGER,
        RoutineKind.OTHER,
    ]


def test_trigger_records_its_parent() -> None:
    (trigger,) = build_routines(
        [routine_row("t", "TR", parent_schema_name="Sales", parent_name="Orders")]
    )
    assert trigger.parent == "object:Sales.Orders"


def test_encrypted_and_clr_routines_have_no_definition() -> None:
    encrypted, clr = build_routines(
        [
            routine_row("a", "P ", definition=None, is_encrypted=True),
            routine_row("b", "PC", definition=None, has_module=False),
        ]
    )
    assert (encrypted.definition, encrypted.definition_status) == (None, DefinitionStatus.ENCRYPTED)
    assert (clr.definition, clr.definition_status) == (None, DefinitionStatus.NOT_APPLICABLE)


def synonym_row(**overrides: object) -> SynonymRow:
    base: dict[str, object] = {
        "schema_name": "dbo",
        "synonym_name": "S",
        "target_server": None,
        "target_database": None,
        "target_schema": "dbo",
        "target_name": "T",
        "resolved_schema_name": "dbo",
        "resolved_name": "T",
    }
    return SynonymRow(**{**base, **overrides})  # type: ignore[arg-type]


def test_local_synonym_resolves() -> None:
    (synonym,) = build_synonyms([synonym_row()])
    assert synonym.target.scope is ReferenceScope.LOCAL
    assert synonym.target.resolved == "object:dbo.T"


def test_cross_database_and_cross_server_synonyms_are_kept_as_written_never_resolved() -> None:
    # Even if a resolved name were supplied, only local scope may carry one.
    other_db, other_server = build_synonyms(
        [
            synonym_row(synonym_name="D", target_database="Other"),
            synonym_row(synonym_name="L", target_server="Far", target_database="Other"),
        ]
    )
    assert other_db.target.scope is ReferenceScope.CROSS_DATABASE
    assert other_db.target.name.database == "Other"
    assert other_db.target.resolved is None
    assert other_server.target.scope is ReferenceScope.CROSS_SERVER
    assert other_server.target.name.server == "Far"
    assert other_server.target.resolved is None


def test_synonym_to_a_missing_local_object_is_unresolved() -> None:
    (synonym,) = build_synonyms([synonym_row(resolved_schema_name=None, resolved_name=None)])
    assert synonym.target.scope is ReferenceScope.LOCAL
    assert synonym.target.resolved is None


def dependency_row(**overrides: object) -> DependencyRow:
    base: dict[str, object] = {
        "from_schema_name": "dbo",
        "from_name": "V",
        "target_server": None,
        "target_database": None,
        "target_schema": "dbo",
        "target_name": "T",
        "resolved_schema_name": "dbo",
        "resolved_name": "T",
    }
    return DependencyRow(**{**base, **overrides})  # type: ignore[arg-type]


def test_repeated_dependency_rows_collapse_to_one() -> None:
    assert len(build_dependencies([dependency_row(), dependency_row()])) == 1


def test_dependency_scopes() -> None:
    built = build_dependencies(
        [
            dependency_row(target_name="A", resolved_name="A"),
            dependency_row(target_name="B", resolved_schema_name=None, resolved_name=None),
            dependency_row(target_name="C", target_database="Other"),
            dependency_row(target_name="D", target_server="Far", target_database="Other"),
        ]
    )
    by_name = {d.target.name.name: d.target for d in built}
    assert by_name["A"].resolved == "object:dbo.A"
    assert by_name["B"].scope is ReferenceScope.LOCAL
    assert by_name["B"].resolved is None
    assert by_name["C"].scope is ReferenceScope.CROSS_DATABASE
    assert by_name["C"].resolved is None
    assert by_name["D"].scope is ReferenceScope.CROSS_SERVER
    assert by_name["D"].name.server == "Far"


def test_dependency_name_parts_are_kept_exactly_as_written() -> None:
    (dependency,) = build_dependencies(
        [dependency_row(target_schema=None, target_database="Odd.Db [x]", target_name="T.1")]
    )
    name = dependency.target.name
    assert (name.database, name.schema_name, name.name) == ("Odd.Db [x]", None, "T.1")


def test_dependencies_are_sorted_deterministically() -> None:
    rows = [dependency_row(target_name="B"), dependency_row(target_name="A")]
    assert build_dependencies(rows) == build_dependencies(reversed(rows))
