import re
from typing import Any

import pytest
from typer.testing import CliRunner

from schemamap import cli
from schemamap.cli import app
from schemamap.connect import AuthMode, ConnectionConfig, Status, diagnose
from schemamap.connect import doctor as doctor_module
from schemamap.errors import ConnectError, DriverUnavailableError, QueryRefusedError
from schemamap.queries import QueryName

PASSWORD = "Sup3rSecret"


class FakeConnection:
    def __init__(self, answers: dict[QueryName, Any]) -> None:
        self.answers = answers

    def run(self, name: QueryName) -> list[tuple[Any, ...]]:
        answer = self.answers[name]
        if isinstance(answer, Exception):
            raise answer
        return list(answer)

    def __enter__(self) -> "FakeConnection":
        return self

    def __exit__(self, *_: object) -> None:
        return None


GREEN: dict[QueryName, Any] = {
    QueryName.DOCTOR_SERVER_INFO: [("16.0.4135.4", "Developer Edition (64-bit)", 3, "Sales")],
    QueryName.PERMISSIONS: [
        ("SELECT ON sys.sql_expression_dependencies",),
        ("VIEW DATABASE STATE",),
        ("VIEW DEFINITION",),
    ],
    QueryName.QUERY_STORE_STATE: [("READ_WRITE",)],
}


def config() -> ConnectionConfig:
    return ConnectionConfig(server="h", database="d", user="u", password=PASSWORD)


def patch(monkeypatch: pytest.MonkeyPatch, answers: dict[QueryName, Any]) -> None:
    monkeypatch.setattr(doctor_module, "load_driver", lambda: object())
    monkeypatch.setattr(doctor_module, "connect", lambda _c: FakeConnection(answers))


def test_all_green(monkeypatch: pytest.MonkeyPatch) -> None:
    patch(monkeypatch, GREEN)
    report = diagnose(config())
    assert report.all_green
    assert report.connected
    assert [c.name for c in report.checks] == [
        "Driver",
        "Connection",
        "Server",
        "VIEW DEFINITION",
        "VIEW DATABASE STATE",
        "SELECT sys.sql_expression_dependencies",
        "Query Store",
    ]


def test_missing_permissions_and_query_store_warn(monkeypatch: pytest.MonkeyPatch) -> None:
    patch(monkeypatch, {**GREEN, QueryName.PERMISSIONS: [], QueryName.QUERY_STORE_STATE: []})
    report = diagnose(config())
    warned = {c.name for c in report.checks if c.status is Status.WARN}
    assert warned == {
        "VIEW DEFINITION",
        "VIEW DATABASE STATE",
        "SELECT sys.sql_expression_dependencies",
        "Query Store",
    }
    assert all(c.next_step for c in report.checks if c.status is Status.WARN)
    assert report.connected


def checks_by_name(report: Any) -> dict[str, Any]:
    return {c.name: c for c in report.checks}


def test_missing_dependencies_select_warns_with_the_exact_grant(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    without = [("VIEW DATABASE STATE",), ("VIEW DEFINITION",)]
    patch(monkeypatch, {**GREEN, QueryName.PERMISSIONS: without})
    check = checks_by_name(diagnose(config()))["SELECT sys.sql_expression_dependencies"]
    assert check.status is Status.WARN
    assert check.detail == "missing"
    assert "GRANT SELECT ON sys.sql_expression_dependencies TO <login>;" in check.next_step
    assert "dependency and impact information is skipped" in check.next_step


def test_query_store_is_unknown_not_off_without_view_database_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The catalog says OFF to a login without VIEW DATABASE STATE; the doctor must not repeat it.
    held = [("VIEW DEFINITION",)]
    patch(
        monkeypatch, {**GREEN, QueryName.PERMISSIONS: held, QueryName.QUERY_STORE_STATE: [("OFF",)]}
    )
    check = checks_by_name(diagnose(config()))["Query Store"]
    assert check.status is Status.WARN
    assert check.detail == "unknown"
    assert "not off" in check.next_step


def test_query_store_off_when_readable_and_off(monkeypatch: pytest.MonkeyPatch) -> None:
    patch(monkeypatch, {**GREEN, QueryName.QUERY_STORE_STATE: [("OFF",)]})
    check = checks_by_name(diagnose(config()))["Query Store"]
    assert check.detail == "off"


def test_failed_probe_degrades_to_warning(monkeypatch: pytest.MonkeyPatch) -> None:
    patch(monkeypatch, {**GREEN, QueryName.QUERY_STORE_STATE: RuntimeError("denied")})
    report = diagnose(config())
    assert report.connected
    assert report.checks[-1].status is Status.WARN


def test_refused_query_is_a_bug_not_a_warning(monkeypatch: pytest.MonkeyPatch) -> None:
    refused = QueryRefusedError("Query is not on the allowlist.")
    patch(monkeypatch, {**GREEN, QueryName.PERMISSIONS: refused})
    with pytest.raises(QueryRefusedError):
        diagnose(config())


def test_connect_failure_is_failed_check(monkeypatch: pytest.MonkeyPatch) -> None:
    def refuse(_c: ConnectionConfig) -> Any:
        raise ConnectError("Login failed.")

    monkeypatch.setattr(doctor_module, "load_driver", lambda: object())
    monkeypatch.setattr(doctor_module, "connect", refuse)
    report = diagnose(config())
    assert not report.connected
    assert report.checks[-1].status is Status.FAIL


def test_driver_failure_stops_early(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail() -> Any:
        raise DriverUnavailableError("fix: brew install openssl")

    monkeypatch.setattr(doctor_module, "load_driver", fail)
    report = diagnose(config())
    assert [c.name for c in report.checks] == ["Driver"]
    assert (
        report.checks[0].next_step
        == "The SQL Server driver is not loaded: fix: brew install openssl"
    )


ARGS = ["doctor", "--server", "h", "--database", "d"]


def run(args: list[str], env: dict[str, str] | None = None, stdin: str | None = None) -> Any:
    return CliRunner().invoke(app, args, env=env or {}, input=stdin)


def test_cli_exit_3_when_driver_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail() -> Any:
        raise DriverUnavailableError(
            "The SQL Server driver could not be loaded. brew install openssl"
        )

    monkeypatch.setattr(doctor_module, "load_driver", fail)
    result = run(ARGS, {"SCHEMAMAP_USER": "u", "SCHEMAMAP_PASSWORD": PASSWORD})
    assert result.exit_code == 3
    assert "brew install openssl" in result.output
    assert PASSWORD not in result.output


def test_cli_exit_3_on_bad_config() -> None:
    result = run([*ARGS, "--port", "0"], {"SCHEMAMAP_USER": "u", "SCHEMAMAP_PASSWORD": PASSWORD})
    assert result.exit_code == 3
    assert "Port 0" in result.output


def test_cli_green_exit_0(monkeypatch: pytest.MonkeyPatch) -> None:
    patch(monkeypatch, GREEN)
    result = run(ARGS, {"SCHEMAMAP_USER": "u", "SCHEMAMAP_PASSWORD": PASSWORD})
    assert result.exit_code == 0
    assert "Everything is ready" in result.output
    assert PASSWORD not in result.output


def test_cli_prompts_hidden_when_env_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    patch(monkeypatch, GREEN)
    seen: list[ConnectionConfig] = []
    real = doctor_module.diagnose

    def spy(cfg: ConnectionConfig) -> Any:
        seen.append(cfg)
        return real(cfg)

    monkeypatch.setattr(cli, "diagnose", spy)
    result = run(ARGS, stdin=f"alice\n{PASSWORD}\n")
    assert result.exit_code == 0
    assert seen[0].user == "alice"
    assert seen[0].password == PASSWORD
    assert PASSWORD not in result.output


def test_cli_has_no_password_flag() -> None:
    result = run([*ARGS, "--password", "x"])
    assert result.exit_code == 2


def test_cli_windows_auth_refused_off_windows(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("schemamap.connect.config.sys.platform", "darwin")
    result = run([*ARGS, "--auth", AuthMode.WINDOWS.value])
    assert result.exit_code == 3
    assert "only available on Windows" in result.output


def test_every_next_step_names_its_subject(monkeypatch: pytest.MonkeyPatch) -> None:
    patch(monkeypatch, {**GREEN, QueryName.PERMISSIONS: [], QueryName.QUERY_STORE_STATE: []})
    steps = [c.next_step for c in diagnose(config()).checks if c.next_step]
    assert steps
    for step in steps:
        assert not re.search(r"\b[Ii]t\b", step), step
    assert any(step.startswith("VIEW DATABASE STATE is missing: ") for step in steps)
