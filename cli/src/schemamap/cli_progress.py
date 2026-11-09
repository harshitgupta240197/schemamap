"""Progress and timings for `schemamap extract`, written to stderr only.

The spinner shows only on an interactive terminal and never when ``--quiet`` is set. With
``--verbose`` each section also prints its timing line, TTY or not.
"""

from __future__ import annotations

from types import TracebackType

from rich.console import Console
from rich.progress import BarColumn, Progress, SpinnerColumn, TaskID, TextColumn

from schemamap.snapshot.models import Section

_LABELS = {
    Section.SCHEMAS: "schemas",
    Section.TABLES: "tables and columns",
    Section.VIEWS: "views",
    Section.ROUTINES: "procedures, functions and triggers",
    Section.SYNONYMS: "synonyms",
    Section.RELATIONSHIPS: "foreign keys",
    Section.DEPENDENCIES: "dependencies",
    Section.ROW_COUNTS: "row counts",
}


class ExtractProgress:
    """A SectionObserver that draws a transient progress bar and optional timing lines."""

    def __init__(self, console: Console, *, total: int, show: bool, verbose: bool) -> None:
        self._console = console
        self._verbose = verbose
        self._progress = Progress(
            SpinnerColumn(),
            TextColumn("{task.description}"),
            BarColumn(bar_width=20),
            TextColumn("{task.completed}/{task.total}"),
            console=console,
            transient=True,
            disable=not (show and console.is_terminal),
        )
        self._task: TaskID | None = None
        self._total = total

    def __enter__(self) -> ExtractProgress:
        self._progress.start()
        self._task = self._progress.add_task("Connecting", total=self._total)
        return self

    def __exit__(
        self,
        kind: type[BaseException] | None,
        value: BaseException | None,
        trace: TracebackType | None,
    ) -> None:
        self._progress.stop()

    def started(self, section: Section) -> None:
        """Name the section being read."""
        if self._task is not None:
            self._progress.update(
                self._task, description=f"Reading {_LABELS.get(section, section.value)}"
            )

    def finished(self, section: Section, seconds: float, skipped: bool) -> None:
        """Advance the bar and, with --verbose, print the section's timing."""
        if self._task is not None:
            self._progress.advance(self._task)
        if self._verbose:
            note = " (skipped: permission missing)" if skipped else ""
            self._console.print(f"  {section.value:<14}{seconds:6.2f}s{note}", markup=False)
