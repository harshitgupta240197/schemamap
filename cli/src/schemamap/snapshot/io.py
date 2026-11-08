"""Read, write and redact snapshots. Output is deterministic: same snapshot, same bytes."""

from __future__ import annotations

import json
from typing import Any

from pydantic import ValidationError

from schemamap.errors import SnapshotError, SnapshotVersionError
from schemamap.snapshot.models import FORMAT, ReferenceScope, Snapshot


def dump_snapshot(snapshot: Snapshot) -> str:
    """Serialize a snapshot as UTF-8 JSON text with a fixed layout and a trailing newline."""
    return snapshot.model_dump_json(indent=2) + "\n"


def load_snapshot(text: str | bytes) -> Snapshot:
    """Parse and validate a snapshot. Raises SnapshotVersionError or SnapshotError."""
    try:
        document = json.loads(text)
    except json.JSONDecodeError as exc:
        raise SnapshotError(f"not valid JSON: {exc.msg} at line {exc.lineno}") from exc
    if not isinstance(document, dict) or document.get("format") != FORMAT:
        raise SnapshotError(f"not a Schema Map snapshot (expected format {FORMAT!r})")
    version = document.get("format_version")
    if not isinstance(version, str) or version.split(".")[0] != "1":
        raise SnapshotVersionError(f"unsupported snapshot format version {version!r}")
    try:
        return Snapshot.model_validate(document)
    except ValidationError as exc:
        raise SnapshotError(f"invalid snapshot: {exc.error_count()} error(s)\n{exc}") from exc


def _redact_reference(reference: dict[str, Any]) -> None:
    if reference["scope"] == ReferenceScope.CROSS_SERVER.value:
        reference["name"]["server"] = None


def redact_server(snapshot: Snapshot) -> Snapshot:
    """Drop the source host name and every linked-server name (--redact-server).

    Dependencies that differed only by linked server collapse into one entry.
    """
    data = snapshot.model_dump(mode="json")
    data["source"]["server"] = None
    data["source"]["server_redacted"] = True
    for synonym in data["synonyms"]:
        _redact_reference(synonym["target"])
    unique: dict[str, dict[str, Any]] = {}
    for dependency in data["dependencies"]:
        _redact_reference(dependency["target"])
        unique[json.dumps(dependency, sort_keys=True)] = dependency
    data["dependencies"] = list(unique.values())
    return Snapshot.model_validate(data)
