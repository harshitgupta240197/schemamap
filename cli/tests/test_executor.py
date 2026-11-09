"""MetadataExecutor: runs only named, allowlisted queries with bound parameters."""

from typing import Any

import pytest

from schemamap.connect import executor as executor_module
from schemamap.connect.executor import MetadataExecutor, bind_params
from schemamap.errors import QueryRefusedError
from schemamap.queries import QueryName, load_query


class FakeCursor:
    def __init__(self) -> None:
        self.calls: list[tuple[Any, ...]] = []
        self.closed = False

    def execute(self, *args: Any) -> None:
        self.calls.append(args)

    def fetchall(self) -> list[list[Any]]:
        return [["a", 1]]

    def close(self) -> None:
        self.closed = True


class FakeDriverConnection:
    def __init__(self) -> None:
        self.cursors: list[FakeCursor] = []
        self.closed = False

    def cursor(self) -> FakeCursor:
        cursor = FakeCursor()
        self.cursors.append(cursor)
        return cursor

    def close(self) -> None:
        self.closed = True


@pytest.mark.parametrize(
    "query", ["SELECT name FROM sys.tables", "doctor_server_info", b"SELECT 1", None]
)
def test_refuses_raw_sql_text(query: Any) -> None:
    raw = FakeDriverConnection()
    with pytest.raises(QueryRefusedError, match="only named queries"):
        MetadataExecutor(raw).run(query)
    assert raw.cursors == []


def test_runs_a_named_query_and_closes_the_cursor() -> None:
    raw = FakeDriverConnection()
    with MetadataExecutor(raw) as executor:
        rows = executor.run(QueryName.DOCTOR_SERVER_INFO)
    assert rows == [("a", 1)]
    (cursor,) = raw.cursors
    assert cursor.calls == [(load_query(QueryName.DOCTOR_SERVER_INFO),)]
    assert cursor.closed
    assert raw.closed


def test_rechecks_the_file_against_the_allowlist_before_running(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(executor_module, "load_query", lambda _n: "SELECT * FROM dbo.Customers;")
    raw = FakeDriverConnection()
    with pytest.raises(QueryRefusedError, match=r"dbo\.Customers is not a system object"):
        MetadataExecutor(raw).run(QueryName.DOCTOR_SERVER_INFO)
    assert raw.cursors == []


def test_binds_parameters_positionally_never_formatting_them(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sql = (
        "-- params: schema_id, name\nSELECT name FROM sys.tables WHERE schema_id = ? AND name = ?;"
    )
    monkeypatch.setattr(executor_module, "load_query", lambda _n: sql)
    raw = FakeDriverConnection()
    hostile = "x'; DROP TABLE dbo.Customers; --"
    MetadataExecutor(raw).run(QueryName.DOCTOR_SERVER_INFO, {"name": hostile, "schema_id": 5})
    assert raw.cursors[0].calls == [(sql, (5, hostile))]


def test_closes_the_cursor_when_the_driver_fails() -> None:
    class FailingCursor(FakeCursor):
        def execute(self, *args: Any) -> None:
            raise RuntimeError("driver error")

    class Raw(FakeDriverConnection):
        def cursor(self) -> FakeCursor:
            cursor = FailingCursor()
            self.cursors.append(cursor)
            return cursor

    raw = Raw()
    with pytest.raises(RuntimeError):
        MetadataExecutor(raw).run(QueryName.DOCTOR_PERMISSIONS)
    assert raw.cursors[0].closed


def test_bind_params_orders_by_declaration() -> None:
    assert bind_params(("b", "a"), {"a": 1, "b": "x"}) == ("x", 1)
    assert bind_params((), {}) == ()


@pytest.mark.parametrize(
    ("declared", "params", "message"),
    [
        (("a",), {}, r"missing \['a'\]"),
        ((), {"a": 1}, r"unexpected \['a'\]"),
        (("a",), {"a": 1.5}, "must be str or int, not float"),
        (("a",), {"a": True}, "must be str or int, not bool"),
        (("a",), {"a": None}, "must be str or int, not NoneType"),
    ],
)
def test_bind_params_refuses_mismatches(
    declared: tuple[str, ...], params: dict[str, Any], message: str
) -> None:
    with pytest.raises(QueryRefusedError, match=message):
        bind_params(declared, params)
