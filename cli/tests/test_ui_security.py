"""Launcher request checks: Host (DNS rebinding), Origin (cross-origin pages), token."""

from __future__ import annotations

import pytest
from ui_http import FakeClock

from schemamap.ui.security import (
    LaunchCode,
    fetch_site_allowed,
    host_allowed,
    origin_allowed,
    token_matches,
)

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


@pytest.mark.parametrize("site", [None, "same-origin", "none", " Same-Origin "])
def test_own_fetch_sites_may_open_a_map(site: str | None) -> None:
    assert fetch_site_allowed(site)


@pytest.mark.parametrize("site", ["cross-site", "same-site", "", "null", "same-origin; x"])
def test_any_other_fetch_site_is_refused(site: str) -> None:
    assert not fetch_site_allowed(site)


def test_a_launch_code_is_random_and_long() -> None:
    first, second = LaunchCode().code, LaunchCode().code
    assert first is not None and second is not None
    assert first != second
    assert len(first) >= 40


def test_a_launch_code_redeems_once() -> None:
    code = LaunchCode(code="abc")
    assert code.code == "abc"
    assert code.redeem("abc")
    assert not code.redeem("abc")
    assert code.code is None


def test_a_launch_code_expires_after_its_ttl() -> None:
    clock = FakeClock()
    code = LaunchCode(ttl=60, clock=clock, code="abc")
    clock.advance(59.999)
    assert code.code == "abc"
    clock.advance(0.001)
    assert code.code is None
    assert not code.redeem("abc")


def test_the_default_launch_code_lives_sixty_seconds() -> None:
    clock = FakeClock()
    code = LaunchCode(clock=clock, code="abc")
    clock.advance(59)
    assert code.redeem("abc")
    again = LaunchCode(clock=clock, code="abc")
    clock.advance(60)
    assert not again.redeem("abc")


@pytest.mark.parametrize("guess", [None, "", "ABC", "ab", "abcd", "abd"])
def test_a_wrong_guess_fails_without_using_the_code_up(guess: str | None) -> None:
    code = LaunchCode(code="abc")
    assert not code.redeem(guess)
    assert code.redeem("abc")


def test_non_ascii_guesses_are_refused_not_crashed() -> None:
    code = LaunchCode(code="abc")
    assert not code.redeem("é" * 40)
    assert code.redeem("abc")
