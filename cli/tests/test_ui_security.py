"""Launcher request checks: Host (DNS rebinding), Origin (cross-origin pages), token."""

from __future__ import annotations

import pytest

from schemamap.ui.security import host_allowed, origin_allowed, token_matches

PORT = 51234


@pytest.mark.parametrize("host", [f"127.0.0.1:{PORT}", f"localhost:{PORT}", f"LOCALHOST:{PORT}"])
def test_loopback_hosts_with_the_right_port_are_allowed(host: str) -> None:
    assert host_allowed(host, PORT)


@pytest.mark.parametrize(
    "host",
    [
        None,
        "",
        "127.0.0.1",
        "localhost",
        f"127.0.0.1:{PORT + 1}",
        f"evil.example:{PORT}",
        f"localhost.evil.example:{PORT}",
        f"0.0.0.0:{PORT}",
        f"[::1]:{PORT}",
        f"127.0.0.2:{PORT}",
    ],
)
def test_every_other_host_is_refused(host: str | None) -> None:
    assert not host_allowed(host, PORT)


@pytest.mark.parametrize("origin", [None, f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}"])
def test_no_origin_or_our_own_origin_is_allowed(origin: str | None) -> None:
    assert origin_allowed(origin, PORT)


@pytest.mark.parametrize(
    "origin",
    [
        "https://evil.example",
        "null",
        f"http://127.0.0.1:{PORT + 1}",
        f"https://127.0.0.1:{PORT}",
        f"http://evil.example:{PORT}",
        "",
    ],
)
def test_any_other_origin_is_refused(origin: str) -> None:
    assert not origin_allowed(origin, PORT)


def test_token_must_match_exactly() -> None:
    assert token_matches("abc", "abc")
    assert not token_matches(None, "abc")
    assert not token_matches("", "abc")
    assert not token_matches("abd", "abc")
    assert not token_matches("abc ", "abc")
    assert not token_matches("ABC", "abc")
