"""Shared fixtures."""

import importlib.util
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
