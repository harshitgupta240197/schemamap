"""Helpers for tests that talk to a real LauncherServer over a socket."""

from __future__ import annotations

import http.client
import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path

from launcher_builders import write_launcher

from schemamap.ui.assets import load_launcher
from schemamap.ui.server import LauncherServer

TOKEN = "test-token-0123456789"
CODE = "test-launch-code-0123456789"


class FakeClock:
    """A clock tests move by hand, so expiry and idle timeouts need no waiting."""

    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def request(
    server: LauncherServer,
    path: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    body: bytes | None = None,
) -> tuple[int, dict[str, str], bytes]:
    """Send one request. ``headers`` are sent exactly as given (Host defaults to loopback)."""
    connection = http.client.HTTPConnection("127.0.0.1", server.port, timeout=5)
    try:
        # skip_host so each test chooses the Host header, as an attacker's browser would.
        connection.putrequest(method, path, skip_host=True, skip_accept_encoding=True)
        sent = {"Host": f"127.0.0.1:{server.port}"} | (headers or {})
        for name, value in sent.items():
            connection.putheader(name, value)
        connection.endheaders(body)
        response = connection.getresponse()
        return response.status, dict(response.getheaders()), response.read()
    finally:
        connection.close()


def post_json(
    server: LauncherServer, path: str, body: bytes, **headers: str
) -> tuple[int, dict[str, str], bytes]:
    """POST ``body`` as application/json with the right Content-Length."""
    sent = {"Content-Type": "application/json", "Content-Length": str(len(body))} | headers
    return request(server, path, method="POST", headers=sent, body=body)


@contextmanager
def serving(
    directory: Path,
    *,
    clock: Callable[[], float] | None = None,
    idle_timeout: float = 30 * 60,
) -> Iterator[tuple[LauncherServer, threading.Thread]]:
    """Run a launcher server in a thread; always stop it, even when the test already did."""
    extra: dict[str, object] = {} if clock is None else {"clock": clock}
    server = LauncherServer(
        load_launcher(write_launcher(directory / "launcher")),
        data_dir=directory / "data",
        token=TOKEN,
        code=CODE,
        idle_timeout=idle_timeout,
        **extra,  # type: ignore[arg-type]
    )
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01})
    thread.daemon = True
    thread.start()
    try:
        yield server, thread
    finally:
        if thread.is_alive():
            server.shutdown()
        server.server_close()
        thread.join(timeout=5)
