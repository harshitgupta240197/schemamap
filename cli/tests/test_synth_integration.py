"""Build a synthetic database in the lab and check extraction against its ground truth."""

from __future__ import annotations

from pathlib import Path
from types import ModuleType
from typing import Any

import pytest
from typer.testing import CliRunner

from schemamap.cli import app
from schemamap.snapshot.io import read_snapshot

pytestmark = pytest.mark.integration

DATABASE = "SchemaMapSynthTest200"
TABLES = 200


@pytest.fixture(scope="module")
def built(lab: ModuleType, synth: ModuleType, passwords: tuple[str, str]) -> Any:
    result = synth.generate(seed=2024, tables=TABLES, name=DATABASE)
    creds = lab.credentials_from_env(lab.read_env())
    lab.build_synthetic(creds, DATABASE, result.script)
    return result


def test_declared_foreign_keys_equal_the_declared_ground_truth(
    lab: ModuleType,
    built: Any,
    passwords: tuple[str, str],
    tmp_path: Path,
) -> None:
    path = tmp_path / "synth.json"
    args = [
        "extract",
        "--server",
        lab.HOST,
        "--port",
        str(lab.HOST_PORT),
        "--database",
        DATABASE,
        "--trust-server-certificate",
        "--output",
        str(path),
    ]
    env = {"SCHEMAMAP_USER": lab.READER_LOGIN, "SCHEMAMAP_PASSWORD": passwords[1]}
    run = CliRunner().invoke(app, args, env=env)
    assert run.exit_code == 0, run.output
    snapshot = read_snapshot(path)

    expected = {r["edge"] for r in built.truth["relationships"] if r["declared"]}
    assert expected
    assert {r.edge for r in snapshot.relationships} == expected
    assert len(snapshot.relationships) == len(expected)
    assert len(snapshot.tables) == TABLES
    assert snapshot.views
    assert snapshot.routines
