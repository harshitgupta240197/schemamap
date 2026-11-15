"""Connection request parsing and the databases answer, without a socket."""

from __future__ import annotations

from http import HTTPStatus
from typing import Any

import pytest

from schemamap.connect import AuthMode
from schemamap.queries import QueryName
from schemamap.ui import api as api_module
from schemamap.ui.api import (
    ApiError,
    list_databases,
    parse_connection,
    parse_databases_request,
    parse_test_request,
)

BASE: dict[str, object] = {
    "server": "db.example.test",
    "database": "Sales",
    "user": "reader",
    "password": "Sup3rSecret",
}


def refusal(call: Any, *args: Any, **kwargs: Any) -> ApiError:
    with pytest.raises(ApiError) as info:
        call(*args, **kwargs)
    assert isinstance(info.value, ApiError)
    return info.value


def test_a_minimal_connection_gets_the_defaults() -> None:
    config = parse_connection(BASE)
    assert (config.server, config.database, config.port) == ("db.example.test", "Sales", 1433)
    assert config.auth is AuthMode.SQL
    assert config.trust_server_certificate is False
    assert (config.connect_timeout, config.query_timeout) == (15, 60)
    assert config.password == "Sup3rSecret"


def test_every_field_is_read() -> None:
    config = parse_connection(
        BASE
        | {
            "port": 14330,
            "auth": "entra-password",
            "trust_server_certificate": True,
            "connect_timeout": 5,
            "query_timeout": 90,
        }
    )
    assert config.port == 14330
    assert config.auth is AuthMode.ENTRA_PASSWORD
    assert config.trust_server_certificate is True
    assert (config.connect_timeout, config.query_timeout) == (5, 90)


def test_text_is_trimmed_but_the_password_is_kept_exactly() -> None:
    config = parse_connection(
        BASE | {"server": "  db  ", "database": " d ", "user": " u ", "password": "  pw  "}
    )
    assert (config.server, config.database, config.user, config.password) == (
        "db",
        "d",
        "u",
        "  pw  ",
    )


@pytest.mark.parametrize(
    ("change", "field"),
    [
        ({"server": 5}, "server"),
        ({"server": None}, "server"),
        ({"database": 5}, "database"),
        ({"user": 5}, "user"),
        ({"password": 5}, "password"),
        ({"password": ["a"]}, "password"),
        ({"auth": 5}, "auth"),
        ({"port": "1433"}, "port"),
        ({"port": True}, "port"),
        ({"port": 1.5}, "port"),
        ({"port": 0}, "port"),
        ({"port": 70000}, "port"),
        ({"trust_server_certificate": "yes"}, "trust_server_certificate"),
        ({"connect_timeout": 0}, "connect_timeout"),
        ({"query_timeout": 100000}, "query_timeout"),
        ({"server": "x" * 300}, "server"),
        ({"server": "a\x00b"}, "server"),
        ({"password": "a\x00b"}, "password"),
        ({"password": "p" * 2000}, "password"),
    ],
)
def test_a_wrongly_typed_or_out_of_range_field_is_a_400_that_names_only_the_field(
    change: dict[str, object], field: str
) -> None:
    error = refusal(parse_connection, BASE | change)
    assert (error.status, error.code) == (HTTPStatus.BAD_REQUEST, "bad_request")
    assert f"'{field}'" in error.message
    assert "Sup3rSecret" not in error.message


@pytest.mark.parametrize("value", [None, "text", 5, [], [BASE]])
def test_the_connection_must_be_an_object(value: object) -> None:
    assert refusal(parse_connection, value).status is HTTPStatus.BAD_REQUEST


def test_a_missing_server_or_database_is_a_400() -> None:
    assert "'server'" in refusal(parse_connection, {"database": "d"}).message
    assert "'database'" in refusal(parse_connection, {"server": "s"}).message


def test_an_unknown_field_is_refused_without_naming_it() -> None:
    error = refusal(parse_connection, BASE | {"hunter2-is-my-key": "x"})
    assert error.status is HTTPStatus.BAD_REQUEST
    assert "hunter2" not in error.message


def test_an_unknown_auth_mode_is_a_422() -> None:
    error = refusal(parse_connection, BASE | {"auth": "kerberos-ish"})
    assert (error.status, error.code) == (HTTPStatus.UNPROCESSABLE_ENTITY, "invalid")
    assert "kerberos" not in error.message


@pytest.mark.parametrize(
    ("change", "words"),
    [
        ({"password": None}, "needs a password"),
        ({"password": ""}, "needs a password"),
        ({"user": None}, "needs a user"),
        ({"user": "   "}, "needs a user"),
        ({"server": "   "}, "No server"),
        ({"database": "   "}, "No database"),
    ],
)
def test_a_combination_the_settings_refuse_is_a_422_with_their_message(
    change: dict[str, object], words: str
) -> None:
    error = refusal(parse_connection, BASE | change)
    assert (error.status, error.code) == (HTTPStatus.UNPROCESSABLE_ENTITY, "invalid")
    assert words in error.message


def test_a_mode_without_a_password_needs_none() -> None:
    config = parse_connection(
        {"server": "s", "database": "d", "auth": "entra-default", "password": "unused"}
    )
    assert config.auth is AuthMode.ENTRA_DEFAULT


def test_the_test_request_takes_a_connection_and_a_remember_flag() -> None:
    config, remember = parse_test_request({"connection": BASE})
    assert config.database == "Sales" and remember is False
    assert parse_test_request({"connection": BASE, "remember": True})[1] is True
    assert refusal(parse_test_request, {"connection": BASE, "remember": "yes"}).status == 400
    assert refusal(parse_test_request, {"connection": BASE, "include_system": True}).status == 400
    assert refusal(parse_test_request, {}).status == 400


def test_the_databases_request_defaults_the_database_to_master() -> None:
    body: dict[str, object] = {"connection": {k: v for k, v in BASE.items() if k != "database"}}
    config, include_system = parse_databases_request(body)
    assert config.database == "master" and include_system is False
    assert parse_databases_request({"connection": BASE, "include_system": True})[1] is True
    assert refusal(parse_databases_request, {"connection": BASE, "remember": True}).status == 400
    assert refusal(parse_databases_request, {"connection": BASE, "include_system": 1}).status == 400


class FakeExecutor:
    def __init__(self, rows: list[tuple[Any, ...]]) -> None:
        self.rows = rows
        self.calls: list[tuple[QueryName, dict[str, int | str] | None]] = []

    def run(
        self, query: QueryName, params: dict[str, int | str] | None = None
    ) -> list[tuple[Any, ...]]:
        self.calls.append((query, params))
        return self.rows

    def __enter__(self) -> FakeExecutor:
        return self

    def __exit__(self, *_: object) -> None:
        return None


def test_databases_are_sorted_without_regard_to_case_and_deduplicated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    executor = FakeExecutor([("zeta",), ("Alpha",), ("beta",), ("Alpha",), ("Beta",)])
    monkeypatch.setattr(api_module, "connect", lambda _config: executor)
    answer = list_databases(parse_connection(BASE), include_system=False)
    assert answer == {
        "databases": [{"name": n} for n in ["Alpha", "Beta", "beta", "zeta"]],
    }
    assert executor.calls == [(QueryName.DATABASES, {"include_system": 0})]


def test_include_system_is_bound_as_one(monkeypatch: pytest.MonkeyPatch) -> None:
    executor = FakeExecutor([])
    monkeypatch.setattr(api_module, "connect", lambda _config: executor)
    assert list_databases(parse_connection(BASE), include_system=True) == {"databases": []}
    assert executor.calls == [(QueryName.DATABASES, {"include_system": 1})]
