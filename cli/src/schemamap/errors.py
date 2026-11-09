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


class ConnectError(SchemaMapError):
    """Cannot connect or authenticate. The message never contains credentials."""


class DriverUnavailableError(ConnectError):
    """The SQL Server driver or its native library cannot be loaded on this machine."""


class QueryTimeoutError(ConnectError):
    """A metadata query ran past the query timeout."""


class PermissionDeniedError(ConnectError):
    """The server refused a metadata query for lack of permission, after the pre-checks passed."""


class QueryRefusedError(SchemaMapError):
    """The executor refused to run SQL: not a named query, off the allowlist, or bad parameters.

    This is always a bug in Schema Map, never a problem with user input.
    """


class PermissionMissing(SchemaMapError):
    """A section needs a permission the login does not hold.

    Raised inside extraction and always caught there: the section is skipped and recorded as
    one warning. It never reaches the CLI as an error.
    """

    def __init__(self, permission: str, message: str) -> None:
        super().__init__(message)
        self.permission = permission
        self.message = message
