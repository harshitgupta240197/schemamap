"""The local launcher server: standard library only, bound to 127.0.0.1 (D-058, docs/UI.md).

Every request passes the Host check (DNS rebinding) and the Origin check (cross-origin pages)
before routing; every ``/api/*`` route also needs the session token in the
``X-SchemaMap-Token`` header. The token travels to the page in the launch URL's fragment, so it
never reaches a request line, a log or a Referer. Nothing is logged.
"""

from __future__ import annotations

import json
import secrets
import socketserver
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import cast
from urllib.parse import urlsplit

from schemamap import __version__
from schemamap.ui.assets import Launcher
from schemamap.ui.security import (
    LISTEN_HOST,
    TOKEN_HEADER,
    host_allowed,
    origin_allowed,
    token_matches,
)

REQUEST_TIMEOUT_SECONDS = 10

# Sent on every response. Pages other than the launcher (JSON, errors) get a policy that
# allows nothing, so a response opened directly as a document can do nothing either.
_COMMON_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Cache-Control": "no-store",
}
_NOTHING_POLICY = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"


class LauncherServer(ThreadingHTTPServer):
    """An HTTP server for the launcher on 127.0.0.1 and a port the operating system picks.

    The listening address is fixed: there is deliberately no parameter that could bind it to
    another interface.
    """

    daemon_threads = True

    def __init__(self, launcher: Launcher, *, token: str | None = None) -> None:
        self.launcher = launcher
        self.token = token if token is not None else secrets.token_urlsafe(32)
        super().__init__((LISTEN_HOST, 0), LauncherHandler)

    def server_bind(self) -> None:
        """Bind without HTTPServer's reverse DNS lookup of the address (it can stall)."""
        socketserver.TCPServer.server_bind(self)
        host, port = self.server_address[:2]
        self.server_name = str(host)
        self.server_port = int(port)

    def handle_error(self, request: object, client_address: object) -> None:
        """Drop handler errors silently: a traceback on stderr could quote request data."""

    @property
    def port(self) -> int:
        """The port the server listens on."""
        return int(self.server_address[1])

    @property
    def url(self) -> str:
        """The launch URL, with the session token in the fragment."""
        return f"http://{LISTEN_HOST}:{self.port}/#t={self.token}"


class LauncherHandler(BaseHTTPRequestHandler):
    """Routes one request after the Host, Origin and token checks."""

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
        elif path == "/":
            if method not in ("GET", "HEAD"):
                self._error(HTTPStatus.METHOD_NOT_ALLOWED, "method_not_allowed", "Use GET.")
                return
            self._send(
                HTTPStatus.OK,
                server.launcher.html,
                "text/html; charset=utf-8",
                server.launcher.policy,
            )
        else:
            self._error(HTTPStatus.NOT_FOUND, "not_found", "Not found.")

    def _api(self, method: str, path: str) -> None:
        # A token in the query string is ignored on purpose: only the header counts.
        if not token_matches(self.headers.get(TOKEN_HEADER), self._launcher_server.token):
            self._error(HTTPStatus.UNAUTHORIZED, "unauthorized", "Missing or wrong token.")
            return
        if path != "/api/health":
            self._error(HTTPStatus.NOT_FOUND, "not_found", "Not found.")
            return
        if method not in ("GET", "HEAD"):
            self._error(HTTPStatus.METHOD_NOT_ALLOWED, "method_not_allowed", "Use GET.")
            return
        self._json(HTTPStatus.OK, {"status": "ok", "version": __version__})

    def _json(self, status: HTTPStatus, value: object) -> None:
        body = json.dumps(value, separators=(",", ":")).encode("utf-8")
        self._send(status, body, "application/json", _NOTHING_POLICY)

    def _error(self, status: HTTPStatus, code: str, message: str) -> None:
        self._json(status, {"error": {"code": code, "message": message}})

    def _send(self, status: HTTPStatus, body: bytes, content_type: str, policy: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Content-Security-Policy", policy)
        for name, value in _COMMON_HEADERS.items():
            self.send_header(name, value)
        if status == HTTPStatus.METHOD_NOT_ALLOWED:
            self.send_header("Allow", "GET, HEAD")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)
