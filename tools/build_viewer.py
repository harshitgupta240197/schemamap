#!/usr/bin/env python3
"""Build the viewer and package it for `schemamap view` (Python standard library only).

    uv run tools/build_viewer.py

Runs `npm run build` in viewer/ (dependencies must be installed: `npm ci` there), then copies
the single-file viewer to cli/src/schemamap/viewer_dist/index.html with a manifest.json that
records the viewer version, the file size and its sha256. `schemamap view` refuses a viewer
that does not match its manifest. viewer_dist/ is gitignored: release builds run this script
(D-051).

The same build makes the launcher page for `schemamap ui`; it is copied to
viewer_dist/launcher.html with launcher.json: its size, sha256 and the hash sources of its inline
scripts and styles, from which the server builds the page's Content-Security-Policy (D-059).
"""

from __future__ import annotations

import hashlib
import json
import os
import re
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
LAUNCHER_DIST = VIEWER / "dist-launcher"
HASH_SOURCE = re.compile(r"'sha256-[A-Za-z0-9+/]{43}='")


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
    _write_pair(dest, ("index.html", page), ("manifest.json", manifest))
    return manifest


def _write_pair(
    dest: Path, page: tuple[str, bytes], manifest: tuple[str, dict[str, object]]
) -> None:
    """Write a page, then its manifest, each through a temporary name and a rename."""
    dest.mkdir(parents=True, exist_ok=True)
    files = {
        page[0]: page[1],
        manifest[0]: (json.dumps(manifest[1], indent=2) + "\n").encode("utf-8"),
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


def _hash_sources(record: object, key: str) -> list[str]:
    value = record.get(key) if isinstance(record, dict) else None
    if not isinstance(value, list) or not all(
        isinstance(item, str) and HASH_SOURCE.fullmatch(item) for item in value
    ):
        raise BuildError(f"launcher.csp.json: {key} must be a list of sha256 hash sources")
    return list(value)


def package_launcher(built: Path, dest: Path) -> dict[str, object]:
    """Copy the launcher in ``built`` (dist-launcher/) into ``dest`` with launcher.json.

    Refuses a page with a policy meta tag (the server sends the policy as a header), and hash
    records that are missing, malformed or list no script, so the server can never be handed a
    policy that does not match the page.
    """
    try:
        page = (built / "launcher.html").read_bytes()
        record = json.loads((built / "launcher.csp.json").read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise BuildError(f"the launcher build did not produce {exc.filename}") from None
    except ValueError as exc:
        raise BuildError(f"launcher.csp.json is not valid JSON: {exc}") from None
    if CSP_MARKER in page.decode("utf-8"):
        raise BuildError("the launcher page must not carry a Content-Security-Policy meta tag")
    scripts = _hash_sources(record, "script_sources")
    if not scripts:
        raise BuildError("launcher.csp.json lists no script hash")
    manifest: dict[str, object] = {
        "bytes": len(page),
        "sha256": hashlib.sha256(page).hexdigest(),
        "script_sources": scripts,
        "style_sources": _hash_sources(record, "style_sources"),
    }
    _write_pair(dest, ("launcher.html", page), ("launcher.json", manifest))
    return manifest


def main() -> int:
    try:
        manifest = package(run_build(), DEST, viewer_version())
        launcher = package_launcher(LAUNCHER_DIST, DEST)
    except BuildError as exc:
        print(f"build_viewer: {exc}", file=sys.stderr)
        return 1
    print(
        f"Packaged viewer {manifest['viewer_version']} "
        f"({manifest['bytes']} bytes, sha256 {str(manifest['sha256'])[:12]}...) into {DEST}"
    )
    print(f"Packaged launcher ({launcher['bytes']} bytes) into {DEST}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
