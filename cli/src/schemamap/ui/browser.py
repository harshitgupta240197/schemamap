"""Opening the launcher in the user's browser, without ever running a shell command."""

from __future__ import annotations

import webbrowser
from urllib.parse import urlsplit

_OPENABLE_SCHEMES = frozenset({"http", "file"})


def open_in_browser(url: str) -> bool:
    """Open ``url`` in the default browser; true when a browser was started.

    Only ``http`` and ``file`` URLs without whitespace or control characters are passed on, so
    a URL can never become anything but an address. The standard library hands it to the
    system's opener as one argument, never through a shell.
    """
    if urlsplit(url).scheme not in _OPENABLE_SCHEMES:
        return False
    if any(character.isspace() or ord(character) < 32 for character in url):
        return False
    return webbrowser.open(url)
