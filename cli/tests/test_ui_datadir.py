"""The launcher's data folder: default location and safe creation."""

from __future__ import annotations

import os
import stat
import sys
from pathlib import Path

import pytest

from schemamap.errors import DataDirError
from schemamap.ui.datadir import default_data_dir, prepare_data_dir


def test_the_default_is_schemamap_in_the_home_folder(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    assert default_data_dir() == tmp_path / "SchemaMap"


def test_the_default_follows_the_platform_home_variable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    variable = "USERPROFILE" if sys.platform == "win32" else "HOME"
    monkeypatch.setenv(variable, str(tmp_path))
    assert default_data_dir() == Path(os.path.expanduser("~")) / "SchemaMap"
    assert default_data_dir().parent == tmp_path


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX permission bits")
def test_a_new_data_folder_is_private_to_its_owner(tmp_path: Path) -> None:
    target = tmp_path / "a" / "SchemaMap"
    assert prepare_data_dir(target) == target.resolve()
    assert stat.S_IMODE(target.stat().st_mode) == 0o700


def test_an_existing_folder_is_kept_as_it_is(tmp_path: Path) -> None:
    (tmp_path / "keep.txt").write_text("x", encoding="utf-8")
    assert prepare_data_dir(tmp_path) == tmp_path.resolve()
    assert (tmp_path / "keep.txt").read_text(encoding="utf-8") == "x"


def test_a_path_with_spaces_and_non_ascii_names_works(tmp_path: Path) -> None:
    target = tmp_path / "Zoë Müller" / "Schema Map"
    assert prepare_data_dir(target).is_dir()


def test_a_file_in_the_way_is_a_clear_error(tmp_path: Path) -> None:
    blocker = tmp_path / "SchemaMap"
    blocker.write_text("x", encoding="utf-8")
    with pytest.raises(DataDirError, match="SchemaMap"):
        prepare_data_dir(blocker)
    with pytest.raises(DataDirError):
        prepare_data_dir(blocker / "inside")


# A home folder that has a space, accents, an apostrophe and a script that is not Latin: the
# shapes real Windows, macOS and Linux user names take. The suite runs on all three systems in CI.
HOME_NAMES = ["Zoë Müller", "Jane Doe", "José O'Brien", "李雷", "Aleksandr Ivanov (work)"]


def _set_home(monkeypatch: pytest.MonkeyPatch, home: Path) -> None:
    """Point the platform's own home lookup at ``home`` (USERPROFILE on Windows, HOME elsewhere)."""
    variable = "USERPROFILE" if sys.platform == "win32" else "HOME"
    monkeypatch.setenv(variable, str(home))
    if sys.platform == "win32":
        monkeypatch.delenv("HOME", raising=False)


@pytest.mark.parametrize("name", HOME_NAMES)
def test_the_default_folder_sits_in_a_home_with_spaces_and_non_ascii_letters(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, name: str
) -> None:
    home = tmp_path / name
    home.mkdir()
    _set_home(monkeypatch, home)
    assert default_data_dir() == home / "SchemaMap"
    made = prepare_data_dir(default_data_dir())
    assert made.is_dir() and made.name == "SchemaMap"
    assert made == (home / "SchemaMap").resolve()
    (made / "probe.txt").write_text("ä", encoding="utf-8")
    assert (made / "probe.txt").read_text(encoding="utf-8") == "ä"


@pytest.mark.parametrize("name", HOME_NAMES)
def test_a_tilde_path_expands_to_the_home_with_spaces_and_non_ascii_letters(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, name: str
) -> None:
    home = tmp_path / name
    home.mkdir()
    _set_home(monkeypatch, home)
    assert prepare_data_dir(Path("~") / "My Maps" / "Schéma") == (home / "My Maps" / "Schéma")
    assert (home / "My Maps" / "Schéma").is_dir()


def test_the_default_folder_name_is_the_same_on_every_system() -> None:
    assert default_data_dir().name == "SchemaMap"
