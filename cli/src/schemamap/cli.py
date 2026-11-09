"""Command-line entry point."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer
from rich.console import Console

from schemamap import __version__
from schemamap.cli_connection import (
    EXIT_CONNECT,
    AuthOption,
    ConnectTimeoutOption,
    DatabaseOption,
    PortOption,
    QueryTimeoutOption,
    ServerOption,
    TrustCertificateOption,
    connection_config,
    fail_connect,
)
from schemamap.connect import AuthMode, Status, connect, diagnose
from schemamap.errors import ConnectError, SchemaMapError
from schemamap.extract import extract_snapshot
from schemamap.snapshot.io import default_output_path, redact_server, write_snapshot
from schemamap.snapshot.models import Snapshot

EXIT_FAILURE = 1

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


_STYLES = {Status.OK: "green", Status.WARN: "yellow", Status.FAIL: "red"}


@app.command()
def doctor(
    server: ServerOption,
    database: DatabaseOption,
    port: PortOption = 1433,
    auth: AuthOption = AuthMode.SQL,
    trust_server_certificate: TrustCertificateOption = False,
    connect_timeout: ConnectTimeoutOption = 15,
    query_timeout: QueryTimeoutOption = 60,
) -> None:
    """Check the driver, the connection and the permissions Schema Map needs.

    Credentials come from SCHEMAMAP_USER and SCHEMAMAP_PASSWORD, or a hidden prompt.
    """
    console = Console(highlight=False)
    config = connection_config(
        console,
        server=server,
        database=database,
        port=port,
        auth=auth,
        trust_server_certificate=trust_server_certificate,
        connect_timeout=connect_timeout,
        query_timeout=query_timeout,
    )
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


def _summary(snapshot: Snapshot, path: Path) -> list[str]:
    """The lines printed to stderr after a successful extract."""
    counts = (
        ("schemas", snapshot.schemas),
        ("tables", snapshot.tables),
        ("views", snapshot.views),
        ("routines", snapshot.routines),
        ("synonyms", snapshot.synonyms),
        ("relationships", snapshot.relationships),
        ("dependencies", snapshot.dependencies),
    )
    lines = [f"Wrote {path}", "  " + ", ".join(f"{len(items)} {name}" for name, items in counts)]
    if snapshot.warnings:
        sections = sorted({warning.section.value for warning in snapshot.warnings})
        lines.append(f"  {len(snapshot.warnings)} warning(s): {', '.join(sections)}")
        lines.extend(
            f"    {warning.section.value}: {warning.message}" for warning in snapshot.warnings
        )
    else:
        lines.append("  No warnings")
    return lines


@app.command()
def extract(
    server: ServerOption,
    database: DatabaseOption,
    port: PortOption = 1433,
    auth: AuthOption = AuthMode.SQL,
    trust_server_certificate: TrustCertificateOption = False,
    connect_timeout: ConnectTimeoutOption = 15,
    query_timeout: QueryTimeoutOption = 60,
    output: Annotated[
        Path | None,
        typer.Option(
            "--output",
            "-o",
            help="File to write. Default: <database>.snapshot.json in the current directory.",
        ),
    ] = None,
    redact: Annotated[
        bool,
        typer.Option(
            "--redact-server",
            help=(
                "Remove host names only: the server name and linked-server names. "
                "Definitions and object names stay in the file."
            ),
        ),
    ] = False,
    compress: Annotated[
        bool,
        typer.Option("--gzip", help="Write a gzip file (.json.gz); .gz is added to the name."),
    ] = False,
) -> None:
    """Read the database's metadata and write one snapshot file.

    Only system metadata is read, never table rows. The summary goes to stderr.
    Credentials come from SCHEMAMAP_USER and SCHEMAMAP_PASSWORD, or a hidden prompt.
    """
    console = Console(stderr=True, highlight=False)
    config = connection_config(
        console,
        server=server,
        database=database,
        port=port,
        auth=auth,
        trust_server_certificate=trust_server_certificate,
        connect_timeout=connect_timeout,
        query_timeout=query_timeout,
    )
    try:
        with connect(config) as executor:
            snapshot = extract_snapshot(executor, server=server, database=database)
    except ConnectError as exc:
        fail_connect(console, exc)
    except SchemaMapError as exc:
        console.print(f"Extraction failed: {exc}", style="red", markup=False, soft_wrap=True)
        raise typer.Exit(EXIT_FAILURE) from None
    if redact:
        snapshot = redact_server(snapshot)
    target = output or default_output_path(snapshot.source.database, compress)
    try:
        written = write_snapshot(snapshot, target, compress)
    except OSError as exc:
        console.print(f"Cannot write {target}: {exc}", style="red", markup=False, soft_wrap=True)
        raise typer.Exit(EXIT_FAILURE) from None
    for line in _summary(snapshot, written):
        console.print(line, markup=False, soft_wrap=True)
