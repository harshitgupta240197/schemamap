"""The local launcher server: standard library only, bound to 127.0.0.1 (D-058, docs/UI.md).

Every request passes the Host check (DNS rebinding) and the Origin check (cross-origin pages)
before routing. Every ``/api/*`` route except ``POST /api/session`` also needs the session
token in the ``X-SchemaMap-Token`` header. The launch link carries a one-time code instead of
the token (D-060): the page trades it for the token once, so a link seen later is worthless.
Nothing is logged.
"""

from __future__ import annotations

import json
import re
import secrets
import socketserver
import threading
import time
from collections.abc import Callable
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import cast
from urllib.parse import urlsplit

from schemamap import __version__
from schemamap.ui.assets import Launcher
from schemamap.ui.security import (
    LISTEN_HOST,
    TOKEN_HEADER,
    LaunchCode,
    fetch_site_allowed,
    host_allowed,
    origin_allowed,
    token_matches,
)

REQUEST_TIMEOUT_SECONDS = 10
MAX_BODY_BYTES = 1024 * 1024
IDLE_TIMEOUT_SECONDS = 30 * 60

# Sent on every response. Pages other than the launcher (JSON, errors) get a policy that
# allows nothing, so a response opened directly as a document can do nothing either.
_COMMON_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Cache-Control": "no-store",
}
_NOTHING_POLICY = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
# A map keeps its own meta policy (connect-src 'none'); only the framing rule needs a header.
_MAP_POLICY = "frame-ancestors 'none'"

# Methods each API route answers. A route's methods that carry a body need a JSON body.
_API_ROUTES: dict[str, tuple[str, ...]] = {
    "/api/health": ("GET", "HEAD"),
    "/api/quit": ("POST",),
    "/api/session": ("POST",),
}
_BODY_METHODS = frozenset({"POST", "PUT", "PATCH"})
_SESSION_PATH = "/api/session"
_MAP_PREFIX = "/maps/"
_MAP_ID = re.compile(r"[0-9a-f]{32}")


class _Refused(Exception):
    """A request the handler answers with an error instead of routing it."""

    def __init__(self, status: HTTPStatus, code: str, message: str) -> None:
        super().__init__(code)
        self.status = status
        self.code = code
        self.message = message


class LauncherServer(ThreadingHTTPServer):
    """An HTTP server for the launcher on 127.0.0.1, on ``port`` or one the system picks (0).

    The listening address is fixed: there is deliberately no parameter that could bind it to
    another interface. ``clock`` is injectable so expiry and idle shutdown are tested without
    waiting.
    """

    daemon_threads = True

    def __init__(
        self,
        launcher: Launcher,
        *,
        data_dir: Path,
        port: int = 0,
        token: str | None = None,
        code: str | None = None,
        clock: Callable[[], float] = time.monotonic,
        idle_timeout: float = IDLE_TIMEOUT_SECONDS,
    ) -> None:
        self.launcher = launcher
        self.data_dir = data_dir
        self.token = token if token is not None else secrets.token_urlsafe(32)
        self.launch_code = LaunchCode(clock=clock, code=code)
        self.stop_reason: str | None = None
        self._clock = clock
        self._idle_timeout = idle_timeout
        self._last_activity = clock()
        self._stop_lock = threading.Lock()
        super().__init__((LISTEN_HOST, port), LauncherHandler)

    def server_bind(self) -> None:
        """Bind without HTTPServer's reverse DNS lookup of the address (it can stall)."""
        socketserver.TCPServer.server_bind(self)
        host, port = self.server_address[:2]
        self.server_name = str(host)
        self.server_port = int(port)

    def handle_error(self, request: object, client_address: object) -> None:
        """Drop handler errors silently: a traceback on stderr could quote request data."""

    def service_actions(self) -> None:
        """Called by ``serve_forever`` between polls: stop after the idle timeout."""
        if self._clock() - self._last_activity >= self._idle_timeout:
            self.request_stop("idle")

    def touch(self) -> None:
        """Record that someone used the launcher, which restarts the idle timer."""
        self._last_activity = self._clock()

    def request_stop(self, reason: str) -> None:
        """Stop ``serve_forever`` from another thread. The first reason given is kept."""
        with self._stop_lock:
            if self.stop_reason is not None:
                return
            self.stop_reason = reason
        # shutdown() waits for serve_forever to end, so it cannot run on a request thread
        # that serve_forever may be waiting for, nor on serve_forever's own thread.
        threading.Thread(target=self.shutdown, daemon=True).start()

    @property
    def port(self) -> int:
        """The port the server listens on."""
        return int(self.server_address[1])

    @property
    def url(self) -> str:
        """The launch link: the one-time code in the fragment, which is never sent to a server.

        Without a code (already used or expired) it is the bare address, which the page
        explains.
        """
        code = self.launch_code.code
        fragment = "" if code is None else f"#c={code}"
        return f"http://{LISTEN_HOST}:{self.port}/{fragment}"


class LauncherHandler(BaseHTTPRequestHandler):
    """Routes one request after the Host and Origin checks."""

    server_version = "SchemaMap"
    sys_version = ""
    timeout = REQUEST_TIMEOUT_SECONDS

    @property
    def _launcher_server(self) -> LauncherServer:
        return cast(LauncherServer, self.server)

    def log_message(self, format: str, *args: object) -> None:
        """Log nothing: request lines and errors stay off the terminal and out of files."""

    def do_GET(self) -> None:
        self._handle("GET")

    def do_HEAD(self) -> None:
        self._handle("HEAD")

    def do_POST(self) -> None:
        self._handle("POST")

    def do_PUT(self) -> None:
        self._handle("PUT")

    def do_PATCH(self) -> None:
        self._handle("PATCH")

    def do_DELETE(self) -> None:
        self._handle("DELETE")

    def do_OPTIONS(self) -> None:
        self._handle("OPTIONS")

    def _handle(self, method: str) -> None:
        server = self._launcher_server
        if not host_allowed(self.headers.get("Host"), server.port):
            self._error(HTTPStatus.FORBIDDEN, "forbidden_host", "This address is not allowed.")
            return
        if not origin_allowed(self.headers.get("Origin"), server.port):
            self._error(HTTPStatus.FORBIDDEN, "forbidden_origin", "This origin is not allowed.")
            return
        path = urlsplit(self.path).path
        if path == "/api" or path.startswith("/api/"):
            self._api(method, path)
        elif path.startswith(_MAP_PREFIX):
            self._map(method, path.removeprefix(_MAP_PREFIX))
        elif path == "/":
            if method not in ("GET", "HEAD"):
                self._method_not_allowed(("GET", "HEAD"))
                return
            self._send(
                HTTPStatus.OK,
                server.launcher.html,
                "text/html; charset=utf-8",
                server.launcher.policy,
            )
        else:
            self._error(HTTPStatus.NOT_FOUND, "not_found", "Not found.")

    def _map(self, method: str, map_id: str) -> None:
        """Serve a map to a tab the user opened: no token (a navigation cannot send one).

        Guarded by the 128-bit id, the Host and Origin checks, and Fetch Metadata: a request a
        browser marks as coming from another site is refused (D-060).
        """
        if method not in ("GET", "HEAD"):
            self._method_not_allowed(("GET", "HEAD"))
            return
        if not fetch_site_allowed(self.headers.get("Sec-Fetch-Site")):
            self._error(
                HTTPStatus.FORBIDDEN, "forbidden_fetch_site", "This request is not allowed."
            )
            return
        page = self._read_map(map_id)
        if page is None:
            self._error(HTTPStatus.NOT_FOUND, "not_found", "Not found.")
            return
        self._send(HTTPStatus.OK, page, "text/html; charset=utf-8", _MAP_POLICY)

    def _read_map(self, map_id: str) -> bytes | None:
        # Only a 32-character lowercase hex id reaches the file system, so no path from the
        # request is ever joined: ``..``, separators and percent-escapes all fail the match.
        if _MAP_ID.fullmatch(map_id) is None:
            return None
        try:
            return (self._launcher_server.data_dir / "maps" / map_id / "map.html").read_bytes()
        except OSError:
            return None

    def _api(self, method: str, path: str) -> None:
        # A token in the query string is ignored on purpose: only the header counts. The
        # session route is the one place a token is handed out, so it takes a launch code.
        if path != _SESSION_PATH and not token_matches(
            self.headers.get(TOKEN_HEADER), self._launcher_server.token
        ):
            self._error(HTTPStatus.UNAUTHORIZED, "unauthorized", "Missing or wrong token.")
            return
        methods = _API_ROUTES.get(path)
        if methods is None:
            self._error(HTTPStatus.NOT_FOUND, "not_found", "Not found.")
            return
        if method not in methods:
            self._method_not_allowed(methods)
            return
        body: dict[str, object] = {}
        if method in _BODY_METHODS:
            try:
                body = self._read_json_body()
            except _Refused as refusal:
                # The body may be unread, so the connection must not be reused.
                self.close_connection = True
                self._error(refusal.status, refusal.code, refusal.message)
                return
        if path == "/api/health":
            self._json(HTTPStatus.OK, {"status": "ok", "version": __version__})
        elif path == "/api/quit":
            self._json(HTTPStatus.OK, {"status": "stopping"})
            self._launcher_server.request_stop("quit")
        else:
            self._session(body)

    def _session(self, body: dict[str, object]) -> None:
        """Trade the one-time launch code for the session token."""
        server = self._launcher_server
        code = body.get("code")
        if not isinstance(code, str):
            self._error(HTTPStatus.BAD_REQUEST, "bad_request", "Send the launch code as text.")
        elif server.launch_code.redeem(code):
            self._json(HTTPStatus.OK, {"token": server.token})
        else:
            self._error(
                HTTPStatus.UNAUTHORIZED,
                "unauthorized",
                "The launch code is wrong, already used or expired.",
            )

    def _read_json_body(self) -> dict[str, object]:
        """Read the request body as a JSON object. Raises _Refused with the error to send.

        The size is judged from ``Content-Length`` before anything is read, so an oversized
        body is never buffered. Chunked bodies are refused because they hide their size.
        """
        declared = self.headers.get("Content-Length")
        if self.headers.get("Transfer-Encoding") is not None or declared is None:
            raise _Refused(HTTPStatus.LENGTH_REQUIRED, "length_required", "Send a Content-Length.")
        if not declared.isascii() or not declared.isdigit():
            raise _Refused(HTTPStatus.BAD_REQUEST, "bad_request", "Bad Content-Length.")
        length = int(declared)
        if length > MAX_BODY_BYTES:
            raise _Refused(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "too_large", "Body too large.")
        content_type = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if content_type != "application/json":
            raise _Refused(
                HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
                "unsupported_media_type",
                "Send application/json.",
            )
        raw = self.rfile.read(length)
        try:
            value = json.loads(raw)
        except (ValueError, RecursionError):
            value = None
        if not isinstance(value, dict):
            raise _Refused(HTTPStatus.BAD_REQUEST, "bad_request", "Send a JSON object.")
        return cast("dict[str, object]", value)

    def _method_not_allowed(self, methods: tuple[str, ...]) -> None:
        self._error(
            HTTPStatus.METHOD_NOT_ALLOWED,
            "method_not_allowed",
            "Use " + " or ".join(methods) + ".",
            allow=", ".join(methods),
        )

    def _json(self, status: HTTPStatus, value: object) -> None:
        body = json.dumps(value, separators=(",", ":")).encode("utf-8")
        self._send(status, body, "application/json", _NOTHING_POLICY)

    def _error(
        self, status: HTTPStatus, code: str, message: str, *, allow: str | None = None
    ) -> None:
        body = json.dumps({"error": {"code": code, "message": message}}, separators=(",", ":"))
        self._send(status, body.encode("utf-8"), "application/json", _NOTHING_POLICY, allow=allow)

    def _send(
        self,
        status: HTTPStatus,
        body: bytes,
        content_type: str,
        policy: str,
        *,
        allow: str | None = None,
    ) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Content-Security-Policy", policy)
        for name, value in _COMMON_HEADERS.items():
            self.send_header(name, value)
        if allow is not None:
            self.send_header("Allow", allow)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)
        if status < HTTPStatus.BAD_REQUEST:
            self._launcher_server.touch()
