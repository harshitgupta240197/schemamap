"""Stopping the launcher leaves nothing under ``tmp/`` (#13)."""

from __future__ import annotations

import socket
import threading
import time
from pathlib import Path

import pytest
from ui_fakes import small_snapshot, stub_template
from ui_http import TOKEN, serving

from schemamap.ui.library import LibraryClosedError, MapLibrary


def start_upload(port: int, announced: int, sent: int) -> socket.socket:
    """An import that announces ``announced`` bytes and sends only ``sent`` of them."""
    sender = socket.create_connection(("127.0.0.1", port), timeout=5)
    head = (
        f"POST /api/maps/import HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n"
        f"X-SchemaMap-Token: {TOKEN}\r\nContent-Type: application/json\r\n"
        f"Content-Length: {announced}\r\n\r\n"
    )
    sender.sendall(head.encode("ascii") + b" " * sent)
    return sender


def wait_for_upload(tmp: Path) -> Path:
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        found = list(tmp.glob("upload-*.tmp"))
        if found:
            return found[0]
        time.sleep(0.01)
    raise AssertionError("the upload never reached tmp/")


def test_stopping_with_an_upload_in_flight_empties_tmp_and_ends_the_upload(
    tmp_path: Path,
) -> None:
    with serving(tmp_path) as (server, thread):
        tmp = server.data_dir / "tmp"
        with start_upload(server.port, 50 * 1024 * 1024, 1024 * 1024) as sender:
            wait_for_upload(tmp)
            server.shutdown()
            thread.join(5)
            started = time.monotonic()
            server.server_close()
            assert time.monotonic() - started < 4  # it did not wait out the idle upload
            assert not tmp.exists() or not list(tmp.iterdir())
            sender.settimeout(5)
            answer = b""
            try:
                while chunk := sender.recv(4096):
                    answer += chunk
            except ConnectionError:
                pass  # a reset also ends the upload
            assert b"200 OK" not in answer


def test_a_write_in_flight_is_waited_for_and_then_tmp_is_empty(tmp_path: Path) -> None:
    library = MapLibrary(tmp_path, template=stub_template)
    upload = library.new_upload_path()
    with library.writing():
        outcome: list[bool] = []

        closer = threading.Thread(target=lambda: outcome.append(library.close(wait=5)))
        closer.start()
        time.sleep(0.1)
        assert closer.is_alive()  # waiting for the write
        upload.write_bytes(b"{}")
    closer.join(5)
    assert outcome == [True]
    assert not (tmp_path / "tmp").exists()


def test_nothing_is_written_once_the_library_is_closing(tmp_path: Path) -> None:
    library = MapLibrary(tmp_path, template=stub_template)
    assert library.close(wait=0.1)
    with pytest.raises(LibraryClosedError):
        library.add(small_snapshot())
    with pytest.raises(LibraryClosedError):
        library.new_upload_path()
    assert not (tmp_path / "tmp").exists() and not (tmp_path / "maps").exists()


def test_a_write_that_outlives_the_wait_is_reported(tmp_path: Path) -> None:
    library = MapLibrary(tmp_path, template=stub_template)
    with library.writing():
        assert library.close(wait=0.05) is False
