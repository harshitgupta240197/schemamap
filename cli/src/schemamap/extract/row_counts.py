"""The row_counts section: approximate row counts and sizes from partition statistics."""

from __future__ import annotations

from collections.abc import Collection, Iterable

from schemamap.connect import MetadataExecutor
from schemamap.extract.rows import RowCountRow
from schemamap.queries import QueryName
from schemamap.snapshot.ids import object_id
from schemamap.snapshot.models import RowCount, RowCounts


def build_row_counts(rows: Iterable[RowCountRow], known_tables: Collection[str]) -> RowCounts:
    """Map rows to row counts, sorted by object ID.

    Rows for a table not in ``known_tables`` (dropped, or created, between two queries) are
    ignored, so the snapshot never refers to a table it does not contain.
    """
    known = set(known_tables)
    items = [
        RowCount(
            object=object_id(row.schema_name, row.table_name),
            rows=row.row_count,
            reserved_bytes=row.reserved_bytes,
        )
        for row in rows
        if object_id(row.schema_name, row.table_name) in known
    ]
    return RowCounts(items=tuple(sorted(items, key=lambda r: r.object)))


def extract_row_counts(executor: MetadataExecutor, known_tables: Collection[str]) -> RowCounts:
    """Read row counts and reserved space. Needs VIEW DATABASE STATE."""
    return build_row_counts(
        (RowCountRow(*row) for row in executor.run(QueryName.ROW_COUNTS)), known_tables
    )
