"""Unit tests for tools/synth.py. No Docker or database needed."""

from __future__ import annotations

import json
import re
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

from schemamap.snapshot.ids import EdgeId, IdKind, edge_id, parse_id

TABLES = 300
CREATE_TABLE = re.compile(r"^CREATE TABLE \[(.+?)\]\.\[(.+?)\] \($", re.MULTILINE)
COLUMN_LINE = re.compile(r"^    \[(.+?)\] ", re.MULTILINE)


@pytest.fixture(scope="module")
def built(synth: ModuleType) -> Any:
    return synth.generate(seed=5, tables=TABLES)


def script_columns(script: str) -> set[str]:
    """Every column ID declared by CREATE TABLE statements in the script."""
    found: set[str] = set()
    for block in script.split("CREATE TABLE ")[1:]:
        header = CREATE_TABLE.match("CREATE TABLE " + block.splitlines()[0])
        assert header is not None
        schema, table = header.groups()
        body = block.split("\n);", 1)[0]
        for column in COLUMN_LINE.findall(body):
            found.add(f"column:{schema}.{table}.{column}")
    return found


def truth_columns(truth: dict[str, object]) -> set[str]:
    columns: set[str] = set()
    for rel in truth["relationships"]:  # type: ignore[attr-defined]
        columns.update(rel["from_columns"] + rel["to_columns"])
    for trap in truth["traps"]:  # type: ignore[attr-defined]
        columns.update(trap.get("columns", []))
        columns.update(c for c in (trap.get("from_column"), trap.get("to_column")) if c)
    return columns


def test_same_seed_is_byte_identical(synth: ModuleType) -> None:
    first = synth.generate(seed=11, tables=120)
    second = synth.generate(seed=11, tables=120)
    assert first.script == second.script
    assert first.truth_json() == second.truth_json()


def test_different_seeds_differ(synth: ModuleType) -> None:
    first = synth.generate(seed=1, tables=120)
    second = synth.generate(seed=2, tables=120)
    assert first.script != second.script
    assert first.truth_json() != second.truth_json()


def test_table_count_is_exact(built: Any) -> None:
    assert len(CREATE_TABLE.findall(built.script)) == TABLES
    assert built.truth["generator"]["tables"] == TABLES


def test_every_ground_truth_column_exists_in_the_script(built: Any) -> None:
    declared = script_columns(built.script)
    assert declared
    assert truth_columns(built.truth) <= declared


def test_names_are_unique_ignoring_case(built: Any) -> None:
    tables = [(s.lower(), t.lower()) for s, t in CREATE_TABLE.findall(built.script)]
    assert len(tables) == len(set(tables))
    columns = [c.lower() for c in script_columns(built.script)]
    assert len(columns) == len(set(columns))


@pytest.mark.parametrize("share", [0.0, 0.3, 0.6, 1.0])
def test_declared_share_is_honoured(synth: ModuleType, share: float) -> None:
    result = synth.generate(seed=3, tables=TABLES, declared_fk_share=share)
    relationships = result.truth["relationships"]
    declared = sum(1 for r in relationships if r["declared"])
    assert abs(declared / len(relationships) - share) <= 0.01
    assert result.script.count(" FOREIGN KEY (") == declared


def test_edges_use_the_snapshot_id_format(built: Any) -> None:
    for rel in built.truth["relationships"]:
        assert rel["edge"] == edge_id(rel["from_columns"], rel["to_columns"])
        assert isinstance(parse_id(rel["edge"], IdKind.EDGE), EdgeId)
        assert len(rel["from_columns"]) == len(rel["to_columns"])


def test_relationships_are_unique_and_sorted(built: Any) -> None:
    edges = [r["edge"] for r in built.truth["relationships"]]
    assert edges == sorted(set(edges))


def test_realistic_shapes_are_present(built: Any) -> None:
    kinds = {r["kind"] for r in built.truth["relationships"]}
    assert {"hierarchy", "self", "bridge", "star", "composite"} <= kinds
    assert any(len(r["from_columns"]) > 1 for r in built.truth["relationships"])
    assert any(r["declared"] for r in built.truth["relationships"])
    assert any(not r["declared"] for r in built.truth["relationships"])
    assert "PRIMARY KEY" in built.script
    keyless = [b for b in built.script.split("CREATE TABLE ")[1:] if "PRIMARY KEY" not in b]
    assert keyless
    assert "[dw]" in built.script
    assert re.search(r"CREATE TABLE \[dw\]\.\[(dim|fact)", built.script)
    assert "CREATE VIEW" in built.script
    assert "CREATE PROCEDURE" in built.script


def test_traps_cover_every_kind(built: Any) -> None:
    kinds = {t["kind"] for t in built.truth["traps"]}
    assert kinds == {"plain_code", "same_name_different_meaning", "type_mismatch", "orphan_id"}
    true_edges = {
        (f, t)
        for r in built.truth["relationships"]
        for f, t in zip(r["from_columns"], r["to_columns"], strict=True)
    }
    for trap in built.truth["traps"]:
        if "from_column" in trap:
            assert (trap["from_column"], trap["to_column"]) not in true_edges


def test_code_joins_include_wrong_evidence(built: Any) -> None:
    kinds = {j["kind"] for j in built.truth["code_joins"]}
    assert kinds == {"relationship", "non_key"}


def test_script_only_creates_objects(built: Any) -> None:
    statements = re.findall(r"^(INSERT|UPDATE|DELETE|MERGE|EXEC|SELECT \*)", built.script, re.M)
    assert statements == []


def test_files_are_written(synth: ModuleType, tmp_path: Path) -> None:
    result = synth.generate(seed=2, tables=40, name="SchemaMapSynthFiles")
    script, truth = synth.write_files(result, "SchemaMapSynthFiles", tmp_path)
    assert script.read_text(encoding="utf-8") == result.script
    assert json.loads(truth.read_text(encoding="utf-8")) == result.truth


@pytest.mark.parametrize(
    "name", ["AdventureWorks2022", "master", "x; DROP", "SchemaMapSynth-1", ""]
)
def test_unsafe_database_names_are_refused(synth: ModuleType, name: str) -> None:
    with pytest.raises(synth.SynthError):
        synth.generate(tables=20, name=name)


@pytest.mark.parametrize(
    "kwargs", [{"tables": 3}, {"schemas": 0}, {"schemas": 99}, {"declared_fk_share": 1.5}]
)
def test_bad_arguments_are_refused(synth: ModuleType, kwargs: dict[str, float]) -> None:
    with pytest.raises(synth.SynthError):
        synth.generate(**kwargs)


@pytest.mark.parametrize("schemas", [1, 3, 12])
def test_schema_count_is_honoured(synth: ModuleType, schemas: int) -> None:
    result = synth.generate(seed=4, tables=60, schemas=schemas)
    assert len(result.truth["generator"]["schemas"]) == schemas


def test_cli_writes_both_files(synth: ModuleType, tmp_path: Path) -> None:
    code = synth.main(["--tables", "30", "--seed", "9", "--out", str(tmp_path)])
    assert code == 0
    assert (tmp_path / "SchemaMapSynth.sql").exists()
    assert (tmp_path / "SchemaMapSynth.truth.json").exists()
    assert synth.main(["--tables", "30", "--name", "master", "--out", str(tmp_path)]) == 1


def test_escape_matches_the_package(synth: ModuleType) -> None:
    from schemamap.snapshot.ids import escape_part

    for name in ["Plain", "a.b", "x(y),z>w", "100%"]:
        assert synth._esc(name) == escape_part(name)
