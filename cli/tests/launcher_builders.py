"""A fake packaged launcher (page plus manifest) for tests that need no Node.js build."""

from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path

PAGE = b"<!doctype html><title>Schema Map</title><script>1</script>"
SCRIPT_SOURCE = "'sha256-" + base64.b64encode(hashlib.sha256(b"1").digest()).decode() + "'"


def write_launcher(
    directory: Path, *, page: bytes = PAGE, overrides: dict[str, object] | None = None
) -> Path:
    """Write ``launcher.html`` and a matching ``launcher.json`` into ``directory``."""
    manifest: dict[str, object] = {
        "sha256": hashlib.sha256(page).hexdigest(),
        "bytes": len(page),
        "script_sources": [SCRIPT_SOURCE],
        "style_sources": [],
    }
    manifest.update(overrides or {})
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "launcher.html").write_bytes(page)
    (directory / "launcher.json").write_text(json.dumps(manifest), encoding="utf-8")
    return directory
