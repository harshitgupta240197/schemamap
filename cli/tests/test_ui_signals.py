"""`schemamap ui` stopped by real signals while a job runs (U.7), in a child process.

The child runs the real command with a fake job whose "query" ignores cancelling for longer
than the shutdown wait, as a slow catalog query does. Its exit hook stands in for the SQL Server
driver's: it ends the process with code 99 if it runs while the job's worker is still going,
which is when the real driver crashed the process (it closes the connection under the query).
"""

from __future__ import annotations

import http.client
import json
import os
import re
import signal
import subprocess
import sys
import time
from pathlib import Path

import pytest
from ui_http import CODE

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="sends POSIX signals")

TESTS = Path(__file__).parent
DRIVER_HOOK_RAN_UNDER_A_JOB = 99
CHILD = """
import atexit, os, sys, threading, time
sys.path.insert(0, sys.argv[3])
from launcher_builders import write_launcher
from ui_fakes import fake_executor
import schemamap.ui.assets as assets
from schemamap.ui.jobs import JobManager
from schemamap.ui.server import LauncherServer

def opener(config):
    return fake_executor()

def extractor(executor, *, server, database, observer):
    print("job running", file=sys.stderr, flush=True)
    time.sleep(30)
    raise RuntimeError("not reached")

def driver_exit_hook():
    if any(t.name == "schemamap-job" and t.is_alive() for t in threading.enumerate()):
        os._exit(99)

atexit.register(driver_exit_hook)
JobManager.__init__.__kwdefaults__.update(opener=opener, extractor=extractor)
LauncherServer.__init__.__kwdefaults__.update(code=sys.argv[4])
assets.VIEWER_DIR = write_launcher(__import__("pathlib").Path(sys.argv[2]))
from schemamap.cli import app
app(["ui", "--no-open", "--data-dir", sys.argv[1]], prog_name="schemamap")
"""
LINK = re.compile(rb"http://127\.0\.0\.1:(\d+)/")


def wait_for(path: Path, pattern: re.Pattern[bytes], seconds: float = 30) -> re.Match[bytes]:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        found = pattern.search(path.read_bytes())
        if found:
            return found
        time.sleep(0.05)
    raise AssertionError(f"{pattern.pattern!r} never appeared in {path.name}")


def post(port: int, path: str, body: object, token: str | None = None) -> dict[str, object]:
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    headers = {"Content-Type": "application/json"}
    if token is not None:
        headers["X-SchemaMap-Token"] = token
    connection.request("POST", path, json.dumps(body), headers)
    answer: dict[str, object] = json.loads(connection.getresponse().read())
    connection.close()
    return answer


def start_with_a_running_job(tmp_path: Path) -> tuple[subprocess.Popen[bytes], Path, Path]:
    data, out, err = tmp_path / "data", tmp_path / "out.txt", tmp_path / "err.txt"
    child = subprocess.Popen(
        [sys.executable, "-c", CHILD, str(data), str(tmp_path / "launcher"), str(TESTS), CODE],
        stdout=out.open("wb"),
        stderr=err.open("wb"),
        start_new_session=True,
    )
    port = int(wait_for(out, LINK).group(1))
    token = str(post(port, "/api/session", {"code": CODE})["token"])
    connection = {"server": "db-host.example", "database": "Sales", "user": "u", "password": "p"}
    post(port, "/api/jobs", {"connection": connection}, token)
    wait_for(err, re.compile(rb"job running"))
    (data / "tmp").mkdir(exist_ok=True)
    (data / "tmp" / "upload-in-flight.tmp").write_bytes(b"{")
    return child, data, err


@pytest.mark.parametrize(
    "signals",
    [(signal.SIGINT, signal.SIGINT), (signal.SIGINT,), (signal.SIGTERM,)],
    ids=["ctrl-c-twice", "ctrl-c", "sigterm"],
)
def test_a_signal_during_a_job_stops_cleanly_and_empties_tmp(
    tmp_path: Path, signals: tuple[signal.Signals, ...]
) -> None:
    child, data, err = start_with_a_running_job(tmp_path)
    try:
        for number in signals:
            os.kill(child.pid, number)
            time.sleep(0.2)
        code = child.wait(30)
    finally:
        if child.poll() is None:
            child.kill()
    stderr = err.read_text("utf-8")
    assert code == 0, stderr
    assert code != DRIVER_HOOK_RAN_UNDER_A_JOB
    assert stderr.rstrip().endswith("Schema Map launcher stopped.")
    assert "Traceback" not in stderr and "Aborted" not in stderr
    assert list(data.glob("tmp/*")) == []
