"""The committed JSON Schema matches the models exactly."""

from __future__ import annotations

import json
from pathlib import Path

from schemamap.snapshot import render_json_schema

SCHEMA_PATH = Path(__file__).resolve().parents[2] / "schema" / "snapshot.v1.json"


def test_committed_schema_matches_generated() -> None:
    committed = SCHEMA_PATH.read_text(encoding="utf-8")
    assert committed == render_json_schema(), (
        "schema/snapshot.v1.json is stale: run `uv run python scripts/gen_snapshot_schema.py`"
    )


def test_generation_is_deterministic() -> None:
    assert render_json_schema() == render_json_schema()


def test_schema_documents_contract() -> None:
    schema = json.loads(render_json_schema())
    assert schema["$schema"] == "https://json-schema.org/draft/2020-12/schema"
    assert "inferred_relationships" in schema["description"]
    assert "inferred_relationships" not in schema["properties"]
    for section in ("row_counts", "query_history", "join_evidence"):
        assert "Optional" in schema["properties"][section]["description"]


def _walk(node: object) -> list[dict[str, object]]:
    if isinstance(node, dict):
        return [node, *(n for v in node.values() for n in _walk(v))]
    if isinstance(node, list):
        return [n for v in node for n in _walk(v)]
    return []


def test_schema_has_no_open_or_untyped_values() -> None:
    schema = json.loads(render_json_schema())
    for node in _walk(schema["$defs"]) + _walk(schema["properties"]):
        if node.get("type") == "object":
            assert "properties" in node, node
        assert "additionalProperties" not in node or node["additionalProperties"] is False
