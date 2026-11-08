"""Render the JSON Schema for snapshot format v1 (committed as schema/snapshot.v1.json)."""

from __future__ import annotations

import json

from schemamap.snapshot.models import Snapshot

SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema"


def render_json_schema() -> str:
    """JSON Schema text for format v1, with sorted keys so the output is byte-stable."""
    schema = Snapshot.model_json_schema(mode="validation")
    schema["$schema"] = SCHEMA_DIALECT
    schema["title"] = "Schema Map snapshot v1"
    return json.dumps(schema, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
