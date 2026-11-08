"""Regenerate schema/snapshot.v1.json from the Pydantic models.

Run from cli/: uv run python scripts/gen_snapshot_schema.py
"""

from __future__ import annotations

from pathlib import Path

from schemamap.snapshot import render_json_schema

SCHEMA_PATH = Path(__file__).resolve().parents[2] / "schema" / "snapshot.v1.json"


def main() -> None:
    """Write the schema file, creating schema/ if needed."""
    SCHEMA_PATH.parent.mkdir(exist_ok=True)
    SCHEMA_PATH.write_text(render_json_schema(), encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
