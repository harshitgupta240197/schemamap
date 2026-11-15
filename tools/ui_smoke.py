#!/usr/bin/env python3
"""Smoke-test an installed `schemamap ui` on this operating system (standard library only).

    uv run tools/ui_smoke.py --venv <virtualenv holding the installed wheel>

Two launches, each in a home folder whose name has a space and non-ASCII letters:

1. the default data folder (SchemaMap in the home folder; HOME and USERPROFILE point at the
   test home), which must be created there;
2. `--data-dir` with a path that has spaces and non-ASCII letters, which must be created too.

Each launch must print its link; the one-time code in it must be refused when wrong, accepted
once and refused the second time (D-060); `/api/health` must need the token and answer with
it; `POST /api/quit` must stop the process with exit status 0. Nothing here reads the lab or
any user data.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import urllib.error
import urllib.request
from collections.abc import Sequence
from pathlib import Path

HOME_NAME = "Zoë Müller"
DATA_FOLDER = "SchemaMap"
LINK = re.compile(r"Schema Map is running at (http://127\.0\.0\.1:(\d+)/#c=([\w-]+))")
TOKEN_HEADER = "X-SchemaMap-Token"
START_SECONDS = 90
STOP_SECONDS = 20


class SmokeError(Exception):
    """The launcher did not behave as the smoke test requires."""


def executable(venv: Path, platform: str = sys.platform) -> Path:
    """The ``schemamap`` command inside a virtual environment, for this platform."""
    if platform == "win32":
        return venv / "Scripts" / "schemamap.exe"
    return venv / "bin" / "schemamap"


def find_link(text: str) -> tuple[str, int, str] | None:
    """The launch link, its port and its one-time code from the launcher's output, if printed."""
    match = LINK.search(text)
    if match is None:
        return None
    return match.group(1), int(match.group(2)), match.group(3)


def _call(
    port: int, path: str, *, method: str = "GET", token: str | None = None, body: object = None
) -> tuple[int, object]:
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Content-Type": "application/json"} if data is not None else {}
    if token is not None:
        headers[TOKEN_HEADER] = token
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}", data=data, method=method, headers=headers
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            status, raw = response.status, response.read()
    except urllib.error.HTTPError as error:
        status, raw = error.code, error.read()
    return status, json.loads(raw) if raw else None


def _expect(condition: bool, what: str) -> None:
    if not condition:
        raise SmokeError(what)


class Launcher:
    """One `schemamap ui --no-open` process, its output collected on a thread."""

    def __init__(self, command: Path, args: Sequence[str], home: Path) -> None:
        env = {**os.environ, "HOME": str(home), "USERPROFILE": str(home)}
        # Never let a developer's own settings decide where the data goes.
        env.pop("XDG_DATA_HOME", None)
        self.process = subprocess.Popen(
            [str(command), "ui", "--no-open", *args],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            env=env,
            cwd=home,
        )
        self.output = ""
        self._found = threading.Event()
        self._reader = threading.Thread(target=self._read, daemon=True)
        self._reader.start()

    def _read(self) -> None:
        assert self.process.stdout is not None
        for raw in iter(self.process.stdout.readline, b""):
            self.output += raw.decode("utf-8", "replace")
            if find_link(self.output) is not None:
                self._found.set()
        self._found.set()

    def link(self) -> tuple[str, int, str]:
        self._found.wait(START_SECONDS)
        found = find_link(self.output)
        if found is None:
            raise SmokeError(f"`schemamap ui` printed no launch link:\n{self.output}")
        return found

    def stop(self) -> int:
        try:
            return self.process.wait(STOP_SECONDS)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()
            raise SmokeError(
                f"`schemamap ui` did not stop after /api/quit:\n{self.output}"
            ) from None
        finally:
            self._reader.join(5)

    def kill(self) -> None:
        if self.process.poll() is None:
            self.process.kill()
            self.process.wait()


def exercise(launcher: Launcher) -> None:
    """Trade the code, call health with and without the token, quit, check the exit."""
    _, port, code = launcher.link()
    status, _ = _call(port, "/api/session", method="POST", body={"code": "wrong-" + code})
    _expect(status == 401, f"a wrong launch code answered {status}, not 401")
    status, answer = _call(port, "/api/session", method="POST", body={"code": code})
    _expect(status == 200 and isinstance(answer, dict), f"the launch code answered {status}")
    token = answer.get("token") if isinstance(answer, dict) else None
    _expect(isinstance(token, str) and token != "", "the session answer carried no token")
    assert isinstance(token, str)
    status, _ = _call(port, "/api/session", method="POST", body={"code": code})
    _expect(status == 401, f"the launch code worked twice (second answer {status})")
    status, _ = _call(port, "/api/health")
    _expect(status == 401, f"/api/health without the token answered {status}, not 401")
    status, answer = _call(port, "/api/health", token=token)
    _expect(
        status == 200 and isinstance(answer, dict) and answer.get("status") == "ok",
        f"/api/health with the token answered {status}",
    )
    status, _ = _call(port, "/api/quit", method="POST", token=token, body={})
    _expect(status == 200, f"/api/quit answered {status}")
    code_out = launcher.stop()
    _expect(code_out == 0, f"`schemamap ui` exited with status {code_out}:\n{launcher.output}")
    _expect("stopped" in launcher.output, f"no stop message in the output:\n{launcher.output}")


def run(command: Path, args: Sequence[str], home: Path, expected: Path) -> None:
    """Start the launcher with ``args``, exercise it, and require ``expected`` to exist."""
    launcher = Launcher(command, args, home)
    try:
        exercise(launcher)
    finally:
        launcher.kill()
    _expect(expected.is_dir(), f"the data folder {expected} was not created")
    if sys.platform != "win32":
        mode = expected.stat().st_mode & 0o777
        _expect(mode == 0o700, f"the data folder {expected} has mode {mode:o}, not 700")


def main(argv: Sequence[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--venv", type=Path, required=True, help="virtualenv with schemamap")
    options = parser.parse_args(argv)
    # A console that cannot show an accent must not fail the check that prints it.
    for stream in (sys.stdout, sys.stderr):
        if isinstance(stream, io.TextIOWrapper):
            stream.reconfigure(errors="backslashreplace")
    command = executable(options.venv.resolve())
    if not command.is_file():
        print(f"ui_smoke: {command} does not exist", file=sys.stderr)
        return 2
    try:
        with tempfile.TemporaryDirectory(prefix="schemamap smoke ") as scratch:
            home = Path(scratch) / HOME_NAME
            home.mkdir()
            run(command, [], home, home / DATA_FOLDER)
            print(f"default data folder: created at {home / DATA_FOLDER}")
            chosen = home / "My Maps" / "Schéma Map"
            run(command, ["--data-dir", str(chosen)], home, chosen)
            print(f"--data-dir with spaces and accents: created at {chosen}")
    except SmokeError as error:
        print(f"ui_smoke: {error}", file=sys.stderr)
        return 1
    print("ui_smoke: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
