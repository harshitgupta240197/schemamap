"""tools/build_viewer.py: packaging, manifest and refusing a page that cannot take a snapshot."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from types import ModuleType

import pytest
from launcher_builders import SCRIPT_SOURCE

from schemamap.ui.assets import launcher_policy, load_launcher
from schemamap.viewer import PLACEHOLDER, load_viewer

CSP = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'" />'
PAGE = f"<html><head>{CSP}</head><body>{PLACEHOLDER}<script>var a = 1;</script></body></html>"


def built(tmp_path: Path, html: str = PAGE) -> Path:
    path = tmp_path / "dist" / "index.html"
    path.parent.mkdir(parents=True)
    path.write_text(html, encoding="utf-8")
    return path


def test_package_copies_the_page_and_writes_the_manifest(
    build_viewer: ModuleType, tmp_path: Path
) -> None:
    dest = tmp_path / "viewer_dist"
    manifest = build_viewer.package(built(tmp_path), dest, "7.8.9")
    page = (dest / "index.html").read_bytes()
    assert page == PAGE.encode("utf-8")
    assert json.loads((dest / "manifest.json").read_text(encoding="utf-8")) == manifest
    assert manifest == {
        "viewer_version": "7.8.9",
        "bytes": len(page),
        "sha256": hashlib.sha256(page).hexdigest(),
    }
    assert sorted(p.name for p in dest.iterdir()) == ["index.html", "manifest.json"]


def test_a_packaged_viewer_passes_the_cli_check(build_viewer: ModuleType, tmp_path: Path) -> None:
    dest = tmp_path / "viewer_dist"
    build_viewer.package(built(tmp_path), dest, "7.8.9")
    template = load_viewer(dest)
    assert template.html == PAGE
    assert template.version == "7.8.9"


@pytest.mark.skipif(os.name != "posix", reason="POSIX permission bits")
def test_packaged_files_are_world_readable(build_viewer: ModuleType, tmp_path: Path) -> None:
    dest = tmp_path / "viewer_dist"
    build_viewer.package(built(tmp_path), dest, "1.0.0")
    assert [p.stat().st_mode & 0o777 for p in sorted(dest.iterdir())] == [0o644, 0o644]


@pytest.mark.parametrize("html", ["<html></html>", f"{CSP}{PLACEHOLDER}{PLACEHOLDER}"])
def test_a_page_without_exactly_one_placeholder_is_refused(
    build_viewer: ModuleType, tmp_path: Path, html: str
) -> None:
    dest = tmp_path / "viewer_dist"
    with pytest.raises(build_viewer.BuildError, match="placeholder"):
        build_viewer.package(built(tmp_path, html), dest, "1.0.0")
    assert not dest.exists()


@pytest.mark.parametrize("html", [f"<html>{PLACEHOLDER}</html>", f"{CSP}{CSP}{PLACEHOLDER}"])
def test_a_page_without_exactly_one_policy_is_refused(
    build_viewer: ModuleType, tmp_path: Path, html: str
) -> None:
    dest = tmp_path / "viewer_dist"
    with pytest.raises(build_viewer.BuildError, match="Content-Security-Policy"):
        build_viewer.package(built(tmp_path, html), dest, "1.0.0")
    assert not dest.exists()


def test_a_refused_build_leaves_the_previous_viewer_untouched(
    build_viewer: ModuleType, tmp_path: Path
) -> None:
    dest = tmp_path / "viewer_dist"
    build_viewer.package(built(tmp_path), dest, "1.0.0")
    before = {p.name: p.read_bytes() for p in dest.iterdir()}
    with pytest.raises(build_viewer.BuildError):
        build_viewer.package(built(tmp_path / "again", "<html></html>"), dest, "2.0.0")
    assert {p.name: p.read_bytes() for p in dest.iterdir()} == before


def test_viewer_version_comes_from_package_json(build_viewer: ModuleType, tmp_path: Path) -> None:
    (tmp_path / "package.json").write_text('{"version": "3.2.1"}', encoding="utf-8")
    assert build_viewer.viewer_version(tmp_path) == "3.2.1"


def test_viewer_version_is_required(build_viewer: ModuleType, tmp_path: Path) -> None:
    (tmp_path / "package.json").write_text("{}", encoding="utf-8")
    with pytest.raises(build_viewer.BuildError, match="version"):
        build_viewer.viewer_version(tmp_path)


def test_missing_dependencies_are_explained(build_viewer: ModuleType, tmp_path: Path) -> None:
    with pytest.raises(build_viewer.BuildError, match=r"npm ci"):
        build_viewer.run_build(tmp_path)


def test_the_repository_viewer_template_holds_the_placeholder_once() -> None:
    """The source page is what the build starts from; a lost placeholder would only show later."""
    source = Path(__file__).resolve().parents[2] / "viewer" / "index.html"
    assert source.read_text(encoding="utf-8").count(PLACEHOLDER) == 1


LAUNCHER = b"<!doctype html><title>Schema Map</title><script>1</script>"


def built_launcher(tmp_path: Path, record: object = None, page: bytes = LAUNCHER) -> Path:
    directory = tmp_path / "dist-launcher"
    directory.mkdir()
    (directory / "launcher.html").write_bytes(page)
    if record is None:
        record = {"script_sources": [SCRIPT_SOURCE], "style_sources": []}
    (directory / "launcher.csp.json").write_text(json.dumps(record), encoding="utf-8")
    return directory


def test_package_launcher_writes_a_manifest_the_server_accepts(
    build_viewer: ModuleType, tmp_path: Path
) -> None:
    dest = tmp_path / "viewer_dist"
    manifest = build_viewer.package_launcher(built_launcher(tmp_path), dest)
    assert manifest == {
        "bytes": len(LAUNCHER),
        "sha256": hashlib.sha256(LAUNCHER).hexdigest(),
        "script_sources": [SCRIPT_SOURCE],
        "style_sources": [],
    }
    launcher = load_launcher(dest)
    assert launcher.html == LAUNCHER
    assert launcher.policy == launcher_policy([SCRIPT_SOURCE], [])
    assert oct((dest / "launcher.html").stat().st_mode & 0o777) in {"0o644", "0o666"}


@pytest.mark.parametrize(
    "record",
    [
        {"script_sources": [], "style_sources": []},
        {"script_sources": ["'unsafe-inline'"], "style_sources": []},
        {"script_sources": ["*"], "style_sources": []},
        {"style_sources": []},
        ["not", "an", "object"],
    ],
)
def test_package_launcher_refuses_bad_hash_records(
    build_viewer: ModuleType, tmp_path: Path, record: object
) -> None:
    with pytest.raises(build_viewer.BuildError):
        build_viewer.package_launcher(built_launcher(tmp_path, record), tmp_path / "out")
    assert not (tmp_path / "out" / "launcher.json").exists()


def test_package_launcher_refuses_a_policy_meta_tag(
    build_viewer: ModuleType, tmp_path: Path
) -> None:
    page = CSP.encode("utf-8") + LAUNCHER
    with pytest.raises(build_viewer.BuildError, match="must not carry"):
        build_viewer.package_launcher(built_launcher(tmp_path, page=page), tmp_path / "out")


def test_package_launcher_explains_a_missing_build(
    build_viewer: ModuleType, tmp_path: Path
) -> None:
    with pytest.raises(build_viewer.BuildError, match="did not produce"):
        build_viewer.package_launcher(tmp_path, tmp_path / "out")
