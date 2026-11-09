"""Command-line entry point."""

from __future__ import annotations

import os
from typing import Annotated

import typer
from rich.console import Console

from schemamap import __version__
from schemamap.connect import AuthMode, ConnectionConfig, Status, diagnose
from schemamap.errors import ConnectError

EXIT_CONNECT = 3
ENV_USER = "SCHEMAMAP_USER"
ENV_PASSWORD = "SCHEMAMAP_PASSWORD"

# Locals can hold the password, so crash output must never show them.
app = typer.Typer(
    help="Map a SQL Server database from system metadata only.",
    pretty_exceptions_show_locals=False,
)


def _show_version(value: bool) -> None:
    if value:
        typer.echo(__version__)
        raise typer.Exit()


@app.callback()
def main(
    version: bool = typer.Option(
        False,
        "--version",
        callback=_show_version,
        is_eager=True,
        help="Show the version and exit.",
    ),
) -> None:
    """Map a SQL Server database from system metadata only."""


def _credentials(auth: AuthMode) -> tuple[str | None, str | None]:
    """User and password from the environment, else a hidden prompt. Never stored."""
    user = os.environ.get(ENV_USER) if auth.needs_user else None
    if auth.needs_user and not user:
        user = typer.prompt("User")
    password = os.environ.get(ENV_PASSWORD) if auth.needs_password else None
    if auth.needs_password and not password:
        password = typer.prompt("Password", hide_input=True)
    return user, password


_STYLES = {Status.OK: "green", Status.WARN: "yellow", Status.FAIL: "red"}


@app.command()
def doctor(
    server: Annotated[str, typer.Option(help="Server host name or address.")],
    database: Annotated[str, typer.Option(help="Database to inspect.")],
    port: Annotated[int, typer.Option(help="TCP port.")] = 1433,
    auth: Annotated[
        AuthMode, typer.Option(help="Authentication mode. Windows works on Windows only.")
    ] = AuthMode.SQL,
    trust_server_certificate: Annotated[
        bool,
        typer.Option(
            "--trust-server-certificate",
            help="Accept a self-signed server certificate (local labs only).",
        ),
    ] = False,
    connect_timeout: Annotated[int, typer.Option(help="Login timeout in seconds.")] = 15,
    query_timeout: Annotated[int, typer.Option(help="Per-query timeout in seconds.")] = 60,
) -> None:
    """Check the driver, the connection and the permissions Schema Map needs.

    Credentials come from SCHEMAMAP_USER and SCHEMAMAP_PASSWORD, or a hidden prompt.
    """
    console = Console(highlight=False)
    try:
        user, password = _credentials(auth)
        config = ConnectionConfig(
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
        console.print(str(exc), style="red", markup=False, soft_wrap=True)
        raise typer.Exit(EXIT_CONNECT) from None

    report = diagnose(config)
    steps: list[str] = []
    for check in report.checks:
        console.print(
            f"{check.status.value.upper():<5}", style=_STYLES[check.status], end=" ", markup=False
        )
        console.print(f"{check.name}: {check.detail}", markup=False, soft_wrap=True)
        if check.next_step:
            steps.append(check.next_step)
    console.print()
    if report.all_green:
        console.print("Everything is ready. Next: run `schemamap extract`.")
    else:
        console.print("Next steps:")
        for step in steps:
            console.print(f"  - {step}", markup=False, soft_wrap=True)
    if not report.connected:
        raise typer.Exit(EXIT_CONNECT)
