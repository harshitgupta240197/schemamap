"""The launcher's data folder: where it keeps maps and remembered connections (docs/UI.md)."""

from __future__ import annotations

import os
from pathlib import Path

from schemamap.errors import DataDirError

FOLDER_NAME = "SchemaMap"


def default_data_dir() -> Path:
    """``~/SchemaMap`` on macOS and Linux, ``%USERPROFILE%\\SchemaMap`` on Windows."""
    return Path.home() / FOLDER_NAME


def prepare_data_dir(path: Path) -> Path:
    """Create the data folder (readable only by its owner on POSIX) and return it, resolved.

    A folder that already exists is left as it is: its owner chose its permissions. Raises
    DataDirError when the path is a file or the folder cannot be made.
    """
    path = path.expanduser()
    try:
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
        resolved = path.resolve()
    except OSError as exc:
        raise DataDirError(f"Cannot create the data folder {path}: {exc.strerror or exc}") from None
    if not resolved.is_dir() or not os.access(resolved, os.W_OK | os.X_OK):
        raise DataDirError(f"The data folder {resolved} is not a folder you can write to.")
    return resolved
