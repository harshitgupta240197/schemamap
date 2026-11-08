"""Command-line entry point."""

from __future__ import annotations

import typer

from schemamap import __version__

app = typer.Typer(help="Map a SQL Server database from system metadata only.")


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
