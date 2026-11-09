"""Row-to-model mapping with hand-written rows; no database needed."""

import pytest

from schemamap.extract import build_schemas, build_tables
from schemamap.extract.rows import (
    CheckConstraintRow,
    ColumnRow,
    IndexColumnRow,
    IndexRow,
    TableRow,
)
from schemamap.extract.schemas import SchemaRow
from schemamap.extract.tables import build_column
from schemamap.snapshot.models import IndexKind, KeyKind, TemporalType


def column_row(**overrides: object) -> ColumnRow:
    base: dict[str, object] = {
        "schema_name": "dbo",
        "table_name": "T",
        "ordinal": 1,
        "column_name": "C",
        "type_name": "int",
        "is_alias_type": False,
        "type_schema_name": "sys",
        "base_type_name": None,
        "max_length": 4,
        "precision": 10,
        "scale": 0,
        "is_nullable": False,
        "is_identity": False,
        "collation_name": None,
        "computed_definition": None,
        "computed_persisted": None,
        "default_schema_name": None,
        "default_name": None,
        "default_definition": None,
    }
    return ColumnRow(**{**base, **overrides})  # type: ignore[arg-type]


def index_column(index_id: int, name: str, **overrides: object) -> IndexColumnRow:
    base: dict[str, object] = {
        "schema_name": "dbo",
        "table_name": "T",
        "index_id": index_id,
        "column_name": name,
        "key_ordinal": 0,
        "partition_ordinal": 0,
        "index_column_id": 1,
        "is_descending": False,
        "is_included": False,
    }
    return IndexColumnRow(**{**base, **overrides})  # type: ignore[arg-type]


def index_row(index_id: int, name: str | None, **overrides: object) -> IndexRow:
    base: dict[str, object] = {
        "schema_name": "dbo",
        "table_name": "T",
        "index_id": index_id,
        "index_name": name,
        "index_type": 2,
        "is_unique": False,
        "is_disabled": False,
        "filter_definition": None,
        "key_constraint_type": None,
        "key_constraint_schema_name": None,
        "key_constraint_name": None,
    }
    return IndexRow(**{**base, **overrides})  # type: ignore[arg-type]


def test_schemas_are_sorted_by_id() -> None:
    schemas = build_schemas([SchemaRow("Sales"), SchemaRow("dbo")])
    assert [s.id for s in schemas] == ["schema:Sales", "schema:dbo"]


@pytest.mark.parametrize(
    ("overrides", "length", "is_max", "precision", "scale"),
    [
        ({"type_name": "int"}, None, False, None, None),
        ({"type_name": "varchar", "max_length": 50}, 50, False, None, None),
        ({"type_name": "varchar", "max_length": -1}, None, True, None, None),
        ({"type_name": "nvarchar", "max_length": 100}, 50, False, None, None),
        ({"type_name": "nvarchar", "max_length": -1}, None, True, None, None),
        ({"type_name": "nchar", "max_length": 20}, 10, False, None, None),
        ({"type_name": "varbinary", "max_length": 16}, 16, False, None, None),
        ({"type_name": "decimal", "precision": 18, "scale": 4}, None, False, 18, 4),
        ({"type_name": "datetime2", "precision": 27, "scale": 7}, None, False, None, 7),
        ({"type_name": "xml", "max_length": -1}, None, False, None, None),
        ({"type_name": "money", "precision": 19, "scale": 4}, None, False, None, None),
    ],
)
def test_type_details(
    overrides: dict[str, object],
    length: int | None,
    is_max: bool,
    precision: int | None,
    scale: int | None,
) -> None:
    column = build_column(column_row(**overrides))
    assert (column.length, column.is_max, column.precision, column.scale) == (
        length,
        is_max,
        precision,
        scale,
    )


def test_alias_type_reports_its_base_type() -> None:
    column = build_column(
        column_row(
            type_name="Name",
            is_alias_type=True,
            type_schema_name="dbo",
            base_type_name="nvarchar",
            max_length=100,
        )
    )
    assert (column.data_type, column.user_type, column.length) == ("nvarchar", "dbo.Name", 50)


def test_identity_computed_default_and_collation() -> None:
    column = build_column(
        column_row(
            is_identity=True,
            is_nullable=True,
            collation_name="Latin1_General_CI_AS",
            computed_definition="([A]+[B])",
            computed_persisted=True,
            default_schema_name="dbo",
            default_name="DF_T_C",
            default_definition="((0))",
        )
    )
    assert column.identity and column.nullable
    assert column.collation == "Latin1_General_CI_AS"
    assert column.computed is not None
    assert (column.computed.definition, column.computed.persisted) == ("([A]+[B])", True)
    assert column.default is not None
    assert (column.default.id, column.default.definition) == ("constraint:dbo.DF_T_C", "((0))")


def assemble() -> tuple[object, ...]:
    return build_tables(
        [TableRow("dbo", "T", 2, True), TableRow("dbo", "A", 0, False)],
        [
            column_row(ordinal=2, column_name="B"),
            column_row(ordinal=1, column_name="A"),
            column_row(ordinal=3, column_name="Note"),
            column_row(table_name="A", column_name="Id"),
        ],
        [
            index_row(
                1,
                "PK_T",
                index_type=1,
                is_unique=True,
                key_constraint_type="PK",
                key_constraint_schema_name="dbo",
                key_constraint_name="PK_T",
            ),
            index_row(2, "IX_T_B", filter_definition="([B]>(0))"),
            index_row(
                3,
                "UQ_T_Note",
                is_unique=True,
                key_constraint_type="UQ",
                key_constraint_schema_name="dbo",
                key_constraint_name="UQ_T_Note",
            ),
        ],
        [
            index_column(1, "B", key_ordinal=2, index_column_id=2, is_descending=True),
            index_column(1, "A", key_ordinal=1, index_column_id=1),
            index_column(2, "B", key_ordinal=1, index_column_id=1),
            index_column(2, "Note", index_column_id=2, is_included=True),
            index_column(3, "Note", key_ordinal=1),
        ],
        [CheckConstraintRow("dbo", "T", "dbo", "CK_T_B", "([B]>(0))", "B", False, True)],
    )


def test_tables_assemble_with_keys_indexes_and_checks() -> None:
    tables = assemble()
    assert [t.id for t in tables] == ["object:dbo.A", "object:dbo.T"]  # type: ignore[attr-defined]
    table = tables[1]
    assert table.temporal_type is TemporalType.SYSTEM_VERSIONED  # type: ignore[attr-defined]
    assert table.memory_optimized  # type: ignore[attr-defined]
    assert [c.name for c in table.columns] == ["A", "B", "Note"]  # type: ignore[attr-defined]
    pk, unique = table.key_constraints  # type: ignore[attr-defined]
    assert (pk.kind, pk.index) == (KeyKind.PRIMARY_KEY, "index:dbo.T.PK_T")
    assert pk.columns == ("column:dbo.T.A", "column:dbo.T.B")
    assert unique.kind is KeyKind.UNIQUE
    by_name = {i.name: i for i in table.indexes}  # type: ignore[attr-defined]
    assert by_name["PK_T"].kind is IndexKind.CLUSTERED
    assert [(k.column, k.descending) for k in by_name["PK_T"].key_columns] == [
        ("column:dbo.T.A", False),
        ("column:dbo.T.B", True),
    ]
    filtered = by_name["IX_T_B"]
    assert filtered.filter == "([B]>(0))"
    assert filtered.included_columns == ("column:dbo.T.Note",)
    (check,) = table.check_constraints  # type: ignore[attr-defined]
    assert (check.column, check.trusted, check.disabled) == ("column:dbo.T.B", False, False)


def test_key_constraint_belongs_to_no_other_table() -> None:
    first = assemble()[0]
    assert first.key_constraints == ()  # type: ignore[attr-defined]


def test_xml_index_keeps_its_column_but_partitioning_columns_are_not_keys() -> None:
    (table,) = build_tables(
        [TableRow("dbo", "T", 0, False)],
        [column_row(column_name="Doc"), column_row(ordinal=2, column_name="Part")],
        [index_row(5, "PXML", index_type=3), index_row(6, "IX_P")],
        [
            index_column(5, "Doc"),
            index_column(6, "Doc", key_ordinal=1),
            index_column(6, "Part", partition_ordinal=1, index_column_id=2),
        ],
        [],
    )
    by_name = {i.name: i for i in table.indexes}
    assert by_name["PXML"].kind is IndexKind.XML
    assert [k.column for k in by_name["PXML"].key_columns] == ["column:dbo.T.Doc"]
    assert [k.column for k in by_name["IX_P"].key_columns] == ["column:dbo.T.Doc"]


def test_columnstore_columns_are_included_columns() -> None:
    (table,) = build_tables(
        [TableRow("dbo", "T", 0, False)],
        [column_row(column_name="A"), column_row(ordinal=2, column_name="B")],
        [index_row(2, "CCI", index_type=5)],
        [index_column(2, "A", is_included=True), index_column(2, "B", is_included=True)],
        [],
    )
    (index,) = table.indexes
    assert index.kind is IndexKind.CLUSTERED_COLUMNSTORE
    assert index.key_columns == ()
    assert len(index.included_columns) == 2


def test_rows_for_objects_dropped_between_queries_are_ignored() -> None:
    tables = build_tables(
        [TableRow("dbo", "T", 0, False)],
        [column_row(), column_row(table_name="Gone", column_name="X")],
        [index_row(9, "IX_Gone", table_name="Gone")],
        [index_column(9, "X", table_name="Gone", key_ordinal=1)],
        [CheckConstraintRow("dbo", "Gone", "dbo", "CK", "(1=1)", None, False, False)],
    )
    assert [t.id for t in tables] == ["object:dbo.T"]
    assert tables[0].indexes == ()


ODD_NAMES = ["a.b", "[x]", "x]y", "Straße", "表", "😀", "a,b", "a(b)", "a>b", "100%", "has space"]


@pytest.mark.parametrize("name", ODD_NAMES)
def test_odd_names_round_trip_into_valid_models(name: str) -> None:
    (table,) = build_tables(
        [TableRow(name, name, 0, False)],
        [column_row(schema_name=name, table_name=name, column_name=name)],
        [
            index_row(
                1,
                name,
                schema_name=name,
                table_name=name,
                index_type=1,
                is_unique=True,
                key_constraint_type="PK",
                key_constraint_schema_name=name,
                key_constraint_name=name,
            )
        ],
        [index_column(1, name, schema_name=name, table_name=name, key_ordinal=1)],
        [CheckConstraintRow(name, name, name, name, "(1=1)", name, False, False)],
    )
    assert table.name == name
    assert table.columns[0].name == name
    assert table.key_constraints[0].name == name
    assert table.check_constraints[0].column == table.columns[0].id
