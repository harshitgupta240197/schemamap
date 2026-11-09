"""`schemamap extract` end to end against the lab's AdventureWorks2022, as ``schemamap_reader``.

The golden file in tests/fixtures/ is the whole snapshot with two environment-dependent values
normalised: ``captured_at`` (the clock) and ``source.product_version`` (the lab image is
``2022-latest``, so its build number moves). Everything else must match byte for byte.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from types import ModuleType

import pytest
from jsonschema import Draft202012Validator
from typer.testing import CliRunner

from schemamap.cli import app
from schemamap.snapshot.io import dump_snapshot, load_snapshot, read_snapshot

pytestmark = pytest.mark.integration

DATABASE = "AdventureWorks2022"
ROOT = Path(__file__).resolve().parents[2]
GOLDEN = Path(__file__).parent / "fixtures" / "adventureworks2022.snapshot.json"
SCHEMA = ROOT / "schema" / "snapshot.v1.json"
FROZEN = datetime(2000, 1, 1, tzinfo=timezone.utc)
CAPTURED_AT_LINE = re.compile(r'^  "captured_at": ".*",$', re.MULTILINE)


def normalised(text: str) -> str:
    """The snapshot text with the clock and the server build number replaced."""
    snapshot = load_snapshot(text)
    source = snapshot.source.model_copy(update={"product_version": None})
    return dump_snapshot(snapshot.model_copy(update={"captured_at": FROZEN, "source": source}))


class Extraction:
    """One run of the command."""

    def __init__(self, path: Path, output: str, exit_code: int) -> None:
        self.path = path
        self.output = output
        self.exit_code = exit_code

    @property
    def text(self) -> str:
        return self.path.read_text(encoding="utf-8")


class Runner:
    """Runs `schemamap extract` against the lab; every run writes to its own folder."""

    def __init__(self, lab: ModuleType, password: str, folder: Path) -> None:
        self.lab = lab
        self.password = password
        self.folder = folder
        self.count = 0

    def run(
        self, *extra: str, server: str = "localhost", password: str | None = None
    ) -> Extraction:
        self.count += 1
        path = self.folder / f"run{self.count}.json"
        args = [
            "extract",
            "--server",
            server,
            "--port",
            str(self.lab.HOST_PORT),
            "--database",
            DATABASE,
            "--trust-server-certificate",
            "--output",
            str(path),
            *extra,
        ]
        env = {
            "SCHEMAMAP_USER": self.lab.READER_LOGIN,
            "SCHEMAMAP_PASSWORD": password or self.password,
        }
        result = CliRunner().invoke(app, args, env=env)
        written = path.with_name(path.name + ".gz") if "--gzip" in extra else path
        return Extraction(written, result.output, result.exit_code)


@pytest.fixture(scope="module")
def runner(
    lab: ModuleType, passwords: tuple[str, str], tmp_path_factory: pytest.TempPathFactory
) -> Runner:
    return Runner(lab, passwords[1], tmp_path_factory.mktemp("extract"))


@pytest.fixture(scope="module")
def first(runner: Runner) -> Extraction:
    run = runner.run()
    assert run.exit_code == 0, run.output
    return run


def test_writes_a_valid_snapshot_and_prints_a_summary(first: Extraction) -> None:
    snapshot = read_snapshot(first.path)
    assert snapshot.format_version == "1.0"
    assert snapshot.generator.name == "schemamap"
    assert snapshot.source.database == DATABASE
    assert snapshot.source.server == "localhost"
    assert snapshot.source.product_version
    assert snapshot.source.compatibility_level == 160
    assert snapshot.source.collation
    assert snapshot.captured_at.utcoffset() == timezone.utc.utcoffset(None)
    assert len(snapshot.tables) == 71
    assert f"Wrote {first.path}" in first.output
    assert "71 tables" in first.output


def test_matches_the_golden_file(first: Extraction) -> None:
    assert normalised(first.text) == GOLDEN.read_text(encoding="utf-8")


def test_two_runs_differ_only_in_captured_at(runner: Runner, first: Extraction) -> None:
    second = runner.run()
    assert second.exit_code == 0, second.output
    assert CAPTURED_AT_LINE.sub("", first.text) == CAPTURED_AT_LINE.sub("", second.text)
    assert len(CAPTURED_AT_LINE.findall(first.text)) == 1


def test_validates_against_the_json_schema_and_loads_back(first: Extraction) -> None:
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    errors = list(Draft202012Validator(schema).iter_errors(json.loads(first.text)))
    assert errors == []
    assert dump_snapshot(load_snapshot(first.text)) == first.text


def test_redact_server_leaves_no_host_name_anywhere(runner: Runner) -> None:
    # 127.0.0.1 is a value that appears nowhere else in AdventureWorks, so a leak is unmistakable.
    plain = runner.run(server="127.0.0.1")
    redacted = runner.run("--redact-server", server="127.0.0.1")
    assert plain.exit_code == redacted.exit_code == 0
    assert plain.text.count("127.0.0.1") == 1
    assert "127.0.0.1" not in redacted.text
    assert "localhost" not in redacted.text
    snapshot = read_snapshot(redacted.path)
    assert snapshot.source.server is None
    assert snapshot.source.server_redacted is True
    assert snapshot.tables == read_snapshot(plain.path).tables


def test_gzip_round_trips(runner: Runner, first: Extraction) -> None:
    compressed = runner.run("--gzip")
    assert compressed.exit_code == 0, compressed.output
    assert compressed.path.name.endswith(".json.gz")
    assert not compressed.path.with_suffix("").exists()
    assert normalised(dump_snapshot(read_snapshot(compressed.path))) == normalised(first.text)


def test_no_secret_is_in_the_file_or_the_output(
    runner: Runner, first: Extraction, passwords: tuple[str, str]
) -> None:
    # A bare "Password" is no signal here: AdventureWorks has a Person.Password table.
    # So look for what a leaked connection string would contain.
    reader = passwords[1]
    for text in (first.text, first.output):
        assert reader not in text
        assert runner.lab.READER_LOGIN not in text
        assert not re.search(r"\b(pwd|password)\s*=", text, re.IGNORECASE)
        assert "ApplicationIntent" not in text
        assert "TrustServerCertificate" not in text


def test_wrong_password_exits_3_and_writes_nothing(runner: Runner) -> None:
    run = runner.run(password="definitely-not-the-password")
    assert run.exit_code == 3
    assert "definitely-not-the-password" not in run.output
    assert not run.path.exists()
