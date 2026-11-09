"""Every SQL statement Schema Map runs, one .sql file each, loaded by name."""

from __future__ import annotations

import re
from importlib import resources

_NAME = re.compile(r"[a-z][a-z0-9_]*")


def load_query(name: str) -> str:
    """Return the text of ``queries/<name>.sql``. Raises ValueError for an unsafe name."""
    if not _NAME.fullmatch(name):
        raise ValueError(f"invalid query name: {name!r}")
    return resources.files(__name__).joinpath(f"{name}.sql").read_text(encoding="utf-8")
