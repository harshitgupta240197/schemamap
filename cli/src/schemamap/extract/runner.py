"""Runs each extraction section on its own, turning a missing permission into one warning."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from time import perf_counter
from typing import Protocol, TypeVar

from schemamap.connect import Permission
from schemamap.errors import PermissionMissing
from schemamap.snapshot.models import ExtractionWarning, Section

T = TypeVar("T")

PERMISSION_MISSING_CODE = "permission_missing"


class SectionObserver(Protocol):
    """Told when each section starts and ends. The CLI uses it to show progress."""

    def started(self, section: Section) -> None:
        """A section is about to be read."""

    def finished(self, section: Section, seconds: float, skipped: bool) -> None:
        """A section ended, after ``seconds``; ``skipped`` when a permission was missing."""


@dataclass(frozen=True)
class Requirement:
    """A permission a section needs, and what is lost without it."""

    permission: Permission
    skipped: str


class SectionRunner:
    """Runs sections independently against the permissions the login holds.

    A section that needs a permission the login lacks is not run at all, so the doomed query
    is never sent. A section that raises PermissionMissing is skipped the same way. Either way
    the result is one ExtractionWarning for that section and extraction goes on. Any other
    error propagates: it is a bug or an outage, not a permission gap.
    """

    def __init__(
        self, held: frozenset[Permission], observer: SectionObserver | None = None
    ) -> None:
        self._held = held
        self._observer = observer
        self._warnings: list[ExtractionWarning] = []

    @property
    def warnings(self) -> tuple[ExtractionWarning, ...]:
        """One warning per skipped section, in the order the sections ran."""
        return tuple(self._warnings)

    def run(
        self,
        section: Section,
        read: Callable[[], T],
        skipped_value: T,
        requires: Requirement | None = None,
    ) -> T:
        """Return ``read()``, or ``skipped_value`` plus a warning if the section is skipped."""
        if self._observer is not None:
            self._observer.started(section)
        began = perf_counter()
        skipped = False
        try:
            if requires is not None and requires.permission not in self._held:
                raise PermissionMissing(requires.permission.value, missing_message(requires))
            return read()
        except PermissionMissing as exc:
            skipped = True
            self._warnings.append(
                ExtractionWarning(
                    section=section, code=PERMISSION_MISSING_CODE, message=exc.message
                )
            )
            return skipped_value
        finally:
            if self._observer is not None:
                self._observer.finished(section, perf_counter() - began, skipped)


def missing_message(requirement: Requirement) -> str:
    """The warning text: what is missing, what is skipped, and the exact GRANT line."""
    permission = requirement.permission
    return (
        f"{permission.value} is not granted. {requirement.skipped} "
        f"Ask a DBA to run {permission.grant}"
    )
