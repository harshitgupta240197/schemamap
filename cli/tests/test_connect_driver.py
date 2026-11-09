from typing import Any

import pytest

from schemamap.connect import driver as driver_module
from schemamap.connect import driver_fix_message, load_driver
from schemamap.errors import DriverUnavailableError


def test_fix_message_macos() -> None:
    text = driver_fix_message("darwin")
    assert "macOS 15" in text
    assert "brew install openssl" in text
    assert driver_module.DOCS_URL in text


def test_fix_message_linux() -> None:
    text = driver_fix_message("linux")
    assert "libltdl" in text
    assert "Kerberos" in text


def test_fix_message_windows_and_unknown() -> None:
    assert "Redistributable" in driver_fix_message("win32")
    assert "not supported" in driver_fix_message("plan9")


@pytest.mark.parametrize("error", [ImportError("no module"), OSError("libssl.dylib not found")])
def test_driver_load_failure_gives_fix_message(
    monkeypatch: pytest.MonkeyPatch, error: Exception
) -> None:
    def boom(_name: str) -> Any:
        raise error

    monkeypatch.setattr("schemamap.connect.driver.sys.platform", "darwin")
    monkeypatch.setattr("schemamap.connect.driver.importlib.import_module", boom)
    with pytest.raises(DriverUnavailableError, match="brew install openssl") as info:
        load_driver()
    assert info.value.__context__ is None
