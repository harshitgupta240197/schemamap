"""Typed errors raised by library code. The CLI layer turns them into messages and exit codes."""

from __future__ import annotations


class SchemaMapError(Exception):
    """Base class for every error Schema Map raises on purpose."""


class InvalidIdError(SchemaMapError, ValueError):
    """An object ID is malformed, non-canonical or of the wrong kind."""


class SnapshotError(SchemaMapError):
    """A snapshot document cannot be read."""


class SnapshotVersionError(SnapshotError):
    """A snapshot uses a format major version this build cannot read."""
