"""Read, write and redact snapshots. Output is deterministic: same snapshot, same bytes."""

from __future__ import annotations

import gzip
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from schemamap.errors import SnapshotError, SnapshotVersionError
from schemamap.snapshot.models import FORMAT, ReferenceScope, Snapshot

_GZIP_MAGIC = b"\x1f\x8b"
_UNSAFE_FILENAME_CHARS = re.compile(r"[^A-Za-z0-9._-]")
# Windows opens these devices whatever extension follows (CON.snapshot.json is the console).
_WINDOWS_DEVICES = frozenset(
    {"CON", "PRN", "AUX", "NUL"} | {f"{port}{n}" for port in ("COM", "LPT") for n in range(1, 10)}
)


def dump_snapshot(snapshot: Snapshot) -> str:
    """Serialize a snapshot as UTF-8 JSON text with a fixed layout and a trailing newline."""
    return snapshot.model_dump_json(indent=2) + "\n"


def default_output_path(database: str, compress: bool = False) -> Path:
    """``<database>.snapshot.json[.gz]`` in the current directory.

    The database name is untrusted, so anything outside letters, digits, ``.``, ``_`` and ``-``
    becomes ``_``; a name can never point the file at another folder. A name that Windows
    reserves for a device (``CON``, ``NUL``, ``COM1``...) gets a leading ``_``.
    """
    stem = _UNSAFE_FILENAME_CHARS.sub("_", database).strip(".") or "database"
    if stem.split(".")[0].upper() in _WINDOWS_DEVICES:
        stem = f"_{stem}"
    return Path(f"{stem}.snapshot.json" + (".gz" if compress else ""))


def write_snapshot(snapshot: Snapshot, path: Path, compress: bool = False) -> Path:
    """Write the snapshot to ``path`` and return the path actually written.

    With ``compress`` the file is gzip and ``.gz`` is appended unless the path already ends in
    it. The gzip header carries no file name and a zero time, so equal snapshots give equal
    bytes. The file is written beside the target and moved into place, so an interrupted run
    never leaves a half-written snapshot. The temporary file gets a fresh random name and is
    created exclusively, so a symlink planted in the folder is never followed, and it is
    readable only by its owner (POSIX), as is the snapshot it becomes.
    """
    if compress and path.suffix != ".gz":
        path = path.with_name(path.name + ".gz")
    data = dump_snapshot(snapshot).encode("utf-8")
    if compress:
        data = gzip.compress(data, mtime=0)
    descriptor, name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    return path


def read_snapshot(path: Path) -> Snapshot:
    """Load a snapshot file, plain or gzip (detected by content, not by extension)."""
    try:
        data = path.read_bytes()
        if data.startswith(_GZIP_MAGIC):
            data = gzip.decompress(data)
    except (OSError, EOFError) as exc:
        raise SnapshotError(f"cannot read {path}: {exc}") from exc
    return load_snapshot(data)


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
