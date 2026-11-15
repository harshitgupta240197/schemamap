"""Remembered connections: the settings a person types again and again, never a password.

The file ``<data-dir>/connections.json`` holds server, port, database, authentication mode and
user for each entry, and nothing else. There is no password field to fill by mistake: an entry
is built from the five named values, and the loader copies only those five from what it reads,
so even a hand-edited file cannot carry a password forward. Writes are atomic and the file is
readable only by its owner.
"""

from __future__ import annotations

import hashlib
import json
import threading
from dataclasses import dataclass
from pathlib import Path

from schemamap.connect import AuthMode, ConnectionConfig
from schemamap.snapshot.io import write_bytes_atomic

FILE_NAME = "connections.json"
MAX_REMEMBERED = 20
_MAX_FILE_BYTES = 256 * 1024

# What the file may contain. A test reads this to prove no password field can exist.
FILE_SCHEMA: dict[str, object] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["version", "connections"],
    "properties": {
        "version": {"const": 1},
        "connections": {
            "type": "array",
            "maxItems": MAX_REMEMBERED,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "server", "port", "database", "auth", "user"],
                "properties": {
                    "id": {"type": "string", "pattern": "^[0-9a-f]{32}$"},
                    "server": {"type": "string", "minLength": 1},
                    "port": {"type": "integer", "minimum": 1, "maximum": 65535},
                    "database": {"type": "string", "minLength": 1},
                    "auth": {"enum": [mode.value for mode in AuthMode]},
                    "user": {"type": ["string", "null"]},
                },
            },
        },
    },
}


@dataclass(frozen=True)
class RememberedConnection:
    """One saved connection. The fields are the whole record: there is nowhere to put a secret."""

    id: str
    server: str
    port: int
    database: str
    auth: AuthMode
    user: str | None

    def to_json(self) -> dict[str, object]:
        """The entry as written to the file and sent to the launcher page."""
        return {
            "id": self.id,
            "server": self.server,
            "port": self.port,
            "database": self.database,
            "auth": self.auth.value,
            "user": self.user,
        }


def connection_id(server: str, port: int, database: str, auth: AuthMode, user: str | None) -> str:
    """A stable 32-hex id for these settings: the same connection remembered twice is one entry."""
    key = json.dumps([server, port, database, auth.value, user], separators=(",", ":"))
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:32]


def _entry_from_config(config: ConnectionConfig) -> RememberedConnection:
    user = config.user if config.auth.needs_user else None
    return RememberedConnection(
        id=connection_id(config.server, config.port, config.database, config.auth, user),
        server=config.server,
        port=config.port,
        database=config.database,
        auth=config.auth,
        user=user,
    )


def _entry_from_json(value: object) -> RememberedConnection | None:
    """One entry read from the file, or None when it is not a well-formed entry.

    Only the five settings are copied, so any other key (a password someone added by hand)
    is dropped here and gone from the next write.
    """
    if not isinstance(value, dict):
        return None
    server, port, database = value.get("server"), value.get("port"), value.get("database")
    user = value.get("user")
    try:
        auth = AuthMode(value.get("auth"))
    except ValueError:
        return None
    if not (
        isinstance(server, str)
        and server
        and isinstance(database, str)
        and database
        and isinstance(port, int)
        and not isinstance(port, bool)
        and 0 < port < 65536
        and (user is None or isinstance(user, str))
    ):
        return None
    return RememberedConnection(
        id=connection_id(server, port, database, auth, user),
        server=server,
        port=port,
        database=database,
        auth=auth,
        user=user,
    )


class ConnectionStore:
    """Reads and writes ``connections.json`` in the launcher's data folder."""

    def __init__(self, data_dir: Path) -> None:
        self._path = data_dir / FILE_NAME
        self._lock = threading.Lock()

    def entries(self) -> list[RememberedConnection]:
        """Remembered connections, most recently used first. A missing or damaged file is empty."""
        with self._lock:
            return self._read()

    def remember(self, config: ConnectionConfig) -> RememberedConnection:
        """Save the connection's five settings (never the password) and put it first.

        Remembering the same settings again moves the entry to the front instead of adding a
        second one. Only the newest ``MAX_REMEMBERED`` are kept.
        """
        entry = _entry_from_config(config)
        with self._lock:
            kept = [item for item in self._read() if item.id != entry.id]
            self._write([entry, *kept][:MAX_REMEMBERED])
        return entry

    def forget(self, connection_id_: str) -> bool:
        """Remove the entry with this id. False when there is no such entry."""
        with self._lock:
            entries = self._read()
            kept = [item for item in entries if item.id != connection_id_]
            if len(kept) == len(entries):
                return False
            self._write(kept)
            return True

    def _read(self) -> list[RememberedConnection]:
        try:
            if self._path.stat().st_size > _MAX_FILE_BYTES:
                return []
            document = json.loads(self._path.read_bytes())
        except (OSError, ValueError, RecursionError):
            return []
        items = document.get("connections") if isinstance(document, dict) else None
        if not isinstance(items, list):
            return []
        entries = (_entry_from_json(item) for item in items)
        unique = {item.id: item for item in entries if item is not None}
        return list(unique.values())[:MAX_REMEMBERED]

    def _write(self, entries: list[RememberedConnection]) -> None:
        document = {"version": 1, "connections": [entry.to_json() for entry in entries]}
        data = json.dumps(document, indent=2, ensure_ascii=False) + "\n"
        self._path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        write_bytes_atomic(self._path, data.encode("utf-8"))
