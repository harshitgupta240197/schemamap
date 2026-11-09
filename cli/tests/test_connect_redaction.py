import logging
import traceback
from typing import Any

import pytest

from schemamap.connect import ConnectionConfig, MetadataExecutor, connect, redact
from schemamap.connect import connection as connection_module
from schemamap.errors import ConnectError
from schemamap.queries import QueryName

PASSWORD = "Sup3rSecret;pw"


def make_config() -> ConnectionConfig:
    return ConnectionConfig(
        server="db.example.test", database="Sales", user="reader", password=PASSWORD
    )


class FakeDriver:
    """Stands in for mssql_python; fails the way a real driver might, echoing secrets."""

    def __init__(self, message: str) -> None:
        self.message = message

    def connect(self, connection_string: str, **_: Any) -> Any:
        raise RuntimeError(self.message.format(conn=connection_string, pw=PASSWORD))


@pytest.mark.parametrize(
    "message",
    [
        "Login failed for user 'reader'. PWD={pw}",
        "bad string: {conn}",
        "boom {pw} boom",
    ],
)
def test_connect_error_never_contains_secrets(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, message: str
) -> None:
    config = make_config()
    monkeypatch.setattr(connection_module, "load_driver", lambda: FakeDriver(message))
    with caplog.at_level(logging.DEBUG), pytest.raises(ConnectError) as info:
        connect(config)
    error = info.value
    rendered = "".join(traceback.format_exception(error))
    for text in (str(error), repr(error), rendered, caplog.text):
        assert PASSWORD not in text
        assert config.connection_string() not in text
        assert "PWD=" not in text
    assert error.__cause__ is None
    assert error.__context__ is None


def test_login_failure_gets_plain_hint(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        connection_module, "load_driver", lambda: FakeDriver("Login failed for user 'reader'.")
    )
    with pytest.raises(ConnectError, match="Check the user name and password"):
        connect(make_config())


def test_certificate_failure_suggests_trust_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        connection_module, "load_driver", lambda: FakeDriver("SSL certificate verify failed")
    )
    with pytest.raises(ConnectError, match="--trust-server-certificate"):
        connect(make_config())


def test_redact_masks_longest_first_and_ignores_empty() -> None:
    assert redact("abc abcdef", ["abc", "abcdef", ""]) == "*** ***"


def test_redact_masks_pwd_fragments_even_for_unknown_passwords() -> None:
    assert redact("x PWD={other;}}pw};Database=d", []) == "x ***;Database=d"
    assert redact("password = hunter2 end", []) == "*** end"


class FakeCursor:
    def __init__(self) -> None:
        self.closed = False
        self.sql = ""

    def execute(self, sql: str) -> None:
        self.sql = sql

    def fetchall(self) -> list[list[int]]:
        return [[1, 2]]

    def close(self) -> None:
        self.closed = True


class FakeDriverConnection:
    def __init__(self) -> None:
        self.cursor_obj = FakeCursor()
        self.closed = False
        self.timeout = 0

    def cursor(self) -> FakeCursor:
        return self.cursor_obj

    def close(self) -> None:
        self.closed = True


def test_successful_connect_sets_timeouts_and_runs_named_query(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    raw = FakeDriverConnection()
    seen: dict[str, Any] = {}

    class Driver:
        def connect(self, text: str, **kwargs: Any) -> FakeDriverConnection:
            seen.update(kwargs, text=text)
            return raw

    monkeypatch.setattr(connection_module, "load_driver", lambda: Driver())
    with connect(make_config()) as conn:
        assert isinstance(conn, MetadataExecutor)
        assert conn.run(QueryName.DOCTOR_SERVER_INFO) == [(1, 2)]
        assert not hasattr(conn, "cursor")
    assert raw.cursor_obj.closed
    assert raw.closed
    assert raw.timeout == 60
    assert seen["autocommit"] is True
    assert seen["timeout"] == 15
    assert "ApplicationIntent={ReadOnly}" in seen["text"]
