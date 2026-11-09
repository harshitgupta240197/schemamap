"""Reads database metadata through a MetadataExecutor and maps it into snapshot models.

Library code only: it returns model objects or raises typed errors and never prints.
"""

from schemamap.extract.schemas import build_schemas, extract_schemas
from schemamap.extract.tables import build_tables, extract_tables

__all__ = ["build_schemas", "build_tables", "extract_schemas", "extract_tables"]
