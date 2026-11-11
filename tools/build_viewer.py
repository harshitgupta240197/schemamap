#!/usr/bin/env python3
"""Build the viewer and package it for `schemamap view` (Python standard library only).

    uv run tools/build_viewer.py

Runs `npm run build` in viewer/ (dependencies must be installed: `npm ci` there), then copies
the single-file viewer to cli/src/schemamap/viewer_dist/index.html with a manifest.json that
records the viewer version, the file size and its sha256. `schemamap view` refuses a viewer
that does not match its manifest. viewer_dist/ is gitignored: release builds run this script
(D-051).
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
DEST = ROOT / "cli" / "src" / "schemamap" / "viewer_dist"
PLACEHOLDER = '<script type="application/json" id="schemamap-data"></script>'
CSP_MARKER = 'http-equiv="Content-Security-Policy"'


class BuildError(Exception):
    """The viewer could not be built or packaged."""


def viewer_version(viewer: Path = VIEWER) -> str:
    """The version in viewer/package.json."""
    package = json.loads((viewer / "package.json").read_text(encoding="utf-8"))
    version = package.get("version")
    if not isinstance(version, str) or not version:
        raise BuildError("viewer/package.json has no version")
    return version


def run_build(viewer: Path = VIEWER) -> Path:
    """Run `npm run build` and return the built file."""
    npm = shutil.which("npm")
    if npm is None:
        raise BuildError("npm was not found. Install Node.js 24 or later to build the viewer.")
    if not (viewer / "node_modules").is_dir():
        raise BuildError("viewer dependencies are not installed. Run `npm ci` in viewer/ first.")
    result = subprocess.run([npm, "run", "build"], cwd=viewer, check=False)
    if result.returncode != 0:
        raise BuildError(f"`npm run build` failed with exit code {result.returncode}")
    built = viewer / "dist" / "index.html"
    if not built.is_file():
        raise BuildError(f"the build did not produce {built}")
    return built


def package(built: Path, dest: Path, version: str) -> dict[str, object]:
    """Copy ``built`` into ``dest`` with its manifest; return the manifest.

    Refuses a page that does not hold the data placeholder exactly once, since `schemamap view`
    could not embed a snapshot in it, and a page without exactly one Content-Security-Policy
    meta tag, since the map would then not carry its no-network guarantee (D-052). Both files are written to temporary names and then moved,
    the page first, so a failure never leaves a manifest that describes a different page.
    """
    page = built.read_bytes()
    found = page.decode("utf-8").count(PLACEHOLDER)
    if found != 1:
        raise BuildError(f"the built viewer must hold its data placeholder once, found {found}")
    policies = page.decode("utf-8").count(CSP_MARKER)
    if policies != 1:
        raise BuildError(
            f"the built viewer must hold one Content-Security-Policy meta tag, found {policies}"
        )
    manifest: dict[str, object] = {
        "viewer_version": version,
        "bytes": len(page),
        "sha256": hashlib.sha256(page).hexdigest(),
    }
    dest.mkdir(parents=True, exist_ok=True)
    files = {
        "index.html": page,
        "manifest.json": (json.dumps(manifest, indent=2) + "\n").encode("utf-8"),
    }
    for name, data in files.items():
        descriptor, temporary = tempfile.mkstemp(dir=dest, prefix=f".{name}.", suffix=".tmp")
        try:
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(data)
            os.chmod(temporary, 0o644)  # not a secret: mkstemp's 0600 would only get in the way
            os.replace(temporary, dest / name)
        finally:
            Path(temporary).unlink(missing_ok=True)
    return manifest


def main() -> int:
    try:
        manifest = package(run_build(), DEST, viewer_version())
    except BuildError as exc:
        print(f"build_viewer: {exc}", file=sys.stderr)
        return 1
    print(
        f"Packaged viewer {manifest['viewer_version']} "
        f"({manifest['bytes']} bytes, sha256 {str(manifest['sha256'])[:12]}...) into {DEST}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
