"""Opening a read-only connection and wrapping every driver failure in ConnectError."""

from __future__ import annotations

from schemamap.connect.config import ConnectionConfig
from schemamap.connect.driver import load_driver
from schemamap.connect.executor import MetadataExecutor
from schemamap.connect.redact import redact
from schemamap.errors import ConnectError

_MAX_DETAIL = 300
_UNREACHABLE = (
    "network-related",
    "could not open a connection",
    "connection refused",
    "unreachable",
    "name or service not known",
    "no such host",
    "nodename nor servname",
    "08001",
)


def describe_failure(exc: BaseException, config: ConnectionConfig) -> str:
    """A short, secret-free explanation of a driver failure."""
    detail = redact(str(exc), config.secrets()).strip().replace("\n", " ")
    lowered = detail.lower()
    if "login failed" in lowered or "authentication" in lowered:
        hint = (
            f"Login failed for database {config.database!r}. Fix: Check the user name and "
            "password, and that the login can access the database."
        )
    elif "certificate" in lowered or "ssl" in lowered:
        hint = (
            "The server certificate was not trusted. Fix: install a trusted certificate on the "
            "server, or for a local lab pass --trust-server-certificate."
        )
    elif "timeout" in lowered or "timed out" in lowered:
        hint = (
            f"The server {config.server!r} did not answer in time. Fix: check the server name, "
            "port and firewall, or raise --connect-timeout."
        )
    elif any(word in lowered for word in _UNREACHABLE):
        hint = (
            f"Cannot reach {config.server!r} on port {config.port}. Fix: check the server name "
            "and port, that SQL Server accepts TCP connections, and that no firewall blocks it."
        )
    else:
        hint = (
            "Could not connect to the server. Fix: check the server name, port and credentials, "
            "then run `schemamap doctor`."
        )
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
