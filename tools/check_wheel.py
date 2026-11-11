#!/usr/bin/env python3
"""Assert a built wheel carries the packaged viewer (Python standard library only).

    uv run tools/check_wheel.py cli/dist/schemamap-*.whl

The wheel must contain schemamap/viewer_dist/index.html and manifest.json, and the manifest's
sha256 and byte count must match the index.html in the wheel (D-051).
"""

from __future__ import annotations

import hashlib
import json
import sys
import zipfile
from pathlib import Path

PAGE = "schemamap/viewer_dist/index.html"
MANIFEST = "schemamap/viewer_dist/manifest.json"


class WheelError(Exception):
    """The wheel does not carry a valid viewer."""


def check_wheel(wheel: Path) -> None:
    """Raise ``WheelError`` unless ``wheel`` holds the viewer and a manifest that matches it."""
    with zipfile.ZipFile(wheel) as archive:
        names = set(archive.namelist())
        for required in (PAGE, MANIFEST):
            if required not in names:
                raise WheelError(f"{wheel.name} does not contain {required}")
        page = archive.read(PAGE)
        try:
            manifest = json.loads(archive.read(MANIFEST))
        except json.JSONDecodeError as error:
            raise WheelError(f"{MANIFEST} is not valid JSON: {error}") from error
    digest = hashlib.sha256(page).hexdigest()
    if not isinstance(manifest, dict) or manifest.get("sha256") != digest:
        raise WheelError(f"{MANIFEST} sha256 does not match {PAGE} (file is {digest})")
    if manifest.get("bytes") != len(page):
        raise WheelError(f"{MANIFEST} byte count does not match {PAGE} ({len(page)} bytes)")


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: check_wheel.py <wheel>", file=sys.stderr)
        return 2
    try:
        check_wheel(Path(argv[1]))
    except (WheelError, OSError, zipfile.BadZipFile) as error:
        print(f"check_wheel: {error}", file=sys.stderr)
        return 1
    print(f"{argv[1]}: viewer and manifest present, sha256 matches")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
