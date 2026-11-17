"""``GET /api/queries``: every query this version can run, as the .sql files that ship with it.

The list is the ``QueryName`` enum, which the allowlist test checks against the files on disk,
so the page can show nothing the extractor could not send and hide nothing it could. The text
is read as bytes and decoded, so what the page shows is exactly what the file holds.
"""

from __future__ import annotations

from importlib import resources
from pathlib import Path

from schemamap import __version__
from schemamap.queries import QueryName

_COMMENT = "--"
_PARAMS = "params:"


def purpose_of(name: str, sql: str) -> str:
    """The query's one-line purpose: its leading comment lines joined, else the name.

    The ``-- params:`` line is part of the header but not of the purpose.
    """
    parts: list[str] = []
    for line in sql.splitlines():
        stripped = line.strip()
        if not stripped.startswith(_COMMENT):
            break
        text = stripped[len(_COMMENT) :].strip()
        if text and not text.startswith(_PARAMS):
            parts.append(text)
    return " ".join(parts) or name


def list_queries() -> dict[str, object]:
    """The version and every named query with its purpose and SQL text, sorted by name."""
    folder = resources.files("schemamap.queries")
    queries: list[dict[str, str]] = []
    for member in sorted(QueryName, key=lambda item: item.value):
        sql = folder.joinpath(f"{member.value}.sql").read_bytes().decode("utf-8")
        queries.append({"name": member.value, "purpose": purpose_of(member.value, sql), "sql": sql})
    return {"version": __version__, "queries": queries}


def display_path(path: Path, home: Path | None = None) -> str:
    """``path`` with the home folder shown as ``~``, so the page never prints a user name."""
    base = (home or Path.home()).resolve()
    resolved = path.resolve()
    try:
        relative = resolved.relative_to(base)
    except ValueError:
        return str(resolved)
    return str(Path("~") / relative)
