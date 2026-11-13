"""The `schemamap ui` command: help, exit codes and the printed launch link."""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from launcher_builders import write_launcher
from typer.testing import CliRunner

from schemamap.cli import app
from schemamap.ui.server import LauncherServer

runner = CliRunner()


def test_ui_help_has_examples() -> None:
    result = runner.invoke(app, ["ui", "--help"])
    assert result.exit_code == 0
    assert "schemamap ui --no-open" in result.stdout
    assert "127.0.0.1" in result.stdout


def test_a_missing_launcher_exits_1_and_names_the_build_command(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("schemamap.ui.assets.VIEWER_DIR", tmp_path)
    result = runner.invoke(app, ["ui", "--no-open"])
    assert result.exit_code == 1
    assert "tools/build_viewer.py" in result.stderr


def test_ui_prints_the_launch_link_and_stops_on_ctrl_c(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("schemamap.ui.assets.VIEWER_DIR", write_launcher(tmp_path))
    opened: list[str] = []

    def fake_open(url: str) -> bool:
        opened.append(url)
        return True

    monkeypatch.setattr("webbrowser.open", fake_open)

    def interrupt(self: LauncherServer, poll_interval: float = 0.5) -> None:
        raise KeyboardInterrupt

    monkeypatch.setattr(LauncherServer, "serve_forever", interrupt)
    result = runner.invoke(app, ["ui", "--no-open"])
    assert result.exit_code == 0
    assert opened == []
    assert re.fullmatch(
        r"Schema Map is running at http://127\.0\.0\.1:\d+/#t=[\w-]{40,}\n", result.stdout
    )
    assert "stopped" in result.stderr

    result = runner.invoke(app, ["ui"])
    assert result.exit_code == 0
    assert len(opened) == 1 and opened[0] in result.stdout
