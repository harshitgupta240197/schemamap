"""Connection options and credential handling shared by every command that opens a database."""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Annotated, NoReturn

import typer
from rich.console import Console

from schemamap.connect import AuthMode, ConnectionConfig
from schemamap.errors import ConnectError, SchemaMapError, SnapshotError

EXIT_FAILURE = 1
EXIT_CONNECT = 3
EXIT_BAD_SNAPSHOT = 4
ENV_USER = "SCHEMAMAP_USER"
ENV_PASSWORD = "SCHEMAMAP_PASSWORD"

ServerOption = Annotated[str, typer.Option(help="Server host name or address.")]
DatabaseOption = Annotated[str, typer.Option(help="Database to inspect.")]
PortOption = Annotated[int, typer.Option(help="TCP port.")]
AuthOption = Annotated[
    AuthMode, typer.Option(help="Authentication mode. Windows works on Windows only.")
]
TrustCertificateOption = Annotated[
    bool,
    typer.Option(
        "--trust-server-certificate",
        help="Accept a self-signed server certificate (local labs only).",
    ),
]
ConnectTimeoutOption = Annotated[int, typer.Option(help="Login timeout in seconds.")]
QueryTimeoutOption = Annotated[int, typer.Option(help="Per-query timeout in seconds.")]


def credentials(auth: AuthMode) -> tuple[str | None, str | None]:
    """User and password from the environment, else a hidden prompt. Never stored."""
    user = os.environ.get(ENV_USER) if auth.needs_user else None
    if auth.needs_user and not user:
        user = typer.prompt("User")
    password = os.environ.get(ENV_PASSWORD) if auth.needs_password else None
    if auth.needs_password and not password:
        password = typer.prompt("Password", hide_input=True)
    return user, password


def connection_config(
    console: Console,
    *,
    server: str,
    database: str,
    port: int,
    auth: AuthMode,
    trust_server_certificate: bool,
    connect_timeout: int,
    query_timeout: int,
) -> ConnectionConfig:
    """Collect credentials and build the config; a bad setting prints its message and exits 3."""
    try:
        user, password = credentials(auth)
        return ConnectionConfig(
            server=server,
            database=database,
            port=port,
            auth=auth,
            user=user,
            password=password,
            trust_server_certificate=trust_server_certificate,
            connect_timeout=connect_timeout,
            query_timeout=query_timeout,
        )
    except ConnectError as exc:
        fail_connect(console, exc)


def fail_connect(console: Console, exc: ConnectError) -> NoReturn:
    """Print a connection failure in red and exit 3. The message never holds credentials."""
    console.print(str(exc), style="red", markup=False, soft_wrap=True)
    raise typer.Exit(EXIT_CONNECT) from None


DebugOption = Annotated[
    bool,
    typer.Option("--debug", help="Show the full traceback for an unexpected error."),
]


@contextmanager
def friendly_errors(console: Console, *, what: str, debug: bool) -> Iterator[None]:
    """Turn errors into one clear message and an exit code; tracebacks only with ``debug``.

    Connection, login, permission and timeout problems exit 3, an unreadable snapshot exits 4,
    any other Schema Map error and any unexpected error exit 1. Click's own exits pass through.
    """
    try:
        yield
    except (typer.Exit, typer.Abort):
        raise
    except ConnectError as exc:
        fail_connect(console, exc)
    except SnapshotError as exc:
        console.print(str(exc), style="red", markup=False, soft_wrap=True)
        raise typer.Exit(EXIT_BAD_SNAPSHOT) from None
    except SchemaMapError as exc:
        console.print(f"{what} failed: {exc}", style="red", markup=False, soft_wrap=True)
        raise typer.Exit(EXIT_FAILURE) from None
    except Exception as exc:
        if debug:
            raise
        console.print(
            f"{what} failed with an unexpected {type(exc).__name__}. "
            "This is a bug in Schema Map. Re-run with --debug for the full traceback.",
            style="red",
            markup=False,
            soft_wrap=True,
        )
        raise typer.Exit(EXIT_FAILURE) from None
