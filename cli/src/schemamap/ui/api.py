"""The launcher's connection routes, as plain functions the server calls (docs/UI.md, U.2).

Nothing here talks HTTP. A function takes the parsed JSON body and returns the JSON answer, or
raises ``ApiError`` with the status to send. The password arrives in the body, goes into a
``ConnectionConfig`` and is used for the one connection the request needs; no function here
stores it, logs it or puts it in a message. Every text that goes back also passes through
``redact`` with the config's secrets, so a driver message that echoes the password is masked
before it leaves.
"""

from __future__ import annotations

from http import HTTPStatus

from schemamap.connect import (
    AuthMode,
    Check,
    ConnectionConfig,
    connect,
    diagnose,
    redact,
)
from schemamap.connect.connection import split_failure
from schemamap.errors import ConnectError
from schemamap.queries import QueryName
from schemamap.ui.connections import ConnectionStore

DEFAULT_DATABASE = "master"
MAX_TEXT = 256
MAX_PASSWORD = 1024
MAX_TIMEOUT_SECONDS = 300

_CONNECTION_FIELDS = frozenset(
    {
        "server",
        "port",
        "database",
        "auth",
        "user",
        "password",
        "trust_server_certificate",
        "connect_timeout",
        "query_timeout",
    }
)


class ApiError(Exception):
    """A request the server answers with an error. The text never holds a secret or a value."""

    def __init__(self, status: HTTPStatus, code: str, message: str, fix: str | None = None) -> None:
        super().__init__(code)
        self.status = status
        self.code = code
        self.message = message
        self.fix = fix


def _bad(message: str) -> ApiError:
    return ApiError(HTTPStatus.BAD_REQUEST, "bad_request", message)


def _text(
    fields: dict[str, object], name: str, *, required: bool, limit: int = MAX_TEXT
) -> str | None:
    """A text field: absent or null gives None (or an error when required). Never echoed."""
    value = fields.get(name)
    if value is None:
        if required:
            raise _bad(f"The field '{name}' is required.")
        return None
    if not isinstance(value, str):
        raise _bad(f"The field '{name}' must be text.")
    if len(value) > limit:
        raise _bad(f"The field '{name}' is too long.")
    if "\x00" in value:
        raise _bad(f"The field '{name}' holds a character that is not allowed.")
    return value


def _number(fields: dict[str, object], name: str, default: int, *, low: int, high: int) -> int:
    value = fields.get(name, default)
    if isinstance(value, bool) or not isinstance(value, int):
        raise _bad(f"The field '{name}' must be a whole number.")
    if not low <= value <= high:
        raise _bad(f"The field '{name}' must be between {low} and {high}.")
    return value


def _flag(fields: dict[str, object], name: str) -> bool:
    value = fields.get(name, False)
    if not isinstance(value, bool):
        raise _bad(f"The field '{name}' must be true or false.")
    return value


def _only(fields: dict[str, object], allowed: frozenset[str]) -> None:
    """Refuse any field outside ``allowed``. The refusal names no field: it could be a secret."""
    if not set(fields) <= allowed:
        raise _bad("The request has a field this route does not take.")


def parse_connection(value: object, *, default_database: str | None = None) -> ConnectionConfig:
    """Build a ConnectionConfig from the ``connection`` object of a request body.

    Raises ApiError 400 for a missing or ill-typed field and 422 for a combination the
    connection settings refuse (a mode that needs a password given none, say). Messages name
    fields, never values.
    """
    if not isinstance(value, dict):
        raise _bad("Send the connection settings as an object in 'connection'.")
    fields: dict[str, object] = value
    _only(fields, _CONNECTION_FIELDS)
    server = _text(fields, "server", required=True)
    database = _text(fields, "database", required=default_database is None)
    user = _text(fields, "user", required=False)
    password = _text(fields, "password", required=False, limit=MAX_PASSWORD)
    auth_name = _text(fields, "auth", required=False)
    try:
        auth = AuthMode(auth_name or AuthMode.SQL.value)
    except ValueError:
        raise ApiError(
            HTTPStatus.UNPROCESSABLE_ENTITY, "invalid", "That authentication mode is not known."
        ) from None
    trust = _flag(fields, "trust_server_certificate")
    port = _number(fields, "port", 1433, low=1, high=65535)
    connect_timeout = _number(fields, "connect_timeout", 15, low=1, high=MAX_TIMEOUT_SECONDS)
    query_timeout = _number(fields, "query_timeout", 60, low=1, high=MAX_TIMEOUT_SECONDS)
    try:
        return ConnectionConfig(
            server=(server or "").strip(),
            database=(database or default_database or "").strip(),
            port=port,
            auth=auth,
            user=(user.strip() or None) if user is not None else None,
            password=password or None,
            trust_server_certificate=trust,
            connect_timeout=connect_timeout,
            query_timeout=query_timeout,
        )
    except ConnectError as exc:
        # ConnectionConfig's messages are fixed wording: they carry no submitted value.
        raise ApiError(HTTPStatus.UNPROCESSABLE_ENTITY, "invalid", str(exc)) from None


def parse_test_request(body: dict[str, object]) -> tuple[ConnectionConfig, bool]:
    """The connection and the ``remember`` flag of ``POST /api/connection/test``."""
    _only(body, frozenset({"connection", "remember"}))
    return parse_connection(body.get("connection")), _flag(body, "remember")


def parse_databases_request(body: dict[str, object]) -> tuple[ConnectionConfig, bool]:
    """The connection and the ``include_system`` flag of ``POST /api/databases``.

    The database may be left out: it defaults to ``master``, which every login can open.
    """
    _only(body, frozenset({"connection", "include_system"}))
    config = parse_connection(body.get("connection"), default_database=DEFAULT_DATABASE)
    return config, _flag(body, "include_system")


def _scrub(text: str | None, config: ConnectionConfig) -> str | None:
    return None if text is None else redact(text, config.secrets())


def _check_json(check: Check, config: ConnectionConfig) -> dict[str, object]:
    message = check.message or check.next_step or f"{check.name}: {check.detail}"
    return {
        "name": check.name,
        "status": check.status.value,
        "message": _scrub(message, config),
        "fix": _scrub(check.fix, config),
        "fix_sql": _scrub(check.fix_sql, config),
    }


def run_connection_test(
    config: ConnectionConfig, *, remember: bool, store: ConnectionStore
) -> dict[str, object]:
    """Run the doctor checks and report each one.

    The answer is always ``200`` with the checks, whatever they say: a failed login is a
    result, not an error. A connection that opened is saved when ``remember`` is set (its
    server, port, database, mode and user only), even if a check warns or fails after that: the
    settings are right and the fix is on the server. One that did not open is not saved.
    """
    report = diagnose(config)
    remembered = False
    if remember and report.connected:
        store.remember(config)
        remembered = True
    return {
        "checks": [_check_json(check, config) for check in report.checks],
        "connected": report.connected,
        "ok": not report.failed,
        "remembered": remembered,
    }


def list_databases(config: ConnectionConfig, *, include_system: bool) -> dict[str, object]:
    """The databases the login can open, sorted by name. Raises ApiError 502 on a failed login."""
    try:
        with connect(config) as executor:
            rows = executor.run(QueryName.DATABASES, {"include_system": int(include_system)})
    except ConnectError as exc:
        problem, fix = split_failure(str(exc))
        raise ApiError(
            HTTPStatus.BAD_GATEWAY,
            "connect_failed",
            _scrub(problem, config) or "Could not connect.",
            _scrub(fix, config),
        ) from None
    names = sorted({str(row[0]) for row in rows}, key=lambda name: (name.casefold(), name))
    return {"databases": [{"name": name} for name in names]}
