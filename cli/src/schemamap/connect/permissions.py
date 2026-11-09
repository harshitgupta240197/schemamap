"""The permissions Schema Map can use, which of them a login holds, and what that means.

Permissions are read as data (``sys.fn_my_permissions``), never inferred from error text, so
the answer does not depend on the server's language or the driver's message format.
"""

from __future__ import annotations

import enum

from schemamap.connect.executor import MetadataExecutor
from schemamap.queries import QueryName
from schemamap.snapshot.models import QueryStoreState

_ON_STATES = frozenset({"READ_WRITE", "READ_ONLY"})


class Permission(str, enum.Enum):
    """A permission Schema Map uses. The value is how the permissions query names it."""

    VIEW_DEFINITION = "VIEW DEFINITION"
    VIEW_DATABASE_STATE = "VIEW DATABASE STATE"
    SELECT_DEPENDENCIES = "SELECT ON sys.sql_expression_dependencies"

    @property
    def grant(self) -> str:
        """The exact statement a DBA runs to grant it."""
        return f"GRANT {self.value} TO <login>;"


def held_permissions(executor: MetadataExecutor) -> frozenset[Permission]:
    """The permissions the connected login holds in the current database."""
    names = {row[0] for row in executor.run(QueryName.PERMISSIONS)}
    return frozenset(p for p in Permission if p.value in names)


def query_store_state(held: frozenset[Permission], executor: MetadataExecutor) -> QueryStoreState:
    """Whether Query Store is on. ``unknown`` when the login cannot read the setting.

    Without VIEW DATABASE STATE the catalog reports ``OFF`` whatever the real state is, so the
    setting is not read at all and the answer is ``unknown``, never ``off``.
    """
    if Permission.VIEW_DATABASE_STATE not in held:
        return QueryStoreState.UNKNOWN
    rows = executor.run(QueryName.QUERY_STORE_STATE)
    state = str(rows[0][0]) if rows else "OFF"
    return QueryStoreState.ON if state in _ON_STATES else QueryStoreState.OFF
