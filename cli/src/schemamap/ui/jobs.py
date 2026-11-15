"""Extract jobs for the launcher: one at a time, in a worker thread (docs/UI.md, "Job model").

A job takes a connection config, opens one connection, runs the extract and files the resulting
map in the library. Progress comes from the same ``SectionObserver`` callback the CLI's progress
bar uses. Cancelling is cooperative: it is checked between sections and before every query, and
the query timeout bounds the wait for a query already sent.

The password lives in the ``ConnectionConfig`` and nowhere else. The worker takes the config out
of the box it was handed, uses it to open the connection and to build redaction for a failed
login, then drops its only reference. The job record holds server, database, sections, a map id
and an error whose text has passed through ``redact``: there is no field a password could be put
in. Nothing here logs.
"""

from __future__ import annotations

import secrets
import sys
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from enum import Enum
from typing import Protocol

from schemamap.connect import ConnectionConfig, MetadataExecutor, connect, redact
from schemamap.connect.connection import split_failure
from schemamap.errors import (
    ConnectError,
    DriverUnavailableError,
    EmbedError,
    JobCancelledError,
    JobRunningError,
    NoVisibleObjectsError,
    PermissionDeniedError,
    QueryTimeoutError,
    SchemaMapError,
    ViewerUnavailableError,
)
from schemamap.extract import PROGRESS_SECTIONS, SectionObserver, extract_snapshot
from schemamap.snapshot.models import Section, Snapshot
from schemamap.ui.connections import ConnectionStore
from schemamap.ui.library import MapLibrary

SHUTDOWN_WAIT_SECONDS = 5.0
_GENERIC_FAILURE = "Something went wrong inside Schema Map."


class JobState(str, Enum):
    """Where a job is. ``running`` ends in exactly one of the other three."""

    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    CANCELLED = "cancelled"


class SectionProgress(str, Enum):
    """Where one section is."""

    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    SKIPPED = "skipped"
    FAILED = "failed"


@dataclass(frozen=True)
class JobError:
    """Why a job failed: fixed wording, passed through ``redact``, never a submitted value."""

    code: str
    message: str
    fix: str | None = None

    def to_json(self) -> dict[str, object]:
        """The error as sent to the launcher page."""
        answer: dict[str, object] = {"code": self.code, "message": self.message}
        if self.fix is not None:
            answer["fix"] = self.fix
        return answer


class Extractor(Protocol):
    """Reads one database into a snapshot; ``extract_snapshot`` is the real one."""

    def __call__(
        self, executor: MetadataExecutor, *, server: str, database: str, observer: SectionObserver
    ) -> Snapshot:
        """Read the database, reporting each section to ``observer``."""


def _counts(snapshot: Snapshot) -> dict[Section, int | None]:
    """How many items each section produced, for the sections the job reports."""
    return {
        Section.SCHEMAS: len(snapshot.schemas),
        Section.TABLES: len(snapshot.tables),
        Section.VIEWS: len(snapshot.views),
        Section.ROUTINES: len(snapshot.routines),
        Section.SYNONYMS: len(snapshot.synonyms),
        Section.RELATIONSHIPS: len(snapshot.relationships),
        Section.DEPENDENCIES: len(snapshot.dependencies),
        Section.ROW_COUNTS: None if snapshot.row_counts is None else len(snapshot.row_counts.items),
    }


def describe_error(exc: BaseException) -> JobError:
    """The error a job reports for ``exc``. Only fixed wording and redacted text get through.

    An error that is not one of Schema Map's own is reported with a generic message, never
    with the exception's text.
    """
    if isinstance(exc, ConnectError):
        message, fix = split_failure(_masked(exc))
        return JobError(_connect_code(exc), message, fix)
    if isinstance(exc, ViewerUnavailableError | EmbedError):
        return JobError("viewer_unavailable", _masked(exc))
    if isinstance(exc, SchemaMapError):
        return JobError("extract_failed", _masked(exc))
    if isinstance(exc, OSError):
        return JobError(
            "write_failed",
            "The map could not be saved in the data folder.",
            "Check that the data folder exists, has free space and is writable.",
        )
    return JobError("internal", _GENERIC_FAILURE)


def _masked(exc: BaseException) -> str:
    """The exception's text with any ``PWD=...`` or ``Password=...`` fragment masked.

    By now the job holds no password to mask by value, so this is a second line of defence: the
    messages raised during extraction are fixed wording and carry no connection text anyway.
    """
    return redact(str(exc), ())


def _connect_code(exc: ConnectError) -> str:
    if isinstance(exc, NoVisibleObjectsError):
        return "no_visible_objects"
    if isinstance(exc, PermissionDeniedError):
        return "permission_denied"
    if isinstance(exc, QueryTimeoutError):
        return "query_timeout"
    if isinstance(exc, DriverUnavailableError):
        return "driver_unavailable"
    return "connect_failed"


class Job:
    """One extract job: its state and progress, and the observer the extract reports to."""

    def __init__(self, job_id: str, clock: Callable[[], float]) -> None:
        self.id = job_id
        self._clock = clock
        self._lock = threading.Lock()
        self._cancel = threading.Event()
        self._started = clock()
        self._ended: float | None = None
        self._state = JobState.RUNNING
        self._sections = {section: SectionProgress.PENDING for section in PROGRESS_SECTIONS}
        self._counts: dict[Section, int | None] = {}
        self._map_id: str | None = None
        self._error: JobError | None = None

    @property
    def state(self) -> JobState:
        """Where the job is."""
        with self._lock:
            return self._state

    def request_cancel(self) -> bool:
        """Ask the job to stop at its next check. False when it already ended."""
        with self._lock:
            if self._state is not JobState.RUNNING:
                return False
            self._cancel.set()
            return True

    def check_cancelled(self) -> None:
        """Raise JobCancelledError if cancelling was requested."""
        if self._cancel.is_set():
            raise JobCancelledError("cancelled")

    # SectionObserver ------------------------------------------------------------------------

    def started(self, section: Section) -> None:
        """A section is about to be read; stop here instead if the job was cancelled."""
        self.check_cancelled()
        with self._lock:
            if section in self._sections:
                self._sections[section] = SectionProgress.RUNNING

    def finished(self, section: Section, seconds: float, skipped: bool) -> None:
        """A section ended. Called from a ``finally``, so an error in flight is still visible."""
        failure = sys.exc_info()[1]
        with self._lock:
            if section not in self._sections:
                return
            if failure is None:
                self._sections[section] = (
                    SectionProgress.SKIPPED if skipped else SectionProgress.DONE
                )
            elif isinstance(failure, JobCancelledError):
                self._sections[section] = SectionProgress.PENDING
            else:
                self._sections[section] = SectionProgress.FAILED

    # Ending ---------------------------------------------------------------------------------

    def finish_done(self, map_id: str, snapshot: Snapshot) -> None:
        """The map is saved."""
        counts = _counts(snapshot)
        with self._lock:
            self._counts = counts
            self._map_id = map_id
            self._end(JobState.DONE)

    def finish_failed(self, error: JobError) -> None:
        """The job failed for ``error``."""
        with self._lock:
            self._error = error
            self._end(JobState.FAILED)

    def finish_cancelled(self) -> None:
        """The job stopped because it was cancelled."""
        with self._lock:
            self._end(JobState.CANCELLED)

    def _end(self, state: JobState) -> None:
        self._state = state
        self._ended = self._clock()

    def status(self) -> dict[str, object]:
        """The job as sent to the launcher page. It holds no connection setting at all."""
        with self._lock:
            end = self._ended if self._ended is not None else self._clock()
            sections = [
                {
                    "name": section.value,
                    "state": progress.value,
                    "count": self._counts.get(section)
                    if progress is SectionProgress.DONE
                    else None,
                }
                for section, progress in self._sections.items()
            ]
            answer: dict[str, object] = {
                "job_id": self.id,
                "state": self._state.value,
                "sections": sections,
                "elapsed_ms": max(0, round((end - self._started) * 1000)),
            }
            if self._map_id is not None:
                answer["map_id"] = self._map_id
            if self._error is not None:
                answer["error"] = self._error.to_json()
            return answer


class JobManager:
    """Starts jobs and answers for them. One job runs at a time.

    Finished jobs stay in memory for the life of the server: status only, no credentials.
    ``opener`` and ``extractor`` are the real connection and extraction by default; tests pass
    fakes.
    """

    def __init__(
        self,
        library: MapLibrary,
        store: ConnectionStore,
        *,
        opener: Callable[[ConnectionConfig], MetadataExecutor] = connect,
        extractor: Extractor = extract_snapshot,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._library = library
        self._store = store
        self._opener = opener
        self._extractor = extractor
        self._clock = clock
        self._lock = threading.Lock()
        self._jobs: dict[str, Job] = {}
        self._thread: threading.Thread | None = None

    def start(self, config: ConnectionConfig, *, remember: bool) -> str:
        """Start a job and return its id. Raises JobRunningError while another job runs.

        The caller's ``config`` is the one object that carries the password; the worker takes
        over the only other reference through a one-slot box and empties it.
        """
        with self._lock:
            if any(job.state is JobState.RUNNING for job in self._jobs.values()):
                raise JobRunningError("An extract is already running.")
            job = Job(secrets.token_hex(16), self._clock)
            self._jobs[job.id] = job
            box = [config]
            thread = threading.Thread(
                target=self._work, args=(job, box, remember), name="schemamap-job", daemon=True
            )
            self._thread = thread
            thread.start()
            return job.id

    def status(self, job_id: str) -> dict[str, object] | None:
        """The job's status, or None for an unknown id."""
        with self._lock:
            job = self._jobs.get(job_id)
        return None if job is None else job.status()

    def cancel(self, job_id: str) -> str | None:
        """Ask a job to stop. ``cancelling`` while it winds down, else its final state.

        None for an unknown id.
        """
        with self._lock:
            job = self._jobs.get(job_id)
        if job is None:
            return None
        return "cancelling" if job.request_cancel() else job.state.value

    def shutdown(self, wait: float = SHUTDOWN_WAIT_SECONDS) -> None:
        """Cancel the running job, if any, and give it a moment to stop."""
        with self._lock:
            running = [job for job in self._jobs.values() if job.state is JobState.RUNNING]
            thread = self._thread
        for job in running:
            job.request_cancel()
        if running and thread is not None:
            thread.join(wait)

    # The worker thread ----------------------------------------------------------------------

    def _work(self, job: Job, box: list[ConnectionConfig], remember: bool) -> None:
        try:
            executor, server, database = self._open(box.pop(), remember)
            with executor:
                executor.set_gate(job.check_cancelled)
                job.check_cancelled()
                snapshot = self._extractor(executor, server=server, database=database, observer=job)
            job.check_cancelled()
            map_id = self._library.add(snapshot)
        except JobCancelledError:
            job.finish_cancelled()
        except Exception as exc:  # any failure is reported on the job; none escapes the thread
            job.finish_failed(describe_error(exc))
        else:
            job.finish_done(map_id, snapshot)

    def _open(self, config: ConnectionConfig, remember: bool) -> tuple[MetadataExecutor, str, str]:
        """Open the connection with ``config``, which is dropped when this returns.

        A failure is re-raised with the secrets masked in its text. The connection settings
        (never the password) are remembered once the login has opened.
        """
        try:
            executor = self._opener(config)
        except ConnectError as exc:
            masked = redact(str(exc), config.secrets())
            raise type(exc)(masked) from None
        if remember:
            self._store.remember(config)
        return executor, config.server, config.database
