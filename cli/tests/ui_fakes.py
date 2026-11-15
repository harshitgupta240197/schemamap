"""Fakes for the launcher's job and library tests: a stub viewer, a fake connection and extract."""

from __future__ import annotations

import hashlib
import json
import threading
from pathlib import Path
from typing import Any

from snapshot_builders import synthetic_snapshot

from schemamap.connect import ConnectionConfig, MetadataExecutor
from schemamap.extract import PROGRESS_SECTIONS, SectionObserver
from schemamap.snapshot.models import Section, Snapshot, SourceInfo
from schemamap.viewer import PLACEHOLDER, ViewerTemplate

STUB_PAGE = f"<!doctype html><html><body>{PLACEHOLDER}<div id=root></div></body></html>"


def stub_template() -> ViewerTemplate:
    """A viewer template with the data placeholder, in place of the packaged build."""
    return ViewerTemplate(html=STUB_PAGE, version="1.2.3")


def write_stub_viewer(directory: Path) -> Path:
    """Write a viewer directory (page + manifest) as tools/build_viewer.py does."""
    directory.mkdir(parents=True, exist_ok=True)
    page = STUB_PAGE.encode("utf-8")
    (directory / "index.html").write_bytes(page)
    manifest = {"viewer_version": "1.2.3", "sha256": hashlib.sha256(page).hexdigest()}
    (directory / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return directory


def small_snapshot(tables: int = 3, seed: int = 1) -> Snapshot:
    """A few synthetic tables, with a server name."""
    base = synthetic_snapshot(tables, seed)
    source = SourceInfo(server="db-host.example", database=base.source.database)
    return base.model_copy(update={"source": source})


class FakeDriverConnection:
    """What a MetadataExecutor wraps: it only has to close."""

    def __init__(self) -> None:
        self.closed = False

    def close(self) -> None:
        self.closed = True


def fake_executor() -> MetadataExecutor:
    """An executor over a fake driver connection: opened, closeable, never queried."""
    return MetadataExecutor(FakeDriverConnection())


class Opener:
    """A fake ``connect``: records the configs it was given and returns a fake executor."""

    def __init__(self, failure: Exception | None = None) -> None:
        self.failure = failure
        self.seen: list[ConnectionConfig] = []
        self.executors: list[MetadataExecutor] = []

    def __call__(self, config: ConnectionConfig) -> MetadataExecutor:
        self.seen.append(config)
        if self.failure is not None:
            raise self.failure
        executor = fake_executor()
        self.executors.append(executor)
        return executor


class Extractor:
    """A fake extract that reports every section like the real one.

    ``pause_before`` makes it wait for ``release`` before that section, so a test can look at
    (or cancel) a job in the middle of the work. ``snapshot`` is what it returns.
    """

    def __init__(
        self,
        snapshot: Snapshot | None = None,
        *,
        pause_before: Section | None = None,
        skip: Section | None = None,
        fail_in: Section | None = None,
        failure: Exception | None = None,
        fail_after: bool = False,
    ) -> None:
        self.snapshot = snapshot or small_snapshot()
        self.pause_before = pause_before
        self.skip = skip
        self.fail_in = fail_in
        self.failure = failure or RuntimeError("boom")
        self.fail_after = fail_after
        self.reached = threading.Event()
        self.release = threading.Event()
        self.calls: list[dict[str, Any]] = []

    def __call__(
        self, executor: MetadataExecutor, *, server: str, database: str, observer: SectionObserver
    ) -> Snapshot:
        self.calls.append({"server": server, "database": database})
        for section in PROGRESS_SECTIONS:
            if section is self.pause_before:
                self.reached.set()
                assert self.release.wait(10), "the test never released the extract"
            observer.started(section)
            try:
                if section is self.fail_in:
                    raise self.failure
            finally:
                observer.finished(section, 0.01, section is self.skip)
        if self.fail_after:
            raise self.failure
        return self.snapshot
