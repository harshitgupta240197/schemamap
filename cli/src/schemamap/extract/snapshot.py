"""Puts one extraction into a snapshot: the source details, the generator and the capture time."""

from __future__ import annotations

from datetime import datetime, timezone

from schemamap import __version__
from schemamap.connect import MetadataExecutor
from schemamap.extract.database import DatabaseExtraction, extract_database
from schemamap.extract.rows import SourceInfoRow
from schemamap.queries import QueryName
from schemamap.snapshot.models import Generator, QueryStoreState, Snapshot, SourceInfo


def build_source(
    row: SourceInfoRow | None, server: str, database: str, query_store: QueryStoreState
) -> SourceInfo:
    """Source details for the snapshot.

    ``server`` is the host exactly as the user typed it; the server's own name for itself is
    never read, so redaction has one value to drop. ``row`` is None when the catalog shows
    no row for the database, and then only the requested names are recorded.
    """
    if row is None:
        return SourceInfo(server=server, database=database, query_store=query_store)
    return SourceInfo(
        server=server,
        database=row.database_name,
        product_version=row.product_version,
        engine_edition=None if row.engine_edition is None else str(row.engine_edition),
        compatibility_level=row.compatibility_level,
        collation=row.collation_name,
        query_store=query_store,
    )


def build_snapshot(
    extraction: DatabaseExtraction, source: SourceInfo, captured_at: datetime
) -> Snapshot:
    """Assemble and validate a snapshot. Ordering is enforced by the models."""
    return Snapshot(
        generator=Generator(version=__version__),
        captured_at=captured_at,
        source=source,
        schemas=extraction.schemas,
        tables=extraction.tables,
        views=extraction.views,
        routines=extraction.routines,
        synonyms=extraction.synonyms,
        relationships=extraction.relationships,
        dependencies=extraction.dependencies,
        warnings=extraction.warnings,
        row_counts=extraction.row_counts,
    )


def extract_snapshot(
    executor: MetadataExecutor,
    *,
    server: str,
    database: str,
    captured_at: datetime | None = None,
) -> Snapshot:
    """Read the whole database and return its snapshot.

    ``captured_at`` defaults to now in UTC, to the second, so files diff cleanly.
    """
    rows = executor.run(QueryName.SOURCE_INFO)
    extraction = extract_database(executor)
    source = build_source(
        SourceInfoRow(*rows[0]) if rows else None, server, database, extraction.query_store
    )
    stamp = captured_at or datetime.now(timezone.utc).replace(microsecond=0)
    return build_snapshot(extraction, source, stamp)
