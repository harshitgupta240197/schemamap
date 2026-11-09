import pytest

from schemamap.queries import load_query


@pytest.mark.parametrize("name", ["doctor_server_info", "doctor_permissions", "doctor_query_store"])
def test_doctor_queries_are_select_only(name: str) -> None:
    body = "\n".join(
        line for line in load_query(name).splitlines() if not line.startswith("--")
    ).strip()
    assert body.upper().startswith("SELECT")
    assert body.count(";") == 1
    assert body.endswith(";")


@pytest.mark.parametrize("name", ["../x", "a/b", "Doctor", "", "x.sql"])
def test_unsafe_query_names_are_rejected(name: str) -> None:
    with pytest.raises(ValueError, match="invalid query name"):
        load_query(name)


def test_missing_query_raises() -> None:
    with pytest.raises(FileNotFoundError):
        load_query("does_not_exist")
