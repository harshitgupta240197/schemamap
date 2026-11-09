import pytest

from schemamap.connect import AuthMode, ConnectionConfig
from schemamap.errors import ConnectError

PASSWORD = "p@ss;word}{1"


def make(**overrides: object) -> ConnectionConfig:
    values: dict[str, object] = {
        "server": "db.example.test",
        "database": "Sales",
        "user": "reader",
        "password": PASSWORD,
    }
    values.update(overrides)
    return ConnectionConfig(**values)  # type: ignore[arg-type]


def test_defaults_are_encrypted_and_read_only_intent() -> None:
    text = make().connection_string()
    assert "Encrypt={yes}" in text
    assert "TrustServerCertificate={no}" in text
    assert "ApplicationIntent={ReadOnly}" in text
    assert "Server={db.example.test,1433}" in text


def test_trust_flag_and_port() -> None:
    text = make(trust_server_certificate=True, port=14330).connection_string()
    assert "TrustServerCertificate={yes}" in text
    assert "Server={db.example.test,14330}" in text


def test_special_characters_are_brace_quoted() -> None:
    assert "PWD={p@ss;word}}{1}" in make().connection_string()


def test_entra_password_uses_authentication_keyword() -> None:
    text = make(auth=AuthMode.ENTRA_PASSWORD).connection_string()
    assert "Authentication=ActiveDirectoryPassword" in text
    assert "UID=" in text


@pytest.mark.parametrize(
    ("auth", "keyword"),
    [
        (AuthMode.ENTRA_INTERACTIVE, "ActiveDirectoryInteractive"),
        (AuthMode.ENTRA_DEFAULT, "ActiveDirectoryDefault"),
        (AuthMode.ENTRA_INTEGRATED, "ActiveDirectoryIntegrated"),
    ],
)
def test_passwordless_entra_modes_send_no_credentials(auth: AuthMode, keyword: str) -> None:
    text = make(auth=auth, user=None, password=None).connection_string()
    assert f"Authentication={keyword}" in text
    assert "PWD" not in text
    assert "UID" not in text


def test_windows_auth_refused_off_windows(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("schemamap.connect.config.sys.platform", "darwin")
    with pytest.raises(ConnectError, match="only available on Windows"):
        make(auth=AuthMode.WINDOWS, user=None, password=None)


def test_windows_auth_uses_trusted_connection(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("schemamap.connect.config.sys.platform", "win32")
    text = make(auth=AuthMode.WINDOWS, user=None, password=None).connection_string()
    assert "Trusted_Connection=yes" in text
    assert "PWD" not in text


@pytest.mark.parametrize(
    "overrides",
    [
        {"server": " "},
        {"database": ""},
        {"port": 0},
        {"port": 70000},
        {"connect_timeout": -1},
        {"user": None},
        {"password": None},
    ],
)
def test_invalid_settings_raise_connect_error(overrides: dict[str, object]) -> None:
    with pytest.raises(ConnectError):
        make(**overrides)


def test_password_never_in_repr_or_str() -> None:
    config = make()
    for text in (repr(config), str(config), f"{config}", f"{config!r}"):
        assert PASSWORD not in text
        assert "PWD" not in text


def test_config_is_immutable() -> None:
    with pytest.raises(AttributeError):
        make().password = "x"  # type: ignore[misc]
