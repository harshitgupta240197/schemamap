"""The maps library: files on disk, ids, listing, imports, and that no request names a path."""

from __future__ import annotations

import gzip
import json
import os
import re
import stat
from pathlib import Path

import pytest
from snapshot_builders import hostile_snapshot
from typer.testing import CliRunner
from ui_fakes import small_snapshot, stub_template, write_stub_viewer

from schemamap.cli import app
from schemamap.errors import EmbedError, SnapshotError, SnapshotVersionError
from schemamap.snapshot.io import (
    dump_snapshot,
    load_snapshot,
    read_snapshot,
    write_bytes_atomic,
    write_snapshot,
)
from schemamap.ui import library as library_module
from schemamap.ui.library import MAP_ID, MapLibrary, read_upload
from schemamap.viewer import ViewerTemplate

runner = CliRunner()


@pytest.fixture
def library(tmp_path: Path) -> MapLibrary:
    return MapLibrary(tmp_path / "data", template=stub_template)


def test_a_map_is_three_files_under_a_generated_id(library: MapLibrary, tmp_path: Path) -> None:
    map_id = library.add(small_snapshot())
    assert re.fullmatch(r"[0-9a-f]{32}", map_id)
    folder = tmp_path / "data" / "maps" / map_id
    assert sorted(p.name for p in folder.iterdir()) == ["map.html", "meta.json", "snapshot.json.gz"]
    assert [p.name for p in (tmp_path / "data" / "maps").iterdir()] == [map_id]


def test_two_maps_get_two_ids(library: MapLibrary) -> None:
    assert library.add(small_snapshot()) != library.add(small_snapshot())


def test_the_stored_snapshot_is_the_snapshot_and_gzip_is_deterministic(
    library: MapLibrary, tmp_path: Path
) -> None:
    snapshot = small_snapshot()
    map_id = library.add(snapshot)
    stored = tmp_path / "data" / "maps" / map_id / "snapshot.json.gz"
    assert read_snapshot(stored) == snapshot
    assert stored.read_bytes() == gzip.compress(dump_snapshot(snapshot).encode(), mtime=0)


def test_the_served_map_is_byte_identical_to_what_schemamap_view_writes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("schemamap.viewer.VIEWER_DIR", write_stub_viewer(tmp_path / "viewer_dist"))
    snapshot = hostile_snapshot()
    snapshot_file = write_snapshot(snapshot, tmp_path / "hostile.snapshot.json")
    viewed = tmp_path / "viewed.html"
    result = runner.invoke(app, ["view", str(snapshot_file), "-o", str(viewed), "--no-open"])
    assert result.exit_code == 0

    library = MapLibrary(tmp_path / "data")  # the real loader, pointed at the stub viewer
    map_id = library.add(snapshot)
    assert library.read_map(map_id) == viewed.read_bytes()


def test_the_meta_file_holds_what_the_list_shows(library: MapLibrary, tmp_path: Path) -> None:
    snapshot = small_snapshot(tables=4)
    map_id = library.add(snapshot)
    meta = json.loads((tmp_path / "data" / "maps" / map_id / "meta.json").read_text("utf-8"))
    page = (tmp_path / "data" / "maps" / map_id / "map.html").read_bytes()
    assert meta == {
        "id": map_id,
        "database": snapshot.source.database,
        "server": "db-host.example",
        "extracted_at": snapshot.captured_at.isoformat().replace("+00:00", "Z"),
        "tables": 4,
        "bytes": len(page),
    }
    [entry] = library.entries()
    assert entry.to_json() == meta


def test_a_map_without_a_server_name_lists_none(library: MapLibrary) -> None:
    library.add(hostile_snapshot())  # built with the server redacted
    [entry] = library.entries()
    assert entry.server is None


def test_the_list_is_newest_extraction_first_with_ties_by_id(library: MapLibrary) -> None:
    older = small_snapshot(2, 1)
    newer = older.model_copy(update={"captured_at": older.captured_at.replace(year=2030)})
    first = library.add(older)
    second = library.add(newer)
    third = library.add(newer)
    ids = [entry.id for entry in library.entries()]
    assert ids == [*sorted([second, third], reverse=True), first]


def test_an_empty_or_missing_library_lists_nothing(tmp_path: Path) -> None:
    assert MapLibrary(tmp_path / "nowhere").entries() == []


def test_a_folder_with_damaged_metadata_is_skipped_but_the_rest_is_listed(
    library: MapLibrary, tmp_path: Path
) -> None:
    good = library.add(small_snapshot())
    maps = tmp_path / "data" / "maps"
    for name, content in (
        ("a" * 32, "not json"),
        ("b" * 32, json.dumps({"database": 1})),
        ("c" * 32, json.dumps([1, 2])),
        (
            "d" * 32,
            json.dumps(
                {"database": "x", "server": None, "extracted_at": "t", "tables": True, "bytes": 1}
            ),
        ),
    ):
        (maps / name).mkdir()
        (maps / name / "meta.json").write_text(content, encoding="utf-8")
    (maps / "not-an-id").mkdir()
    (maps / "stray-file.txt").write_text("x", encoding="utf-8")
    assert [entry.id for entry in library.entries()] == [good]


def test_the_id_in_a_meta_file_is_ignored_in_favour_of_the_folder_name(
    library: MapLibrary, tmp_path: Path
) -> None:
    map_id = library.add(small_snapshot())
    meta_path = tmp_path / "data" / "maps" / map_id / "meta.json"
    meta = json.loads(meta_path.read_text("utf-8"))
    meta["id"] = "../../etc/passwd"
    meta_path.write_text(json.dumps(meta), encoding="utf-8")
    assert [entry.id for entry in library.entries()] == [map_id]


@pytest.mark.parametrize(
    "bad_id",
    [
        "",
        "..",
        "../" + "a" * 29,
        "a" * 31,
        "a" * 33,
        "A" * 32,
        "g" * 32,
        "%2e%2e",
        "a" * 32 + "/",
        "a" * 32 + "/map.html",
        "a" * 31 + "\x00",
        "/etc/passwd",
        "C:\\Windows",
    ],
)
def test_an_id_that_is_not_32_hex_characters_touches_no_file(
    library: MapLibrary, tmp_path: Path, bad_id: str
) -> None:
    library.add(small_snapshot())
    (tmp_path / "secret.txt").write_text("secret", encoding="utf-8")
    assert library.read_map(bad_id) is None
    assert library.entry(bad_id) is None
    assert library.delete(bad_id) is False
    assert (tmp_path / "secret.txt").exists()
    assert len(library.entries()) == 1


def test_a_well_formed_but_unknown_id_is_none_and_false(library: MapLibrary) -> None:
    assert library.read_map("f" * 32) is None
    assert library.entry("f" * 32) is None
    assert library.delete("f" * 32) is False


def test_delete_removes_the_whole_folder_and_leaves_no_trace_in_tmp(
    library: MapLibrary, tmp_path: Path
) -> None:
    keep = library.add(small_snapshot())
    gone = library.add(small_snapshot())
    assert library.delete(gone) is True
    assert not (tmp_path / "data" / "maps" / gone).exists()
    assert [entry.id for entry in library.entries()] == [keep]
    assert list((tmp_path / "data" / "tmp").iterdir()) == []
    assert library.delete(gone) is False


def test_the_download_name_is_a_safe_file_name_even_for_a_hostile_database(
    library: MapLibrary,
) -> None:
    map_id = library.add(hostile_snapshot())
    name = library.download_name(map_id)
    assert re.fullmatch(r"[A-Za-z0-9._-]+-map\.html", name)
    assert library.download_name("f" * 32) == "database-map.html"


@pytest.mark.skipif(os.name == "nt", reason="POSIX permissions")
def test_files_and_folders_are_private_to_the_owner(library: MapLibrary, tmp_path: Path) -> None:
    map_id = library.add(small_snapshot())
    folder = tmp_path / "data" / "maps" / map_id
    assert stat.S_IMODE(folder.stat().st_mode) == 0o700
    for file in folder.iterdir():
        assert stat.S_IMODE(file.stat().st_mode) == 0o600


def test_a_failed_add_leaves_nothing_behind(tmp_path: Path) -> None:
    def broken() -> ViewerTemplate:
        return ViewerTemplate(html="<html>no placeholder</html>", version="1")

    library = MapLibrary(tmp_path / "data", template=broken)
    with pytest.raises(EmbedError):
        library.add(small_snapshot())
    assert library.entries() == []
    assert [p for p in (tmp_path / "data").rglob("*") if p.is_file()] == []


def test_a_write_failure_midway_leaves_no_half_built_map(
    library: MapLibrary, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    real = write_bytes_atomic
    calls = []

    def fail_on_meta(path: Path, data: bytes) -> None:
        calls.append(path.name)
        if path.name == "meta.json":
            raise OSError("disk full")
        real(path, data)

    monkeypatch.setattr("schemamap.ui.library.write_bytes_atomic", fail_on_meta)
    with pytest.raises(OSError, match="disk full"):
        library.add(small_snapshot())
    assert "map.html" in calls
    assert library.entries() == []
    assert not (tmp_path / "data" / "maps").exists() or not list(
        (tmp_path / "data" / "maps").iterdir()
    )
    assert list((tmp_path / "data" / "tmp").iterdir()) == []


def test_clear_tmp_removes_leftovers(library: MapLibrary, tmp_path: Path) -> None:
    upload = library.new_upload_path()
    upload.write_bytes(b"x")
    (tmp_path / "data" / "tmp" / "map-left-over").mkdir()
    library.clear_tmp()
    assert not (tmp_path / "data" / "tmp").exists()
    library.clear_tmp()  # nothing to clear is fine


@pytest.mark.skipif(os.name == "nt", reason="POSIX permissions")
def test_an_upload_file_is_server_named_and_private(library: MapLibrary, tmp_path: Path) -> None:
    path = library.new_upload_path()
    assert path.parent == tmp_path / "data" / "tmp"
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert library.new_upload_path() != path


# -- importing --------------------------------------------------------------------------------


def upload_file(tmp_path: Path, data: bytes) -> Path:
    path = tmp_path / "upload.tmp"
    path.write_bytes(data)
    return path


def test_a_plain_upload_is_read_like_view_reads_it(tmp_path: Path) -> None:
    snapshot = small_snapshot()
    path = upload_file(tmp_path, dump_snapshot(snapshot).encode())
    assert read_upload(path) == snapshot


def test_a_gzip_upload_is_found_by_content_not_by_name(tmp_path: Path) -> None:
    snapshot = small_snapshot()
    path = upload_file(tmp_path, gzip.compress(dump_snapshot(snapshot).encode()))
    assert read_upload(path) == snapshot


def test_an_imported_snapshot_becomes_a_map_that_matches_the_original(
    library: MapLibrary, tmp_path: Path
) -> None:
    snapshot = small_snapshot()
    path = upload_file(tmp_path, gzip.compress(dump_snapshot(snapshot).encode()))
    map_id = library.add(read_upload(path))
    other = library.add(snapshot)
    assert library.read_map(map_id) == library.read_map(other)
    assert library.read_map(map_id) is not None


def test_a_snapshot_of_a_newer_major_version_is_refused_with_the_view_message(
    tmp_path: Path,
) -> None:
    document = json.loads(dump_snapshot(small_snapshot()))
    document["format_version"] = "2.0"
    path = upload_file(tmp_path, json.dumps(document).encode())
    with pytest.raises(SnapshotVersionError, match=r"unsupported snapshot format version '2\.0'"):
        read_upload(path)
    with pytest.raises(SnapshotVersionError) as direct:
        load_snapshot(json.dumps(document))
    with pytest.raises(SnapshotVersionError) as uploaded:
        read_upload(path)
    assert str(uploaded.value) == str(direct.value)


@pytest.mark.parametrize(
    ("data", "fragment"),
    [
        (b"", "not valid JSON"),
        (b"{not json", "not valid JSON"),
        (b"\xff\xfe\x00bad", "not valid JSON"),
        (b"[" * 100_000, "not valid JSON"),
        (b'{"format": "something-else"}', "not a Schema Map snapshot"),
        (b"[1, 2, 3]", "not a Schema Map snapshot"),
        (b"\x1f\x8b not really gzip", "not a valid snapshot file"),
        (gzip.compress(b"{not json"), "not valid JSON"),
    ],
)
def test_a_bad_upload_is_a_snapshot_error_with_a_plain_message(
    tmp_path: Path, data: bytes, fragment: str
) -> None:
    with pytest.raises(SnapshotError, match=fragment):
        read_upload(upload_file(tmp_path, data))


def test_a_truncated_gzip_upload_is_a_snapshot_error(tmp_path: Path) -> None:
    packed = gzip.compress(dump_snapshot(small_snapshot()).encode())
    with pytest.raises(SnapshotError, match="not a valid snapshot file"):
        read_upload(upload_file(tmp_path, packed[: len(packed) // 2]))


def test_an_upload_that_unpacks_past_the_limit_is_refused_without_reading_it_all(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(library_module, "MAX_UNPACKED_BYTES", 1000)
    bomb = gzip.compress(b" " * 100_000)
    assert len(bomb) < 1000
    with pytest.raises(SnapshotError, match="once unpacked"):
        read_upload(upload_file(tmp_path, bomb))
    with pytest.raises(SnapshotError, match="once unpacked"):
        read_upload(upload_file(tmp_path, b" " * 1001))


def test_an_upload_over_the_limit_is_never_unpacked_past_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A 50 MB gzip bomb against a 1 MB limit: decompression stops one byte past the limit."""
    limit = 1024 * 1024
    monkeypatch.setattr(library_module, "MAX_UNPACKED_BYTES", limit)
    produced = 0

    class Counting(gzip.GzipFile):
        def read(self, size: int | None = -1) -> bytes:
            nonlocal produced
            chunk = super().read(size)
            produced += len(chunk)
            return chunk

    monkeypatch.setattr(gzip, "GzipFile", Counting)
    bomb = gzip.compress(b" " * (50 * 1024 * 1024))
    with pytest.raises(SnapshotError, match="1 MB once unpacked"):
        read_upload(upload_file(tmp_path, bomb))
    assert produced == limit + 1


def test_map_ids_are_the_pattern_the_server_routes_use() -> None:
    assert MAP_ID.pattern == "[0-9a-f]{32}"
