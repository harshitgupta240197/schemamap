"""Request checks for the local launcher: Host, Origin and the session token (docs/UI.md).

Pure functions over header values, so every rule is unit-tested without a socket.
"""

from __future__ import annotations

import hmac

LISTEN_HOST = "127.0.0.1"
LOCAL_NAMES = ("127.0.0.1", "localhost")
TOKEN_HEADER = "X-SchemaMap-Token"


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
