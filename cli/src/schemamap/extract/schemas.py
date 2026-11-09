"""The schemas section."""

from __future__ import annotations

from collections.abc import Iterable
from typing import NamedTuple

from schemamap.connect import MetadataExecutor
from schemamap.queries import QueryName
from schemamap.snapshot.ids import schema_id
from schemamap.snapshot.models import Schema


class SchemaRow(NamedTuple):
    """One row of queries/schemas.sql."""

    schema_name: str


def build_schemas(rows: Iterable[SchemaRow]) -> tuple[Schema, ...]:
    """Map schema rows to snapshot schemas, sorted by ID."""
    schemas = [Schema(id=schema_id(row.schema_name), name=row.schema_name) for row in rows]
    return tuple(sorted(schemas, key=lambda s: s.id))


def extract_schemas(executor: MetadataExecutor) -> tuple[Schema, ...]:
    """Read the user-visible schemas of the connected database."""
    return build_schemas(SchemaRow(*row) for row in executor.run(QueryName.SCHEMAS))
