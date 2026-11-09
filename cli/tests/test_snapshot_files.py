"""Writing and reading snapshot files: names, gzip, atomic replace, and bad input."""

from __future__ import annotations

import gzip
import os
from datetime import datetime, timezone
from pathlib import Path

import pytest

from schemamap.errors import SnapshotError
from schemamap.snapshot.io import (
    default_output_path,
    dump_snapshot,
    read_snapshot,
    write_snapshot,
)
from schemamap.snapshot.models import Generator, Snapshot, SourceInfo

GZIP_FLAG_FNAME = 0x08


def sample() -> Snapshot:
    return Snapshot(
        generator=Generator(version="9.9.9"),
        captured_at=datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc),
        source=SourceInfo(server="host-1", database="Sample"),
    )


def test_default_name_is_database_dot_snapshot_json() -> None:
    assert default_output_path("AdventureWorks2022") == Path("AdventureWorks2022.snapshot.json")


def test_default_name_with_gzip_adds_gz() -> None:
    assert default_output_path("Sales", compress=True) == Path("Sales.snapshot.json.gz")


@pytest.mark.parametrize(
    ("database", "expected"),
    [
        ("../../etc/passwd", "_.._etc_passwd.snapshot.json"),
        (".hidden", "hidden.snapshot.json"),
        ("a/b\\c", "a_b_c.snapshot.json"),
        ("My DB; DROP", "My_DB__DROP.snapshot.json"),
        ("..", "database.snapshot.json"),
        ("café", "caf_.snapshot.json"),
        ("nul\x00byte", "nul_byte.snapshot.json"),
    ],
)
def test_default_name_cannot_leave_the_current_folder(database: str, expected: str) -> None:
    path = default_output_path(database)
    assert path.name == expected
    assert path.parent == Path(".")


@pytest.mark.parametrize(
    ("database", "expected"),
    [
        ("CON", "_CON.snapshot.json"),
        ("nul", "_nul.snapshot.json"),
        ("Com1", "_Com1.snapshot.json"),
        ("LPT9.archive", "_LPT9.archive.snapshot.json"),
        ("AUX", "_AUX.snapshot.json"),
        ("Console", "Console.snapshot.json"),
        ("CONTOSO", "CONTOSO.snapshot.json"),
    ],
)
def test_default_name_is_never_a_windows_device(database: str, expected: str) -> None:
    """On Windows ``CON.snapshot.json`` opens the console device, not a file."""
    assert default_output_path(database).name == expected


def test_a_planted_symlink_is_never_followed(tmp_path: Path) -> None:
    """Someone who can write to the folder cannot redirect the snapshot onto another file."""
    victim = tmp_path / "victim.txt"
    victim.write_text("precious", encoding="utf-8")
    try:
        (tmp_path / ".s.json.tmp").symlink_to(victim)
    except OSError:
        pytest.skip("symlinks need extra privileges on this system")
    written = write_snapshot(sample(), tmp_path / "s.json")
    assert victim.read_text(encoding="utf-8") == "precious"
    assert not written.is_symlink()
    assert read_snapshot(written) == sample()


@pytest.mark.skipif(os.name != "posix", reason="POSIX permission bits")
def test_snapshot_is_readable_only_by_its_owner(tmp_path: Path) -> None:
    """A snapshot holds SQL definitions and the host name: private until the user shares it."""
    written = write_snapshot(sample(), tmp_path / "s.json")
    assert written.stat().st_mode & 0o077 == 0


def test_plain_file_is_the_dump_and_loads_back(tmp_path: Path) -> None:
    written = write_snapshot(sample(), tmp_path / "s.json")
    assert written == tmp_path / "s.json"
    assert written.read_text(encoding="utf-8") == dump_snapshot(sample())
    assert read_snapshot(written) == sample()


def test_gzip_appends_gz_and_round_trips(tmp_path: Path) -> None:
    written = write_snapshot(sample(), tmp_path / "s.json", compress=True)
    assert written == tmp_path / "s.json.gz"
    assert not (tmp_path / "s.json").exists()
    assert gzip.decompress(written.read_bytes()).decode("utf-8") == dump_snapshot(sample())
    assert read_snapshot(written) == sample()


def test_gzip_keeps_an_existing_gz_suffix(tmp_path: Path) -> None:
    written = write_snapshot(sample(), tmp_path / "s.json.gz", compress=True)
    assert written.name == "s.json.gz"


def test_gzip_bytes_are_identical_between_runs_and_carry_no_name_or_time(tmp_path: Path) -> None:
    first = write_snapshot(sample(), tmp_path / "a.json", compress=True).read_bytes()
    second = write_snapshot(sample(), tmp_path / "b.json", compress=True).read_bytes()
    assert first == second
    assert first[3] & GZIP_FLAG_FNAME == 0
    assert first[4:8] == b"\x00\x00\x00\x00"


def test_reading_detects_gzip_by_content_not_extension(tmp_path: Path) -> None:
    disguised = tmp_path / "plain-name.json"
    disguised.write_bytes(gzip.compress(dump_snapshot(sample()).encode("utf-8")))
    assert read_snapshot(disguised) == sample()


def test_existing_file_is_replaced_and_no_temporary_is_left(tmp_path: Path) -> None:
    target = tmp_path / "s.json"
    target.write_text("old", encoding="utf-8")
    write_snapshot(sample(), target)
    assert read_snapshot(target) == sample()
    assert [p.name for p in tmp_path.iterdir()] == ["s.json"]


def test_failed_write_leaves_the_old_file_and_no_temporary(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    target = tmp_path / "s.json"
    target.write_text("old", encoding="utf-8")

    def broken(*_: object) -> None:
        raise OSError("disk full")

    monkeypatch.setattr("schemamap.snapshot.io.os.replace", broken)
    with pytest.raises(OSError, match="disk full"):
        write_snapshot(sample(), target)
    assert target.read_text(encoding="utf-8") == "old"
    assert [p.name for p in tmp_path.iterdir()] == ["s.json"]


def test_missing_directory_raises_oserror(tmp_path: Path) -> None:
    with pytest.raises(OSError):
        write_snapshot(sample(), tmp_path / "nope" / "s.json")


def test_reading_a_missing_file_is_a_snapshot_error(tmp_path: Path) -> None:
    with pytest.raises(SnapshotError, match="cannot read"):
        read_snapshot(tmp_path / "missing.json")


def test_reading_a_truncated_gzip_is_a_snapshot_error(tmp_path: Path) -> None:
    broken = tmp_path / "s.json.gz"
    broken.write_bytes(gzip.compress(b"x" * 1000)[:20])
    with pytest.raises(SnapshotError, match="cannot read"):
        read_snapshot(broken)


def test_reading_a_corrupt_gzip_is_a_snapshot_error(tmp_path: Path) -> None:
    broken = tmp_path / "s.json.gz"
    broken.write_bytes(b"\x1f\x8b" + b"not really gzip")
    with pytest.raises(SnapshotError, match="cannot read"):
        read_snapshot(broken)
