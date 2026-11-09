"""Loading the mssql-python driver, with a per-OS fix message when its native library is missing."""

from __future__ import annotations

import importlib
import sys
from types import ModuleType

from schemamap.errors import DriverUnavailableError

DOCS_URL = "https://github.com/microsoft/mssql-python/wiki/Installation"


def driver_fix_message(platform: str | None = None) -> str:
    """Plain-English steps to make the driver load on ``platform`` (default: this machine)."""
    platform = platform or sys.platform
    if platform == "darwin":
        steps = (
            "On macOS the driver needs macOS 15 or newer and Homebrew OpenSSL: "
            "run `brew install openssl`."
        )
    elif platform.startswith("linux"):
        steps = (
            "On Linux the driver needs libltdl and the Kerberos libraries: "
            "install libltdl7 and libkrb5-3 (Debian/Ubuntu) or libtool-ltdl and krb5-libs "
            "(RHEL/Fedora)."
        )
    elif platform.startswith("win"):
        steps = "On Windows install the latest Microsoft Visual C++ Redistributable (x64)."
    else:
        steps = "This operating system is not supported by the SQL Server driver."
    return f"The SQL Server driver could not be loaded. {steps} See {DOCS_URL}"


def load_driver() -> ModuleType:
    """Import mssql_python. Raises DriverUnavailableError with the fix message on failure."""
    try:
        return importlib.import_module("mssql_python")
    except Exception:  # import and native-library failures take many forms
        pass
    # Raised outside the except block so the original error is not chained.
    raise DriverUnavailableError(driver_fix_message())
