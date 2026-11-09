"""Every SQL statement Schema Map runs, one .sql file each, addressed by QueryName.

A file may declare its parameters in a header comment, in the order of its ``?`` placeholders::

    -- params: schema_id, object_name
"""

from __future__ import annotations

import enum
import re
from importlib import resources

from schemamap.errors import QueryRefusedError

_PARAMS_LINE = re.compile(r"^--\s*params:(.*)$", re.MULTILINE)
_PARAM_NAME = re.compile(r"[a-z][a-z0-9_]*")


class QueryName(enum.Enum):
    """One member per .sql file in this folder; the value is the file name without ``.sql``."""

    CHECK_CONSTRAINTS = "check_constraints"
    COLUMNS = "columns"
    DEPENDENCIES = "dependencies"
    DOCTOR_SERVER_INFO = "doctor_server_info"
    FOREIGN_KEYS = "foreign_keys"
    INDEX_COLUMNS = "index_columns"
    INDEXES = "indexes"
    PERMISSIONS = "permissions"
    QUERY_STORE_STATE = "query_store_state"
    ROW_COUNTS = "row_counts"
    ROUTINES = "routines"
    SCHEMAS = "schemas"
    SOURCE_INFO = "source_info"
    SYNONYMS = "synonyms"
    TABLES = "tables"
    VIEW_COLUMNS = "view_columns"
    VIEWS = "views"


def load_query(name: QueryName) -> str:
    """Return the text of the named query file. Refuses anything that is not a QueryName."""
    if not isinstance(name, QueryName):
        raise QueryRefusedError(f"Queries are loaded by QueryName only, not {type(name).__name__}.")
    return resources.files(__name__).joinpath(f"{name.value}.sql").read_text(encoding="utf-8")


def query_params(sql: str) -> tuple[str, ...]:
    """The parameter names declared by a ``-- params:`` header, in placeholder order.

    Raises QueryRefusedError for more than one header, a malformed name or a duplicate.
    """
    headers = _PARAMS_LINE.findall(sql)
    if not headers:
        return ()
    if len(headers) > 1:
        raise QueryRefusedError("A query may declare its parameters only once.")
    names = tuple(part.strip() for part in headers[0].split(","))
    for name in names:
        if not _PARAM_NAME.fullmatch(name):
            raise QueryRefusedError(f"Invalid parameter name {name!r} in the params header.")
    if len(set(names)) != len(names):
        raise QueryRefusedError("A parameter is declared twice in the params header.")
    return names
