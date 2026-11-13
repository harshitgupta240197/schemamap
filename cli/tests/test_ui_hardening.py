"""Launcher hardening over real sockets: bodies, quit, idle timeout, launch code, map tabs."""

from __future__ import annotations

import inspect
import json
import socket
import threading
import time
from pathlib import Path

import pytest
from launcher_builders import write_launcher
from ui_http import CODE, TOKEN, FakeClock, post_json, request, serving

from schemamap.ui.assets import load_launcher
from schemamap.ui.server import MAX_BODY_BYTES, LauncherServer

AUTH = {"X-SchemaMap-Token": TOKEN}
MAP_ID = "0123456789abcdef0123456789abcdef"
MAP_HTML = b"<!doctype html><title>A map</title><p>tables</p>"


def error_code(body: bytes) -> str:
    return str(json.loads(body)["error"]["code"])


def wait_until_stopped(thread: threading.Thread, seconds: float = 5.0) -> bool:
    thread.join(timeout=seconds)
    return not thread.is_alive()


# -- binding ----------------------------------------------------------------------------------


def test_the_server_has_no_way_to_bind_another_interface() -> None:
    parameters = inspect.signature(LauncherServer.__init__).parameters
    assert not {"host", "address", "interface", "bind"} & set(parameters)


def test_an_explicit_port_is_used_and_still_on_loopback(tmp_path: Path) -> None:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = int(probe.getsockname()[1])
    server = LauncherServer(load_launcher(write_launcher(tmp_path)), data_dir=tmp_path, port=port)
    try:
        assert server.server_address[:2] == ("127.0.0.1", port)
        assert server.port == port
    finally:
        server.server_close()


# -- request bodies ---------------------------------------------------------------------------


def test_a_body_over_one_megabyte_is_413_before_it_is_read(tmp_path: Path) -> None:
    with serving(tmp_path) as (server, _):
        headers = AUTH | {
            "Content-Type": "application/json",
            "Content-Length": str(MAX_BODY_BYTES + 1),
        }
        status, _, body = request(server, "/api/quit", method="POST", headers=headers)
        assert status == 413
        assert error_code(body) == "too_large"
        assert request(server, "/api/health", headers=AUTH)[0] == 200


def test_a_body_of_exactly_one_megabyte_is_accepted(tmp_path: Path) -> None:
    padding = " " * (MAX_BODY_BYTES - len(b'{"code":"x"}'))
    body = b'{"code":"x"}' + padding.encode()
    assert len(body) == MAX_BODY_BYTES
    with serving(tmp_path) as (server, _):
        status, _, answer = post_json(server, "/api/session", body)
        assert status == 401
        assert error_code(answer) == "unauthorized"


@pytest.mark.parametrize(
    "content_type", ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data", None]
)
def test_a_body_that_is_not_json_is_415(tmp_path: Path, content_type: str | None) -> None:
    headers = AUTH | {"Content-Length": "2"}
    if content_type is not None:
        headers["Content-Type"] = content_type
    with serving(tmp_path) as (server, thread):
        status, _, body = request(server, "/api/quit", method="POST", headers=headers, body=b"{}")
        assert status == 415
        assert error_code(body) == "unsupported_media_type"
        # The refused request must not have had its effect.
        assert thread.is_alive()
        assert server.stop_reason is None


def test_json_with_a_charset_parameter_is_accepted(tmp_path: Path) -> None:
    with serving(tmp_path) as (server, _):
        status, _, _ = post_json(
            server,
            "/api/session",
            b'{"code":"x"}',
            **{"Content-Type": "application/json; charset=utf-8"},
        )
        assert status == 401


def test_a_body_without_content_length_is_411(tmp_path: Path) -> None:
    with serving(tmp_path) as (server, _):
        headers = AUTH | {"Content-Type": "application/json"}
        status, _, body = request(server, "/api/quit", method="POST", headers=headers)
        assert status == 411
        assert error_code(body) == "length_required"


def test_a_chunked_body_is_411(tmp_path: Path) -> None:
    with serving(tmp_path) as (server, _):
        headers = AUTH | {"Content-Type": "application/json", "Transfer-Encoding": "chunked"}
        status, _, body = request(
            server, "/api/quit", method="POST", headers=headers, body=b"2\r\n{}\r\n0\r\n\r\n"
        )
        assert status == 411
        assert error_code(body) == "length_required"


@pytest.mark.parametrize("length", ["-1", "abc", "1.5", "+2", "²"])
def test_a_malformed_content_length_is_400(tmp_path: Path, length: str) -> None:
    with serving(tmp_path) as (server, _):
        headers = AUTH | {"Content-Type": "application/json", "Content-Length": length}
        status, _, body = request(server, "/api/quit", method="POST", headers=headers)
        assert status == 400
        assert error_code(body) == "bad_request"


@pytest.mark.parametrize("body", [b"not json", b"[]", b'"text"', b"null", b"", b"[" * 100000])
def test_a_body_that_is_not_a_json_object_is_400(tmp_path: Path, body: bytes) -> None:
    with serving(tmp_path) as (server, thread):
        status, _, answer = post_json(server, "/api/quit", body, **AUTH)
        assert status == 400
        assert error_code(answer) == "bad_request"
        assert thread.is_alive()


def test_the_token_is_checked_before_the_body_is_judged(tmp_path: Path) -> None:
    with serving(tmp_path) as (server, _):
        status, _, body = post_json(server, "/api/quit", b"not json")
        assert status == 401
        assert error_code(body) == "unauthorized"


def test_the_wrong_method_on_a_route_is_405_with_allow(tmp_path: Path) -> None:
    with serving(tmp_path) as (server, _):
        status, headers, body = request(server, "/api/quit", headers=AUTH)
        assert status == 405
        assert headers["Allow"] == "POST"
        assert error_code(body) == "method_not_allowed"
        status, headers, _ = request(server, "/api/health", method="DELETE", headers=AUTH)
        assert (status, headers["Allow"]) == (405, "GET, HEAD")


# -- security headers -------------------------------------------------------------------------

RESPONSES = [
    ("GET", "/", {}, None),
    ("GET", "/api/health", AUTH, None),
    ("GET", "/api/health", {}, None),
    ("GET", "/api/nothing", AUTH, None),
    ("GET", "/api/quit", AUTH, None),
    ("POST", "/api/quit", AUTH | {"Content-Type": "text/plain", "Content-Length": "0"}, b""),
    (
        "POST",
        "/api/quit",
        AUTH | {"Content-Type": "application/json", "Content-Length": "9999999"},
        None,
    ),
    ("POST", "/api/session", {"Content-Type": "application/json", "Content-Length": "2"}, b"{}"),
    ("GET", "/maps/" + MAP_ID, {}, None),
    ("GET", "/maps/..%2f..%2fetc", {}, None),
    ("GET", "/missing", {}, None),
    ("GET", "/", {"Host": "evil.example"}, None),
    ("GET", "/", {"Origin": "https://evil.example"}, None),
    ("GET", "/maps/" + MAP_ID, {"Sec-Fetch-Site": "cross-site"}, None),
]


@pytest.mark.parametrize(("method", "path", "headers", "body"), RESPONSES)
def test_every_response_carries_the_security_headers(
    tmp_path: Path, method: str, path: str, headers: dict[str, str], body: bytes | None
) -> None:
    with serving(tmp_path) as (server, _):
        _, answer, _ = request(server, path, method=method, headers=headers, body=body)
    assert answer["X-Content-Type-Options"] == "nosniff"
    assert answer["Referrer-Policy"] == "no-referrer"
    assert answer["X-Frame-Options"] == "DENY"
    assert answer["Cache-Control"] == "no-store"
    assert "frame-ancestors 'none'" in answer["Content-Security-Policy"]
    assert not any(name.lower().startswith("access-control-") for name in answer)


def test_json_responses_allow_nothing_in_the_content_security_policy(tmp_path: Path) -> None:
    with serving(tmp_path) as (server, _):
        _, headers, _ = request(server, "/api/health", headers=AUTH)
    assert headers["Content-Security-Policy"].startswith("default-src 'none'")


# -- quit and idle timeout --------------------------------------------------------------------


def test_post_quit_answers_then_stops_the_server(tmp_path: Path) -> None:
    with serving(tmp_path) as (server, thread):
        status, _, body = post_json(server, "/api/quit", b"{}", **AUTH)
        assert status == 200
        assert json.loads(body) == {"status": "stopping"}
        assert wait_until_stopped(thread)
        assert server.stop_reason == "quit"


def test_the_server_stops_after_thirty_idle_minutes(tmp_path: Path) -> None:
    clock = FakeClock()
    with serving(tmp_path, clock=clock) as (server, thread):
        clock.advance(30 * 60 - 1)
        time.sleep(0.2)
        assert thread.is_alive()
        clock.advance(1)
        assert wait_until_stopped(thread)
        assert server.stop_reason == "idle"


def test_a_successful_request_restarts_the_idle_timer(tmp_path: Path) -> None:
    clock = FakeClock()
    with serving(tmp_path, clock=clock) as (server, thread):
        clock.advance(29 * 60)
        assert request(server, "/api/health", headers=AUTH)[0] == 200
        clock.advance(29 * 60)
        time.sleep(0.2)
        assert thread.is_alive()
        clock.advance(60)
        assert wait_until_stopped(thread)
        assert server.stop_reason == "idle"


def test_refused_requests_do_not_keep_the_launcher_alive(tmp_path: Path) -> None:
    clock = FakeClock()
    with serving(tmp_path, clock=clock) as (server, thread):
        clock.advance(29 * 60)
        assert request(server, "/api/health")[0] == 401
        assert request(server, "/", headers={"Host": "evil.example"})[0] == 403
        clock.advance(60)
        assert wait_until_stopped(thread)
        assert server.stop_reason == "idle"


def test_the_first_reason_to_stop_is_kept(tmp_path: Path) -> None:
    with serving(tmp_path) as (server, thread):
        server.request_stop("quit")
        server.request_stop("idle")
        assert wait_until_stopped(thread)
        assert server.stop_reason == "quit"


# -- one-time launch code (D-060) -------------------------------------------------------------


def redeem(server: LauncherServer, code: str) -> tuple[int, dict[str, str], bytes]:
    return post_json(server, "/api/session", json.dumps({"code": code}).encode())


def test_the_launch_code_works_once_and_returns_the_token(tmp_path: Path) -> None:
    with serving(tmp_path) as (server, _):
        status, _, body = redeem(server, CODE)
        assert status == 200
        assert json.loads(body) == {"token": TOKEN}
        # The token it hands out opens the API.
        assert request(server, "/api/health", headers={"X-SchemaMap-Token": TOKEN})[0] == 200


def test_a_second_use_of_the_launch_code_is_401(tmp_path: Path) -> None:
    with serving(tmp_path) as (server, _):
        assert redeem(server, CODE)[0] == 200
        status, _, body = redeem(server, CODE)
        assert status == 401
        assert error_code(body) == "unauthorized"
        assert TOKEN.encode() not in body


def test_an_expired_launch_code_is_401(tmp_path: Path) -> None:
    clock = FakeClock()
    with serving(tmp_path, clock=clock) as (server, _):
        clock.advance(59)
        assert server.url.endswith(f"#c={CODE}")
        clock.advance(1)
        status, _, body = redeem(server, CODE)
        assert status == 401
        assert TOKEN.encode() not in body
        assert "#" not in server.url


def test_a_launch_code_just_inside_its_minute_still_works(tmp_path: Path) -> None:
    clock = FakeClock()
    with serving(tmp_path, clock=clock) as (server, _):
        clock.advance(59.9)
        assert redeem(server, CODE)[0] == 200


@pytest.mark.parametrize("guess", ["wrong", "", CODE.upper(), CODE + "x", CODE[:-1], TOKEN])
def test_a_wrong_code_is_401_and_does_not_use_up_the_real_one(tmp_path: Path, guess: str) -> None:
    with serving(tmp_path) as (server, _):
        status, _, body = redeem(server, guess)
        assert status == 401
        assert TOKEN.encode() not in body
        assert redeem(server, CODE)[0] == 200


@pytest.mark.parametrize("body", [b"{}", b'{"code": 5}', b'{"code": null}', b'{"code": ["x"]}'])
def test_a_missing_or_non_text_code_is_400(tmp_path: Path, body: bytes) -> None:
    with serving(tmp_path) as (server, _):
        status, _, answer = post_json(server, "/api/session", body)
        assert status == 400
        assert error_code(answer) == "bad_request"
        assert redeem(server, CODE)[0] == 200


def test_the_code_in_the_query_string_or_a_header_is_not_a_code(tmp_path: Path) -> None:
    with serving(tmp_path) as (server, _):
        assert post_json(server, f"/api/session?code={CODE}", b"{}")[0] == 400
        assert post_json(server, "/api/session", b"{}", **{"X-SchemaMap-Code": CODE})[0] == 400
        assert redeem(server, CODE)[0] == 200


def test_the_session_route_still_applies_the_host_origin_and_method_rules(tmp_path: Path) -> None:
    with serving(tmp_path) as (server, _):
        body = json.dumps({"code": CODE}).encode()
        status, _, answer = post_json(server, "/api/session", body, Host="evil.example")
        assert (status, error_code(answer)) == (403, "forbidden_host")
        status, _, answer = post_json(server, "/api/session", body, Origin="https://evil.example")
        assert (status, error_code(answer)) == (403, "forbidden_origin")
        status, headers, _ = request(server, "/api/session")
        assert (status, headers["Allow"]) == (405, "POST")
        status, _, answer = post_json(
            server, "/api/session", body, **{"Content-Type": "text/plain"}
        )
        assert (status, error_code(answer)) == (415, "unsupported_media_type")
        # None of the refusals used the code up.
        assert redeem(server, CODE)[0] == 200


def test_the_token_never_appears_in_any_url_or_header(tmp_path: Path) -> None:
    with serving(tmp_path) as (server, _):
        links = [server.url]
        status, headers, _ = redeem(server, CODE)
        assert status == 200
        links.append(server.url)
        _, page_headers, _ = request(server, "/")
        for answer in (headers, page_headers):
            links.extend(f"{name}: {value}" for name, value in answer.items())
        assert not any(TOKEN in link for link in links)
        assert not any(link.startswith("http") and "?" in link for link in links)


def test_the_page_and_other_routes_never_contain_the_token(tmp_path: Path) -> None:
    with serving(tmp_path) as (server, _):
        redeem(server, CODE)
        for path in ("/", "/api/health", "/api/nothing", "/missing"):
            _, _, body = request(server, path, headers=AUTH)
            assert (TOKEN.encode() in body) is False, path


# -- map tabs: Sec-Fetch-Site (D-060) ---------------------------------------------------------


def write_map(directory: Path, map_id: str = MAP_ID) -> None:
    folder = directory / "data" / "maps" / map_id
    folder.mkdir(parents=True)
    (folder / "map.html").write_bytes(MAP_HTML)


@pytest.mark.parametrize("site", ["same-origin", "none", "SAME-ORIGIN", None])
def test_a_map_opens_from_this_launcher_or_a_typed_address(
    tmp_path: Path, site: str | None
) -> None:
    write_map(tmp_path)
    headers = {} if site is None else {"Sec-Fetch-Site": site}
    with serving(tmp_path) as (server, _):
        status, answer, body = request(server, f"/maps/{MAP_ID}", headers=headers)
    assert status == 200
    assert body == MAP_HTML
    assert answer["Content-Type"] == "text/html; charset=utf-8"
    assert answer["Content-Security-Policy"] == "frame-ancestors 'none'"
    assert answer["Cache-Control"] == "no-store"


@pytest.mark.parametrize("site", ["cross-site", "same-site", "", "bogus"])
def test_a_map_requested_from_another_site_is_403(tmp_path: Path, site: str) -> None:
    write_map(tmp_path)
    with serving(tmp_path) as (server, _):
        for map_id in (MAP_ID, "f" * 32):
            status, _, body = request(server, f"/maps/{map_id}", headers={"Sec-Fetch-Site": site})
            assert status == 403
            assert error_code(body) == "forbidden_fetch_site"


def test_a_map_still_needs_the_loopback_host_and_origin(tmp_path: Path) -> None:
    write_map(tmp_path)
    with serving(tmp_path) as (server, _):
        status, _, body = request(server, f"/maps/{MAP_ID}", headers={"Host": "evil.example"})
        assert (status, error_code(body)) == (403, "forbidden_host")
        status, _, body = request(
            server, f"/maps/{MAP_ID}", headers={"Origin": "https://evil.example"}
        )
        assert (status, error_code(body)) == (403, "forbidden_origin")


@pytest.mark.parametrize(
    "path",
    [
        "/maps/" + "f" * 32,
        "/maps/",
        "/maps/" + MAP_ID.upper(),
        "/maps/" + MAP_ID[:-1],
        "/maps/" + MAP_ID + "0",
        "/maps/../" + MAP_ID,
        "/maps/%2e%2e/" + MAP_ID,
        "/maps/..%2fmaps%2f" + MAP_ID,
        f"/maps/{MAP_ID}/",
        f"/maps/{MAP_ID}/map.html",
        f"/maps/{MAP_ID}%00",
        "/maps//" + MAP_ID,
    ],
)
def test_only_a_known_map_id_is_served(tmp_path: Path, path: str) -> None:
    write_map(tmp_path)
    with serving(tmp_path) as (server, _):
        status, _, body = request(server, path)
    assert status == 404
    assert MAP_HTML not in body


def test_a_map_is_get_or_head_only(tmp_path: Path) -> None:
    write_map(tmp_path)
    with serving(tmp_path) as (server, _):
        status, headers, _ = request(
            server, f"/maps/{MAP_ID}", method="POST", headers={"Content-Length": "0"}
        )
        assert (status, headers["Allow"]) == (405, "GET, HEAD")
        status, headers, body = request(server, f"/maps/{MAP_ID}", method="HEAD")
        assert status == 200
        assert body == b""
        assert headers["Content-Length"] == str(len(MAP_HTML))


@pytest.mark.parametrize("method", ["PUT", "PATCH", "DELETE", "OPTIONS"])
def test_other_methods_are_refused_without_cors_answers(tmp_path: Path, method: str) -> None:
    with serving(tmp_path) as (server, _):
        for path in ("/", "/api/health", f"/maps/{MAP_ID}"):
            status, headers, body = request(
                server,
                path,
                method=method,
                headers=AUTH | {"Content-Type": "application/json", "Content-Length": "2"},
                body=b"{}",
            )
            assert status in (405, 404), (path, status)
            assert not any(name.lower().startswith("access-control-") for name in headers)
            assert b"token" not in body
