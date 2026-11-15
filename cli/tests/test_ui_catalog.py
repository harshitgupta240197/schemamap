"""``GET /api/queries`` and ``GET /api/maps/folder``: what the launcher shows a sceptical DBA."""

from __future__ import annotations

import json
from collections.abc import Iterator
from importlib import resources
from pathlib import Path

import pytest
from ui_http import TOKEN, request, serving

from schemamap import __version__
from schemamap.ui.catalog import display_path, list_queries, purpose_of
from schemamap.ui.server import LauncherServer

AUTH = {"X-SchemaMap-Token": TOKEN}


@pytest.fixture
def server(tmp_path: Path) -> Iterator[LauncherServer]:
    with serving(tmp_path) as (running, _):
        yield running


def files_on_disk() -> dict[str, bytes]:
    folder = resources.files("schemamap.queries")
    return {
        entry.name.removesuffix(".sql"): entry.read_bytes()
        for entry in folder.iterdir()
        if entry.name.endswith(".sql")
    }


def test_the_answer_is_exactly_the_queries_on_the_allowlist(server: LauncherServer) -> None:
    status, headers, body = request(server, "/api/queries", headers=AUTH)
    answer = json.loads(body)
    assert status == 200
    assert headers["Content-Type"].startswith("application/json")
    assert answer["version"] == __version__
    on_disk = files_on_disk()
    assert [item["name"] for item in answer["queries"]] == sorted(on_disk)
    for item in answer["queries"]:
        assert set(item) == {"name", "purpose", "sql"}
        assert item["sql"].encode("utf-8") == on_disk[item["name"]]
        assert item["purpose"]


def test_the_listing_needs_the_token(server: LauncherServer) -> None:
    for headers in ({}, {"X-SchemaMap-Token": "wrong"}):
        status, _, body = request(server, "/api/queries", headers=headers)
        assert status == 401
        assert json.loads(body)["error"]["code"] == "unauthorized"


def test_the_listing_refuses_a_foreign_host(server: LauncherServer) -> None:
    status, _, _ = request(server, "/api/queries", headers=AUTH | {"Host": "evil.example"})
    assert status == 403


def test_the_listing_takes_get_only(server: LauncherServer) -> None:
    headers = AUTH | {"Content-Type": "application/json", "Content-Length": "2"}
    status, answer, _ = request(server, "/api/queries", method="POST", headers=headers, body=b"{}")
    assert status == 405
    assert answer["Allow"] == "GET, HEAD"


def test_the_purpose_is_the_header_comment_or_the_name() -> None:
    assert purpose_of("x", "-- First line\n-- second line.\n-- params: a, b\nSELECT 1") == (
        "First line second line."
    )
    assert purpose_of("x", "SELECT 1") == "x"
    assert purpose_of("x", "-- params: a\nSELECT 1") == "x"


def test_every_shipped_query_has_a_purpose_beyond_its_name() -> None:
    for item in list_queries()["queries"]:  # type: ignore[attr-defined]
        assert item["purpose"] != item["name"], item["name"]


def test_the_maps_folder_is_shown_with_the_home_folder_as_tilde(
    server: LauncherServer, tmp_path: Path
) -> None:
    status, _, body = request(server, "/api/maps/folder", headers=AUTH)
    assert status == 200
    folder = json.loads(body)["folder"]
    assert folder == str((tmp_path / "data" / "maps").resolve())
    assert request(server, "/api/maps/folder")[0] == 401


def test_display_path_replaces_only_the_home_prefix(tmp_path: Path) -> None:
    home = tmp_path / "me"
    assert display_path(home / "SchemaMap" / "maps", home) == str(Path("~") / "SchemaMap" / "maps")
    assert display_path(tmp_path / "elsewhere", home) == str((tmp_path / "elsewhere").resolve())
