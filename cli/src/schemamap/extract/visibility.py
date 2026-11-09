"""Decides whether what extraction saw can be trusted, given VIEW DEFINITION.

Without VIEW DEFINITION, SQL Server shows a login only the objects it owns or has other rights
on, and returns no error for the rest: the catalog views are simply short. So an empty read is
ambiguous, and this module settles it from the permission, not from the row counts alone.
"""

from __future__ import annotations

import enum

from schemamap.connect import USER_NOTE, Permission, grant_note
from schemamap.errors import NoVisibleObjectsError
from schemamap.snapshot.models import ExtractionWarning, Section

PARTIAL_VISIBILITY_CODE = "partial_visibility"


class Visibility(str, enum.Enum):
    """What extraction saw, judged against the VIEW DEFINITION permission."""

    COMPLETE = "complete"
    """VIEW DEFINITION held and at least one user table: a normal run."""

    EMPTY = "empty"
    """VIEW DEFINITION held and no user tables: the database really has none."""

    PARTIAL = "partial"
    """VIEW DEFINITION missing, some objects visible: the map is missing objects."""

    NONE = "none"
    """VIEW DEFINITION missing, no objects visible: the map would say nothing true."""


def assess_visibility(*, view_definition_held: bool, tables: int, other_objects: int) -> Visibility:
    """Classify a run. ``other_objects`` counts views, routines and synonyms."""
    if view_definition_held:
        return Visibility.COMPLETE if tables else Visibility.EMPTY
    return Visibility.PARTIAL if tables + other_objects else Visibility.NONE


def partial_visibility_warning() -> ExtractionWarning:
    """The warning stored in the snapshot when objects may be hidden from the login."""
    return ExtractionWarning(
        section=Section.OBJECTS,
        code=PARTIAL_VISIBILITY_CODE,
        message=(
            f"{Permission.VIEW_DEFINITION.value} is not granted, so SQL Server shows this login "
            "only the objects it owns or has other rights on. This map is partial: other "
            "tables, views and routines are missing. "
            f"Ask a DBA to run {Permission.VIEW_DEFINITION.grant_for()} {USER_NOTE}"
        ),
    )


def no_visible_objects_error(user: str | None) -> NoVisibleObjectsError:
    """The error for a login that sees nothing: names the permission and the exact GRANT."""
    return NoVisibleObjectsError(
        "No tables, views or routines are visible to this login and "
        f"{Permission.VIEW_DEFINITION.value} is not granted, so nothing was written: an empty "
        "map would look the same as a database with no objects. "
        f"Ask a DBA to run {Permission.VIEW_DEFINITION.grant_for(user)} {grant_note(user)}"
    )
