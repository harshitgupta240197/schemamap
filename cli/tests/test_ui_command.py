"""The `schemamap ui` command: help, exit codes and the printed launch link."""

from __future__ import annotations

import re
import signal
import socket
from pathlib import Path

import pytest
from launcher_builders import write_launcher
from typer.testing import CliRunner

from schemamap.cli import app
from schemamap.ui.jobs import JobManager
from schemamap.ui.server import LauncherServer

runner = CliRunner()


ANSI = re.compile(r"\x1b\[[0-9;]*m")


def test_ui_help_has_examples() -> None:
    # Fixed width and no colour, as the other help tests do, so CI's terminal cannot wrap it.
    result = runner.invoke(
        app, ["ui", "--help"], env={"COLUMNS": "200", "TERM": "xterm", "NO_COLOR": "1"}
    )
    assert result.exit_code == 0
    text = re.sub(r"\s+", " ", re.sub(r"[│╭╮╰╯─]", " ", ANSI.sub("", result.output)))
    assert "schemamap ui --no-open" in text
    assert "127.0.0.1" in text


def test_ui_help_lists_the_options() -> None:
    result = runner.invoke(
        app, ["ui", "--help"], env={"COLUMNS": "200", "TERM": "xterm", "NO_COLOR": "1"}
    )
    text = re.sub(r"\s+", " ", re.sub(r"[│╭╮╰╯─]", " ", ANSI.sub("", result.output)))
    for option in ("--port", "--no-open", "--data-dir"):
        assert option in text
    assert "Exit codes" in text


def test_a_missing_launcher_exits_1_and_names_the_build_command(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("schemamap.ui.assets.VIEWER_DIR", tmp_path)
    data = tmp_path / "data"
    result = runner.invoke(app, ["ui", "--no-open", "--data-dir", str(data)])
    assert result.exit_code == 1
    assert "tools/build_viewer.py" in result.stderr
    assert not data.exists()


def stop_at_once(monkeypatch: pytest.MonkeyPatch, reason: str | None = None) -> None:
    def interrupt(self: LauncherServer, poll_interval: float = 0.5) -> None:
        self.stop_reason = reason
        if reason is None:
            raise KeyboardInterrupt

    monkeypatch.setattr(LauncherServer, "serve_forever", interrupt)


def test_ui_prints_the_launch_link_and_stops_on_ctrl_c(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("schemamap.ui.assets.VIEWER_DIR", write_launcher(tmp_path / "launcher"))
    opened: list[str] = []

    def fake_open(url: str) -> bool:
        opened.append(url)
        return True

    monkeypatch.setattr("webbrowser.open", fake_open)
    stop_at_once(monkeypatch)
    data = tmp_path / "My Maps"
    result = runner.invoke(app, ["ui", "--no-open", "--data-dir", str(data)])
    assert result.exit_code == 0
    assert opened == []
    assert re.fullmatch(
        r"Schema Map is running at http://127\.0\.0\.1:\d+/#c=[\w-]{40,}\n", result.stdout
    )
    assert "#t=" not in result.stdout
    assert "stopped" in result.stderr
    assert "expires after 60 seconds" in result.stderr
    # It says where the data folder is, and made it.
    assert str(data) in result.stderr.replace("\n", "")
    assert data.is_dir()

    result = runner.invoke(app, ["ui", "--data-dir", str(data)])
    assert result.exit_code == 0
    assert len(opened) == 1 and opened[0] in result.stdout


def test_ui_says_when_it_stopped_from_inactivity(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("schemamap.ui.assets.VIEWER_DIR", write_launcher(tmp_path / "launcher"))
    stop_at_once(monkeypatch, "idle")
    result = runner.invoke(app, ["ui", "--no-open", "--data-dir", str(tmp_path / "data")])
    assert result.exit_code == 0
    assert "30 minutes" in result.stderr


def test_the_default_data_folder_is_schemamap_in_the_home_folder(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("schemamap.ui.assets.VIEWER_DIR", write_launcher(tmp_path / "launcher"))
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path / "home"))
    stop_at_once(monkeypatch)
    result = runner.invoke(app, ["ui", "--no-open"])
    assert result.exit_code == 0
    assert (tmp_path / "home" / "SchemaMap").is_dir()


def test_port_picks_the_listening_port(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("schemamap.ui.assets.VIEWER_DIR", write_launcher(tmp_path / "launcher"))
    stop_at_once(monkeypatch)
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = int(probe.getsockname()[1])
    result = runner.invoke(
        app, ["ui", "--no-open", "--port", str(port), "--data-dir", str(tmp_path / "d")]
    )
    assert result.exit_code == 0
    assert f"http://127.0.0.1:{port}/#c=" in result.stdout


def test_a_port_in_use_exits_1_with_advice(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("schemamap.ui.assets.VIEWER_DIR", write_launcher(tmp_path / "launcher"))
    with socket.socket() as taken:
        taken.bind(("127.0.0.1", 0))
        taken.listen()
        port = int(taken.getsockname()[1])
        result = runner.invoke(
            app, ["ui", "--no-open", "--port", str(port), "--data-dir", str(tmp_path / "d")]
        )
    assert result.exit_code == 1
    assert f"port {port}" in result.stderr
    assert "--port" in result.stderr


@pytest.mark.parametrize("port", ["-1", "65536", "abc"])
def test_a_bad_port_is_a_usage_error(tmp_path: Path, port: str) -> None:
    result = runner.invoke(app, ["ui", "--port", port, "--data-dir", str(tmp_path / "d")])
    assert result.exit_code == 2


def test_an_unusable_data_folder_exits_1(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("schemamap.ui.assets.VIEWER_DIR", write_launcher(tmp_path / "launcher"))
    blocker = tmp_path / "file"
    blocker.write_text("x", encoding="utf-8")
    result = runner.invoke(app, ["ui", "--no-open", "--data-dir", str(blocker)])
    assert result.exit_code == 1
    assert "data folder" in result.stderr


def test_a_second_ctrl_c_while_stopping_does_not_cut_the_cleanup_short(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # U.7: a second SIGINT (pressed twice, or forwarded by `uv run`) used to raise inside
    # server_close while it waited for a job, so the process died without emptying tmp/.
    monkeypatch.setattr("schemamap.ui.assets.VIEWER_DIR", write_launcher(tmp_path / "launcher"))
    events: list[object] = []
    close = LauncherServer.server_close

    def serve(self: LauncherServer, poll_interval: float = 0.5) -> None:
        signal.raise_signal(signal.SIGINT)
        events.append(("served", self.stop_reason))

    def close_after_another_ctrl_c(self: LauncherServer) -> None:
        signal.raise_signal(signal.SIGINT)
        close(self)
        events.append("closed")

    exits: list[int] = []
    monkeypatch.setattr(LauncherServer, "serve_forever", serve)
    monkeypatch.setattr(LauncherServer, "server_close", close_after_another_ctrl_c)
    monkeypatch.setattr(LauncherServer, "shutdown", lambda self: None)  # serve_forever is fake
    monkeypatch.setattr("schemamap.cli.os._exit", exits.append)
    before = signal.getsignal(signal.SIGINT)
    result = runner.invoke(app, ["ui", "--no-open", "--data-dir", str(tmp_path / "data")])
    assert result.exit_code == 0
    assert events == [("served", "interrupt"), "closed"]
    assert "Schema Map launcher stopped." in result.stderr
    assert exits == []  # no job left running: an ordinary exit
    assert signal.getsignal(signal.SIGINT) is before


def test_a_job_still_running_after_the_stop_ends_the_process_at_once(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The driver's exit hook would close the connection under the running query (a crash), so
    # the command leaves with os._exit once tmp/ is emptied and the stop is reported.
    monkeypatch.setattr("schemamap.ui.assets.VIEWER_DIR", write_launcher(tmp_path / "launcher"))
    stop_at_once(monkeypatch)
    monkeypatch.setattr(JobManager, "busy", property(lambda self: True))
    exits: list[int] = []
    monkeypatch.setattr("schemamap.cli.os._exit", exits.append)
    result = runner.invoke(app, ["ui", "--no-open", "--data-dir", str(tmp_path / "data")])
    assert result.exit_code == 0
    assert "Schema Map launcher stopped." in result.stderr
    assert exits == [0]
