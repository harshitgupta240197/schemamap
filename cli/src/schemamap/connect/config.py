"""Connection settings. The password lives in a field that never appears in repr or str."""

from __future__ import annotations

import enum
import sys
from dataclasses import dataclass, field

from schemamap.errors import ConnectError


class AuthMode(str, enum.Enum):
    """How to authenticate. Values are the CLI spellings."""

    SQL = "sql"
    WINDOWS = "windows"
    ENTRA_PASSWORD = "entra-password"
    ENTRA_INTERACTIVE = "entra-interactive"
    ENTRA_DEFAULT = "entra-default"
    ENTRA_INTEGRATED = "entra-integrated"

    @property
    def needs_user(self) -> bool:
        """True when the mode takes a user name."""
        return self in (AuthMode.SQL, AuthMode.ENTRA_PASSWORD)

    @property
    def needs_password(self) -> bool:
        """True when the mode takes a password."""
        return self in (AuthMode.SQL, AuthMode.ENTRA_PASSWORD)


_ENTRA_KEYWORD = {
    AuthMode.ENTRA_PASSWORD: "ActiveDirectoryPassword",
    AuthMode.ENTRA_INTERACTIVE: "ActiveDirectoryInteractive",
    AuthMode.ENTRA_DEFAULT: "ActiveDirectoryDefault",
    AuthMode.ENTRA_INTEGRATED: "ActiveDirectoryIntegrated",
}


def _quote(value: str) -> str:
    """Brace-quote a connection-string value so ``;`` and ``{`` cannot inject keywords."""
    return "{" + value.replace("}", "}}") + "}"


@dataclass(frozen=True)
class ConnectionConfig:
    """Everything needed to open a connection. Never printable with the password."""

    server: str
    database: str
    port: int = 1433
    auth: AuthMode = AuthMode.SQL
    user: str | None = None
    password: str | None = field(default=None, repr=False)
    trust_server_certificate: bool = False
    encrypt: bool = True
    connect_timeout: int = 15
    query_timeout: int = 60

    def __post_init__(self) -> None:
        if not self.server.strip():
            raise ConnectError("No server given.")
        if not self.database.strip():
            raise ConnectError("No database given.")
        if not 0 < self.port < 65536:
            raise ConnectError(f"Port {self.port} is not valid.")
        if self.connect_timeout < 0 or self.query_timeout < 0:
            raise ConnectError("Timeouts cannot be negative.")
        if self.auth is AuthMode.WINDOWS and not sys.platform.startswith("win"):
            raise ConnectError(
                "Windows authentication is only available on Windows. "
                "Use --auth sql, or an Entra ID mode."
            )
        if self.auth.needs_user and not self.user:
            raise ConnectError("This authentication mode needs a user name.")
        if self.auth.needs_password and not self.password:
            raise ConnectError("This authentication mode needs a password.")

    def __repr__(self) -> str:
        return (
            f"ConnectionConfig(server={self.server!r}, port={self.port}, "
            f"database={self.database!r}, auth={self.auth.value!r}, user={self.user!r})"
        )

    __str__ = __repr__

    def connection_string(self) -> str:
        """Build the driver connection string. Contains the password: never log or print it."""
        parts = {
            "Server": f"{self.server},{self.port}",
            "Database": self.database,
            "ApplicationIntent": "ReadOnly",
            "Encrypt": "yes" if self.encrypt else "no",
            "TrustServerCertificate": "yes" if self.trust_server_certificate else "no",
        }
        text = ";".join(f"{key}={_quote(value)}" for key, value in parts.items())
        if self.auth is AuthMode.WINDOWS:
            return f"{text};Trusted_Connection=yes"
        if self.auth is AuthMode.SQL:
            text += f";UID={_quote(self.user or '')};PWD={_quote(self.password or '')}"
            return text
        text += f";Authentication={_ENTRA_KEYWORD[self.auth]}"
        if self.auth is AuthMode.ENTRA_PASSWORD:
            text += f";UID={_quote(self.user or '')};PWD={_quote(self.password or '')}"
        return text

    def secrets(self) -> tuple[str, ...]:
        """Strings that must never appear in any message: the password and the connection string."""
        found = [self.connection_string()]
        if self.password:
            found.append(self.password)
        return tuple(found)
