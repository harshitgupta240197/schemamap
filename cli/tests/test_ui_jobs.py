"""Extract jobs: lifecycle, progress, one at a time, cancelling, and the password's lifetime."""

from __future__ import annotations

import gc
import json
import logging
import time
import weakref
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from test_ui_connection_routes import forms
from ui_fakes import Extractor, Opener, stub_template

from schemamap.connect import AuthMode, ConnectionConfig
from schemamap.errors import (
    ConnectError,
    DriverUnavailableError,
    EmbedError,
    JobRunningError,
    NoVisibleObjectsError,
    PermissionDeniedError,
    QueryTimeoutError,
    SchemaMapError,
)
from schemamap.queries import QueryName
from schemamap.snapshot.models import Section
from schemamap.ui.connections import ConnectionStore
from schemamap.ui.jobs import JobError, JobManager, describe_error
from schemamap.ui.library import MapLibrary
from schemamap.viewer import ViewerTemplate

PASSWORD = "S3cret};PWD={pw}"
HERE_SECTIONS = [
    "schemas",
    "tables",
    "views",
    "routines",
    "synonyms",
    "relationships",
    "dependencies",
    "row_counts",
]


def config(password: str = PASSWORD, **changes: Any) -> ConnectionConfig:
    settings: dict[str, Any] = {
        "server": "db-host.example",
        "database": "Sales",
        "auth": AuthMode.SQL,
        "user": "reader",
        "password": password,
    }
    return ConnectionConfig(**(settings | changes))


class Rig:
    """A job manager over a temporary data folder with fake connection and extract."""

    def __init__(
        self,
        directory: Path,
        *,
        opener: Opener | None = None,
        extractor: Extractor | None = None,
        template: Callable[[], ViewerTemplate] = stub_template,
    ) -> None:
        self.data = directory / "data"
        self.opener = opener or Opener()
        self.extractor = extractor or Extractor()
        self.library = MapLibrary(self.data, template=template)
        self.store = ConnectionStore(self.data)
        self.clock = 100.0
        self.manager = JobManager(
            self.library,
            self.store,
            opener=self.opener,
            extractor=self.extractor,
            clock=lambda: self.clock,
        )

    def status(self, job_id: str) -> dict[str, Any]:
        answer = self.manager.status(job_id)
        assert answer is not None
        return answer

    def wait(self, job_id: str, *, until: str | None = None) -> dict[str, Any]:
        """Poll until the job leaves ``running`` (or reaches ``until``)."""
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            answer = self.status(job_id)
            if answer["state"] != "running" if until is None else answer["state"] == until:
                return answer
            time.sleep(0.005)
        raise AssertionError("the job did not finish")

    def sections(self, job_id: str) -> dict[str, str]:
        return {s["name"]: s["state"] for s in self.status(job_id)["sections"]}

    def files(self) -> list[Path]:
        return [p for p in self.data.rglob("*") if p.is_file()] if self.data.exists() else []


@pytest.fixture
def rig(tmp_path: Path) -> Iterator[Rig]:
    made = Rig(tmp_path)
    yield made
    made.extractor.release.set()
    made.manager.shutdown()


# -- lifecycle --------------------------------------------------------------------------------


def test_a_job_runs_to_done_and_keeps_the_map(rig: Rig) -> None:
    job_id = rig.manager.start(config(), remember=False)
    assert len(job_id) == 32
    done = rig.wait(job_id)
    assert done["state"] == "done"
    assert "error" not in done
    [entry] = rig.library.entries()
    assert done["map_id"] == entry.id
    assert entry.tables == len(rig.extractor.snapshot.tables) == 3
    assert rig.extractor.calls == [{"server": "db-host.example", "database": "Sales"}]
    assert rig.opener.executors[0]._driver_connection.closed is True


def test_the_status_lists_every_section_in_order_with_counts_once_done(rig: Rig) -> None:
    job_id = rig.manager.start(config(), remember=False)
    done = rig.wait(job_id)
    assert [s["name"] for s in done["sections"]] == HERE_SECTIONS
    snapshot = rig.extractor.snapshot
    counts = {s["name"]: s["count"] for s in done["sections"]}
    assert {s["state"] for s in done["sections"]} == {"done"}
    assert counts["tables"] == len(snapshot.tables)
    assert counts["views"] == len(snapshot.views)
    assert counts["relationships"] == len(snapshot.relationships)
    assert counts["schemas"] == len(snapshot.schemas)
    assert counts["row_counts"] is None  # the synthetic snapshot has no row counts


def test_progress_is_visible_while_the_job_runs(tmp_path: Path) -> None:
    rig = Rig(tmp_path, extractor=Extractor(pause_before=Section.VIEWS))
    try:
        job_id = rig.manager.start(config(), remember=False)
        assert rig.extractor.reached.wait(5)
        assert rig.status(job_id)["state"] == "running"
        assert rig.sections(job_id) == {
            "schemas": "done",
            "tables": "done",
            "views": "pending",
            "routines": "pending",
            "synonyms": "pending",
            "relationships": "pending",
            "dependencies": "pending",
            "row_counts": "pending",
        }
        assert "map_id" not in rig.status(job_id)
        rig.extractor.release.set()
        assert rig.wait(job_id)["state"] == "done"
    finally:
        rig.extractor.release.set()
        rig.manager.shutdown()


def test_a_skipped_section_is_reported_as_skipped(tmp_path: Path) -> None:
    rig = Rig(tmp_path, extractor=Extractor(skip=Section.DEPENDENCIES))
    job_id = rig.manager.start(config(), remember=False)
    done = rig.wait(job_id)
    assert done["state"] == "done"
    assert rig.sections(job_id)["dependencies"] == "skipped"
    skipped = next(s for s in done["sections"] if s["name"] == "dependencies")
    assert skipped["count"] is None


def test_elapsed_time_follows_the_clock_and_stops_when_the_job_ends(tmp_path: Path) -> None:
    rig = Rig(tmp_path, extractor=Extractor(pause_before=Section.TABLES))
    try:
        job_id = rig.manager.start(config(), remember=False)
        assert rig.extractor.reached.wait(5)
        rig.clock += 1.5
        assert rig.status(job_id)["elapsed_ms"] == 1500
        rig.extractor.release.set()
        rig.wait(job_id)
        ended = rig.status(job_id)["elapsed_ms"]
        rig.clock += 60
        assert rig.status(job_id)["elapsed_ms"] == ended
    finally:
        rig.extractor.release.set()
        rig.manager.shutdown()


def test_an_unknown_job_is_none(rig: Rig) -> None:
    assert rig.manager.status("f" * 32) is None
    assert rig.manager.cancel("f" * 32) is None


# -- failures ---------------------------------------------------------------------------------


def test_a_failed_login_is_a_failed_job_with_the_password_masked(tmp_path: Path) -> None:
    echo = ConnectError(
        "Login failed for database 'Sales'. Fix: Check the user name and password. "
        "Driver said: " + " | ".join(forms(PASSWORD)) + " | PWD=abc"
    )
    rig = Rig(tmp_path, opener=Opener(failure=echo))
    job_id = rig.manager.start(config(), remember=True)
    failed = rig.wait(job_id)
    assert failed["state"] == "failed"
    assert failed["error"]["code"] == "connect_failed"
    assert failed["error"]["fix"] == "Check the user name and password."
    assert PASSWORD not in json.dumps(failed)
    assert "***" in failed["error"]["message"]
    assert "map_id" not in failed
    assert rig.library.entries() == []
    assert rig.store.entries() == []  # the login did not open, so nothing is remembered


@pytest.mark.parametrize(
    ("failure", "code"),
    [
        (NoVisibleObjectsError("no objects. Fix: GRANT VIEW DEFINITION"), "no_visible_objects"),
        (PermissionDeniedError("denied. Fix: run doctor"), "permission_denied"),
        (QueryTimeoutError("slow. Fix: raise the timeout"), "query_timeout"),
        (ConnectError("lost. Fix: check the network"), "connect_failed"),
        (DriverUnavailableError("no driver. Fix: install it"), "driver_unavailable"),
    ],
)
def test_an_extract_error_keeps_its_wording_and_gets_a_code(
    tmp_path: Path, failure: Exception, code: str
) -> None:
    rig = Rig(tmp_path, extractor=Extractor(failure=failure, fail_after=True))
    failed = rig.wait(rig.manager.start(config(), remember=False))
    assert failed["state"] == "failed"
    assert failed["error"]["code"] == code
    assert failed["error"]["fix"] is not None
    assert str(failure).split(". Fix:")[0].split(" Fix:")[0] in failed["error"]["message"]
    assert {s["state"] for s in failed["sections"]} == {"done"}  # raised between sections


def test_a_section_that_fails_is_marked_failed_and_the_rest_stay_pending(tmp_path: Path) -> None:
    rig = Rig(
        tmp_path,
        extractor=Extractor(fail_in=Section.VIEWS, failure=ConnectError("lost. Fix: retry")),
    )
    job_id = rig.manager.start(config(), remember=False)
    assert rig.wait(job_id)["state"] == "failed"
    assert list(rig.sections(job_id).values()) == [
        "done",
        "done",
        "failed",
        "pending",
        "pending",
        "pending",
        "pending",
        "pending",
    ]


def test_an_unexpected_error_is_generic_and_never_quotes_the_exception(tmp_path: Path) -> None:
    boom = RuntimeError(f"driver blew up with {PASSWORD} inside")
    rig = Rig(tmp_path, extractor=Extractor(fail_in=Section.TABLES, failure=boom))
    failed = rig.wait(rig.manager.start(config(), remember=False))
    assert failed["error"] == {
        "code": "internal",
        "message": "Something went wrong inside Schema Map.",
    }
    assert "blew up" not in json.dumps(failed)


def test_a_missing_viewer_fails_the_job_and_names_the_build_command(tmp_path: Path) -> None:
    def no_viewer() -> ViewerTemplate:
        raise EmbedError("the viewer page must contain its data placeholder. Rebuild it.")

    rig = Rig(tmp_path, template=no_viewer)
    failed = rig.wait(rig.manager.start(config(), remember=False))
    assert failed["error"]["code"] == "viewer_unavailable"
    assert rig.library.entries() == []


def test_a_folder_that_cannot_be_written_fails_with_a_plain_message(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    rig = Rig(tmp_path)

    def refuse(_: Any) -> str:
        raise OSError(13, f"Permission denied: {tmp_path}/secret-place")

    monkeypatch.setattr(rig.library, "add", refuse)
    failed = rig.wait(rig.manager.start(config(), remember=False))
    assert failed["error"]["code"] == "write_failed"
    assert "secret-place" not in json.dumps(failed)


def test_describe_error_covers_each_kind_of_failure() -> None:
    assert describe_error(SchemaMapError("plain")) == JobError("extract_failed", "plain")
    assert describe_error(KeyError("x")).code == "internal"
    assert describe_error(OSError("x")).code == "write_failed"
    assert describe_error(ConnectError("a. Fix: b")) == JobError("connect_failed", "a.", "b")


# -- one job at a time ------------------------------------------------------------------------


def test_a_second_job_is_refused_while_one_runs_and_allowed_after(tmp_path: Path) -> None:
    rig = Rig(tmp_path, extractor=Extractor(pause_before=Section.TABLES))
    try:
        first = rig.manager.start(config(), remember=False)
        assert rig.extractor.reached.wait(5)
        with pytest.raises(JobRunningError):
            rig.manager.start(config(), remember=False)
        rig.extractor.release.set()
        assert rig.wait(first)["state"] == "done"
        second = rig.manager.start(config(), remember=False)
        assert second != first
        assert rig.wait(second)["state"] == "done"
        assert len(rig.library.entries()) == 2
    finally:
        rig.extractor.release.set()
        rig.manager.shutdown()


def test_a_failed_job_does_not_block_the_next(tmp_path: Path) -> None:
    rig = Rig(tmp_path, opener=Opener(failure=ConnectError("nope. Fix: try again")))
    assert rig.wait(rig.manager.start(config(), remember=False))["state"] == "failed"
    rig.opener.failure = None
    assert rig.wait(rig.manager.start(config(), remember=False))["state"] == "done"


def test_finished_jobs_stay_available_by_id(rig: Rig) -> None:
    first = rig.manager.start(config(), remember=False)
    rig.wait(first)
    second = rig.manager.start(config(), remember=False)
    rig.wait(second)
    assert rig.status(first)["state"] == "done"
    assert rig.status(first)["map_id"] != rig.status(second)["map_id"]


# -- cancelling -------------------------------------------------------------------------------


def test_cancelling_between_sections_stops_the_job_and_keeps_no_map(tmp_path: Path) -> None:
    rig = Rig(tmp_path, extractor=Extractor(pause_before=Section.VIEWS))
    try:
        job_id = rig.manager.start(config(), remember=False)
        assert rig.extractor.reached.wait(5)
        assert rig.manager.cancel(job_id) == "cancelling"
        assert rig.status(job_id)["state"] == "running"  # until it reaches its next check
        rig.extractor.release.set()
        cancelled = rig.wait(job_id)
        assert cancelled["state"] == "cancelled"
        assert "map_id" not in cancelled and "error" not in cancelled
        assert rig.sections(job_id)["views"] == "pending"
        assert rig.library.entries() == []
        assert rig.opener.executors[0]._driver_connection.closed is True
    finally:
        rig.extractor.release.set()
        rig.manager.shutdown()


def test_cancelling_stops_the_next_query_before_it_is_sent(tmp_path: Path) -> None:
    """The gate sits in the executor, so cancel works between queries inside one section."""
    seen: list[str] = []

    class Querying(Extractor):
        def __call__(self, executor: Any, **kwargs: Any) -> Any:
            kwargs["observer"].started(Section.SCHEMAS)
            self.reached.set()
            assert self.release.wait(10)
            seen.append("before the query")
            executor.run(QueryName.SCHEMAS)  # the fake driver has no cursor: never reached
            seen.append("after the query")
            return self.snapshot

    rig = Rig(tmp_path, extractor=Querying())
    try:
        job_id = rig.manager.start(config(), remember=False)
        assert rig.extractor.reached.wait(5)
        rig.manager.cancel(job_id)
        rig.extractor.release.set()
        assert rig.wait(job_id)["state"] == "cancelled"
        assert seen == ["before the query"]
    finally:
        rig.extractor.release.set()
        rig.manager.shutdown()


def test_cancelling_during_a_section_marks_it_pending_not_failed(tmp_path: Path) -> None:
    from schemamap.errors import JobCancelledError

    rig = Rig(
        tmp_path,
        extractor=Extractor(fail_in=Section.TABLES, failure=JobCancelledError("cancelled")),
    )
    job_id = rig.manager.start(config(), remember=False)
    assert rig.wait(job_id)["state"] == "cancelled"
    assert rig.sections(job_id)["tables"] == "pending"


def test_cancelling_a_finished_job_reports_its_state_and_changes_nothing(rig: Rig) -> None:
    job_id = rig.manager.start(config(), remember=False)
    rig.wait(job_id)
    assert rig.manager.cancel(job_id) == "done"
    assert rig.status(job_id)["state"] == "done"


def test_shutdown_cancels_a_running_job_and_waits_for_it(tmp_path: Path) -> None:
    rig = Rig(tmp_path, extractor=Extractor(pause_before=Section.TABLES))
    job_id = rig.manager.start(config(), remember=False)
    assert rig.extractor.reached.wait(5)
    rig.extractor.release.set()
    rig.manager.shutdown()
    assert rig.status(job_id)["state"] == "cancelled"
    rig.manager.shutdown()  # nothing running: returns at once


# -- remembering ------------------------------------------------------------------------------


def test_remember_saves_the_settings_once_the_login_opened_and_never_the_password(
    rig: Rig,
) -> None:
    rig.wait(rig.manager.start(config(), remember=True))
    [entry] = rig.store.entries()
    assert (entry.server, entry.database, entry.user) == ("db-host.example", "Sales", "reader")
    assert PASSWORD not in (rig.data / "connections.json").read_text("utf-8")


def test_without_remember_nothing_is_saved(rig: Rig) -> None:
    rig.wait(rig.manager.start(config(), remember=False))
    assert rig.store.entries() == []
    assert not (rig.data / "connections.json").exists()


def test_a_connection_is_remembered_even_if_the_extract_then_fails(tmp_path: Path) -> None:
    rig = Rig(
        tmp_path, extractor=Extractor(failure=PermissionDeniedError("x. Fix: y"), fail_after=True)
    )
    assert rig.wait(rig.manager.start(config(), remember=True))["state"] == "failed"
    assert len(rig.store.entries()) == 1


# -- the password -----------------------------------------------------------------------------


def test_the_job_drops_its_reference_to_the_password_once_connected(tmp_path: Path) -> None:
    class ForgetfulOpener(Opener):
        def __call__(self, config: ConnectionConfig) -> Any:
            executor = super().__call__(config)
            self.seen.clear()
            return executor

    rig = Rig(tmp_path, opener=ForgetfulOpener(), extractor=Extractor(pause_before=Section.TABLES))
    try:
        settings = config()
        reference = weakref.ref(settings)
        job_id = rig.manager.start(settings, remember=False)
        del settings
        assert rig.extractor.reached.wait(5)  # connected, mid-extract
        gc.collect()
        assert reference() is None, "the job still holds the connection settings"
        rig.extractor.release.set()
        assert rig.wait(job_id)["state"] == "done"
    finally:
        rig.extractor.release.set()
        rig.manager.shutdown()


@pytest.mark.parametrize(
    "scenario", ["done", "login_failed", "extract_failed", "unexpected", "cancelled"]
)
def test_the_password_is_in_no_status_error_log_or_saved_file(
    tmp_path: Path,
    scenario: str,
    caplog: pytest.LogCaptureFixture,
    capfd: pytest.CaptureFixture[str],
) -> None:
    caplog.set_level(logging.DEBUG)
    echo = "Login failed. Fix: Check it. Driver said: " + " | ".join(forms(PASSWORD))
    opener = Opener(failure=ConnectError(echo) if scenario == "login_failed" else None)
    extractor = Extractor()
    if scenario == "extract_failed":
        extractor = Extractor(
            failure=PermissionDeniedError(f"denied PWD={PASSWORD}"), fail_after=True
        )
    if scenario == "unexpected":
        extractor = Extractor(failure=RuntimeError(PASSWORD), fail_in=Section.VIEWS)
    if scenario == "cancelled":
        extractor = Extractor(pause_before=Section.VIEWS)
    rig = Rig(tmp_path, opener=opener, extractor=extractor)
    try:
        job_id = rig.manager.start(config(), remember=True)
        statuses = [rig.status(job_id)]
        if scenario == "cancelled":
            assert extractor.reached.wait(5)
            statuses.append(rig.status(job_id))
            rig.manager.cancel(job_id)
            extractor.release.set()
        statuses.append(rig.wait(job_id))
    finally:
        extractor.release.set()
        rig.manager.shutdown()
    out, err = capfd.readouterr()
    haystacks = [json.dumps(s) for s in statuses] + [caplog.text, out, err]
    haystacks += [p.read_bytes().decode("utf-8", "replace") for p in rig.files()]
    for text in haystacks:
        assert PASSWORD not in text
        assert "S3cret" not in text
