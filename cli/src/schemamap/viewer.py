"""Put a snapshot into the packaged single-file viewer to make one offline HTML map.

The viewer build ships one empty ``<script type="application/json" id="schemamap-data">``.
Embedding replaces that exact text, once, with the same element holding the snapshot JSON.
Object names and SQL text are untrusted, so the JSON is escaped before it goes into HTML: no
name can close the script element, open a comment or end the line of a script.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

from schemamap.errors import EmbedError, ViewerUnavailableError
from schemamap.snapshot.models import Snapshot

PLACEHOLDER = '<script type="application/json" id="schemamap-data"></script>'
_DATA_OPEN = '<script type="application/json" id="schemamap-data">'
_DATA_CLOSE = "</script>"

VIEWER_DIR = Path(__file__).resolve().parent / "viewer_dist"
VIEWER_FILE = "index.html"
MANIFEST_FILE = "manifest.json"
BUILD_COMMAND = "uv run tools/build_viewer.py"

# `<`, `>` and `&` could end the script or open a comment; U+2028 and U+2029 end a line in
# older JavaScript. Inside a JSON string all of them are legal as \uXXXX escapes, and outside
# strings none of them can occur, so the result parses to the identical value.
_ESCAPES = {
    ord("<"): "\\u003c",
    ord(">"): "\\u003e",
    ord("&"): "\\u0026",
    0x2028: "\\u2028",
    0x2029: "\\u2029",
}


@dataclass(frozen=True)
class ViewerTemplate:
    """The packaged viewer page and the version recorded when it was built."""

    html: str
    version: str


def escape_for_script(json_text: str) -> str:
    """Make JSON text safe to place inside an HTML ``<script>`` element."""
    return json_text.translate(_ESCAPES)


def embed_snapshot(template: str, snapshot: Snapshot) -> str:
    """Return ``template`` with the snapshot filled into its data placeholder.

    Raises EmbedError unless the placeholder occurs exactly once. The replacement is a plain
    string replace: no regular expression and no format string, so text such as ``$&``, ``\\1``
    or ``{0}`` in a SQL definition is copied byte for byte.
    """
    found = template.count(PLACEHOLDER)
    if found != 1:
        raise EmbedError(
            f"the viewer page must contain its data placeholder exactly once, found {found}. "
            f"Rebuild it with `{BUILD_COMMAND}`."
        )
    document = json.dumps(
        snapshot.model_dump(mode="json"), ensure_ascii=False, separators=(",", ":")
    )
    return template.replace(PLACEHOLDER, _DATA_OPEN + escape_for_script(document) + _DATA_CLOSE)


def load_viewer(directory: Path | None = None) -> ViewerTemplate:
    """Read the packaged viewer and check it against its manifest.

    Raises ViewerUnavailableError, naming ``tools/build_viewer.py``, when the viewer is absent,
    unreadable or changed since it was built.
    """
    directory = VIEWER_DIR if directory is None else directory
    rebuild = f"Build it with `{BUILD_COMMAND}` (needs Node.js)."
    try:
        page = (directory / VIEWER_FILE).read_bytes()
        manifest = json.loads((directory / MANIFEST_FILE).read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ViewerUnavailableError(f"The packaged viewer is not built. {rebuild}") from None
    except (OSError, ValueError) as exc:
        raise ViewerUnavailableError(
            f"The packaged viewer cannot be read ({type(exc).__name__}). {rebuild}"
        ) from None
    expected = manifest.get("sha256") if isinstance(manifest, dict) else None
    version = manifest.get("viewer_version") if isinstance(manifest, dict) else None
    if not isinstance(expected, str) or not isinstance(version, str):
        raise ViewerUnavailableError(f"The viewer manifest is malformed. {rebuild}")
    if hashlib.sha256(page).hexdigest() != expected:
        raise ViewerUnavailableError(f"The packaged viewer does not match its manifest. {rebuild}")
    try:
        return ViewerTemplate(html=page.decode("utf-8"), version=version)
    except UnicodeDecodeError:
        raise ViewerUnavailableError(f"The packaged viewer is not valid UTF-8. {rebuild}") from None
