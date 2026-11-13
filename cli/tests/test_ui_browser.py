"""Opening the browser: http and file addresses only, never a shell command."""

from __future__ import annotations

import pytest

from schemamap.ui.browser import open_in_browser


@pytest.fixture
def opened(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    calls: list[str] = []

    def fake_open(url: str) -> bool:
        calls.append(url)
        return True

    monkeypatch.setattr("webbrowser.open", fake_open)
    return calls


@pytest.mark.parametrize("url", ["http://127.0.0.1:8765/#c=abc", "file:///tmp/map.html"])
def test_http_and_file_urls_are_opened(opened: list[str], url: str) -> None:
    assert open_in_browser(url)
    assert opened == [url]


@pytest.mark.parametrize(
    "url",
    [
        "javascript:alert(1)",
        "data:text/html,x",
        "ftp://127.0.0.1/x",
        "calc.exe",
        "-a Calculator",
        "http://127.0.0.1:1/ --new-window",
        "http://127.0.0.1:1/\n--evil",
        "http://127.0.0.1:1/\x00",
        "",
    ],
)
def test_anything_else_is_refused_and_nothing_is_run(opened: list[str], url: str) -> None:
    assert not open_in_browser(url)
    assert opened == []


def test_a_browser_that_cannot_start_returns_false(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("webbrowser.open", lambda url: False)
    assert not open_in_browser("http://127.0.0.1:1/")
