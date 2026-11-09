"""`schemamap extract` with the database faked out: options, files, summary and exit codes."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path
from types import TracebackType
from typing import Any

import pytest
from typer.testing import CliRunner

from schemamap import cli
from schemamap.cli import app
from schemamap.connect import ConnectionConfig
from schemamap.errors import ConnectError, QueryRefusedError
from schemamap.extract import DatabaseExtraction, build_snapshot, build_source
from schemamap.extract.rows import SourceInfoRow
from schemamap.snapshot.ids import object_id, schema_id
from schemamap.snapshot.io import read_snapshot
from schemamap.snapshot.models import (
    ExtractionWarning,
    QualifiedName,
    QueryStoreState,
    Reference,
    ReferenceScope,
    Schema,
    Section,
    Snapshot,
    Synonym,
)

PASSWORD = "Sup3rSecret"
ENV = {"SCHEMAMAP_USER": "reader", "SCHEMAMAP_PASSWORD": PASSWORD}
ARGS = ["extract", "--server", "db-host.example", "--database", "Sales"]
CAPTURED = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)


class FakeExecutor:
    def __enter__(self) -> FakeExecutor:
        return self

    def __exit__(
        self,
        kind: type[BaseException] | None,
        value: BaseException | None,
        trace: TracebackType | None,
    ) -> None:
        return None


def snapshot(
    server: str = "db-host.example", warnings: tuple[ExtractionWarning, ...] = ()
) -> Snapshot:
    extraction = DatabaseExtraction(
        schemas=(Schema(id="schema:dbo", name="dbo"),),
        tables=(),
        views=(),
        routines=(),
        synonyms=(),
        relationships=(),
        dependencies=(),
        row_counts=None,
        query_store=QueryStoreState.OFF,
        warnings=warnings,
    )
    source = build_source(None, server, "Sales", QueryStoreState.OFF)
    return build_snapshot(extraction, source, CAPTURED)


def fake_database(
    monkeypatch: pytest.MonkeyPatch,
    result: Snapshot | Exception,
    configs: list[ConnectionConfig] | None = None,
) -> None:
    def connect(config: ConnectionConfig) -> FakeExecutor:
        if configs is not None:
            configs.append(config)
        return FakeExecutor()

    def extract_snapshot(_: object, **__: Any) -> Snapshot:
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(cli, "connect", connect)
    monkeypatch.setattr(cli, "extract_snapshot", extract_snapshot)


def run(args: list[str], env: dict[str, str] | None = None, stdin: str | None = None) -> Any:
    return CliRunner().invoke(app, args, env=ENV if env is None else env, input=stdin)


@pytest.fixture(autouse=True)
def in_tmp(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.chdir(tmp_path)
    return tmp_path


def test_default_file_is_database_dot_snapshot_json(
    monkeypatch: pytest.MonkeyPatch, in_tmp: Path
) -> None:
    fake_database(monkeypatch, snapshot())
    result = run(ARGS)
    assert result.exit_code == 0, result.output
    assert read_snapshot(in_tmp / "Sales.snapshot.json") == snapshot()


def test_output_option_and_summary(monkeypatch: pytest.MonkeyPatch, in_tmp: Path) -> None:
    fake_database(monkeypatch, snapshot())
    result = run([*ARGS, "--output", str(in_tmp / "out.json")])
    assert result.exit_code == 0
    assert (in_tmp / "out.json").exists()
    assert "out.json" in result.output
    assert "1 schemas, 0 tables" in result.output
    assert "No warnings" in result.output


def test_summary_goes_to_stderr_and_stdout_stays_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_database(monkeypatch, snapshot())
    result = CliRunner().invoke(app, ARGS, env=ENV)
    assert result.stdout == ""
    assert "Wrote" in result.stderr


def test_gzip_option_writes_json_gz(monkeypatch: pytest.MonkeyPatch, in_tmp: Path) -> None:
    fake_database(monkeypatch, snapshot())
    result = run([*ARGS, "--gzip"])
    assert result.exit_code == 0
    assert not (in_tmp / "Sales.snapshot.json").exists()
    assert read_snapshot(in_tmp / "Sales.snapshot.json.gz") == snapshot()
    assert "Sales.snapshot.json.gz" in result.output


def test_gzip_adds_gz_to_an_explicit_output_name(
    monkeypatch: pytest.MonkeyPatch, in_tmp: Path
) -> None:
    fake_database(monkeypatch, snapshot())
    result = run([*ARGS, "--gzip", "-o", "custom.json"])
    assert result.exit_code == 0
    assert (in_tmp / "custom.json.gz").exists()


def test_warnings_exit_zero_and_name_their_sections(
    monkeypatch: pytest.MonkeyPatch, in_tmp: Path
) -> None:
    warnings = (
        ExtractionWarning(
            section=Section.ROW_COUNTS, code="permission_missing", message="No rows."
        ),
        ExtractionWarning(
            section=Section.DEPENDENCIES, code="permission_missing", message="No deps."
        ),
    )
    fake_database(monkeypatch, snapshot(warnings=warnings))
    result = run(ARGS)
    assert result.exit_code == 0
    assert "2 warning(s): dependencies, row_counts" in result.output
    assert "No deps." in result.output
    assert len(read_snapshot(in_tmp / "Sales.snapshot.json").warnings) == 2


def test_redact_server_removes_the_host_from_the_file(
    monkeypatch: pytest.MonkeyPatch, in_tmp: Path
) -> None:
    fake_database(monkeypatch, snapshot())
    result = run([*ARGS, "--redact-server"])
    assert result.exit_code == 0
    text = (in_tmp / "Sales.snapshot.json").read_text(encoding="utf-8")
    assert "db-host.example" not in text
    assert read_snapshot(in_tmp / "Sales.snapshot.json").source.server_redacted is True


def test_redact_server_also_drops_linked_server_names(
    monkeypatch: pytest.MonkeyPatch, in_tmp: Path
) -> None:
    synonym = Synonym(
        id=object_id("dbo", "S"),
        schema_id=schema_id("dbo"),
        name="S",
        target=Reference(
            scope=ReferenceScope.CROSS_SERVER,
            name=QualifiedName(server="linked-box", database="D", schema_name="dbo", name="T"),
        ),
    )
    source = build_source(None, "db-host.example", "Sales", QueryStoreState.OFF)
    extraction = DatabaseExtraction(
        schemas=(Schema(id="schema:dbo", name="dbo"),),
        tables=(),
        views=(),
        routines=(),
        synonyms=(synonym,),
        relationships=(),
        dependencies=(),
        row_counts=None,
        query_store=QueryStoreState.OFF,
        warnings=(),
    )
    fake_database(monkeypatch, build_snapshot(extraction, source, CAPTURED))
    assert run([*ARGS, "--redact-server"]).exit_code == 0
    text = (in_tmp / "Sales.snapshot.json").read_text(encoding="utf-8")
    assert "linked-box" not in text
    assert "db-host.example" not in text


def test_hostile_database_name_cannot_choose_the_folder(
    monkeypatch: pytest.MonkeyPatch, in_tmp: Path
) -> None:
    hostile = snapshot().model_copy(
        update={"source": build_source(None, "h", "../../outside", QueryStoreState.OFF)}
    )
    fake_database(monkeypatch, hostile)
    result = run(["extract", "--server", "h", "--database", "../../outside"])
    assert result.exit_code == 0
    assert [p.name for p in in_tmp.iterdir()] == ["_.._outside.snapshot.json"]


def test_server_and_credentials_reach_the_connection(monkeypatch: pytest.MonkeyPatch) -> None:
    configs: list[ConnectionConfig] = []
    fake_database(monkeypatch, snapshot(), configs)
    result = run([*ARGS, "--port", "14330", "--trust-server-certificate"])
    assert result.exit_code == 0
    assert configs[0].server == "db-host.example"
    assert configs[0].port == 14330
    assert configs[0].user == "reader"
    assert configs[0].password == PASSWORD
    assert configs[0].trust_server_certificate is True
    assert PASSWORD not in result.output


def test_prompts_hidden_when_env_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    configs: list[ConnectionConfig] = []
    fake_database(monkeypatch, snapshot(), configs)
    result = run(ARGS, env={}, stdin=f"alice\n{PASSWORD}\n")
    assert result.exit_code == 0
    assert configs[0].user == "alice"
    assert PASSWORD not in result.output


def test_connect_failure_exits_3_and_writes_nothing(
    monkeypatch: pytest.MonkeyPatch, in_tmp: Path
) -> None:
    fake_database(monkeypatch, ConnectError("Login failed. Check the user name and password."))

    def refuse(_: ConnectionConfig) -> FakeExecutor:
        raise ConnectError("Login failed. Check the user name and password.")

    monkeypatch.setattr(cli, "connect", refuse)
    result = run(ARGS)
    assert result.exit_code == 3
    assert "Login failed" in result.output
    assert PASSWORD not in result.output
    assert list(in_tmp.iterdir()) == []


def test_connect_error_during_extraction_exits_3(
    monkeypatch: pytest.MonkeyPatch, in_tmp: Path
) -> None:
    fake_database(monkeypatch, ConnectError("The server did not answer in time."))
    result = run(ARGS)
    assert result.exit_code == 3
    assert list(in_tmp.iterdir()) == []


def test_bad_config_exits_3(in_tmp: Path) -> None:
    result = run([*ARGS, "--port", "0"])
    assert result.exit_code == 3
    assert "Port 0" in result.output
    assert list(in_tmp.iterdir()) == []


def test_internal_error_exits_1_with_a_message(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_database(monkeypatch, QueryRefusedError("not on the allowlist"))
    result = run(ARGS)
    assert result.exit_code == 1
    assert "Extraction failed: not on the allowlist" in result.output


def test_unwritable_output_exits_1(monkeypatch: pytest.MonkeyPatch, in_tmp: Path) -> None:
    fake_database(monkeypatch, snapshot())
    result = run([*ARGS, "--output", str(in_tmp / "missing-folder" / "s.json")])
    assert result.exit_code == 1
    assert "Cannot write" in result.output


def test_markup_in_paths_and_messages_is_printed_as_text(
    monkeypatch: pytest.MonkeyPatch, in_tmp: Path
) -> None:
    warning = ExtractionWarning(
        section=Section.ROW_COUNTS, code="permission_missing", message="Grant [bold]x[/bold]."
    )
    fake_database(monkeypatch, snapshot(warnings=(warning,)))
    result = run([*ARGS, "--output", str(in_tmp / "[red]x.json")])
    assert result.exit_code == 0
    assert "[red]x.json" in result.output
    assert "Grant [bold]x[/bold]." in result.output


def plain_help(command: str) -> str:
    result = CliRunner().invoke(app, [command, "--help"], env={"COLUMNS": "200", "TERM": "dumb"})
    assert result.exit_code == 0
    return re.sub(r"\s+", " ", re.sub(r"[│╭╮╰╯─]", " ", result.output))


def test_extract_shares_the_connection_options_with_doctor() -> None:
    shared = ["--server", "--database", "--port", "--auth", "--trust-server-certificate"]
    shared += ["--connect-timeout", "--query-timeout"]
    for option in shared:
        assert option in plain_help("extract")
        assert option in plain_help("doctor")


def test_extract_has_no_password_flag() -> None:
    assert run([*ARGS, "--password", "x"]).exit_code == 2


def test_redact_server_help_says_host_names_only() -> None:
    text = plain_help("extract")
    assert "--redact-server" in text
    assert "host names only" in text
    assert "Definitions and object names stay in the file" in text


def test_build_source_without_a_catalog_row_records_the_requested_names() -> None:
    source = build_source(None, "h", "Sales", QueryStoreState.UNKNOWN)
    assert (source.server, source.database, source.product_version) == ("h", "Sales", None)
    assert source.query_store is QueryStoreState.UNKNOWN


def test_build_source_maps_the_catalog_row() -> None:
    row = SourceInfoRow(
        "16.0.4250.1", 3, "Developer Edition (64-bit)", 160, "SQL_Latin1_General_CP1_CI_AS", "Sales"
    )
    source = build_source(row, "h", "requested-name", QueryStoreState.ON)
    assert source.database == "Sales"
    assert source.product_version == "16.0.4250.1"
    assert source.engine_edition == "3"
    assert source.edition == "Developer Edition (64-bit)"
    assert source.compatibility_level == 160
    assert source.collation == "SQL_Latin1_General_CP1_CI_AS"
    assert source.query_store is QueryStoreState.ON


def test_build_source_keeps_unknown_values_null() -> None:
    row = SourceInfoRow(None, None, None, None, None, "Sales")
    source = build_source(row, "h", "Sales", QueryStoreState.OFF)
    assert source.engine_edition is None
    assert source.compatibility_level is None


def test_snapshot_records_generator_and_utc_time() -> None:
    built = snapshot()
    assert built.generator.name == "schemamap"
    assert built.generator.version
    assert built.captured_at == CAPTURED
    assert built.format_version == "1.0"
