"""The tables section: tables, columns, key constraints, indexes and check constraints."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable

from schemamap.connect import MetadataExecutor
from schemamap.extract.rows import (
    CheckConstraintRow,
    ColumnRow,
    IndexColumnRow,
    IndexRow,
    TableRow,
)
from schemamap.queries import QueryName
from schemamap.snapshot.ids import (
    column_id,
    constraint_id,
    index_id,
    object_id,
    schema_id,
)
from schemamap.snapshot.models import (
    CheckConstraint,
    Column,
    ComputedColumn,
    DefaultConstraint,
    Index,
    IndexColumn,
    IndexKind,
    KeyConstraint,
    KeyKind,
    Table,
    TemporalType,
)

_TEMPORAL = {0: TemporalType.NONE, 1: TemporalType.HISTORY, 2: TemporalType.SYSTEM_VERSIONED}

_INDEX_KINDS = {
    1: IndexKind.CLUSTERED,
    2: IndexKind.NONCLUSTERED,
    3: IndexKind.XML,
    4: IndexKind.SPATIAL,
    5: IndexKind.CLUSTERED_COLUMNSTORE,
    6: IndexKind.NONCLUSTERED_COLUMNSTORE,
    7: IndexKind.HASH,
}

_KEY_KINDS = {"PK": KeyKind.PRIMARY_KEY, "UQ": KeyKind.UNIQUE}

_BYTE_LENGTH_TYPES = frozenset({"char", "varchar", "binary", "varbinary"})
_WIDE_CHAR_TYPES = frozenset({"nchar", "nvarchar"})
_PRECISION_AND_SCALE_TYPES = frozenset({"decimal", "numeric"})
_SCALE_ONLY_TYPES = frozenset({"time", "datetime2", "datetimeoffset"})

_TableKey = tuple[str, str]
_IndexKey = tuple[str, str, int]


def build_column(row: ColumnRow) -> Column:
    """Map one column row to a snapshot column.

    ``length`` is in characters for character types and bytes for binary types (None for
    ``max`` types, which set ``is_max``). ``precision`` and ``scale`` are set only for the
    types where they are declared, so an ``int`` column does not carry a precision of 10.
    """
    alias = row.is_alias_type
    data_type = row.base_type_name if alias and row.base_type_name else row.type_name
    length: int | None = None
    is_max = False
    if data_type in _BYTE_LENGTH_TYPES or data_type in _WIDE_CHAR_TYPES:
        if row.max_length == -1:
            is_max = True
        elif data_type in _WIDE_CHAR_TYPES:
            length = row.max_length // 2
        else:
            length = row.max_length
    precision = row.precision if data_type in _PRECISION_AND_SCALE_TYPES else None
    scale = (
        row.scale
        if data_type in _PRECISION_AND_SCALE_TYPES or data_type in _SCALE_ONLY_TYPES
        else None
    )
    computed = None
    if row.computed_definition is not None:
        computed = ComputedColumn(
            definition=row.computed_definition, persisted=bool(row.computed_persisted)
        )
    default = None
    if row.default_name is not None and row.default_schema_name is not None:
        default = DefaultConstraint(
            id=constraint_id(row.default_schema_name, row.default_name),
            name=row.default_name,
            definition=row.default_definition or "",
        )
    return Column(
        id=column_id(row.schema_name, row.table_name, row.column_name),
        name=row.column_name,
        ordinal=row.ordinal,
        data_type=data_type,
        user_type=f"{row.type_schema_name}.{row.type_name}" if alias else None,
        length=length,
        is_max=is_max,
        precision=precision,
        scale=scale,
        nullable=bool(row.is_nullable),
        identity=bool(row.is_identity),
        computed=computed,
        default=default,
        collation=row.collation_name,
    )


def _index_columns(
    rows: Iterable[IndexColumnRow],
) -> tuple[tuple[IndexColumn, ...], tuple[str, ...]]:
    """Split one index's column rows into ordered key columns and included column IDs."""
    ordered = sorted(rows, key=lambda r: (r.key_ordinal, r.index_column_id))
    keys = tuple(
        IndexColumn(
            column=column_id(r.schema_name, r.table_name, r.column_name),
            descending=bool(r.is_descending),
        )
        for r in ordered
        if not r.is_included and (r.key_ordinal > 0 or r.partition_ordinal == 0)
    )
    included = tuple(
        column_id(r.schema_name, r.table_name, r.column_name) for r in ordered if r.is_included
    )
    return keys, included


def build_tables(
    tables: Iterable[TableRow],
    columns: Iterable[ColumnRow],
    indexes: Iterable[IndexRow],
    index_columns: Iterable[IndexColumnRow],
    checks: Iterable[CheckConstraintRow],
) -> tuple[Table, ...]:
    """Assemble tables from the rows of the five table queries, sorted by ID.

    Rows that belong to a table or index not in the other inputs (an object dropped between
    two queries) are ignored.
    """
    columns_by_table: dict[_TableKey, list[Column]] = defaultdict(list)
    for column_row in columns:
        columns_by_table[(column_row.schema_name, column_row.table_name)].append(
            build_column(column_row)
        )
    index_column_rows: dict[_IndexKey, list[IndexColumnRow]] = defaultdict(list)
    for ic in index_columns:
        index_column_rows[(ic.schema_name, ic.table_name, ic.index_id)].append(ic)
    indexes_by_table: dict[_TableKey, list[Index]] = defaultdict(list)
    keys_by_table: dict[_TableKey, list[KeyConstraint]] = defaultdict(list)
    for index_row in indexes:
        table_key = (index_row.schema_name, index_row.table_name)
        keys, included = _index_columns(
            index_column_rows[(table_key[0], table_key[1], index_row.index_id)]
        )
        built = Index(
            id=index_id(index_row.schema_name, index_row.table_name, index_row.index_name),
            name=index_row.index_name,
            kind=_INDEX_KINDS.get(index_row.index_type, IndexKind.OTHER),
            unique=bool(index_row.is_unique),
            key_columns=keys,
            included_columns=included,
            filter=index_row.filter_definition,
            disabled=bool(index_row.is_disabled),
        )
        indexes_by_table[table_key].append(built)
        key_kind = _KEY_KINDS.get(index_row.key_constraint_type or "")
        if (
            key_kind is not None
            and index_row.key_constraint_schema_name is not None
            and index_row.key_constraint_name is not None
            and keys
        ):
            keys_by_table[table_key].append(
                KeyConstraint(
                    id=constraint_id(
                        index_row.key_constraint_schema_name, index_row.key_constraint_name
                    ),
                    name=index_row.key_constraint_name,
                    kind=key_kind,
                    columns=tuple(k.column for k in keys),
                    index=built.id,
                )
            )
    checks_by_table: dict[_TableKey, list[CheckConstraint]] = defaultdict(list)
    for check in checks:
        checks_by_table[(check.schema_name, check.table_name)].append(
            CheckConstraint(
                id=constraint_id(check.constraint_schema_name, check.constraint_name),
                name=check.constraint_name,
                definition=check.definition,
                column=(
                    column_id(check.schema_name, check.table_name, check.column_name)
                    if check.column_name is not None
                    else None
                ),
                disabled=bool(check.is_disabled),
                trusted=not check.is_not_trusted,
            )
        )
    built_tables = []
    for row in tables:
        key = (row.schema_name, row.table_name)
        built_tables.append(
            Table(
                id=object_id(row.schema_name, row.table_name),
                schema_id=schema_id(row.schema_name),
                name=row.table_name,
                temporal_type=_TEMPORAL.get(row.temporal_type, TemporalType.NONE),
                memory_optimized=bool(row.is_memory_optimized),
                columns=tuple(columns_by_table[key]),
                indexes=tuple(indexes_by_table[key]),
                key_constraints=tuple(keys_by_table[key]),
                check_constraints=tuple(checks_by_table[key]),
            )
        )
    return tuple(sorted(built_tables, key=lambda t: t.id))


def extract_tables(executor: MetadataExecutor) -> tuple[Table, ...]:
    """Read every user table with its columns, keys, indexes and check constraints."""
    return build_tables(
        (TableRow(*row) for row in executor.run(QueryName.TABLES)),
        (ColumnRow(*row) for row in executor.run(QueryName.COLUMNS)),
        (IndexRow(*row) for row in executor.run(QueryName.INDEXES)),
        (IndexColumnRow(*row) for row in executor.run(QueryName.INDEX_COLUMNS)),
        (CheckConstraintRow(*row) for row in executor.run(QueryName.CHECK_CONSTRAINTS)),
    )
