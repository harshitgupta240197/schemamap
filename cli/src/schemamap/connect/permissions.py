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

USER_PLACEHOLDER = "[<user>]"
"""Stands for the database user in a GRANT line when the name is not known, or must not be
stored (snapshot warnings never hold a user name)."""

USER_NOTE = "<user> is the database user the login maps to, which may differ from the login name."


class Permission(str, enum.Enum):
    """A permission Schema Map uses. The value is how the permissions query names it."""

    VIEW_DEFINITION = "VIEW DEFINITION"
    VIEW_DATABASE_STATE = "VIEW DATABASE STATE"
    SELECT_DEPENDENCIES = "SELECT ON sys.sql_expression_dependencies"

    def grant_for(self, user: str | None = None) -> str:
        """The exact statement a DBA runs to grant it, to ``user`` or to ``[<user>]``.

        Grants go to a database user, not a login, and the two names can differ.
        """
        return f"GRANT {self.value} TO {_principal(user)};"


def _principal(user: str | None) -> str:
    """``[user]`` with ``]`` doubled, or the placeholder. ``guest`` is never named: granting
    to it would open the permission to every login."""
    if user is None or user.lower() == "guest":
        return USER_PLACEHOLDER
    return f"[{user.replace(']', ']]')}]"


def grant_note(user: str | None) -> str:
    """The sentence after a GRANT hint: which user it names and why that may not be the login."""
    principal = _principal(user)
    if principal == USER_PLACEHOLDER:
        return USER_NOTE
    return f"The database user is {principal}, which may differ from the login name."


def database_user(executor: MetadataExecutor) -> str | None:
    """The database user the connected login maps to, or None when the server gives none."""
    rows = executor.run(QueryName.DATABASE_USER)
    name = rows[0][0] if rows else None
    return str(name) if name else None


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
