"""Guards for .github/workflows/ci.yml that a human would forget to keep in step with lab.py."""

from __future__ import annotations

import re
from pathlib import Path
from types import ModuleType

import pytest

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = (ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
COMPOSE = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")


def _integration_job() -> str:
    match = re.search(r"^  integration:\n(.*?)(?=^  \S|\Z)", WORKFLOW, re.S | re.M)
    assert match, "ci.yml has no integration job"
    return match.group(1)


def test_backup_cache_key_names_every_backup_with_its_exact_size(lab: ModuleType) -> None:
    match = re.search(r"key: (lab-backups-\S+)", _integration_job())
    assert match, "the integration job has no backup cache key"
    expected = "lab-backups-" + "-".join(f"{b.filename}-{b.size}" for b in lab.CATALOG.values())
    assert match.group(1) == expected


def test_sql_server_image_is_pinned_to_a_cumulative_update() -> None:
    match = re.search(r"SCHEMAMAP_LAB_IMAGE_TAG: (\S+)", _integration_job())
    assert match
    tag = match.group(1)
    assert re.fullmatch(r"2022-CU\d+-ubuntu-22\.04", tag), tag
    assert "latest" not in tag


def test_compose_defaults_to_the_image_tag_ci_pins() -> None:
    """The local lab and CI run the same SQL Server build unless someone overrides the tag."""
    pinned = re.search(r"SCHEMAMAP_LAB_IMAGE_TAG: (\S+)", _integration_job())
    assert pinned
    assert f"mssql/server:${{SCHEMAMAP_LAB_IMAGE_TAG:-{pinned.group(1)}}}" in COMPOSE


def test_passwords_are_masked_before_they_reach_the_environment_file() -> None:
    job = _integration_job()
    assert job.index("::add-mask::") < job.index("GITHUB_ENV")


def test_no_workflow_step_can_print_the_passwords() -> None:
    for line in _integration_job().splitlines():
        if re.search(r"\bprintenv\b|\bset -x\b|\becho\b.*PASSWORD", line):
            pytest.fail(f"workflow line may print a secret: {line.strip()}")


def test_workflow_stays_least_privilege_and_shares_one_concurrency_group() -> None:
    header = WORKFLOW.split("\njobs:")[0]
    assert re.search(r"^permissions:\n  contents: read$", header, re.M)
    assert WORKFLOW.count("concurrency:") == 1
    assert "permissions:" not in _integration_job()
