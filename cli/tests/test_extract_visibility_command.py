"""`schemamap extract` for the three VIEW DEFINITION cases, with the database faked out."""

from __future__ import annotations

from pathlib import Path

import pytest
from test_extract_command import ARGS, fake_database, run, snapshot

from schemamap import cli
from schemamap.errors import NoVisibleObjectsError
from schemamap.extract.visibility import no_visible_objects_error, partial_visibility_warning
from schemamap.snapshot.models import AppliedFilters


@pytest.fixture(autouse=True)
def in_tmp(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.chdir(tmp_path)
    return tmp_path


def test_case_a_exits_3_names_the_permission_and_writes_no_file(
    monkeypatch: pytest.MonkeyPatch, in_tmp: Path
) -> None:
    fake_database(monkeypatch, no_visible_objects_error("app_user"))
    result = run(ARGS)
    assert result.exit_code == 3
    assert "VIEW DEFINITION" in result.output
    assert "GRANT VIEW DEFINITION TO [app_user];" in result.output
    assert "may differ from the login name" in result.output
    assert list(in_tmp.iterdir()) == []


def test_case_a_error_is_a_no_visible_objects_error() -> None:
    assert isinstance(no_visible_objects_error(None), NoVisibleObjectsError)


def test_case_b_prints_the_partial_map_warning_first_and_names_the_database_user(
    monkeypatch: pytest.MonkeyPatch, in_tmp: Path
) -> None:
    fake_database(monkeypatch, snapshot(warnings=(partial_visibility_warning(),)))
    monkeypatch.setattr(cli, "database_user", lambda _executor: "app_user")
    result = run(ARGS)
    assert result.exit_code == 0
    lines = result.output.splitlines()
    assert lines[0].startswith("WARNING: partial map.")
    assert "VIEW DEFINITION" in lines[0]
    assert (in_tmp / "Sales.snapshot.json").exists()
    assert "1 warning(s): objects" in result.output
    assert "GRANT VIEW DEFINITION TO [<user>];" in result.output
    assert "The database user here is [app_user]" in result.output
    assert "0 user tables found" not in result.output


def test_case_b_quiet_prints_nothing_and_does_not_look_the_user_up(
    monkeypatch: pytest.MonkeyPatch, in_tmp: Path
) -> None:
    fake_database(monkeypatch, snapshot(warnings=(partial_visibility_warning(),)))

    def refuse(_executor: object) -> str:
        raise AssertionError("looked the user up")

    monkeypatch.setattr(cli, "database_user", refuse)
    result = run([*ARGS, "--quiet"])
    assert result.exit_code == 0
    assert result.output == ""
    assert (in_tmp / "Sales.snapshot.json").exists()


def test_case_c_prints_a_plain_note_and_no_warning(
    monkeypatch: pytest.MonkeyPatch, in_tmp: Path
) -> None:
    fake_database(monkeypatch, snapshot())
    result = run(ARGS)
    assert result.exit_code == 0
    assert "0 user tables found" in result.output
    assert "No warnings" in result.output
    assert "WARNING" not in result.output
    assert (in_tmp / "Sales.snapshot.json").exists()


def test_the_empty_note_is_not_printed_when_a_schema_filter_removed_the_tables(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    filtered = snapshot().model_copy(update={"filters": AppliedFilters(schemas=("nothing",))})
    fake_database(monkeypatch, filtered)
    result = run([*ARGS, "--schema", "nothing"])
    assert "0 user tables found" not in result.output
