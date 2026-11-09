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
    DebugOption,
    PortOption,
    QueryTimeoutOption,
    ServerOption,
    TrustCertificateOption,
    connection_config,
    friendly_errors,
)
from schemamap.cli_progress import ExtractProgress
from schemamap.connect import AuthMode, Status, connect, diagnose
from schemamap.extract import SECTION_COUNT, SchemaFilter, extract_snapshot
from schemamap.snapshot.io import default_output_path, redact_server, write_snapshot
from schemamap.snapshot.models import Snapshot

EXIT_FAILURE = 1

EXIT_CODES_EPILOG = (
    "\b\nExit codes:\n"
    "  0  success, including warnings\n"
    "  1  internal error (re-run with --debug for the traceback)\n"
    "  2  usage error\n"
    "  3  cannot connect, log in or read (also permission denied and timeouts)\n"
    "  4  bad or unsupported snapshot file"
)

# Locals can hold the password, so crash output must never show them.
app = typer.Typer(
    help="Map a SQL Server database from system metadata only.",
    epilog=EXIT_CODES_EPILOG,
    pretty_exceptions_show_locals=False,
    no_args_is_help=True,
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


@app.command(epilog=EXIT_CODES_EPILOG)
def doctor(
    server: ServerOption,
    database: DatabaseOption,
    port: PortOption = 1433,
    auth: AuthOption = AuthMode.SQL,
    trust_server_certificate: TrustCertificateOption = False,
    connect_timeout: ConnectTimeoutOption = 15,
    query_timeout: QueryTimeoutOption = 60,
    debug: DebugOption = False,
) -> None:
    """Check the driver, the connection and the permissions Schema Map needs.

    Credentials come from SCHEMAMAP_USER and SCHEMAMAP_PASSWORD, or a hidden prompt.

    \b
    Examples:
      schemamap doctor --server localhost --database AdventureWorks2022
      schemamap doctor --server db.example.com --database Sales --auth entra-interactive
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
    with friendly_errors(console, what="Doctor", debug=debug):
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
    if snapshot.filters is not None:
        applied = [f"--schema {n}" for n in snapshot.filters.schemas]
        applied += [f"--exclude-schema {n}" for n in snapshot.filters.exclude_schemas]
        lines.append("  Filters: " + " ".join(applied))
    if snapshot.warnings:
        sections = sorted({warning.section.value for warning in snapshot.warnings})
        lines.append(f"  {len(snapshot.warnings)} warning(s): {', '.join(sections)}")
        lines.extend(
            f"    {warning.section.value}: {warning.message}" for warning in snapshot.warnings
        )
    else:
        lines.append("  No warnings")
    return lines


@app.command(epilog=EXIT_CODES_EPILOG)
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
    schemas: Annotated[
        list[str] | None,
        typer.Option(
            "--schema",
            help="Read only this schema. Repeat for several. Everything else is left out.",
        ),
    ] = None,
    exclude_schemas: Annotated[
        list[str] | None,
        typer.Option(
            "--exclude-schema",
            help="Leave this schema out. Repeat for several. Relationships into it are dropped.",
        ),
    ] = None,
    no_definitions: Annotated[
        bool,
        typer.Option(
            "--no-definitions",
            help=(
                "Leave out all SQL text: view, procedure, function and trigger bodies, "
                "computed columns, defaults, check constraints and index filters."
            ),
        ),
    ] = False,
    quiet: Annotated[
        bool, typer.Option("--quiet", "-q", help="Print errors only: no progress, no summary.")
    ] = False,
    verbose: Annotated[
        bool, typer.Option("--verbose", "-v", help="Print how long each section took.")
    ] = False,
    debug: DebugOption = False,
) -> None:
    """Read the database's metadata and write one snapshot file.

    Only system metadata is read, never table rows. Progress and the summary go to stderr.
    Credentials come from SCHEMAMAP_USER and SCHEMAMAP_PASSWORD, or a hidden prompt.

    \b
    Examples:
      schemamap extract --server localhost --database AdventureWorks2022
      schemamap extract --server db.example.com --database Sales --schema dbo --schema sales
      schemamap extract --server db.example.com --database Sales --no-definitions --gzip
    """
    if quiet and verbose:
        raise typer.BadParameter("--quiet and --verbose cannot be used together.")
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
    schema_filter = SchemaFilter(include=tuple(schemas or ()), exclude=tuple(exclude_schemas or ()))
    with (
        friendly_errors(console, what="Extraction", debug=debug),
        ExtractProgress(console, total=SECTION_COUNT, show=not quiet, verbose=verbose) as progress,
        connect(config) as executor,
    ):
        snapshot = extract_snapshot(
            executor,
            server=server,
            database=database,
            schema_filter=schema_filter,
            include_definitions=not no_definitions,
            observer=progress,
        )
    if redact:
        snapshot = redact_server(snapshot)
    target = output or default_output_path(snapshot.source.database, compress)
    try:
        written = write_snapshot(snapshot, target, compress)
    except OSError as exc:
        console.print(f"Cannot write {target}: {exc}", style="red", markup=False, soft_wrap=True)
        raise typer.Exit(EXIT_FAILURE) from None
    if not quiet:
        for line in _summary(snapshot, written):
            console.print(line, markup=False, soft_wrap=True)
