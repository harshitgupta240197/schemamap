"""Performance smoke test: extract a 500-table synthetic database within a generous budget.

This guards against an accidental order-of-magnitude slowdown (a query that becomes
quadratic, a missing batch), not against small drift. The budget is about three times the
extraction time observed on a GitHub-hosted runner; see D-038 for the measurements.
"""

from __future__ import annotations

import time
from pathlib import Path
from types import ModuleType

import pytest
from typer.testing import CliRunner

from schemamap.cli import app
from schemamap.snapshot.io import read_snapshot

pytestmark = pytest.mark.integration

DATABASE = "SchemaMapSynthPerf500"
TABLES = 500
EXTRACT_BUDGET_SECONDS = 60.0


def test_extracting_500_tables_stays_within_the_ci_budget(
    lab: ModuleType,
    synth: ModuleType,
    passwords: tuple[str, str],
    tmp_path: Path,
) -> None:
    result = synth.generate(seed=500, tables=TABLES, name=DATABASE)
    creds = lab.credentials_from_env(lab.read_env())
    build_seconds = lab.build_synthetic(creds, DATABASE, result.script)

    path = tmp_path / "perf.json"
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
    start = time.monotonic()
    run = CliRunner().invoke(app, args, env=env)
    extract_seconds = time.monotonic() - start

    print(
        f"{DATABASE}: build {build_seconds:.1f}s, extract {extract_seconds:.1f}s "
        f"(budget {EXTRACT_BUDGET_SECONDS:.0f}s)"
    )
    assert run.exit_code == 0, run.output
    snapshot = read_snapshot(path)
    assert len(snapshot.tables) == TABLES
    assert extract_seconds < EXTRACT_BUDGET_SECONDS
