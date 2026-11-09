"""The VIEW DEFINITION decision: never write a silently empty snapshot (fake executor)."""

from __future__ import annotations

from typing import Any

import pytest
from test_extract_sections import FakeExecutor, permission_rows

from schemamap.connect import Permission, database_user
from schemamap.errors import ConnectError, NoVisibleObjectsError, PermissionDeniedError
from schemamap.extract import Visibility, assess_visibility, extract_database
from schemamap.queries import QueryName
from schemamap.snapshot.models import Section

HELD = frozenset({Permission.VIEW_DEFINITION})
NOT_HELD: frozenset[Permission] = frozenset()


def answers(
    held: frozenset[Permission], *, tables: bool = False, views: bool = False, user: str = "app"
) -> dict[QueryName, Any]:
    return {
        QueryName.PERMISSIONS: permission_rows(held),
        QueryName.DATABASE_USER: [(user,)],
        QueryName.TABLES: [("dbo", "Orders", 0, False)] if tables else [],
        QueryName.VIEWS: [("dbo", "V", False, "CREATE VIEW dbo.V AS SELECT 1 AS x", False)]
        if views
        else [],
    }


# --- the pure decision --------------------------------------------------------------------


@pytest.mark.parametrize(
    ("held", "tables", "others", "expected"),
    [
        (True, 3, 0, Visibility.COMPLETE),
        (True, 0, 5, Visibility.EMPTY),
        (True, 0, 0, Visibility.EMPTY),
        (False, 2, 0, Visibility.PARTIAL),
        (False, 0, 1, Visibility.PARTIAL),
        (False, 0, 0, Visibility.NONE),
    ],
)
def test_the_three_way_decision(held: bool, tables: int, others: int, expected: Visibility) -> None:
    assert assess_visibility(view_definition_held=held, tables=tables, other_objects=others) is (
        expected
    )


# --- through extract_database --------------------------------------------------------------


def test_case_a_nothing_visible_and_no_view_definition_raises_with_the_grant() -> None:
    with pytest.raises(NoVisibleObjectsError) as raised:
        extract_database(FakeExecutor(answers(NOT_HELD, user="app_user")))
    message = str(raised.value)
    assert "VIEW DEFINITION" in message
    assert "GRANT VIEW DEFINITION TO [app_user];" in message
    assert "may differ from the login name" in message
    assert isinstance(raised.value, PermissionDeniedError)
    assert isinstance(raised.value, ConnectError)  # so the CLI exits 3


def test_case_a_uses_a_placeholder_when_the_user_is_unknown() -> None:
    fake = answers(NOT_HELD)
    fake[QueryName.DATABASE_USER] = [(None,)]
    with pytest.raises(NoVisibleObjectsError, match=r"GRANT VIEW DEFINITION TO \[<user>\];"):
        extract_database(FakeExecutor(fake))


def test_the_guest_user_is_never_named_in_a_grant() -> None:
    with pytest.raises(NoVisibleObjectsError) as raised:
        extract_database(FakeExecutor(answers(NOT_HELD, user="guest")))
    assert "TO [guest]" not in str(raised.value)
    assert "GRANT VIEW DEFINITION TO [<user>];" in str(raised.value)


def test_a_closing_bracket_in_the_user_name_is_doubled() -> None:
    with pytest.raises(NoVisibleObjectsError, match=r"TO \[a\]\]b\];"):
        extract_database(FakeExecutor(answers(NOT_HELD, user="a]b")))


@pytest.mark.parametrize(("tables", "views"), [(True, False), (False, True)])
def test_case_b_some_objects_visible_records_one_partial_visibility_warning(
    tables: bool, views: bool
) -> None:
    result = extract_database(FakeExecutor(answers(NOT_HELD, tables=tables, views=views)))
    (warning,) = (w for w in result.warnings if w.code == "partial_visibility")
    assert warning.section is Section.OBJECTS
    assert "VIEW DEFINITION is not granted" in warning.message
    assert "GRANT VIEW DEFINITION TO [<user>];" in warning.message
    assert "may differ from the login name" in warning.message
    assert result.tables or result.views


def test_case_c_view_definition_held_and_no_tables_is_a_clean_empty_result() -> None:
    executor = FakeExecutor(answers(HELD))
    result = extract_database(executor)
    assert result.tables == ()
    assert [w for w in result.warnings if w.code == "partial_visibility"] == []
    assert QueryName.DATABASE_USER not in executor.ran  # no reason to look the user up


def test_a_normal_run_has_no_partial_visibility_warning() -> None:
    result = extract_database(FakeExecutor(answers(HELD, tables=True)))
    assert [w for w in result.warnings if w.code == "partial_visibility"] == []


def test_database_user_reads_the_name_or_none() -> None:
    assert database_user(FakeExecutor({QueryName.DATABASE_USER: [("u",)]})) == "u"
    assert database_user(FakeExecutor({QueryName.DATABASE_USER: [(None,)]})) is None
    assert database_user(FakeExecutor({QueryName.DATABASE_USER: []})) is None
