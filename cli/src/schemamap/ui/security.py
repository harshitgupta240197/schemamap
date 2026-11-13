"""Request checks for the local launcher: Host, Origin, Fetch Metadata, launch code, token.

Pure functions over header values (and one small clock-driven class), so every rule is
unit-tested without a socket. See docs/UI.md and D-060.
"""

from __future__ import annotations

import hmac
import secrets
import threading
import time
from collections.abc import Callable

LISTEN_HOST = "127.0.0.1"
LOCAL_NAMES = ("127.0.0.1", "localhost")
TOKEN_HEADER = "X-SchemaMap-Token"
LAUNCH_CODE_TTL_SECONDS = 60.0
# Sec-Fetch-Site values for a navigation the user made: opened from the launcher, or typed,
# bookmarked or reloaded. Everything else (cross-site, same-site on another port) is refused.
_OWN_FETCH_SITES = frozenset({"same-origin", "none"})


def allowed_hosts(port: int) -> frozenset[str]:
    """The only ``Host`` header values the launcher answers: loopback names with its port."""
    return frozenset(f"{name}:{port}" for name in LOCAL_NAMES)


def host_allowed(host: str | None, port: int) -> bool:
    """Whether ``host`` names this launcher. Anything else may be DNS rebinding.

    Compared case-insensitively, since host names are; a missing Host is refused.
    """
    return host is not None and host.strip().lower() in allowed_hosts(port)


def origin_allowed(origin: str | None, port: int) -> bool:
    """Whether a request's ``Origin`` is absent or this launcher's own origin.

    Browsers send Origin on cross-origin requests and on every POST, so a page on any other
    origin (including another port on 127.0.0.1, and the opaque ``null`` origin) is refused.
    """
    if origin is None:
        return True
    return origin.strip().lower() in {f"http://{host}" for host in allowed_hosts(port)}


def token_matches(supplied: str | None, expected: str) -> bool:
    """Whether ``supplied`` equals the session token, compared in constant time."""
    if supplied is None:
        return False
    return hmac.compare_digest(supplied.encode("utf-8"), expected.encode("utf-8"))


def fetch_site_allowed(site: str | None) -> bool:
    """Whether a ``Sec-Fetch-Site`` value may open a map tab.

    A missing header (older browsers, scripts) is allowed: the Host and Origin checks and the
    128-bit map id still apply. A browser that sends the header and says anything but
    ``same-origin`` or ``none`` is a page on another site, and is refused.
    """
    return site is None or site.strip().lower() in _OWN_FETCH_SITES


class LaunchCode:
    """The one-time code in the launch link, traded once for the session token (D-060).

    The link is visible in the browser-launch process's arguments and the terminal, so it must
    not be the session token. The code is random, valid for ``ttl`` seconds from creation and
    redeemable once. A wrong guess does not use it up, so a stray request cannot burn it.
    """

    def __init__(
        self,
        *,
        ttl: float = LAUNCH_CODE_TTL_SECONDS,
        clock: Callable[[], float] = time.monotonic,
        code: str | None = None,
    ) -> None:
        self._code: bytes | None = (
            code if code is not None else secrets.token_urlsafe(32)
        ).encode()
        self._clock = clock
        self._expires = clock() + ttl
        self._lock = threading.Lock()

    @property
    def code(self) -> str | None:
        """The code for the launch link, or None once it was used or expired."""
        with self._lock:
            self._expire_if_due()
            return None if self._code is None else self._code.decode()

    def redeem(self, supplied: str | None) -> bool:
        """Use the code: true exactly once, and only before it expires."""
        with self._lock:
            self._expire_if_due()
            if self._code is None or supplied is None:
                return False
            if not hmac.compare_digest(supplied.encode("utf-8"), self._code):
                return False
            self._code = None
            return True

    def _expire_if_due(self) -> None:
        if self._code is not None and self._clock() >= self._expires:
            self._code = None
