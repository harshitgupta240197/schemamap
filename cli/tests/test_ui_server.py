"""The launcher server over real sockets: loopback bind, Host/Origin checks, token, headers."""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path

import pytest
from launcher_builders import PAGE, SCRIPT_SOURCE, write_launcher
from ui_http import CODE, TOKEN, request, serving

from schemamap.errors import LauncherUnavailableError
from schemamap.ui.assets import Launcher, launcher_policy, load_launcher
from schemamap.ui.server import LauncherServer


@pytest.fixture
def server(tmp_path: Path) -> Iterator[LauncherServer]:
    with serving(tmp_path) as (running, _):
        yield running


def health(server: LauncherServer, **headers: str) -> tuple[int, dict[str, str], bytes]:
    return request(server, "/api/health", headers=headers)


def test_server_binds_loopback_only_on_a_picked_port(server: LauncherServer) -> None:
    host, port = server.server_address[:2]
    assert host == "127.0.0.1"
    assert port == server.port and port > 0
    # The launch link carries the one-time code, never the session token (D-060).
    assert server.url == f"http://127.0.0.1:{port}/#c={CODE}"
    assert TOKEN not in server.url


def test_a_new_server_gets_a_long_random_token(tmp_path: Path) -> None:
    launcher = load_launcher(write_launcher(tmp_path))
    first = LauncherServer(launcher, data_dir=tmp_path)
    second = LauncherServer(launcher, data_dir=tmp_path)
    try:
        assert first.token != second.token
        assert len(first.token) >= 40
        assert first.launch_code.code != second.launch_code.code
        assert first.launch_code.code != first.token
    finally:
        first.server_close()
        second.server_close()


def test_the_right_token_gets_health(server: LauncherServer) -> None:
    status, headers, body = health(server, **{"X-SchemaMap-Token": TOKEN})
    assert status == 200
    assert headers["Content-Type"] == "application/json"
    assert headers["Cache-Control"] == "no-store"
    assert json.loads(body)["status"] == "ok"


@pytest.mark.parametrize(
    "headers",
    [{}, {"X-SchemaMap-Token": "wrong"}, {"X-SchemaMap-Token": ""}, {"Authorization": TOKEN}],
)
def test_a_missing_or_wrong_token_is_401(server: LauncherServer, headers: dict[str, str]) -> None:
    status, _, body = request(server, "/api/health", headers=headers)
    assert status == 401
    assert json.loads(body)["error"]["code"] == "unauthorized"
    assert TOKEN.encode() not in body


def test_a_token_in_the_query_string_does_not_count(server: LauncherServer) -> None:
    status, _, _ = request(server, f"/api/health?t={TOKEN}")
    assert status == 401


def test_unknown_api_routes_need_the_token_before_saying_not_found(server: LauncherServer) -> None:
    assert request(server, "/api/nothing")[0] == 401
    assert request(server, "/api/nothing", headers={"X-SchemaMap-Token": TOKEN})[0] == 404


@pytest.mark.parametrize(
    "host", ["evil.example:{port}", "127.0.0.1:1", "localhost", "0.0.0.0:{port}"]
)
def test_a_foreign_host_is_403_even_with_the_token(server: LauncherServer, host: str) -> None:
    headers = {"Host": host.format(port=server.port), "X-SchemaMap-Token": TOKEN}
    for path in ("/", "/api/health"):
        status, _, body = request(server, path, headers=headers)
        assert status == 403
        assert json.loads(body)["error"]["code"] == "forbidden_host"


def test_localhost_with_the_port_is_allowed(server: LauncherServer) -> None:
    headers = {"Host": f"localhost:{server.port}", "X-SchemaMap-Token": TOKEN}
    assert health(server, **headers)[0] == 200


@pytest.mark.parametrize("origin", ["https://evil.example", "null", "http://127.0.0.1:1"])
def test_a_foreign_origin_is_403_even_with_the_token(server: LauncherServer, origin: str) -> None:
    status, _, body = health(server, **{"Origin": origin, "X-SchemaMap-Token": TOKEN})
    assert status == 403
    assert json.loads(body)["error"]["code"] == "forbidden_origin"


def test_our_own_origin_is_allowed(server: LauncherServer) -> None:
    origin = f"http://127.0.0.1:{server.port}"
    assert health(server, **{"Origin": origin, "X-SchemaMap-Token": TOKEN})[0] == 200


def test_the_page_is_served_with_its_policy_and_security_headers(server: LauncherServer) -> None:
    status, headers, body = request(server, "/")
    assert status == 200
    assert body == PAGE
    assert headers["Content-Type"] == "text/html; charset=utf-8"
    assert headers["Content-Security-Policy"] == server.launcher.policy
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert headers["Referrer-Policy"] == "no-referrer"
    assert headers["X-Frame-Options"] == "DENY"
    assert "Access-Control-Allow-Origin" not in headers


def test_every_response_carries_the_security_headers(server: LauncherServer) -> None:
    for path, extra in [
        ("/", {}),
        ("/api/health", {"X-SchemaMap-Token": TOKEN}),
        ("/api/health", {}),
        ("/missing", {}),
        ("/", {"Host": "evil.example"}),
    ]:
        _, headers, _ = request(server, path, headers=extra)
        assert headers["X-Content-Type-Options"] == "nosniff", path
        assert headers["Referrer-Policy"] == "no-referrer", path
        assert "frame-ancestors 'none'" in headers["Content-Security-Policy"], path
        assert not any(name.lower().startswith("access-control-") for name in headers), path


def test_other_methods_on_the_page_are_405(server: LauncherServer) -> None:
    status, headers, _ = request(server, "/", method="POST", headers={"Content-Length": "0"})
    assert status == 405
    assert headers["Allow"] == "GET, HEAD"


def test_unknown_paths_are_404(server: LauncherServer) -> None:
    assert request(server, "/../etc/passwd")[0] == 404
    assert request(server, "/launcher.html")[0] == 404


def test_launcher_policy_matches_the_design() -> None:
    policy = launcher_policy([SCRIPT_SOURCE], [])
    assert policy == (
        f"default-src 'self'; script-src {SCRIPT_SOURCE}; style-src 'self'; "
        "connect-src 'self'; frame-ancestors 'none'; form-action 'self'; "
        "base-uri 'none'; object-src 'none'"
    )
    assert "unsafe" not in policy


@pytest.mark.parametrize(
    "sources",
    [
        ["'unsafe-inline'"],
        ["*"],
        [SCRIPT_SOURCE + "; script-src *"],
        [SCRIPT_SOURCE + "\r\nX-Evil: 1"],
        ["'sha256-short='"],
    ],
)
def test_a_malformed_hash_source_is_refused(sources: list[str]) -> None:
    with pytest.raises(ValueError):
        launcher_policy(sources, [])
    with pytest.raises(ValueError):
        launcher_policy([SCRIPT_SOURCE], sources)


def test_a_launcher_without_scripts_is_refused() -> None:
    with pytest.raises(ValueError):
        launcher_policy([], [])


def test_load_launcher_returns_the_page_and_policy(tmp_path: Path) -> None:
    launcher = load_launcher(write_launcher(tmp_path))
    assert launcher == Launcher(html=PAGE, policy=launcher_policy([SCRIPT_SOURCE], []))


def test_a_missing_launcher_names_the_build_command(tmp_path: Path) -> None:
    with pytest.raises(LauncherUnavailableError, match=r"tools/build_viewer\.py"):
        load_launcher(tmp_path)


@pytest.mark.parametrize(
    "overrides",
    [
        {"sha256": "0" * 64},
        {"script_sources": ["'unsafe-inline'"]},
        {"script_sources": "not a list"},
        {"style_sources": [1]},
    ],
)
def test_a_launcher_that_does_not_match_its_manifest_is_refused(
    tmp_path: Path, overrides: dict[str, object]
) -> None:
    with pytest.raises(LauncherUnavailableError, match=r"tools/build_viewer\.py"):
        load_launcher(write_launcher(tmp_path, overrides=overrides))
