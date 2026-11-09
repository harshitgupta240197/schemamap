from importlib import resources

import pytest

from schemamap.errors import QueryRefusedError
from schemamap.queries import QueryName, load_query, query_params


def sql_files() -> set[str]:
    folder = resources.files("schemamap.queries")
    return {entry.name[: -len(".sql")] for entry in folder.iterdir() if entry.name.endswith(".sql")}


def test_query_name_enum_matches_sql_files_exactly() -> None:
    assert {member.value for member in QueryName} == sql_files()


@pytest.mark.parametrize("name", list(QueryName))
def test_every_query_name_loads(name: QueryName) -> None:
    assert load_query(name).strip()


@pytest.mark.parametrize("name", ["doctor_server_info", "SELECT 1", "../x"])
def test_load_query_refuses_anything_but_a_query_name(name: str) -> None:
    with pytest.raises(QueryRefusedError, match="QueryName only"):
        load_query(name)  # type: ignore[arg-type]


def test_query_params_reads_the_header_in_order() -> None:
    sql = "-- About.\n-- params: schema_id, object_name\nSELECT 1 FROM sys.tables;"
    assert query_params(sql) == ("schema_id", "object_name")


def test_query_params_defaults_to_none() -> None:
    assert query_params("SELECT 1 FROM sys.tables;") == ()


@pytest.mark.parametrize(
    ("header", "message"),
    [
        ("-- params: a\n-- params: b\n", "only once"),
        ("-- params: Bad-Name\n", "Invalid parameter name"),
        ("-- params: a,\n", "Invalid parameter name"),
        ("-- params: a, a\n", "declared twice"),
    ],
)
def test_query_params_refuses_malformed_headers(header: str, message: str) -> None:
    with pytest.raises(QueryRefusedError, match=message):
        query_params(header + "SELECT 1 FROM sys.tables;")
