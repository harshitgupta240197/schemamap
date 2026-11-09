"""Opening a read-only connection and wrapping every driver failure in ConnectError."""

from __future__ import annotations

from schemamap.connect.config import ConnectionConfig
from schemamap.connect.driver import load_driver
from schemamap.connect.executor import MetadataExecutor
from schemamap.connect.redact import redact
from schemamap.errors import ConnectError

_MAX_DETAIL = 300


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


def connect(config: ConnectionConfig) -> MetadataExecutor:
    """Open a read-only intent, encrypted-by-default connection wrapped in the executor.

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
    return MetadataExecutor(connection)
