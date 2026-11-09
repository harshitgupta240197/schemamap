"""One NamedTuple per query, in the column order of its .sql file."""

from __future__ import annotations

from typing import NamedTuple


class TableRow(NamedTuple):
    """queries/tables.sql"""

    schema_name: str
    table_name: str
    temporal_type: int
    is_memory_optimized: bool


class ColumnRow(NamedTuple):
    """queries/columns.sql"""

    schema_name: str
    table_name: str
    ordinal: int
    column_name: str
    type_name: str
    is_alias_type: bool
    type_schema_name: str
    base_type_name: str | None
    max_length: int
    precision: int
    scale: int
    is_nullable: bool
    is_identity: bool
    collation_name: str | None
    computed_definition: str | None
    computed_persisted: bool | None
    default_schema_name: str | None
    default_name: str | None
    default_definition: str | None


class IndexRow(NamedTuple):
    """queries/indexes.sql"""

    schema_name: str
    table_name: str
    index_id: int
    index_name: str
    index_type: int
    is_unique: bool
    is_disabled: bool
    filter_definition: str | None
    key_constraint_type: str | None
    key_constraint_schema_name: str | None
    key_constraint_name: str | None


class IndexColumnRow(NamedTuple):
    """queries/index_columns.sql"""

    schema_name: str
    table_name: str
    index_id: int
    column_name: str
    key_ordinal: int
    partition_ordinal: int
    index_column_id: int
    is_descending: bool
    is_included: bool


class CheckConstraintRow(NamedTuple):
    """queries/check_constraints.sql"""

    schema_name: str
    table_name: str
    constraint_schema_name: str
    constraint_name: str
    definition: str
    column_name: str | None
    is_disabled: bool
    is_not_trusted: bool
