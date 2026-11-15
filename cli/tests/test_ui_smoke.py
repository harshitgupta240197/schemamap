"""tools/ui_smoke.py: the helpers the three-OS smoke job relies on, and the job itself."""

from __future__ import annotations

import re
from pathlib import Path
from types import ModuleType

import pytest

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")


def test_the_command_lives_where_the_platform_puts_scripts(ui_smoke: ModuleType) -> None:
    venv = Path("env")
    assert ui_smoke.executable(venv, "win32") == venv / "Scripts" / "schemamap.exe"
    assert ui_smoke.executable(venv, "linux") == venv / "bin" / "schemamap"
    assert ui_smoke.executable(venv, "darwin") == venv / "bin" / "schemamap"


def test_the_launch_link_is_found_in_the_output(ui_smoke: ModuleType) -> None:
    output = (
        "Schema Map is running at http://127.0.0.1:50321/#c=abc-DEF_123\n"
        "The link works once and expires after 60 seconds. Press Ctrl+C to stop.\n"
    )
    assert ui_smoke.find_link(output) == (
        "http://127.0.0.1:50321/#c=abc-DEF_123",
        50321,
        "abc-DEF_123",
    )


@pytest.mark.parametrize(
    "output",
    ["", "Schema Map is starting", "Schema Map is running at http://localhost:5/#c=x\n"],
)
def test_no_link_is_found_when_none_was_printed(ui_smoke: ModuleType, output: str) -> None:
    assert ui_smoke.find_link(output) is None


def _smoke_job() -> str:
    match = re.search(r"^  ui-smoke:\n(.*?)(?=^  \S|\Z)", WORKFLOW, re.S | re.M)
    assert match, "ci.yml has no ui-smoke job"
    return match.group(1)


def test_the_smoke_job_runs_on_all_three_operating_systems() -> None:
    job = _smoke_job()
    for runner in ("ubuntu-latest", "macos-latest", "windows-latest"):
        assert runner in job
    assert "fail-fast: false" in job


def test_the_smoke_job_tests_the_built_wheel_not_the_source_tree() -> None:
    job = _smoke_job()
    assert "uv build --wheel" in job
    assert "tools/check_wheel.py" in job
    assert "tools/ui_smoke.py" in job
