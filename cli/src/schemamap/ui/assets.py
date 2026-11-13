"""The packaged launcher page and its Content-Security-Policy (D-059).

`tools/build_viewer.py` copies the single-file launcher to ``viewer_dist/launcher.html`` with
``launcher.json``: its sha256, byte count and the hash sources of its inline scripts and
styles. The policy is sent as an HTTP header (``frame-ancestors`` has no effect in a meta tag).
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path

from schemamap.errors import LauncherUnavailableError
from schemamap.viewer import BUILD_COMMAND, VIEWER_DIR

LAUNCHER_FILE = "launcher.html"
LAUNCHER_MANIFEST = "launcher.json"

# The only source form a header may carry: a quoted sha256 hash in base64. Checked before the
# value is used, so a tampered manifest cannot loosen the policy or inject a header.
_HASH_SOURCE = re.compile(r"'sha256-[A-Za-z0-9+/]{43}='")


@dataclass(frozen=True)
class Launcher:
    """The launcher page and the policy it is served with."""

    html: bytes
    policy: str


def launcher_policy(script_sources: list[str], style_sources: list[str]) -> str:
    """The launcher's Content-Security-Policy for these inline script and style hashes."""
    for source in [*script_sources, *style_sources]:
        if not _HASH_SOURCE.fullmatch(source):
            raise ValueError("a launcher hash source is malformed")
    if not script_sources:
        raise ValueError("the launcher has no script hash")
    return "; ".join(
        [
            "default-src 'self'",
            "script-src " + " ".join(script_sources),
            "style-src " + " ".join(["'self'", *style_sources]),
            "connect-src 'self'",
            "frame-ancestors 'none'",
            "form-action 'self'",
            "base-uri 'none'",
            "object-src 'none'",
        ]
    )


def _sources(manifest: dict[str, object], key: str) -> list[str]:
    value = manifest.get(key)
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValueError(f"{key} is not a list of strings")
    return [str(item) for item in value]


def load_launcher(directory: Path | None = None) -> Launcher:
    """Read the packaged launcher, check it against its manifest and build its policy.

    Raises LauncherUnavailableError, naming ``tools/build_viewer.py``, when the launcher is
    absent, unreadable, changed since it was built, or its manifest is malformed.
    """
    directory = VIEWER_DIR if directory is None else directory
    rebuild = f"Build it with `{BUILD_COMMAND}` (needs Node.js)."
    try:
        page = (directory / LAUNCHER_FILE).read_bytes()
        manifest = json.loads((directory / LAUNCHER_MANIFEST).read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise LauncherUnavailableError(f"The launcher page is not built. {rebuild}") from None
    except (OSError, ValueError) as exc:
        raise LauncherUnavailableError(
            f"The launcher page cannot be read ({type(exc).__name__}). {rebuild}"
        ) from None
    if not isinstance(manifest, dict) or manifest.get("sha256") != hashlib.sha256(page).hexdigest():
        raise LauncherUnavailableError(f"The launcher page does not match its manifest. {rebuild}")
    try:
        policy = launcher_policy(
            _sources(manifest, "script_sources"), _sources(manifest, "style_sources")
        )
    except ValueError as exc:
        raise LauncherUnavailableError(
            f"The launcher manifest is malformed: {exc}. {rebuild}"
        ) from None
    return Launcher(html=page, policy=policy)
