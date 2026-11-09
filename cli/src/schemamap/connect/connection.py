"""Opening a read-only connection and wrapping every driver failure in ConnectError."""

from __future__ import annotations

from typing import Any

from schemamap.connect.config import ConnectionConfig
from schemamap.connect.driver import load_driver
from schemamap.connect.redact import redact
from schemamap.errors import ConnectError
from schemamap.queries import load_query

_MAX_DETAIL = 300


class Connection:
    """An open connection. Runs queries by name from ``queries/``."""

    def __init__(self, driver_connection: Any) -> None:
        self._connection = driver_connection

    def query(self, name: str) -> list[tuple[Any, ...]]:
        """Run ``queries/<name>.sql`` and return all rows as tuples."""
        cursor = self._connection.cursor()
        try:
            cursor.execute(load_query(name))
            return [tuple(row) for row in cursor.fetchall()]
        finally:
            cursor.close()

    def cursor(self) -> Any:
        """A raw driver cursor. Crumb 1.3 replaces this with the allowlisting executor."""
        return self._connection.cursor()

    def close(self) -> None:
        """Close the connection; safe to call twice."""
        self._connection.close()

    def __enter__(self) -> Connection:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()


def describe_failure(exc: BaseException, config: ConnectionConfig) -> str:
    """A short, secret-free explanation of a driver failure."""
    detail = redact(str(exc), config.secrets()).strip().replace("\n", " ")
    lowered = detail.lower()
    if "login failed" in lowered or "authentication" in lowered:
        hint = "Login failed. Check the user name and password, and that the login can access "
        hint += f"database {config.database!r}."
    elif "certificate" in lowered or "ssl" in lowered:
        hint = (
            "The server certificate was not trusted. For a local lab you can pass "
            "--trust-server-certificate."
        )
    elif "timeout" in lowered or "timed out" in lowered:
        hint = "The server did not answer in time. Check the server name, port and firewall."
    else:
        hint = "Could not connect to the server."
    return f"{hint} Driver said: {detail[:_MAX_DETAIL]}" if detail else hint


def connect(config: ConnectionConfig) -> Connection:
    """Open a read-only intent, encrypted-by-default connection.

    Raises DriverUnavailableError if the driver cannot load and ConnectError for any
    connection or authentication failure. The driver exception is never chained, because
    its text could carry the connection string.
    """
    driver = load_driver()
    failure: str | None = None
    try:
        connection = driver.connect(
            config.connection_string(),
            autocommit=True,
            timeout=config.connect_timeout,
        )
        connection.timeout = config.query_timeout
    except Exception as exc:  # the driver raises its own hierarchy; always wrap
        failure = describe_failure(exc, config)
    if failure is not None:
        # Raised outside the except block so the driver exception is not even in __context__.
        raise ConnectError(failure)
    return Connection(connection)
