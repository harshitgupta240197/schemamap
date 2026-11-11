"""Test-only snapshot builders: a hostile-name snapshot and a seeded large synthetic one.

Everything here is invented; no real database is involved.
"""

from __future__ import annotations

import random
from datetime import datetime, timezone

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
    Column,
    DefinitionStatus,
    Generator,
    Index,
    IndexColumn,
    IndexKind,
    KeyConstraint,
    KeyKind,
    Relationship,
    Schema,
    Snapshot,
    SourceInfo,
    Table,
    View,
)

CAPTURED = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
LINE_SEPARATOR = chr(0x2028)
PARAGRAPH_SEPARATOR = chr(0x2029)

HOSTILE_DATABASE = "</script><svg onload=alert(1)>"
HOSTILE_SCHEMA = "</script><img src=x onerror=alert(1)>"
HOSTILE_TABLES = ("<!--", "]]>", f"line{LINE_SEPARATOR}break{PARAGRAPH_SEPARATOR}end", "Orders")
HOSTILE_COLUMNS = ("<img src=x onerror=alert(1)>", "</script>", "a&b", "Id")
HOSTILE_DEFINITION = (
    "SELECT '</script><script>alert(1)</script><!--' AS x -- $& $' $` \\1 \\g<0> {0} %s ]]>"
)


def column(schema: str, table: str, name: str, ordinal: int, data_type: str = "int") -> Column:
    return Column(
        id=column_id(schema, table, name),
        name=name,
        ordinal=ordinal,
        data_type=data_type,
        nullable=ordinal > 1,
    )


def table_with_key(schema: str, name: str, column_names: tuple[str, ...]) -> Table:
    """A table whose first column is its primary key."""
    key_index = Index(
        id=index_id(schema, name, f"PK_{name}"),
        name=f"PK_{name}",
        kind=IndexKind.CLUSTERED,
        unique=True,
        key_columns=(IndexColumn(column=column_id(schema, name, column_names[0])),),
    )
    return Table(
        id=object_id(schema, name),
        schema_id=schema_id(schema),
        name=name,
        columns=tuple(column(schema, name, c, i + 1) for i, c in enumerate(column_names)),
        indexes=(key_index,),
        key_constraints=(
            KeyConstraint(
                id=constraint_id(schema, f"PK_{name}"),
                name=f"PK_{name}",
                kind=KeyKind.PRIMARY_KEY,
                columns=(column_id(schema, name, column_names[0]),),
                index=key_index.id,
            ),
        ),
    )


def foreign_key(
    from_schema: str, from_table: str, from_column: str, to_schema: str, to_table: str, to_col: str
) -> Relationship:
    name = f"FK_{from_table}_{to_table}_{from_column}"
    source = (column_id(from_schema, from_table, from_column),)
    target = (column_id(to_schema, to_table, to_col),)
    return Relationship(
        id=foreign_key_id(from_schema, name),
        name=name,
        edge=edge_id(source, target),
        from_object=object_id(from_schema, from_table),
        from_columns=source,
        to_object=object_id(to_schema, to_table),
        to_columns=target,
    )


def hostile_snapshot() -> Snapshot:
    """Names and SQL text that would break out of an HTML script element if embedded raw."""
    odd = HOSTILE_SCHEMA
    odd_names = ("<!--", "]]>")
    tables = [
        table_with_key(odd, odd_names[0], HOSTILE_COLUMNS),
        table_with_key(odd, odd_names[1], HOSTILE_COLUMNS),
        table_with_key("dbo", HOSTILE_TABLES[2], HOSTILE_COLUMNS),
        table_with_key("dbo", "Orders", HOSTILE_COLUMNS),
    ]
    relationships = [
        foreign_key("dbo", "Orders", HOSTILE_COLUMNS[2], odd, odd_names[0], HOSTILE_COLUMNS[3]),
        foreign_key(odd, odd_names[1], HOSTILE_COLUMNS[1], "dbo", "Orders", HOSTILE_COLUMNS[3]),
    ]
    view = View(
        id=object_id("dbo", "</style>"),
        schema_id=schema_id("dbo"),
        name="</style>",
        columns=(column("dbo", "</style>", "x", 1),),
        definition=HOSTILE_DEFINITION,
        definition_status=DefinitionStatus.AVAILABLE,
    )
    return Snapshot(
        generator=Generator(version="0.0.0"),
        captured_at=CAPTURED,
        source=SourceInfo(server=None, server_redacted=True, database=HOSTILE_DATABASE),
        schemas=(
            Schema(id=schema_id("dbo"), name="dbo"),
            Schema(id=schema_id(odd), name=odd),
        ),
        tables=tuple(tables),
        views=(view,),
        relationships=tuple(relationships),
    )


def synthetic_snapshot(tables: int, seed: int) -> Snapshot:
    """A seeded database of ``tables`` tables in 12 schemas with keys and view definitions."""
    rng = random.Random(seed)
    schema_names = [f"schema{n:02d}" for n in range(12)]
    built: list[Table] = []
    schema_of: list[str] = []
    relationships: list[Relationship] = []
    for number in range(tables):
        schema = schema_names[rng.randrange(len(schema_names))]
        name = f"Table{number:04d}"
        parents = [rng.randrange(number) for _ in range(rng.choice((0, 1, 1, 2)))] if number else []
        names = ("Id", *(f"Parent{p:04d}Id" for p in dict.fromkeys(parents)), "Name", "Created")
        built.append(table_with_key(schema, name, names))
        schema_of.append(schema)
        for parent in dict.fromkeys(parents):
            relationships.append(
                foreign_key(
                    schema,
                    name,
                    f"Parent{parent:04d}Id",
                    schema_of[parent],
                    built[parent].name,
                    "Id",
                )
            )
    views = tuple(
        View(
            id=object_id(schema_names[n % 12], f"View{n:04d}"),
            schema_id=schema_id(schema_names[n % 12]),
            name=f"View{n:04d}",
            columns=(column(schema_names[n % 12], f"View{n:04d}", "Id", 1),),
            definition=f"SELECT t.Id, t.Name FROM {schema_names[n % 12]}.Table{n:04d} AS t "
            + "WHERE t.Name <> '' AND t.Created > '2020-01-01' " * 4,
            definition_status=DefinitionStatus.AVAILABLE,
        )
        for n in range(min(tables // 5, tables))
    )
    return Snapshot(
        generator=Generator(version="0.0.0"),
        captured_at=CAPTURED,
        source=SourceInfo(server=None, server_redacted=True, database="Synthetic"),
        schemas=tuple(Schema(id=schema_id(s), name=s) for s in schema_names),
        tables=tuple(built),
        views=views,
        relationships=tuple(relationships),
    )
