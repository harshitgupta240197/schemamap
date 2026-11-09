"""Shared fixtures."""

import importlib.util
import subprocess
import sys
from pathlib import Path
from types import ModuleType

import pytest

LAB_PATH = Path(__file__).resolve().parents[2] / "tools" / "lab.py"


@pytest.fixture(scope="session")
def lab() -> ModuleType:
    """Load tools/lab.py (a standalone script, not part of the package) as a module."""
    spec = importlib.util.spec_from_file_location("schemamap_lab", LAB_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["schemamap_lab"] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="session")
def passwords(lab: ModuleType) -> tuple[str, str]:
    """(sa, reader) passwords from the lab's .env; fails clearly if the lab is not set up."""
    env = lab.read_env()
    sa, reader = env.get(lab.ENV_SA), env.get(lab.ENV_READER)
    if not sa or not reader:
        pytest.fail("Lab not initialised: run `uv run tools/lab.py up` first.")
    state = subprocess.run(
        ["docker", "inspect", "-f", "{{.State.Status}}", lab.CONTAINER],
        capture_output=True,
        text=True,
        check=False,
    )
    if state.stdout.strip() != "running":
        pytest.fail("Lab container is not running: run `uv run tools/lab.py up` first.")
    return sa, reader


SYNTH_PATH = LAB_PATH.with_name("synth.py")


@pytest.fixture(scope="session")
def synth() -> ModuleType:
    """Load tools/synth.py (a standalone script, not part of the package) as a module."""
    spec = importlib.util.spec_from_file_location("schemamap_synth", SYNTH_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["schemamap_synth"] = module
    spec.loader.exec_module(module)
    return module
