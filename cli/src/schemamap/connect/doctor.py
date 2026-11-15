"""Diagnose a connection: what works, what is missing, and what to do next."""

from __future__ import annotations

import enum
from collections.abc import Callable
from dataclasses import dataclass

from schemamap.connect.config import ConnectionConfig
from schemamap.connect.connection import connect, split_failure
from schemamap.connect.driver import load_driver
from schemamap.connect.executor import MetadataExecutor
from schemamap.connect.permissions import (
    Permission,
    database_user,
    grant_note,
    held_permissions,
    query_store_state,
    quote_name,
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


class Scope(str, enum.Enum):
    """What a check judges: the server (or the sign-in), or one database's permissions."""

    SERVER = "server"
    DATABASE = "database"


@dataclass(frozen=True)
class Check:
    """One line of the doctor report.

    ``next_step`` is the whole hint as the terminal prints it. ``message``, ``fix`` and
    ``fix_sql`` hold the same hint in parts for the launcher: what is wrong, what to do, and
    the statement a DBA runs when there is one. A database-scope check's ``fix_sql`` starts
    with ``USE [<database>];`` so the script runs in the right database.
    """

    name: str
    status: Status
    detail: str
    next_step: str | None = None
    message: str | None = None
    fix: str | None = None
    fix_sql: str | None = None
    scope: Scope = Scope.SERVER


@dataclass(frozen=True)
class DoctorReport:
    """All checks in order, plus whether the connection itself worked."""

    checks: tuple[Check, ...]
    connected: bool

    @property
    def failed(self) -> bool:
        """True when any check is FAIL; warnings alone do not count."""
        return any(check.status is Status.FAIL for check in self.checks)

    @property
    def all_green(self) -> bool:
        """True when every check is OK."""
        return all(check.status is Status.OK for check in self.checks)


def _server_check(conn: MetadataExecutor, *, name_database: bool) -> Check:
    rows = conn.run(QueryName.DOCTOR_SERVER_INFO)
    version, edition, engine, database = rows[0]
    kind = "Azure SQL" if engine in _AZURE_ENGINES else "SQL Server"
    where = f", database {database}" if name_database else ""
    return Check("Server", Status.OK, f"{kind} {version}, {edition}{where}")


def _permission_checks(conn: MetadataExecutor, database: str) -> list[Check]:
    held = held_permissions(conn)
    user = database_user(conn)
    return [
        _permission_check(
            "VIEW DEFINITION",
            Permission.VIEW_DEFINITION,
            held,
            _NO_DEFINITION,
            user,
            database,
            Status.FAIL,
        ),
        _permission_check(
            "VIEW DATABASE STATE",
            Permission.VIEW_DATABASE_STATE,
            held,
            _NO_DATABASE_STATE,
            user,
            database,
        ),
        _permission_check(
            "SELECT sys.sql_expression_dependencies",
            Permission.SELECT_DEPENDENCIES,
            held,
            _NO_DEPENDENCIES,
            user,
            database,
        ),
    ]


def _permission_check(
    name: str,
    permission: Permission,
    held: frozenset[Permission],
    consequence: str,
    user: str | None,
    database: str,
    missing: Status = Status.WARN,
) -> Check:
    if permission in held:
        return Check(name, Status.OK, "granted", scope=Scope.DATABASE)
    grant = permission.grant_for(user)
    message = f"{permission.value} is missing: {consequence}"
    fix = f"Ask a DBA to run {grant} {grant_note(user)}"
    script = f"USE {quote_name(database)};\n{grant}"
    return Check(name, missing, "missing", f"{message} {fix}", message, fix, script, Scope.DATABASE)


def _query_store_check(conn: MetadataExecutor) -> Check:
    state = query_store_state(held_permissions(conn), conn)
    if state is QueryStoreState.ON:
        return Check("Query Store", Status.OK, "on", scope=Scope.DATABASE)
    if state is QueryStoreState.UNKNOWN:
        return Check(
            "Query Store",
            Status.WARN,
            "unknown",
            "Query Store is unknown: Query Store cannot be read without VIEW DATABASE STATE, so "
            "its state is reported as unknown, not off. Query-based join hints are skipped.",
            scope=Scope.DATABASE,
        )
    return Check(
        "Query Store",
        Status.WARN,
        "off",
        "Query Store is off: query-based join hints will be skipped. "
        "Schema Map still works without Query Store.",
        scope=Scope.DATABASE,
    )


def diagnose(config: ConnectionConfig, *, database_checks: bool = True) -> DoctorReport:
    """Run every check. Never raises for a connection problem: it becomes a failed check.

    With ``database_checks`` off only the server checks run: the connection is open on some
    database (``master``) the person did not choose, so its permissions say nothing about the
    one they will map.
    """
    checks: list[Check] = []
    try:
        load_driver()
    except DriverUnavailableError as exc:
        problem = "The SQL Server driver could not be loaded."
        checks.append(
            Check(
                "Driver",
                Status.FAIL,
                "not loaded",
                f"The SQL Server driver is not loaded: {exc}",
                problem,
                str(exc).removeprefix(problem).strip() or None,
            )
        )
        return DoctorReport(tuple(checks), connected=False)
    checks.append(Check("Driver", Status.OK, "mssql-python loaded"))

    try:
        conn = connect(config)
    except ConnectError as exc:
        message, fix = split_failure(str(exc))
        checks.append(
            Check(
                "Connection",
                Status.FAIL,
                "failed",
                f"The connection failed: {exc}",
                message,
                fix,
            )
        )
        return DoctorReport(tuple(checks), connected=False)
    checks.append(
        Check("Connection", Status.OK, f"{config.server},{config.port} ({config.auth.value})")
    )
    with conn:
        steps: list[tuple[str, Callable[[], list[Check]]]] = [
            ("Server", lambda: [_server_check(conn, name_database=database_checks)]),
        ]
        if database_checks:
            steps += [
                ("Permissions", lambda: _permission_checks(conn, config.database)),
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
