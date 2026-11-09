"""Diagnose a connection: what works, what is missing, and what to do next."""

from __future__ import annotations

import enum
from collections.abc import Callable
from dataclasses import dataclass

from schemamap.connect.config import ConnectionConfig
from schemamap.connect.connection import connect
from schemamap.connect.driver import load_driver
from schemamap.connect.executor import MetadataExecutor
from schemamap.connect.permissions import (
    Permission,
    database_user,
    grant_note,
    held_permissions,
    query_store_state,
)
from schemamap.errors import ConnectError, DriverUnavailableError, QueryRefusedError
from schemamap.queries import QueryName
from schemamap.snapshot.models import QueryStoreState

# EngineEdition values: 5 = Azure SQL Database, 8 = Azure SQL Managed Instance.
_AZURE_ENGINES = {5, 8}


_NO_DEFINITION = (
    "Without VIEW DEFINITION, SQL Server hides every object the login does not own or have "
    "rights on, so the map would be empty or partial."
)
_NO_DATABASE_STATE = (
    "Without VIEW DATABASE STATE, row counts and sizes, Query Store and usage hints are "
    "skipped (optional)."
)
_NO_DEPENDENCIES = (
    "sys.sql_expression_dependencies is a system catalog view, not user data. Without "
    "this SELECT grant, dependency and impact information is skipped."
)


class Status(str, enum.Enum):
    """Result of one check."""

    OK = "ok"
    WARN = "warn"
    FAIL = "fail"


@dataclass(frozen=True)
class Check:
    """One line of the doctor report."""

    name: str
    status: Status
    detail: str
    next_step: str | None = None


@dataclass(frozen=True)
class DoctorReport:
    """All checks in order, plus whether the connection itself worked."""

    checks: tuple[Check, ...]
    connected: bool

    @property
    def all_green(self) -> bool:
        """True when every check is OK."""
        return all(check.status is Status.OK for check in self.checks)


def _server_check(conn: MetadataExecutor) -> Check:
    rows = conn.run(QueryName.DOCTOR_SERVER_INFO)
    version, edition, engine, database = rows[0]
    kind = "Azure SQL" if engine in _AZURE_ENGINES else "SQL Server"
    return Check("Server", Status.OK, f"{kind} {version}, {edition}, database {database}")


def _permission_checks(conn: MetadataExecutor) -> list[Check]:
    held = held_permissions(conn)
    user = database_user(conn)
    return [
        _permission_check(
            "VIEW DEFINITION", Permission.VIEW_DEFINITION, held, _NO_DEFINITION, user, Status.FAIL
        ),
        _permission_check(
            "VIEW DATABASE STATE", Permission.VIEW_DATABASE_STATE, held, _NO_DATABASE_STATE, user
        ),
        _permission_check(
            "SELECT sys.sql_expression_dependencies",
            Permission.SELECT_DEPENDENCIES,
            held,
            _NO_DEPENDENCIES,
            user,
        ),
    ]


def _permission_check(
    name: str,
    permission: Permission,
    held: frozenset[Permission],
    consequence: str,
    user: str | None,
    missing: Status = Status.WARN,
) -> Check:
    if permission in held:
        return Check(name, Status.OK, "granted")
    return Check(
        name,
        missing,
        "missing",
        f"{permission.value} is missing: {consequence} "
        f"Ask a DBA to run {permission.grant_for(user)} {grant_note(user)}",
    )


def _query_store_check(conn: MetadataExecutor) -> Check:
    state = query_store_state(held_permissions(conn), conn)
    if state is QueryStoreState.ON:
        return Check("Query Store", Status.OK, "on")
    if state is QueryStoreState.UNKNOWN:
        return Check(
            "Query Store",
            Status.WARN,
            "unknown",
            "Query Store is unknown: Query Store cannot be read without VIEW DATABASE STATE, so "
            "its state is reported as unknown, not off. Query-based join hints are skipped.",
        )
    return Check(
        "Query Store",
        Status.WARN,
        "off",
        "Query Store is off: query-based join hints will be skipped. "
        "Schema Map still works without Query Store.",
    )


def diagnose(config: ConnectionConfig) -> DoctorReport:
    """Run every check. Never raises for a connection problem: it becomes a failed check."""
    checks: list[Check] = []
    try:
        load_driver()
    except DriverUnavailableError as exc:
        checks.append(
            Check(
                "Driver", Status.FAIL, "not loaded", f"The SQL Server driver is not loaded: {exc}"
            )
        )
        return DoctorReport(tuple(checks), connected=False)
    checks.append(Check("Driver", Status.OK, "mssql-python loaded"))

    try:
        conn = connect(config)
    except ConnectError as exc:
        checks.append(Check("Connection", Status.FAIL, "failed", f"The connection failed: {exc}"))
        return DoctorReport(tuple(checks), connected=False)
    checks.append(
        Check("Connection", Status.OK, f"{config.server},{config.port} ({config.auth.value})")
    )
    with conn:
        steps: list[tuple[str, Callable[[], list[Check]]]] = [
            ("Server", lambda: [_server_check(conn)]),
            ("Permissions", lambda: _permission_checks(conn)),
            ("Query Store", lambda: [_query_store_check(conn)]),
        ]
        for label, step in steps:
            try:
                checks.extend(step())
            except QueryRefusedError:
                raise  # a bug in Schema Map, not a permission problem: never hide it
            except Exception:  # a failed probe is a warning, never a crash
                checks.append(
                    Check(
                        label,
                        Status.WARN,
                        "could not be checked",
                        f"{label} could not be checked: the login may lack permission to read "
                        f"the {label.lower()} details.",
                    )
                )
    return DoctorReport(tuple(checks), connected=True)
