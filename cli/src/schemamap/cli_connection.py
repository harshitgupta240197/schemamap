"""Connection options and credential handling shared by every command that opens a database."""

from __future__ import annotations

import os
from typing import Annotated, NoReturn

import typer
from rich.console import Console

from schemamap.connect import AuthMode, ConnectionConfig
from schemamap.errors import ConnectError

EXIT_CONNECT = 3
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
