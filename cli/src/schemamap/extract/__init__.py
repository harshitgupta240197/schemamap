"""Reads database metadata through a MetadataExecutor and maps it into snapshot models.

Library code only: it returns model objects or raises typed errors and never prints.
"""

from schemamap.extract.code import (
    build_dependencies,
    build_routines,
    build_synonyms,
    build_views,
    extract_dependencies,
    extract_routines,
    extract_synonyms,
    extract_views,
)
from schemamap.extract.database import SECTION_COUNT, DatabaseExtraction, extract_database
from schemamap.extract.filters import SchemaFilter, apply_schema_filter, omit_definitions
from schemamap.extract.relationships import build_relationships, extract_relationships
from schemamap.extract.row_counts import build_row_counts, extract_row_counts
from schemamap.extract.runner import Requirement, SectionObserver, SectionRunner
from schemamap.extract.schemas import build_schemas, extract_schemas
from schemamap.extract.snapshot import build_snapshot, build_source, extract_snapshot
from schemamap.extract.tables import build_tables, extract_tables
from schemamap.extract.visibility import (
    PARTIAL_VISIBILITY_CODE,
    Visibility,
    assess_visibility,
)

__all__ = [
    "PARTIAL_VISIBILITY_CODE",
    "SECTION_COUNT",
    "DatabaseExtraction",
    "Requirement",
    "SchemaFilter",
    "SectionObserver",
    "SectionRunner",
    "Visibility",
    "apply_schema_filter",
    "assess_visibility",
    "build_dependencies",
    "build_relationships",
    "build_routines",
    "build_row_counts",
    "build_schemas",
    "build_snapshot",
    "build_source",
    "build_synonyms",
    "build_tables",
    "build_views",
    "extract_database",
    "extract_dependencies",
    "extract_relationships",
    "extract_routines",
    "extract_row_counts",
    "extract_schemas",
    "extract_snapshot",
    "extract_synonyms",
    "extract_tables",
    "extract_views",
    "omit_definitions",
]
