"""The CLI's calm surface: exit codes, friendly errors, quiet and verbose, progress, help."""

from __future__ import annotations

import io
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pytest
from rich.console import Console
from typer.testing import CliRunner

from schemamap import cli
from schemamap.cli import app
from schemamap.cli_progress import ExtractProgress
from schemamap.connect import ConnectionConfig, Permission
from schemamap.connect import connection as connection_module
from schemamap.connect.executor import MetadataExecutor
from schemamap.errors import (
    ConnectError,
    PermissionDeniedError,
    QueryTimeoutError,
    SnapshotVersionError,
)
from schemamap.extract import SchemaFilter, SectionRunner
from schemamap.queries import QueryName
from schemamap.snapshot.models import (
    DefinitionStatus,
    ExtractionWarning,
    Generator,
    QueryStoreState,
    Schema,
    Section,
    Snapshot,
    SourceInfo,
)

PASSWORD = "Sup3rSecret"
ENV = {"SCHEMAMAP_USER": "reader", "SCHEMAMAP_PASSWORD": PASSWORD}
ARGS = ["extract", "--server", "db-host.example", "--database", "Sales"]


class FakeExecutor:
    def __enter__(self) -> FakeExecutor:
        return self

    def __exit__(self, *_: object) -> None:
        return None


def fake_extract(
    monkeypatch: pytest.MonkeyPatch, outcome: Snapshot | BaseException
) -> list[dict[str, Any]]:
    """Fake the database; returns the keyword arguments each extract call received."""
    calls: list[dict[str, Any]] = []

    def extract_snapshot(_: object, **kwargs: Any) -> Snapshot:
        calls.append(kwargs)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome

    monkeypatch.setattr(cli, "connect", lambda _config: FakeExecutor())
    monkeypatch.setattr(cli, "extract_snapshot", extract_snapshot)
    return calls


def empty_snapshot(
    warnings: tuple[ExtractionWarning, ...] = (),
    query_store: QueryStoreState = QueryStoreState.OFF,
) -> Snapshot:
    return Snapshot(
        generator=Generator(version="test"),
        captured_at=datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc),
        source=SourceInfo(server="db-host.example", database="Sales", query_store=query_store),
        schemas=(Schema(id="schema:dbo", name="dbo"),),
        warnings=warnings,
    )


def run(args: list[str], env: dict[str, str] | None = None) -> Any:
    return CliRunner().invoke(app, args, env=ENV if env is None else env)


@pytest.fixture(autouse=True)
def in_tmp(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.chdir(tmp_path)
    return tmp_path


def make_config() -> ConnectionConfig:
    return ConnectionConfig(server="db-host.example", database="Sales", user="u", password=PASSWORD)


class RaisingDriver:
    def __init__(self, message: str) -> None:
        self.message = message

    def connect(self, *_: Any, **__: Any) -> Any:
        raise RuntimeError(self.message)


# --- Friendly errors and exit codes -------------------------------------------------------


@pytest.mark.parametrize(
    ("driver_message", "expected"),
    [
        ("Login failed for user 'reader'.", "Check the user name and password"),
        ("Login timeout expired", "raise --connect-timeout"),
        ("TCP Provider: Connection refused", "no firewall blocks it"),
        ("SSL certificate verify failed", "--trust-server-certificate"),
        ("something odd", "schemamap doctor"),
    ],
)
def test_connection_failures_say_what_happened_and_how_to_fix_it(
    monkeypatch: pytest.MonkeyPatch, driver_message: str, expected: str
) -> None:
    monkeypatch.setattr(connection_module, "load_driver", lambda: RaisingDriver(driver_message))
    monkeypatch.setattr(cli, "connect", connection_module.connect)
    result = run(ARGS)
    assert result.exit_code == 3
    assert expected in result.output
    assert "Fix:" in result.output
    assert "Traceback" not in result.output
    assert PASSWORD not in result.output


def test_missing_permission_during_extraction_exits_3_and_points_to_doctor(
    monkeypatch: pytest.MonkeyPatch, in_tmp: Path
) -> None:
    fake_extract(
        monkeypatch,
        PermissionDeniedError("The server denied the query 'tables'. Fix: run `schemamap doctor`."),
    )
    result = run(ARGS)
    assert result.exit_code == 3
    assert "schemamap doctor" in result.output
    assert list(in_tmp.iterdir()) == []


def test_query_timeout_exits_3_and_names_the_option(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_extract(
        monkeypatch, QueryTimeoutError("The query ran past the timeout. Fix: --query-timeout")
    )
    result = run(ARGS)
    assert result.exit_code == 3
    assert "--query-timeout" in result.output


def test_unreadable_snapshot_exits_4(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_extract(monkeypatch, SnapshotVersionError("Snapshot format 2.0 is not supported."))
    result = run(ARGS)
    assert result.exit_code == 4
    assert "format 2.0" in result.output


def test_usage_error_exits_2() -> None:
    assert run(["extract", "--server", "h"]).exit_code == 2
    assert run([*ARGS, "--quiet", "--verbose"]).exit_code == 2


def test_unexpected_error_exits_1_without_a_traceback(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_extract(monkeypatch, RuntimeError(f"boom {PASSWORD}"))
    result = run(ARGS)
    assert result.exit_code == 1
    assert "unexpected RuntimeError" in result.output
    assert "--debug" in result.output
    assert "Traceback" not in result.output
    assert PASSWORD not in result.output


def test_debug_lets_the_unexpected_error_through(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_extract(monkeypatch, RuntimeError("boom"))
    result = run([*ARGS, "--debug"])
    assert result.exit_code == 1
    assert isinstance(result.exception, RuntimeError)


class FakeCursor:
    def __init__(self, message: str) -> None:
        self.message = message

    def execute(self, *_: Any) -> None:
        raise RuntimeError(self.message)

    def close(self) -> None:
        return None


class FakeDriverConnection:
    def __init__(self, message: str) -> None:
        self.message = message

    def cursor(self) -> FakeCursor:
        return FakeCursor(self.message)


@pytest.mark.parametrize(
    ("driver_message", "error", "words"),
    [
        ("Query timeout expired (HYT00)", QueryTimeoutError, "--query-timeout"),
        ("The SELECT permission was denied on the object", PermissionDeniedError, "doctor"),
        ("Communication link failure (08S01)", ConnectError, "connection"),
    ],
)
def test_executor_turns_driver_failures_into_friendly_errors(
    driver_message: str, error: type[ConnectError], words: str
) -> None:
    executor = MetadataExecutor(FakeDriverConnection(driver_message))
    with pytest.raises(error, match=words) as info:
        executor.run(QueryName.SCHEMAS)
    assert info.value.__cause__ is None
    assert info.value.__context__ is None


def test_executor_lets_unrecognised_driver_errors_through() -> None:
    executor = MetadataExecutor(FakeDriverConnection("something unrelated"))
    with pytest.raises(RuntimeError):
        executor.run(QueryName.SCHEMAS)


# --- Options reach the extractor ----------------------------------------------------------


def test_filters_and_definition_switch_reach_the_extractor(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = fake_extract(monkeypatch, empty_snapshot())
    result = run(
        [
            *ARGS,
            "--schema",
            "dbo",
            "--schema",
            "sales",
            "--exclude-schema",
            "audit",
            "--no-definitions",
        ]
    )
    assert result.exit_code == 0, result.output
    assert calls[0]["schema_filter"] == SchemaFilter(include=("dbo", "sales"), exclude=("audit",))
    assert calls[0]["include_definitions"] is False


def test_defaults_keep_everything(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = fake_extract(monkeypatch, empty_snapshot())
    assert run(ARGS).exit_code == 0
    assert calls[0]["schema_filter"] == SchemaFilter()
    assert calls[0]["include_definitions"] is True


# --- Quiet, verbose, progress -------------------------------------------------------------


def test_quiet_prints_nothing_on_success(monkeypatch: pytest.MonkeyPatch, in_tmp: Path) -> None:
    fake_extract(monkeypatch, empty_snapshot())
    result = CliRunner().invoke(app, [*ARGS, "--quiet"], env=ENV)
    assert result.exit_code == 0
    assert result.output == ""
    assert (in_tmp / "Sales.snapshot.json").exists()


def test_quiet_still_prints_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_extract(monkeypatch, ConnectError("Login failed. Fix: check the password."))
    result = run([*ARGS, "-q"])
    assert result.exit_code == 3
    assert "Login failed" in result.output


def test_no_progress_output_without_a_terminal(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_extract(monkeypatch, empty_snapshot())
    result = CliRunner().invoke(app, ARGS, env=ENV)
    assert result.stdout == ""
    assert "\r" not in result.stderr
    assert "Reading" not in result.stderr
    assert "\x1b" not in result.stderr


def sections() -> list[Section]:
    return [Section.SCHEMAS, Section.TABLES, Section.DEPENDENCIES]


def drive(progress: ExtractProgress) -> None:
    with progress:
        for section in sections():
            progress.started(section)
            progress.finished(section, 0.25, skipped=section is Section.DEPENDENCIES)


def test_progress_draws_only_on_a_terminal() -> None:
    plain = io.StringIO()
    drive(
        ExtractProgress(
            Console(file=plain, force_terminal=False), total=3, show=True, verbose=False
        )
    )
    assert plain.getvalue() == ""

    tty = io.StringIO()
    drive(
        ExtractProgress(Console(file=tty, force_terminal=True), total=3, show=True, verbose=False)
    )
    assert "Reading" in tty.getvalue()

    hidden = io.StringIO()
    drive(
        ExtractProgress(
            Console(file=hidden, force_terminal=True), total=3, show=False, verbose=False
        )
    )
    assert hidden.getvalue() == ""


def test_verbose_prints_a_timing_line_per_section_even_without_a_terminal() -> None:
    out = io.StringIO()
    drive(
        ExtractProgress(Console(file=out, force_terminal=False), total=3, show=True, verbose=True)
    )
    lines = out.getvalue().splitlines()
    assert [line.split()[0] for line in lines] == ["schemas", "tables", "dependencies"]
    assert "0.25s" in lines[0]
    assert "skipped" in lines[2]


def test_section_runner_reports_each_section_to_the_observer() -> None:
    events: list[tuple[str, Section, bool]] = []

    class Spy:
        def started(self, section: Section) -> None:
            events.append(("start", section, False))

        def finished(self, section: Section, seconds: float, skipped: bool) -> None:
            assert seconds >= 0
            events.append(("end", section, skipped))

    runner = SectionRunner(frozenset(), Spy())
    from schemamap.extract import Requirement

    runner.run(Section.TABLES, lambda: 1, 0)
    runner.run(
        Section.ROW_COUNTS, lambda: 1, 0, Requirement(Permission.VIEW_DATABASE_STATE, "Skipped.")
    )
    assert events == [
        ("start", Section.TABLES, False),
        ("end", Section.TABLES, False),
        ("start", Section.ROW_COUNTS, False),
        ("end", Section.ROW_COUNTS, True),
    ]


def test_summary_shows_the_filters(monkeypatch: pytest.MonkeyPatch) -> None:
    snap = empty_snapshot().model_copy(
        update={"filters": SchemaFilter(include=("dbo",), exclude=("audit",)).recorded()}
    )
    fake_extract(monkeypatch, snap)
    result = run(ARGS)
    assert "Filters: --schema dbo --exclude-schema audit" in result.output


# --- Help ---------------------------------------------------------------------------------


def plain_help(*args: str) -> str:
    result = CliRunner().invoke(app, [*args, "--help"], env={"COLUMNS": "200", "TERM": "dumb"})
    assert result.exit_code == 0
    return re.sub(r"[ \t]+", " ", re.sub(r"[│╭╮╰╯─]", " ", result.output))


@pytest.mark.parametrize("command", [(), ("extract",), ("doctor",)])
def test_every_help_lists_the_exit_codes(command: tuple[str, ...]) -> None:
    text = plain_help(*command)
    for line in (
        "Exit codes",
        "0 success",
        "1 internal error",
        "2 usage error",
        "3 cannot",
        "4 bad",
    ):
        assert line in text


@pytest.mark.parametrize("command", ["extract", "doctor"])
def test_command_help_has_examples(command: str) -> None:
    text = plain_help(command)
    assert "Examples:" in text
    assert f"schemamap {command} --server" in text


def test_extract_help_describes_the_new_options() -> None:
    text = plain_help("extract")
    for option in (
        "--schema",
        "--exclude-schema",
        "--no-definitions",
        "--quiet",
        "--verbose",
        "--debug",
    ):
        assert option in text


def test_definition_status_has_an_omitted_value() -> None:
    assert DefinitionStatus.OMITTED.value == "omitted"
