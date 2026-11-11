"""tools/check_wheel.py: the wheel must carry the viewer and a manifest that matches it."""

from __future__ import annotations

import hashlib
import json
import zipfile
from pathlib import Path
from types import ModuleType

import pytest

CSP = b'<meta http-equiv="Content-Security-Policy" content="default-src \'none\'" />'
PAGE = b"<html><head>" + CSP + b"</head>viewer</html>"


def wheel(
    tmp_path: Path,
    *,
    page: bytes | None = PAGE,
    manifest: dict[str, object] | None = None,
) -> Path:
    if manifest is None:
        manifest = {"sha256": hashlib.sha256(PAGE).hexdigest(), "bytes": len(PAGE)}
    path = tmp_path / "schemamap-0.0.1-py3-none-any.whl"
    with zipfile.ZipFile(path, "w") as archive:
        if page is not None:
            archive.writestr("schemamap/viewer_dist/index.html", page)
        archive.writestr("schemamap/viewer_dist/manifest.json", json.dumps(manifest))
    return path


def test_a_wheel_with_a_matching_viewer_passes(check_wheel: ModuleType, tmp_path: Path) -> None:
    check_wheel.check_wheel(wheel(tmp_path))


def test_a_wheel_without_the_viewer_fails(check_wheel: ModuleType, tmp_path: Path) -> None:
    with pytest.raises(check_wheel.WheelError, match=r"index\.html"):
        check_wheel.check_wheel(wheel(tmp_path, page=None))


def test_a_manifest_that_does_not_match_fails(check_wheel: ModuleType, tmp_path: Path) -> None:
    with pytest.raises(check_wheel.WheelError, match="sha256"):
        check_wheel.check_wheel(wheel(tmp_path, page=PAGE + b" "))


@pytest.mark.parametrize("page", [b"<html>viewer</html>", b"<html>" + CSP + CSP + b"</html>"])
def test_a_page_without_exactly_one_policy_fails(
    check_wheel: ModuleType, tmp_path: Path, page: bytes
) -> None:
    manifest = {"sha256": hashlib.sha256(page).hexdigest(), "bytes": len(page)}
    with pytest.raises(check_wheel.WheelError, match="Content-Security-Policy"):
        check_wheel.check_wheel(wheel(tmp_path, page=page, manifest=manifest))


def test_a_wrong_byte_count_fails(check_wheel: ModuleType, tmp_path: Path) -> None:
    bad = {"sha256": hashlib.sha256(PAGE).hexdigest(), "bytes": 1}
    with pytest.raises(check_wheel.WheelError, match="byte count"):
        check_wheel.check_wheel(wheel(tmp_path, manifest=bad))
