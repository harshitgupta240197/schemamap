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
from schemamap.extract.relationships import build_relationships, extract_relationships
from schemamap.extract.schemas import build_schemas, extract_schemas
from schemamap.extract.tables import build_tables, extract_tables

__all__ = [
    "build_dependencies",
    "build_relationships",
    "build_routines",
    "build_schemas",
    "build_synonyms",
    "build_tables",
    "build_views",
    "extract_dependencies",
    "extract_relationships",
    "extract_routines",
    "extract_schemas",
    "extract_synonyms",
    "extract_tables",
    "extract_views",
]
