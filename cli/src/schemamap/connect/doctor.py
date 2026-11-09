"""Diagnose a connection: what works, what is missing, and what to do next."""

from __future__ import annotations

import enum
from collections.abc import Callable
from dataclasses import dataclass

from schemamap.connect.config import ConnectionConfig
from schemamap.connect.connection import Connection, connect
from schemamap.connect.driver import load_driver
from schemamap.errors import ConnectError, DriverUnavailableError

# EngineEdition values: 5 = Azure SQL Database, 8 = Azure SQL Managed Instance.
_AZURE_ENGINES = {5, 8}


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


def _server_check(conn: Connection) -> Check:
    rows = conn.query("doctor_server_info")
    version, edition, engine, database = rows[0]
    kind = "Azure SQL" if engine in _AZURE_ENGINES else "SQL Server"
    return Check("Server", Status.OK, f"{kind} {version}, {edition}, database {database}")


def _permission_checks(conn: Connection) -> list[Check]:
    held = {row[0] for row in conn.query("doctor_permissions")}
    checks: list[Check] = []
    definition = "VIEW DEFINITION" in held
    checks.append(
        Check(
            "VIEW DEFINITION",
            Status.OK if definition else Status.WARN,
            "granted" if definition else "missing",
            None
            if definition
            else "Without it, views, procedures and functions cannot be read. Ask a DBA to run "
            "GRANT VIEW DEFINITION TO <login>.",
        )
    )
    state = "VIEW DATABASE STATE" in held
    checks.append(
        Check(
            "VIEW DATABASE STATE",
            Status.OK if state else Status.WARN,
            "granted" if state else "missing",
            None
            if state
            else "Without it, Query Store and usage hints are skipped. Ask a DBA to run "
            "GRANT VIEW DATABASE STATE TO <login> (optional).",
        )
    )
    return checks


def _query_store_check(conn: Connection) -> Check:
    rows = conn.query("doctor_query_store")
    state = str(rows[0][0]) if rows else "OFF"
    if state in ("READ_WRITE", "READ_ONLY"):
        return Check("Query Store", Status.OK, state.replace("_", " ").lower())
    return Check(
        "Query Store",
        Status.WARN,
        "off",
        "Query Store is off, so query-based join hints will be skipped. "
        "Schema Map still works without it.",
    )


def diagnose(config: ConnectionConfig) -> DoctorReport:
    """Run every check. Never raises for a connection problem: it becomes a failed check."""
    checks: list[Check] = []
    try:
        load_driver()
    except DriverUnavailableError as exc:
        checks.append(Check("Driver", Status.FAIL, "not loaded", str(exc)))
        return DoctorReport(tuple(checks), connected=False)
    checks.append(Check("Driver", Status.OK, "mssql-python loaded"))

    try:
        conn = connect(config)
    except ConnectError as exc:
        checks.append(Check("Connection", Status.FAIL, "failed", str(exc)))
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
            except Exception:  # a failed probe is a warning, never a crash
                checks.append(
                    Check(
                        label,
                        Status.WARN,
                        "could not be checked",
                        "The login may lack permission to read this information.",
                    )
                )
    return DoctorReport(tuple(checks), connected=True)
