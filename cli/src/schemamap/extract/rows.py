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


class ForeignKeyRow(NamedTuple):
    """queries/foreign_keys.sql: one row per column pair."""

    fk_schema_name: str
    fk_name: str
    from_schema_name: str
    from_table_name: str
    to_schema_name: str
    to_table_name: str
    ordinal: int
    from_column_name: str
    to_column_name: str
    on_delete: int
    on_update: int
    is_disabled: bool
    is_not_trusted: bool


class ViewRow(NamedTuple):
    """queries/views.sql"""

    schema_name: str
    view_name: str
    is_schema_bound: bool
    definition: str | None
    is_encrypted: bool


class RoutineRow(NamedTuple):
    """queries/routines.sql"""

    schema_name: str
    routine_name: str
    type_code: str
    parent_schema_name: str | None
    parent_name: str | None
    definition: str | None
    is_encrypted: bool
    has_module: bool


class SynonymRow(NamedTuple):
    """queries/synonyms.sql"""

    schema_name: str
    synonym_name: str
    target_server: str | None
    target_database: str | None
    target_schema: str | None
    target_name: str
    resolved_schema_name: str | None
    resolved_name: str | None


class DependencyRow(NamedTuple):
    """queries/dependencies.sql"""

    from_schema_name: str
    from_name: str
    target_server: str | None
    target_database: str | None
    target_schema: str | None
    target_name: str
    resolved_schema_name: str | None
    resolved_name: str | None
    is_ambiguous: int
    has_referenced_id: int


class RowCountRow(NamedTuple):
    """queries/row_counts.sql"""

    schema_name: str
    table_name: str
    row_count: int
    reserved_bytes: int
