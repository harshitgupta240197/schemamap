"""The launcher's maps library: maps on disk, one folder per map (docs/UI.md, "Where files go").

```
<data-dir>/maps/<id>/snapshot.json.gz   the snapshot
                     map.html           byte-identical to `schemamap view` output
                     meta.json          what the list shows
<data-dir>/tmp/                         uploads and folders being built; emptied at start and stop
```

An id is 32 lowercase hex characters from ``secrets.token_hex(16)``. It is made here and looked
up here: no function takes a path from a request, so a request can never name a file. A map
folder is built under ``tmp/`` and moved into place in one step, so a list never shows half a map.
"""

from __future__ import annotations

import gzip
import json
import os
import re
import secrets
import shutil
import tempfile
import threading
import zlib
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import timezone
from pathlib import Path
from typing import Protocol

from schemamap.errors import SnapshotError
from schemamap.snapshot.io import (
    load_snapshot,
    safe_file_stem,
    write_bytes_atomic,
    write_snapshot,
)
from schemamap.snapshot.models import Snapshot
from schemamap.viewer import ViewerTemplate, embed_snapshot, load_viewer

MAPS_FOLDER = "maps"
TMP_FOLDER = "tmp"
SNAPSHOT_FILE = "snapshot.json.gz"
MAP_FILE = "map.html"
META_FILE = "meta.json"
MAP_ID = re.compile(r"[0-9a-f]{32}")
# An upload may unpack to far more than it weighs; stop reading past this, so a small gzip file
# cannot fill memory. Importing peaks at about 18 times the unpacked size, so 32 MB keeps the
# peak under 1 GB on the measured machine (D-072, docs/PERFORMANCE.md).
MAX_UNPACKED_BYTES = 32 * 1024 * 1024
_MAX_META_BYTES = 64 * 1024
CLOSE_WAIT_SECONDS = 5.0
_GZIP_MAGIC = b"\x1f\x8b"
_READ_CHUNK_BYTES = 1024 * 1024


@dataclass(frozen=True)
class MapEntry:
    """What the list shows for one map."""

    id: str
    database: str
    server: str | None
    extracted_at: str
    tables: int
    bytes: int

    def to_json(self) -> dict[str, object]:
        """The entry as written to ``meta.json`` and sent to the launcher page."""
        return {
            "id": self.id,
            "database": self.database,
            "server": self.server,
            "extracted_at": self.extracted_at,
            "tables": self.tables,
            "bytes": self.bytes,
        }


def _entry_from_json(value: object, map_id: str) -> MapEntry | None:
    """One entry read from ``meta.json``, or None when it is not well formed.

    The id always comes from the folder name, never from the file.
    """
    if not isinstance(value, dict):
        return None
    database, server = value.get("database"), value.get("server")
    extracted_at, tables, size = value.get("extracted_at"), value.get("tables"), value.get("bytes")
    if not (
        isinstance(database, str)
        and (server is None or isinstance(server, str))
        and isinstance(extracted_at, str)
        and isinstance(tables, int)
        and not isinstance(tables, bool)
        and isinstance(size, int)
        and not isinstance(size, bool)
    ):
        return None
    return MapEntry(map_id, database, server, extracted_at, tables, size)


class _Readable(Protocol):
    def read(self, size: int = ..., /) -> bytes: ...


def _read_limited(source: _Readable) -> bytes:
    """Read up to ``MAX_UNPACKED_BYTES`` plus one byte, in chunks, and stop there.

    The extra byte tells the caller the source is over the limit. A gzip bomb is never unpacked
    past it: each chunk is asked for only while the total is within the limit.
    """
    data = bytearray()
    while len(data) <= MAX_UNPACKED_BYTES:
        chunk = source.read(min(_READ_CHUNK_BYTES, MAX_UNPACKED_BYTES + 1 - len(data)))
        if not chunk:
            break
        data += chunk
    return bytes(data)


def read_upload(path: Path) -> Snapshot:
    """Load and validate an uploaded snapshot, plain or gzip (detected by content).

    Validated exactly as `schemamap view` does it. Raises SnapshotError, or SnapshotVersionError
    for a format major version this build cannot read. Messages never quote the file's content
    except through the validator's own wording.
    """
    try:
        with path.open("rb") as handle:
            packed = handle.read(len(_GZIP_MAGIC)) == _GZIP_MAGIC
            handle.seek(0)
            if packed:
                with gzip.GzipFile(fileobj=handle) as unpacked:
                    data = _read_limited(unpacked)
            else:
                data = _read_limited(handle)
    except (OSError, EOFError, zlib.error):
        raise SnapshotError("cannot read the file: it is not a valid snapshot file") from None
    if len(data) > MAX_UNPACKED_BYTES:
        raise SnapshotError(
            f"the snapshot is larger than {MAX_UNPACKED_BYTES // (1024 * 1024)} MB once unpacked"
        )
    return load_snapshot(data)


class LibraryClosedError(OSError):
    """The launcher is stopping: nothing new is written under ``tmp/`` or ``maps/``."""


class MapLibrary:
    """Maps kept under the data folder: add, list, read, delete."""

    def __init__(
        self, data_dir: Path, *, template: Callable[[], ViewerTemplate] = load_viewer
    ) -> None:
        self._maps = data_dir / MAPS_FOLDER
        self._tmp = data_dir / TMP_FOLDER
        self._template = template
        self._lock = threading.Lock()
        self._writers = threading.Condition()
        self._active = 0
        self._closed = False

    @property
    def closed(self) -> bool:
        """Whether ``close`` has begun: writers should stop at their next chance."""
        return self._closed

    @contextmanager
    def writing(self) -> Iterator[None]:
        """Mark a write that ``close`` waits for. Raises LibraryClosedError once closing."""
        with self._writers:
            if self._closed:
                raise LibraryClosedError("Schema Map is stopping")
            self._active += 1
        try:
            yield
        finally:
            with self._writers:
                self._active -= 1
                self._writers.notify_all()

    def close(self, wait: float = CLOSE_WAIT_SECONDS) -> bool:
        """Refuse new writes, wait up to ``wait`` seconds for those in flight, empty ``tmp/``.

        True when ``tmp/`` is gone. False when a write outlived the wait or a file is locked
        (Windows); what is left is removed at the next start.
        """
        with self._writers:
            self._closed = True
            self._writers.wait_for(lambda: self._active == 0, timeout=wait)
            settled = self._active == 0
        self.clear_tmp()
        return settled and not self._tmp.exists()

    def add(self, snapshot: Snapshot) -> str:
        """Make a map from the snapshot, keep it, and return its new id.

        Raises ViewerUnavailableError or EmbedError when the packaged viewer cannot be used, and
        OSError when the folder cannot be written. Nothing is left behind on failure.
        """
        with self.writing():
            return self._add(snapshot)

    def _add(self, snapshot: Snapshot) -> str:
        page = embed_snapshot(self._template().html, snapshot).encode("utf-8")
        map_id = secrets.token_hex(16)
        staging = Path(tempfile.mkdtemp(dir=self._tmp_dir(), prefix="map-"))
        try:
            write_snapshot(snapshot, staging / SNAPSHOT_FILE, compress=True)
            write_bytes_atomic(staging / MAP_FILE, page)
            captured = snapshot.captured_at.astimezone(timezone.utc)
            entry = MapEntry(
                id=map_id,
                database=snapshot.source.database,
                server=snapshot.source.server,
                extracted_at=captured.isoformat().replace("+00:00", "Z"),
                tables=len(snapshot.tables),
                bytes=len(page),
            )
            meta = json.dumps(entry.to_json(), indent=2, ensure_ascii=False) + "\n"
            write_bytes_atomic(staging / META_FILE, meta.encode("utf-8"))
            self._maps.mkdir(mode=0o700, parents=True, exist_ok=True)
            with self._lock:
                os.replace(staging, self._maps / map_id)
        finally:
            shutil.rmtree(staging, ignore_errors=True)
        return map_id

    def entries(self) -> list[MapEntry]:
        """Every map, newest extraction first. A folder without readable metadata is skipped."""
        found: list[MapEntry] = []
        try:
            folders = list(self._maps.iterdir())
        except OSError:
            return []
        for folder in folders:
            entry = self.entry(folder.name)
            if entry is not None:
                found.append(entry)
        return sorted(found, key=lambda item: (item.extracted_at, item.id), reverse=True)

    def entry(self, map_id: str) -> MapEntry | None:
        """The list entry for one id, or None for an unknown id or unreadable metadata."""
        if MAP_ID.fullmatch(map_id) is None:
            return None
        path = self._maps / map_id / META_FILE
        try:
            if path.stat().st_size > _MAX_META_BYTES:
                return None
            document = json.loads(path.read_bytes())
        except (OSError, ValueError, RecursionError):
            return None
        return _entry_from_json(document, map_id)

    def read_map(self, map_id: str) -> bytes | None:
        """The map's HTML as stored, or None for an unknown id.

        Only a 32-character lowercase hex id reaches the file system: ``..``, separators and
        percent-escapes all fail the match.
        """
        if MAP_ID.fullmatch(map_id) is None:
            return None
        try:
            return (self._maps / map_id / MAP_FILE).read_bytes()
        except OSError:
            return None

    def download_name(self, map_id: str) -> str:
        """A safe file name for downloading the map: ``<database>-map.html``."""
        entry = self.entry(map_id)
        return f"{safe_file_stem(entry.database if entry else 'database')}-map.html"

    def delete(self, map_id: str) -> bool:
        """Remove the map. False when there is no such map.

        The folder is moved out of the library first, so no list ever shows a half-deleted map.
        """
        if MAP_ID.fullmatch(map_id) is None:
            return False
        with self.writing():
            trash = self._tmp_dir() / f"deleted-{secrets.token_hex(8)}"
            with self._lock:
                try:
                    os.replace(self._maps / map_id, trash)
                except OSError:
                    return False
            shutil.rmtree(trash, ignore_errors=True)
            return True

    def new_upload_path(self) -> Path:
        """A fresh, empty, owner-only file under ``tmp/`` for an upload, named by the server."""
        with self.writing():
            descriptor, name = tempfile.mkstemp(
                dir=self._tmp_dir(), prefix="upload-", suffix=".tmp"
            )
        os.close(descriptor)
        return Path(name)

    def clear_tmp(self) -> None:
        """Empty ``tmp/``: leftovers of an interrupted write or upload."""
        shutil.rmtree(self._tmp, ignore_errors=True)

    def _tmp_dir(self) -> Path:
        self._tmp.mkdir(mode=0o700, parents=True, exist_ok=True)
        return self._tmp
