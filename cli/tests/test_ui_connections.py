"""Remembered connections: five settings, never a password, whatever the file or caller does."""

from __future__ import annotations

import json
import os
import stat
import sys
from pathlib import Path

import jsonschema
import pytest

from schemamap.connect import AuthMode, ConnectionConfig
from schemamap.ui.connections import (
    FILE_NAME,
    FILE_SCHEMA,
    MAX_REMEMBERED,
    ConnectionStore,
    connection_id,
)

PASSWORD = "Sup3r;Secret}pw"


def config(**changes: object) -> ConnectionConfig:
    settings: dict[str, object] = {
        "server": "db.example.test",
        "port": 1433,
        "database": "Sales",
        "user": "reader",
        "password": PASSWORD,
    }
    return ConnectionConfig(**(settings | changes))  # type: ignore[arg-type]


def saved(directory: Path) -> dict[str, object]:
    loaded: dict[str, object] = json.loads((directory / FILE_NAME).read_text(encoding="utf-8"))
    return loaded


def test_a_new_store_has_nothing_and_writes_nothing(tmp_path: Path) -> None:
    assert ConnectionStore(tmp_path).entries() == []
    assert not (tmp_path / FILE_NAME).exists()


def test_remember_saves_the_five_settings_and_nothing_else(tmp_path: Path) -> None:
    entry = ConnectionStore(tmp_path).remember(config())
    assert saved(tmp_path) == {
        "version": 1,
        "connections": [
            {
                "id": entry.id,
                "server": "db.example.test",
                "port": 1433,
                "database": "Sales",
                "auth": "sql",
                "user": "reader",
            }
        ],
    }
    text = (tmp_path / FILE_NAME).read_text(encoding="utf-8")
    assert PASSWORD not in text
    assert "password" not in text.lower()
    assert "trust" not in text.lower()


def test_the_file_matches_the_schema_and_the_schema_has_no_password_field(tmp_path: Path) -> None:
    store = ConnectionStore(tmp_path)
    store.remember(config())
    store.remember(config(auth=AuthMode.ENTRA_INTERACTIVE, user=None, password=None))
    jsonschema.validate(saved(tmp_path), FILE_SCHEMA)

    item = FILE_SCHEMA["properties"]["connections"]["items"]  # type: ignore[index]
    assert item["additionalProperties"] is False
    assert set(item["properties"]) == {"id", "server", "port", "database", "auth", "user"}
    assert FILE_SCHEMA["additionalProperties"] is False


@pytest.mark.parametrize("extra", ["password", "pwd", "Password", "token", "trust"])
def test_the_schema_rejects_a_file_that_carries_an_extra_field(tmp_path: Path, extra: str) -> None:
    store = ConnectionStore(tmp_path)
    store.remember(config())
    document = saved(tmp_path)
    document["connections"][0][extra] = "x"  # type: ignore[index]
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(document, FILE_SCHEMA)


def test_a_password_added_by_hand_is_dropped_on_the_next_write(tmp_path: Path) -> None:
    store = ConnectionStore(tmp_path)
    first = store.remember(config())
    document = saved(tmp_path)
    document["connections"][0]["password"] = "hand-added-secret"  # type: ignore[index]
    document["password"] = "top-level-secret"
    (tmp_path / FILE_NAME).write_text(json.dumps(document), encoding="utf-8")

    assert [item.id for item in store.entries()] == [first.id]
    store.remember(config(database="Other"))
    assert "secret" not in (tmp_path / FILE_NAME).read_text(encoding="utf-8")


def test_a_windows_style_mode_keeps_no_user(tmp_path: Path) -> None:
    entry = ConnectionStore(tmp_path).remember(
        config(auth=AuthMode.ENTRA_DEFAULT, user="someone", password="ignored")
    )
    assert entry.user is None
    assert saved(tmp_path)["connections"][0]["user"] is None  # type: ignore[index]
    assert "someone" not in (tmp_path / FILE_NAME).read_text(encoding="utf-8")


def test_remembering_the_same_connection_again_moves_it_first(tmp_path: Path) -> None:
    store = ConnectionStore(tmp_path)
    one = store.remember(config(database="One"))
    two = store.remember(config(database="Two"))
    assert [item.id for item in store.entries()] == [two.id, one.id]
    again = store.remember(config(database="One", password="a different password"))
    assert again.id == one.id
    assert [item.id for item in store.entries()] == [one.id, two.id]


def test_only_the_newest_entries_are_kept(tmp_path: Path) -> None:
    store = ConnectionStore(tmp_path)
    for number in range(MAX_REMEMBERED + 5):
        store.remember(config(database=f"Db{number}"))
    entries = store.entries()
    assert len(entries) == MAX_REMEMBERED
    assert entries[0].database == f"Db{MAX_REMEMBERED + 4}"


def test_forget_removes_one_entry_and_reports_a_missing_one(tmp_path: Path) -> None:
    store = ConnectionStore(tmp_path)
    one = store.remember(config(database="One"))
    two = store.remember(config(database="Two"))
    assert store.forget(one.id) is True
    assert [item.id for item in store.entries()] == [two.id]
    assert store.forget(one.id) is False
    assert store.forget("0" * 32) is False


def test_ids_are_stable_hex_and_depend_on_every_setting() -> None:
    base = connection_id("s", 1433, "d", AuthMode.SQL, "u")
    assert base == connection_id("s", 1433, "d", AuthMode.SQL, "u")
    assert len(base) == 32 and set(base) <= set("0123456789abcdef")
    variants = [
        connection_id("s2", 1433, "d", AuthMode.SQL, "u"),
        connection_id("s", 1434, "d", AuthMode.SQL, "u"),
        connection_id("s", 1433, "d2", AuthMode.SQL, "u"),
        connection_id("s", 1433, "d", AuthMode.ENTRA_PASSWORD, "u"),
        connection_id("s", 1433, "d", AuthMode.SQL, "u2"),
        connection_id("s", 1433, "d", AuthMode.SQL, None),
    ]
    assert len({base, *variants}) == 7


@pytest.mark.parametrize(
    "content",
    [
        b"",
        b"not json",
        b"[]",
        b'{"connections": "no"}',
        b'{"connections": [1, null, "x", {}]}',
        b'{"connections": [{"server": "s", "port": true, "database": "d", "auth": "sql"}]}',
        b'{"connections": [{"server": "s", "port": 0, "database": "d", "auth": "sql"}]}',
        b'{"connections": [{"server": "s", "port": 1, "database": "d", "auth": "magic"}]}',
        b'{"connections": [{"server": "", "port": 1, "database": "d", "auth": "sql"}]}',
        b'{"connections": [{"server": "s", "port": 1, "database": "d", "auth": "sql", "user": 5}]}',
        b"[" * 100000,
    ],
)
def test_a_damaged_file_reads_as_empty_and_is_replaced_on_the_next_save(
    tmp_path: Path, content: bytes
) -> None:
    (tmp_path / FILE_NAME).write_bytes(content)
    store = ConnectionStore(tmp_path)
    assert store.entries() == []
    store.remember(config())
    assert len(store.entries()) == 1


def test_good_entries_survive_beside_bad_ones(tmp_path: Path) -> None:
    good = {"server": "s", "port": 1, "database": "d", "auth": "sql", "user": "u"}
    document = {"version": 1, "connections": [{"server": 1}, good, good, "x"]}
    (tmp_path / FILE_NAME).write_text(json.dumps(document), encoding="utf-8")
    assert [(e.server, e.user) for e in ConnectionStore(tmp_path).entries()] == [("s", "u")]


def test_a_huge_file_is_ignored_not_read(tmp_path: Path) -> None:
    (tmp_path / FILE_NAME).write_bytes(b" " * (300 * 1024))
    assert ConnectionStore(tmp_path).entries() == []


def test_the_data_folder_is_made_when_it_is_missing(tmp_path: Path) -> None:
    folder = tmp_path / "not" / "yet"
    ConnectionStore(folder).remember(config())
    assert (folder / FILE_NAME).is_file()


@pytest.mark.skipif(sys.platform.startswith("win"), reason="POSIX file modes")
def test_the_file_is_readable_only_by_its_owner(tmp_path: Path) -> None:
    ConnectionStore(tmp_path).remember(config())
    mode = stat.S_IMODE(os.stat(tmp_path / FILE_NAME).st_mode)
    assert mode == 0o600


def test_nothing_but_the_file_is_left_in_the_folder(tmp_path: Path) -> None:
    store = ConnectionStore(tmp_path)
    store.remember(config())
    store.forget(store.entries()[0].id)
    assert [item.name for item in tmp_path.iterdir()] == [FILE_NAME]
