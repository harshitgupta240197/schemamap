"""The connection routes over a real socket: shapes, auth, and that no password ever leaves.

Every hostile password from the Gate 1 review goes through every route in every failure mode.
After each run the response bodies, captured logs, stdout, stderr and every file under the data
folder are searched for the password in the forms it could take: raw, JSON-escaped and
brace-quoted.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Iterator
from pathlib import Path
from typing import Any, ClassVar

import pytest
from ui_http import TOKEN, post_json, request, serving

from schemamap.connect import connection as connection_module
from schemamap.connect import doctor as doctor_module
from schemamap.queries import QueryName
from schemamap.ui import api as api_module
from schemamap.ui import server as server_module
from schemamap.ui.connections import FILE_NAME
from schemamap.ui.server import LauncherServer

AUTH = {"X-SchemaMap-Token": TOKEN}

# The five hostile passwords from the Gate 1 review, plus a brace/UID injection attempt.
HOSTILE_PASSWORDS = [
    "Wr0ng};Database=master;UID=sa;PWD={x",
    "pa;ss word=1",
    "}}}{{{",
    "PWD=leak'\"`$(id)`",
    "pässwörd-日本語-✓-🔑",
    "x};UID={sa};PWD={y",
]

FAILURES = [
    "Login failed for user 'reader'. PWD={pw}",
    "bad string: {conn}",
    "boom {pw} boom",
    "Password = {pw}; and again {pw_braced}",
    "{pw_json}",
]


def forms(password: str) -> list[str]:
    """The ways a password could appear in text: raw, JSON-escaped, brace-quoted, quoted."""
    return [
        password,
        json.dumps(password)[1:-1],
        json.dumps(password, ensure_ascii=False)[1:-1],
        "{" + password.replace("}", "}}") + "}",
        "PWD=" + password,
    ]


def connection(password: str, **changes: Any) -> dict[str, Any]:
    settings = {
        "server": "db.example.test",
        "port": 1433,
        "database": "Sales",
        "user": "reader",
        "password": password,
    }
    return settings | changes


class FailingDriver:
    """Stands in for mssql_python; fails the way a real driver might, echoing secrets."""

    def __init__(self, template: str, password: str) -> None:
        self.template = template
        self.password = password

    def connect(self, connection_string: str, **_: Any) -> Any:
        raise RuntimeError(
            self.template.format(
                conn=connection_string,
                pw=self.password,
                pw_braced="{" + self.password.replace("}", "}}") + "}",
                pw_json=json.dumps(self.password),
            )
        )


class GreenConnection:
    """A connection every doctor probe answers well."""

    ANSWERS: ClassVar[dict[QueryName, list[tuple[Any, ...]]]] = {
        QueryName.DOCTOR_SERVER_INFO: [("16.0.4135.4", "Developer Edition (64-bit)", 3, "Sales")],
        QueryName.PERMISSIONS: [
            ("SELECT ON sys.sql_expression_dependencies",),
            ("VIEW DATABASE STATE",),
            ("VIEW DEFINITION",),
        ],
        QueryName.QUERY_STORE_STATE: [("READ_WRITE",)],
        QueryName.DATABASE_USER: [("reader",)],
        QueryName.DATABASES: [("Sales",), ("Archive",)],
    }

    def run(self, query: QueryName, params: Any = None) -> list[tuple[Any, ...]]:
        return self.ANSWERS[query]

    def __enter__(self) -> GreenConnection:
        return self

    def __exit__(self, *_: object) -> None:
        return None


@pytest.fixture
def server(tmp_path: Path) -> Iterator[LauncherServer]:
    with serving(tmp_path) as (running, _):
        yield running


def data_files(server: LauncherServer) -> list[Path]:
    return (
        [p for p in server.data_dir.rglob("*") if p.is_file()] if server.data_dir.exists() else []
    )


def assert_no_password(
    password: str,
    *,
    bodies: list[bytes],
    server: LauncherServer,
    caplog: pytest.LogCaptureFixture,
    capfd: pytest.CaptureFixture[str],
) -> None:
    out, err = capfd.readouterr()
    haystacks = [b.decode("utf-8", "replace") for b in bodies] + [caplog.text, out, err]
    haystacks += [p.read_bytes().decode("utf-8", "replace") for p in data_files(server)]
    for text in haystacks:
        for form in forms(password):
            assert form not in text, f"{form!r} leaked"
    for text in haystacks:
        assert "PWD=" not in text and "Trusted_Connection" not in text


def failing_driver(monkeypatch: pytest.MonkeyPatch, template: str, password: str) -> None:
    driver = FailingDriver(template, password)
    monkeypatch.setattr(connection_module, "load_driver", lambda: driver)
    monkeypatch.setattr(doctor_module, "load_driver", lambda: driver)


def post(server: LauncherServer, path: str, payload: object) -> tuple[int, dict[str, str], bytes]:
    return post_json(server, path, json.dumps(payload).encode("utf-8"), **AUTH)


# -- shapes ----------------------------------------------------------------------------------


def test_a_green_connection_test_lists_every_check(
    server: LauncherServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(doctor_module, "load_driver", lambda: object())
    monkeypatch.setattr(doctor_module, "connect", lambda _config: GreenConnection())
    status, headers, body = post(server, "/api/connection/test", {"connection": connection("pw")})
    assert status == 200
    assert headers["Content-Type"] == "application/json"
    answer = json.loads(body)
    assert answer["connected"] is True and answer["ok"] is True
    assert answer["remembered"] is False
    assert [c["name"] for c in answer["checks"]] == [
        "Driver",
        "Connection",
        "Server",
        "VIEW DEFINITION",
        "VIEW DATABASE STATE",
        "SELECT sys.sql_expression_dependencies",
        "Query Store",
    ]
    assert {c["status"] for c in answer["checks"]} == {"ok"}
    for check in answer["checks"]:
        assert set(check) == {"name", "status", "message", "fix", "fix_sql"}
        assert check["message"] and check["fix"] is None and check["fix_sql"] is None
    assert not (server.data_dir / FILE_NAME).exists()


def test_a_missing_permission_is_a_check_with_a_message_a_fix_and_the_statement(
    server: LauncherServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    class NoDefinition(GreenConnection):
        def run(self, query: QueryName, params: Any = None) -> list[tuple[Any, ...]]:
            if query is QueryName.PERMISSIONS:
                return [("VIEW DATABASE STATE",)]
            return super().run(query, params)

    monkeypatch.setattr(doctor_module, "load_driver", lambda: object())
    monkeypatch.setattr(doctor_module, "connect", lambda _config: NoDefinition())
    _, _, body = post(server, "/api/connection/test", {"connection": connection("pw")})
    answer = json.loads(body)
    assert answer["connected"] is True and answer["ok"] is False
    by_name = {c["name"]: c for c in answer["checks"]}
    definition = by_name["VIEW DEFINITION"]
    assert definition["status"] == "fail"
    assert definition["message"].startswith("VIEW DEFINITION is missing:")
    assert definition["fix_sql"] == "GRANT VIEW DEFINITION TO [reader];"
    assert definition["fix"].startswith("Ask a DBA to run GRANT VIEW DEFINITION TO [reader];")
    assert by_name["SELECT sys.sql_expression_dependencies"]["status"] == "warn"


def test_remember_saves_a_connection_that_opened_and_never_the_password(
    server: LauncherServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(doctor_module, "load_driver", lambda: object())
    monkeypatch.setattr(doctor_module, "connect", lambda _config: GreenConnection())
    payload = {"connection": connection("Sup3r;Secret}pw"), "remember": True}
    status, _, body = post(server, "/api/connection/test", payload)
    assert status == 200 and json.loads(body)["remembered"] is True

    status, _, listing = request(server, "/api/connections", headers=AUTH)
    assert status == 200
    [entry] = json.loads(listing)["connections"]
    assert entry == {
        "id": entry["id"],
        "server": "db.example.test",
        "port": 1433,
        "database": "Sales",
        "auth": "sql",
        "user": "reader",
    }
    assert "Sup3r" not in (server.data_dir / FILE_NAME).read_text(encoding="utf-8")
    assert "Sup3r" not in listing.decode("utf-8")


def test_a_connection_that_did_not_open_is_not_remembered(
    server: LauncherServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    failing_driver(monkeypatch, "Login failed for user 'reader'.", "pw")
    _, _, body = post(
        server, "/api/connection/test", {"connection": connection("pw"), "remember": True}
    )
    assert json.loads(body)["remembered"] is False
    assert not (server.data_dir / FILE_NAME).exists()


def test_a_failed_login_is_a_failed_check_with_the_right_fix(
    server: LauncherServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    failing_driver(monkeypatch, "Login failed for user 'reader'.", "pw")
    status, _, body = post(server, "/api/connection/test", {"connection": connection("pw")})
    assert status == 200
    answer = json.loads(body)
    assert answer["connected"] is False and answer["ok"] is False
    failed = [c for c in answer["checks"] if c["status"] == "fail"]
    assert [c["name"] for c in failed] == ["Connection"]
    assert failed[0]["message"].startswith("Login failed for database 'Sales'.")
    assert failed[0]["fix"] == (
        "Check the user name and password, and that the login can access the database."
    )


@pytest.mark.parametrize(
    ("text", "words"),
    [
        ("SSL certificate verify failed", "trusted certificate"),
        ("Connection timeout expired", "did not answer in time"),
        ("Client unable to establish connection", "Cannot reach"),
    ],
)
def test_each_failure_kind_gets_its_own_fix(
    server: LauncherServer, monkeypatch: pytest.MonkeyPatch, text: str, words: str
) -> None:
    failing_driver(monkeypatch, text, "pw")
    _, _, body = post(server, "/api/connection/test", {"connection": connection("pw")})
    [check] = [c for c in json.loads(body)["checks"] if c["status"] == "fail"]
    assert check["fix"]
    assert words in f"{check['message']} {check['fix']}"
    assert "Fix:" not in check["message"] and "Fix:" not in check["fix"]


def test_a_missing_driver_is_a_failed_driver_check_with_its_fix(
    server: LauncherServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    from schemamap.errors import DriverUnavailableError

    def broken() -> object:
        raise DriverUnavailableError("The SQL Server driver could not be loaded. Install X.")

    monkeypatch.setattr(doctor_module, "load_driver", broken)
    _, _, body = post(server, "/api/connection/test", {"connection": connection("pw")})
    answer = json.loads(body)
    assert [(c["name"], c["status"]) for c in answer["checks"]] == [("Driver", "fail")]
    assert answer["checks"][0]["message"] == "The SQL Server driver could not be loaded."
    assert answer["checks"][0]["fix"] == "Install X."


def test_databases_lists_the_names_the_login_can_open(
    server: LauncherServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(api_module, "connect", lambda _config: GreenConnection())
    status, _, body = post(server, "/api/databases", {"connection": connection("pw")})
    assert status == 200
    assert json.loads(body) == {"databases": [{"name": "Archive"}, {"name": "Sales"}]}


def test_databases_reports_a_failed_login_as_502_with_a_fix(
    server: LauncherServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    failing_driver(monkeypatch, "Login failed for user 'reader'.", "pw")
    status, _, body = post(server, "/api/databases", {"connection": connection("pw")})
    assert status == 502
    error = json.loads(body)["error"]
    assert error["code"] == "connect_failed"
    assert "Login failed" in error["message"]
    assert "Check the user name and password" in error["fix"]


def test_connections_can_be_listed_and_deleted(
    server: LauncherServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(doctor_module, "load_driver", lambda: object())
    monkeypatch.setattr(doctor_module, "connect", lambda _config: GreenConnection())
    for database in ("One", "Two"):
        post(
            server,
            "/api/connection/test",
            {"connection": connection("pw", database=database), "remember": True},
        )
    _, _, listing = request(server, "/api/connections", headers=AUTH)
    entries = json.loads(listing)["connections"]
    assert [e["database"] for e in entries] == ["Two", "One"]

    status, _, body = request(
        server, f"/api/connections/{entries[0]['id']}", method="DELETE", headers=AUTH
    )
    assert (status, json.loads(body)) == (200, {"deleted": True})
    _, _, listing = request(server, "/api/connections", headers=AUTH)
    assert [e["database"] for e in json.loads(listing)["connections"]] == ["One"]

    status, _, body = request(
        server, f"/api/connections/{entries[0]['id']}", method="DELETE", headers=AUTH
    )
    assert status == 404 and json.loads(body)["error"]["code"] == "not_found"


@pytest.mark.parametrize(
    "suffix", ["", "/", "/not-hex", "/ABCDEF0123456789ABCDEF0123456789", "/../x"]
)
def test_a_delete_without_a_well_formed_id_is_not_a_route(
    server: LauncherServer, suffix: str
) -> None:
    status, _, _ = request(server, f"/api/connections{suffix}", method="DELETE", headers=AUTH)
    assert status in (404, 405)


def test_an_empty_list_when_nothing_is_remembered(server: LauncherServer) -> None:
    status, _, body = request(server, "/api/connections", headers=AUTH)
    assert (status, json.loads(body)) == (200, {"connections": []})


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/api/connection/test"),
        ("POST", "/api/databases"),
        ("GET", "/api/connections"),
        ("DELETE", "/api/connections/" + "0" * 32),
    ],
)
def test_every_connection_route_needs_the_token(
    server: LauncherServer, method: str, path: str
) -> None:
    headers = {"Content-Type": "application/json", "Content-Length": "2"}
    body = b"{}" if method == "POST" else None
    status, _, answer = request(
        server, path, method=method, headers=headers if body else None, body=body
    )
    assert status == 401
    assert json.loads(answer)["error"]["code"] == "unauthorized"


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/connection/test"),
        ("GET", "/api/databases"),
        ("POST", "/api/connections"),
        ("PUT", "/api/connections"),
        ("GET", "/api/connections/" + "0" * 32),
    ],
)
def test_the_wrong_method_is_a_405_with_allow(
    server: LauncherServer, method: str, path: str
) -> None:
    status, headers, _ = request(server, path, method=method, headers=AUTH)
    assert status == 405
    assert headers["Allow"]


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"connection": "text"},
        {"connection": {"server": "s"}},
        {"connection": {"server": "s", "database": "d", "port": "x"}},
        {"connection": {"server": "s", "database": "d", "auth": "kerberos"}},
        {"connection": {"server": "s", "database": "d", "user": "u"}},
        {"connection": {"server": "s", "database": "d", "user": "u", "password": "p"}, "x": 1},
    ],
)
def test_a_bad_request_is_a_4xx_error_object(server: LauncherServer, payload: object) -> None:
    status, _, body = post(server, "/api/connection/test", payload)
    assert status in (400, 422)
    error = json.loads(body)["error"]
    assert set(error) == {"code", "message"}


def test_a_json_body_that_is_not_an_object_is_a_400(server: LauncherServer) -> None:
    status, _, _ = post_json(server, "/api/databases", b"[1]", **AUTH)
    assert status == 400


def test_an_unexpected_failure_is_a_generic_500_with_no_detail(
    server: LauncherServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    def boom(*_: object, **__: object) -> None:
        raise RuntimeError("the secret is hunter2-in-a-traceback")

    monkeypatch.setattr(server_module, "run_connection_test", boom)
    status, _, body = post(server, "/api/connection/test", {"connection": connection("pw")})
    assert status == 500
    assert json.loads(body) == {
        "error": {"code": "internal", "message": "Something went wrong inside Schema Map."}
    }


def test_a_refused_query_is_a_generic_500(
    server: LauncherServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    from schemamap.errors import QueryRefusedError

    def refuse(_config: object) -> None:
        raise QueryRefusedError("Query is not on the allowlist: hunter2.")

    monkeypatch.setattr(api_module, "connect", refuse)
    status, _, body = post(server, "/api/databases", {"connection": connection("pw")})
    assert status == 500 and b"hunter2" not in body


# -- the password never leaves ----------------------------------------------------------------


@pytest.mark.parametrize("password", HOSTILE_PASSWORDS)
@pytest.mark.parametrize("template", FAILURES)
def test_a_failed_connection_test_never_returns_the_password(
    server: LauncherServer,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    capfd: pytest.CaptureFixture[str],
    password: str,
    template: str,
) -> None:
    failing_driver(monkeypatch, template, password)
    with caplog.at_level(logging.DEBUG):
        status, _, body = post(
            server,
            "/api/connection/test",
            {"connection": connection(password), "remember": True},
        )
    assert status == 200
    assert json.loads(body)["connected"] is False
    assert_no_password(password, bodies=[body], server=server, caplog=caplog, capfd=capfd)


@pytest.mark.parametrize("password", HOSTILE_PASSWORDS)
@pytest.mark.parametrize("template", FAILURES)
def test_a_failed_database_list_never_returns_the_password(
    server: LauncherServer,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    capfd: pytest.CaptureFixture[str],
    password: str,
    template: str,
) -> None:
    failing_driver(monkeypatch, template, password)
    with caplog.at_level(logging.DEBUG):
        status, _, body = post(server, "/api/databases", {"connection": connection(password)})
    assert status == 502
    assert_no_password(password, bodies=[body], server=server, caplog=caplog, capfd=capfd)


@pytest.mark.parametrize("password", HOSTILE_PASSWORDS)
def test_a_remembered_connection_never_holds_the_password(
    server: LauncherServer,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    capfd: pytest.CaptureFixture[str],
    password: str,
) -> None:
    monkeypatch.setattr(doctor_module, "load_driver", lambda: object())
    monkeypatch.setattr(doctor_module, "connect", lambda _config: GreenConnection())
    with caplog.at_level(logging.DEBUG):
        _, _, tested = post(
            server,
            "/api/connection/test",
            {"connection": connection(password), "remember": True},
        )
        _, _, listing = request(server, "/api/connections", headers=AUTH)
    assert json.loads(tested)["remembered"] is True
    assert (server.data_dir / FILE_NAME).is_file()
    assert_no_password(
        password, bodies=[tested, listing], server=server, caplog=caplog, capfd=capfd
    )


@pytest.mark.parametrize("password", HOSTILE_PASSWORDS)
@pytest.mark.parametrize(
    "mutate",
    [
        {"port": "not a number"},
        {"auth": "nope"},
        {"server": 5},
        {"user": None},
        {"surprise": 1},
        {"trust_server_certificate": "maybe"},
    ],
)
def test_a_rejected_request_never_echoes_the_password_it_carried(
    server: LauncherServer,
    caplog: pytest.LogCaptureFixture,
    capfd: pytest.CaptureFixture[str],
    password: str,
    mutate: dict[str, Any],
) -> None:
    with caplog.at_level(logging.DEBUG):
        status, _, body = post(
            server, "/api/connection/test", {"connection": connection(password, **mutate)}
        )
    assert status in (400, 422)
    assert_no_password(password, bodies=[body], server=server, caplog=caplog, capfd=capfd)


@pytest.mark.parametrize("password", HOSTILE_PASSWORDS)
def test_an_internal_failure_that_quotes_the_password_is_not_sent(
    server: LauncherServer,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    capfd: pytest.CaptureFixture[str],
    password: str,
) -> None:
    def boom(*_: object, **__: object) -> None:
        raise RuntimeError(f"connection string was PWD={{{password}}}")

    monkeypatch.setattr(server_module, "list_databases", boom)
    with caplog.at_level(logging.DEBUG):
        status, _, body = post(server, "/api/databases", {"connection": connection(password)})
    assert status == 500
    assert_no_password(password, bodies=[body], server=server, caplog=caplog, capfd=capfd)


def test_the_server_keeps_no_reference_to_the_password(
    server: LauncherServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    secret = "Distinct-Marker-7f3a;pw"
    monkeypatch.setattr(doctor_module, "load_driver", lambda: object())
    monkeypatch.setattr(doctor_module, "connect", lambda _config: GreenConnection())
    post(server, "/api/connection/test", {"connection": connection(secret), "remember": True})
    for name, value in vars(server).items():
        assert secret not in repr(value), name


# -- capabilities -----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("platform", "name", "windows"),
    [("win32", "windows", True), ("darwin", "macos", False), ("linux", "linux", False)],
)
def test_capabilities_name_the_os_and_offer_windows_only_on_windows(
    platform: str, name: str, windows: bool
) -> None:
    answer = api_module.capabilities(platform)
    assert answer["os"] == name
    modes = answer["auth_modes"]
    assert isinstance(modes, list)
    ids = [mode["id"] for mode in modes]
    assert ("windows" in ids) is windows
    assert ids[0] == "sql"
    assert {i for i in ids if i.startswith("entra-")} == {
        "entra-password",
        "entra-interactive",
        "entra-default",
        "entra-integrated",
    }
    by_id = {mode["id"]: mode for mode in modes}
    assert by_id["sql"]["needs_user"] is True and by_id["sql"]["needs_password"] is True
    assert by_id["entra-interactive"]["needs_password"] is False
    assert by_id["entra-integrated"]["needs_user"] is False
    for mode in modes:
        assert isinstance(mode["label"], str) and mode["label"]
        assert mode["group"] in ("sql", "windows", "entra")


def test_capabilities_route_needs_the_token_and_answers_json(tmp_path: Path) -> None:
    with serving(tmp_path) as (server, _):
        assert request(server, "/api/capabilities")[0] == 401
        status, _, body = request(server, "/api/capabilities", headers=AUTH)
        assert status == 200
        answer = json.loads(body)
        assert set(answer) == {"os", "auth_modes"}
        assert request(server, "/api/capabilities", method="POST", headers=AUTH)[0] == 405
