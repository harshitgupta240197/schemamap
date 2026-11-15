"""Extract jobs against the lab SQL Server, through a real launcher server.

Needs the lab up and restored: `uv run tools/lab.py up && uv run tools/lab.py restore all`.
The map page is made from a stub viewer, so the packaged build is not needed.
"""

from __future__ import annotations

import json
import time
from collections.abc import Iterator
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest
from test_ui_connection_integration import lab_connection
from test_ui_connection_routes import assert_no_password
from ui_fakes import write_stub_viewer
from ui_http import TOKEN, post_json, request, serving

from schemamap.connect import connect
from schemamap.extract import PROGRESS_SECTIONS, extract_database
from schemamap.snapshot.io import read_snapshot
from schemamap.snapshot.models import Section
from schemamap.ui.server import LauncherServer

pytestmark = pytest.mark.integration

AUTH = {"X-SchemaMap-Token": TOKEN}


@pytest.fixture
def server(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[LauncherServer]:
    monkeypatch.setattr("schemamap.viewer.VIEWER_DIR", write_stub_viewer(tmp_path / "viewer_dist"))
    with serving(tmp_path) as (running, _):
        yield running


def run_job(server: LauncherServer, payload: object) -> tuple[list[bytes], dict[str, Any]]:
    """Start a job and poll it like the page does. Returns every body seen and the last status."""
    status, _, body = post_json(server, "/api/jobs", json.dumps(payload).encode("utf-8"), **AUTH)
    assert status == 202, body
    seen = [body]
    job_id = json.loads(body)["job_id"]
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        _, _, body = request(server, f"/api/jobs/{job_id}", headers=AUTH)
        seen.append(body)
        answer: dict[str, Any] = json.loads(body)
        if answer["state"] != "running":
            return seen, answer
        time.sleep(0.1)
    raise AssertionError("the job did not finish")


def test_extracting_adventureworks_through_the_api_gives_a_map_of_71_tables(
    server: LauncherServer,
    lab: ModuleType,
    passwords: tuple[str, str],
    caplog: pytest.LogCaptureFixture,
    capfd: pytest.CaptureFixture[str],
) -> None:
    seen, done = run_job(
        server, {"connection": lab_connection(lab, passwords[1]), "remember": True}
    )
    assert done["state"] == "done", done
    assert [s["name"] for s in done["sections"]] == [s.value for s in PROGRESS_SECTIONS]
    assert {s["state"] for s in done["sections"]} <= {"done", "skipped"}
    counts = {s["name"]: s["count"] for s in done["sections"]}
    assert counts["tables"] == 71

    _, _, listing = request(server, "/api/maps", headers=AUTH)
    [entry] = json.loads(listing)["maps"]
    assert entry["id"] == done["map_id"]
    assert (entry["database"], entry["server"], entry["tables"]) == (
        "AdventureWorks2022",
        lab.HOST,
        71,
    )

    snapshot = read_snapshot(server.data_dir / "maps" / entry["id"] / "snapshot.json.gz")
    assert len(snapshot.tables) == 71
    status, _, page = request(server, f"/maps/{entry['id']}")
    assert status == 200 and len(page) == entry["bytes"]

    assert_no_password(
        passwords[1], bodies=[*seen, listing], server=server, caplog=caplog, capfd=capfd
    )


def test_the_reported_sections_are_the_sections_extraction_runs(
    lab: ModuleType, passwords: tuple[str, str]
) -> None:
    from schemamap.ui.api import parse_connection

    ran: list[Section] = []

    class Recorder:
        def started(self, section: Section) -> None:
            ran.append(section)

        def finished(self, section: Section, seconds: float, skipped: bool) -> None:
            return None

    config = parse_connection(lab_connection(lab, passwords[1]))
    with connect(config) as executor:
        extract_database(executor, Recorder())
    assert tuple(ran) == PROGRESS_SECTIONS


def test_a_wrong_password_fails_the_job_with_the_fix_and_saves_nothing(
    server: LauncherServer, lab: ModuleType, passwords: tuple[str, str]
) -> None:
    wrong = "Wrong" + passwords[1]
    seen, failed = run_job(server, {"connection": lab_connection(lab, wrong), "remember": True})
    assert failed["state"] == "failed"
    assert failed["error"]["code"] == "connect_failed"
    assert "Check the user name and password" in failed["error"]["fix"]
    for body in seen:
        assert wrong.encode() not in body and passwords[1].encode() not in body
    assert json.loads(request(server, "/api/maps", headers=AUTH)[2]) == {"maps": []}
    assert json.loads(request(server, "/api/connections", headers=AUTH)[2]) == {"connections": []}


def test_an_extract_can_be_cancelled_and_leaves_no_map(
    server: LauncherServer, lab: ModuleType, passwords: tuple[str, str]
) -> None:
    _, _, body = post_json(
        server,
        "/api/jobs",
        json.dumps({"connection": lab_connection(lab, passwords[1])}).encode(),
        **AUTH,
    )
    job_id = json.loads(body)["job_id"]
    _, _, body = post_json(server, f"/api/jobs/{job_id}/cancel", b"{}", **AUTH)
    assert json.loads(body) == {"state": "cancelling"}
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        answer = json.loads(request(server, f"/api/jobs/{job_id}", headers=AUTH)[2])
        if answer["state"] != "running":
            break
        time.sleep(0.05)
    assert answer["state"] == "cancelled"
    assert json.loads(request(server, "/api/maps", headers=AUTH)[2]) == {"maps": []}


def test_an_exported_snapshot_imports_back_as_the_same_map(
    server: LauncherServer, lab: ModuleType, passwords: tuple[str, str]
) -> None:
    _, done = run_job(server, {"connection": lab_connection(lab, passwords[1])})
    stored = server.data_dir / "maps" / done["map_id"] / "snapshot.json.gz"
    body = stored.read_bytes()
    status, _, answer = request(
        server,
        "/api/maps/import",
        method="POST",
        headers=AUTH | {"Content-Type": "application/gzip", "Content-Length": str(len(body))},
        body=body,
    )
    assert status == 200
    imported = json.loads(answer)["map_id"]
    assert imported != done["map_id"]
    assert server.library.read_map(imported) == server.library.read_map(done["map_id"])
