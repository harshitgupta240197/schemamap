"""Schema filters and definition omission as pure functions over an extraction."""

from __future__ import annotations

from datetime import datetime, timezone

from schemamap.extract import (
    DatabaseExtraction,
    SchemaFilter,
    apply_schema_filter,
    omit_definitions,
)
from schemamap.snapshot.ids import (
    column_id,
    constraint_id,
    edge_id,
    foreign_key_id,
    index_id,
    object_id,
    schema_id,
)
from schemamap.snapshot.models import (
    CheckConstraint,
    Column,
    ComputedColumn,
    DefaultConstraint,
    DefinitionStatus,
    Dependency,
    Index,
    IndexKind,
    QualifiedName,
    QueryStoreState,
    Reference,
    ReferenceScope,
    Relationship,
    Routine,
    RoutineKind,
    RowCount,
    RowCounts,
    Schema,
    Section,
    Snapshot,
    Synonym,
    Table,
    View,
)

CAPTURED = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)


def col(
    schema: str,
    table: str,
    name: str,
    computed: ComputedColumn | None = None,
    default: DefaultConstraint | None = None,
) -> Column:
    return Column(
        id=column_id(schema, table, name),
        name=name,
        ordinal=1,
        data_type="int",
        nullable=False,
        computed=computed,
        default=default,
    )


def table(
    schema: str,
    name: str,
    columns: tuple[Column, ...] | None = None,
    indexes: tuple[Index, ...] = (),
    check_constraints: tuple[CheckConstraint, ...] = (),
) -> Table:
    return Table(
        id=object_id(schema, name),
        schema_id=schema_id(schema),
        name=name,
        columns=columns or (col(schema, name, "Id"),),
        indexes=indexes,
        check_constraints=check_constraints,
    )


def local(schema: str, name: str) -> Reference:
    return Reference(
        scope=ReferenceScope.LOCAL,
        name=QualifiedName(schema_name=schema, name=name),
        resolved=object_id(schema, name),
    )


def extraction() -> DatabaseExtraction:
    """dbo.Order -> audit.Log (FK); dbo.V reads audit.Log; audit.P reads dbo.Order."""
    order = table("dbo", "Order")
    log = table("audit", "Log")
    fk = Relationship(
        id=foreign_key_id("dbo", "FK_Order_Log"),
        name="FK_Order_Log",
        edge=edge_id((column_id("dbo", "Order", "Id"),), (column_id("audit", "Log", "Id"),)),
        from_object=order.id,
        from_columns=(column_id("dbo", "Order", "Id"),),
        to_object=log.id,
        to_columns=(column_id("audit", "Log", "Id"),),
    )
    view = View(
        id=object_id("dbo", "V"),
        schema_id=schema_id("dbo"),
        name="V",
        columns=(col("dbo", "V", "Id"),),
        definition="SELECT 1 FROM audit.Log",
        definition_status=DefinitionStatus.AVAILABLE,
    )
    proc = Routine(
        id=object_id("audit", "P"),
        schema_id=schema_id("audit"),
        name="P",
        kind=RoutineKind.PROCEDURE,
        definition="SELECT * FROM dbo.[Order]",
        definition_status=DefinitionStatus.AVAILABLE,
    )
    return DatabaseExtraction(
        schemas=(Schema(id="schema:dbo", name="dbo"), Schema(id="schema:audit", name="audit")),
        tables=(order, log),
        views=(view,),
        routines=(proc,),
        synonyms=(),
        relationships=(fk,),
        dependencies=(
            Dependency(from_object=view.id, target=local("audit", "Log")),
            Dependency(from_object=proc.id, target=local("dbo", "Order")),
        ),
        row_counts=RowCounts(
            items=(RowCount(object=order.id, rows=3), RowCount(object=log.id, rows=9))
        ),
        query_store=QueryStoreState.OFF,
        warnings=(),
    )


def assert_whole(result: DatabaseExtraction) -> None:
    """Building a snapshot runs the model's integrity checks."""
    from schemamap.extract import build_snapshot, build_source

    source = build_source(None, "h", "d", QueryStoreState.OFF)
    assert isinstance(build_snapshot(result, source, CAPTURED), Snapshot)


def test_no_filter_returns_the_extraction_unchanged() -> None:
    original = extraction()
    assert apply_schema_filter(original, SchemaFilter()) is original


def test_exclude_drops_objects_and_everything_pointing_at_them() -> None:
    result = apply_schema_filter(extraction(), SchemaFilter(exclude=("audit",)))
    assert [s.name for s in result.schemas] == ["dbo"]
    assert [t.name for t in result.tables] == ["Order"]
    assert result.routines == ()
    assert result.relationships == ()
    assert result.dependencies == ()
    assert result.row_counts is not None
    assert [i.object for i in result.row_counts.items] == [object_id("dbo", "Order")]
    assert_whole(result)


def test_include_keeps_only_the_named_schemas() -> None:
    result = apply_schema_filter(extraction(), SchemaFilter(include=("audit",)))
    assert [t.name for t in result.tables] == ["Log"]
    assert result.views == ()
    assert [r.name for r in result.routines] == ["P"]
    assert result.dependencies == ()
    assert_whole(result)


def test_exactly_one_warning_states_the_drop_count() -> None:
    result = apply_schema_filter(extraction(), SchemaFilter(exclude=("audit",)))
    dropped = [w for w in result.warnings if w.code == "references_dropped"]
    assert len(dropped) == 1
    assert dropped[0].section is Section.FILTERS
    # the FK, the view's dependency on audit.Log and the audit procedure's dependency
    assert "dropped 3 " in dropped[0].message


def test_no_drop_warning_when_nothing_pointed_at_the_removed_schema() -> None:
    result = apply_schema_filter(extraction(), SchemaFilter(exclude=("nothing",)))
    assert [w.code for w in result.warnings] == ["schema_not_found"]


def test_schema_names_compare_case_insensitively() -> None:
    result = apply_schema_filter(extraction(), SchemaFilter(exclude=("AUDIT",)))
    assert [s.name for s in result.schemas] == ["dbo"]
    assert not [w for w in result.warnings if w.code == "schema_not_found"]


def test_unknown_schema_is_warned_about_once() -> None:
    result = apply_schema_filter(extraction(), SchemaFilter(include=("dbo", "typo")))
    messages = [w.message for w in result.warnings if w.code == "schema_not_found"]
    assert len(messages) == 1
    assert "'typo'" in messages[0]


def test_synonym_to_an_omitted_object_is_dropped() -> None:
    base = extraction()
    synonym = Synonym(
        id=object_id("dbo", "SynLog"),
        schema_id=schema_id("dbo"),
        name="SynLog",
        target=local("audit", "Log"),
    )
    result = apply_schema_filter(
        DatabaseExtraction(**{**base.__dict__, "synonyms": (synonym,)}),
        SchemaFilter(exclude=("audit",)),
    )
    assert result.synonyms == ()
    assert_whole(result)


def test_recorded_filters_are_sorted_and_empty_when_unfiltered() -> None:
    assert SchemaFilter().recorded() is None
    recorded = SchemaFilter(include=("sales", "dbo"), exclude=("x",)).recorded()
    assert recorded is not None
    assert recorded.schemas == ("dbo", "sales")
    assert recorded.exclude_schemas == ("x",)


def with_definitions() -> DatabaseExtraction:
    base = extraction()
    key_column = col(
        "dbo",
        "T",
        "Id",
        computed=ComputedColumn(definition="[A]+[B]", persisted=False),
        default=DefaultConstraint(id=constraint_id("dbo", "DF_T"), name="DF_T", definition="((0))"),
    )
    filtered = Index(
        id=index_id("dbo", "T", "IX_T"),
        name="IX_T",
        kind=IndexKind.NONCLUSTERED,
        unique=False,
        key_columns=(),
        filter="([Id]>(0))",
    )
    t = table(
        "dbo",
        "T",
        columns=(key_column,),
        indexes=(filtered,),
        check_constraints=(
            CheckConstraint(id=constraint_id("dbo", "CK_T"), name="CK_T", definition="([Id]>(0))"),
        ),
    )
    encrypted = base.routines[0].model_copy(
        update={
            "id": object_id("dbo", "E"),
            "schema_id": schema_id("dbo"),
            "name": "E",
            "definition": None,
            "definition_status": DefinitionStatus.ENCRYPTED,
        }
    )
    return DatabaseExtraction(
        **{**base.__dict__, "tables": (*base.tables, t), "routines": (*base.routines, encrypted)}
    )


def test_omit_definitions_leaves_no_definition_text() -> None:
    result = omit_definitions(with_definitions())
    dump = "".join(m.model_dump_json() for m in (*result.tables, *result.views, *result.routines))
    for text in ("SELECT", "[A]+[B]", "((0))", "([Id]>(0))"):
        assert text not in dump
    assert_whole(result)


def test_available_becomes_omitted_and_other_statuses_are_kept() -> None:
    result = omit_definitions(with_definitions())
    statuses = {r.name: r.definition_status for r in result.routines}
    assert statuses == {"P": DefinitionStatus.OMITTED, "E": DefinitionStatus.ENCRYPTED}
    assert result.views[0].definition_status is DefinitionStatus.OMITTED


def test_omit_definitions_keeps_the_objects_themselves() -> None:
    before = with_definitions()
    after = omit_definitions(before)
    assert [t.id for t in after.tables] == [t.id for t in before.tables]
    t = next(t for t in after.tables if t.name == "T")
    assert t.columns[0].computed is not None
    assert t.columns[0].computed.persisted is False
    assert t.columns[0].default is not None
    assert t.columns[0].default.name == "DF_T"
    assert t.check_constraints[0].name == "CK_T"
