"""The connection routes against the lab SQL Server, through a real launcher server.

Needs the lab up and restored: `uv run tools/lab.py up && uv run tools/lab.py restore all`.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from types import ModuleType

import pytest
from test_ui_connection_routes import HOSTILE_PASSWORDS, forms
from ui_http import TOKEN, post_json, request, serving

from schemamap.ui.connections import FILE_NAME
from schemamap.ui.server import LauncherServer

pytestmark = pytest.mark.integration

AUTH = {"X-SchemaMap-Token": TOKEN}


@pytest.fixture
def server(tmp_path: Path) -> Iterator[LauncherServer]:
    with serving(tmp_path) as (running, _):
        yield running


def lab_connection(
    lab: ModuleType, password: str, database: str = "AdventureWorks2022"
) -> dict[str, object]:
    return {
        "server": lab.HOST,
        "port": lab.HOST_PORT,
        "database": database,
        "user": lab.READER_LOGIN,
        "password": password,
        "trust_server_certificate": True,
    }


def post(server: LauncherServer, path: str, payload: object) -> tuple[int, bytes]:
    status, _, body = post_json(server, path, json.dumps(payload).encode("utf-8"), **AUTH)
    return status, body


def test_the_reader_login_tests_green(
    server: LauncherServer, lab: ModuleType, passwords: tuple[str, str]
) -> None:
    status, body = post(
        server,
        "/api/connection/test",
        {"connection": lab_connection(lab, passwords[1]), "remember": True},
    )
    assert status == 200
    answer = json.loads(body)
    assert answer["connected"] is True and answer["ok"] is True and answer["remembered"] is True
    statuses = {c["name"]: c["status"] for c in answer["checks"]}
    assert statuses["Driver"] == statuses["Connection"] == statuses["Server"] == "ok"
    assert statuses["VIEW DEFINITION"] == "ok"
    assert "fail" not in statuses.values()
    assert passwords[1].encode() not in body

    text = (server.data_dir / FILE_NAME).read_text(encoding="utf-8")
    assert passwords[1] not in text and lab.READER_LOGIN in text


def test_a_wrong_password_fails_the_connection_check_with_the_right_fix(
    server: LauncherServer, lab: ModuleType, passwords: tuple[str, str]
) -> None:
    wrong = "Wrong" + passwords[1]
    status, body = post(
        server, "/api/connection/test", {"connection": lab_connection(lab, wrong), "remember": True}
    )
    assert status == 200
    answer = json.loads(body)
    assert answer["connected"] is False and answer["ok"] is False
    assert answer["remembered"] is False
    [failed] = [c for c in answer["checks"] if c["status"] == "fail"]
    assert failed["name"] == "Connection"
    assert failed["fix"] == (
        "Check the user name and password, and that the login can access the database."
    )
    assert wrong.encode() not in body and passwords[1].encode() not in body
    assert not (server.data_dir / FILE_NAME).exists()


@pytest.mark.parametrize("password", HOSTILE_PASSWORDS)
def test_a_hostile_password_fails_cleanly_and_never_comes_back(
    server: LauncherServer, lab: ModuleType, passwords: tuple[str, str], password: str
) -> None:
    connection = lab_connection(lab, password)
    results = [
        post(server, "/api/connection/test", {"connection": connection, "remember": True}),
        post(server, "/api/databases", {"connection": connection}),
    ]
    assert [status for status, _ in results] == [200, 502]
    assert json.loads(results[0][1])["connected"] is False
    for _, body in results:
        text = body.decode("utf-8")
        for form in [*forms(password), passwords[0], passwords[1]]:
            assert form not in text
        assert "PWD=" not in text
    assert not (server.data_dir / FILE_NAME).exists()


def test_the_database_list_has_both_sample_databases(
    server: LauncherServer, lab: ModuleType, passwords: tuple[str, str]
) -> None:
    status, body = post(
        server, "/api/databases", {"connection": lab_connection(lab, passwords[1], "master")}
    )
    assert status == 200
    names = [d["name"] for d in json.loads(body)["databases"]]
    assert "AdventureWorks2022" in names and "WideWorldImporters" in names
    assert not {"master", "tempdb", "model", "msdb"} & set(names)
    assert names == sorted(names, key=lambda n: (n.casefold(), n))


def test_system_databases_are_listed_only_when_asked(
    server: LauncherServer, lab: ModuleType, passwords: tuple[str, str]
) -> None:
    status, body = post(
        server,
        "/api/databases",
        {"connection": lab_connection(lab, passwords[1], "master"), "include_system": True},
    )
    assert status == 200
    names = {d["name"] for d in json.loads(body)["databases"]}
    assert {"master", "AdventureWorks2022", "WideWorldImporters"} <= names


def test_the_database_defaults_to_master(
    server: LauncherServer, lab: ModuleType, passwords: tuple[str, str]
) -> None:
    connection = lab_connection(lab, passwords[1])
    del connection["database"]
    status, body = post(server, "/api/databases", {"connection": connection})
    assert status == 200
    assert "AdventureWorks2022" in [d["name"] for d in json.loads(body)["databases"]]


def test_a_wrong_password_for_the_database_list_is_a_502_with_the_fix(
    server: LauncherServer, lab: ModuleType, passwords: tuple[str, str]
) -> None:
    wrong = "Wrong" + passwords[1]
    status, body = post(server, "/api/databases", {"connection": lab_connection(lab, wrong)})
    assert status == 502
    error = json.loads(body)["error"]
    assert error["code"] == "connect_failed"
    assert "Check the user name and password" in error["fix"]
    assert wrong.encode() not in body


def test_a_remembered_connection_is_listed_and_can_be_forgotten(
    server: LauncherServer, lab: ModuleType, passwords: tuple[str, str]
) -> None:
    post(
        server,
        "/api/connection/test",
        {"connection": lab_connection(lab, passwords[1]), "remember": True},
    )
    _, _, listing = request(server, "/api/connections", headers=AUTH)
    [entry] = json.loads(listing)["connections"]
    assert (entry["server"], entry["port"], entry["database"], entry["user"]) == (
        lab.HOST,
        lab.HOST_PORT,
        "AdventureWorks2022",
        lab.READER_LOGIN,
    )
    assert passwords[1].encode() not in listing
    status, _, _ = request(server, f"/api/connections/{entry['id']}", method="DELETE", headers=AUTH)
    assert status == 200
    _, _, listing = request(server, "/api/connections", headers=AUTH)
    assert json.loads(listing) == {"connections": []}


def test_a_login_without_view_definition_fails_on_the_chosen_database(
    server: LauncherServer, lab: ModuleType, passwords: tuple[str, str]
) -> None:
    """VIEW DEFINITION is judged on the database sent, and the script names it."""
    sa, reader = passwords
    database = "AdventureWorks2022"
    revoke = f"USE [{database}];\nGO\nREVOKE VIEW DEFINITION FROM [{lab.READER_MIN_LOGIN}];\nGO\n"
    done = lab.run_sqlcmd("sa", sa, script_text=revoke, extra_env={lab.ENV_READER: reader})
    assert done.returncode == 0, done.stdout + done.stderr
    try:
        connection = lab_connection(lab, reader, database) | {"user": lab.READER_MIN_LOGIN}
        _, body = post(server, "/api/connection/test", {"connection": connection})
        checks = {c["name"]: c for c in json.loads(body)["checks"]}
        definition = checks["VIEW DEFINITION"]
        assert definition["status"] == "fail" and definition["scope"] == "database"
        assert definition["fix_sql"].startswith("USE [AdventureWorks2022];\n")
        del connection["database"]
        _, body = post(server, "/api/connection/test", {"connection": connection})
        assert "VIEW DEFINITION" not in {c["name"] for c in json.loads(body)["checks"]}
    finally:
        lab.grant_reader(lab.load_credentials(), database, False)
