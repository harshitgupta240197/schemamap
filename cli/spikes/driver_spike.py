"""Crumb 1.1 driver spike: connect to the lab and run one catalog query per driver.

Run from cli/ with the driver supplied ad hoc, for example:

    uv run --with mssql-python python spikes/driver_spike.py mssql-python
    uv run --with pymssql python spikes/driver_spike.py pymssql

The reader password is loaded from .env through tools/lab.py and is never printed.
Errors are reported as the exception type plus a redacted message only.
Not part of the package: excluded from the build, mypy and coverage.
"""

from __future__ import annotations

import importlib.util
import sys
import time
from pathlib import Path
from types import ModuleType
from typing import Any

LAB_PATH = Path(__file__).resolve().parents[2] / "tools" / "lab.py"
SERVER, PORT, DATABASE = "localhost", 14330, "AdventureWorks2022"
QUERY = "SELECT name FROM sys.tables ORDER BY name"
RUNS = 5


def load_lab() -> ModuleType:
    spec = importlib.util.spec_from_file_location("schemamap_lab", LAB_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["schemamap_lab"] = module
    spec.loader.exec_module(module)
    return module


def connect_mssql_python(user: str, password: str) -> Any:
    import mssql_python

    # The lab uses a self-signed certificate, hence TrustServerCertificate=yes.
    parts = {
        "Server": f"{SERVER},{PORT}",
        "Database": DATABASE,
        "UID": user,
        "PWD": password,
        "Encrypt": "yes",
        "TrustServerCertificate": "yes",
        "ApplicationIntent": "ReadOnly",
    }
    return mssql_python.connect(";".join(f"{k}={v}" for k, v in parts.items()))


def connect_pymssql(user: str, password: str) -> Any:
    import pymssql

    return pymssql.connect(
        server=SERVER,
        port=str(PORT),
        user=user,
        password=password,
        database=DATABASE,
        read_only=True,
        encryption="require",
    )


CONNECTORS = {"mssql-python": connect_mssql_python, "pymssql": connect_pymssql}


def main(driver: str) -> int:
    lab = load_lab()
    creds = lab.load_credentials()
    connect = CONNECTORS[driver]
    timings: list[tuple[float, float]] = []
    names: list[str] = []
    try:
        for _ in range(RUNS):
            start = time.perf_counter()
            conn = connect(lab.READER_LOGIN, creds.reader)
            connected = time.perf_counter()
            cursor = conn.cursor()
            cursor.execute(QUERY)
            names = [row[0] for row in cursor.fetchall()]
            done = time.perf_counter()
            conn.close()
            timings.append((connected - start, done - connected))
    except Exception as exc:  # report safely, never the raw message or traceback
        message = lab.redact(str(exc), creds.secrets())
        print(f"{driver}: FAILED {type(exc).__name__}: {message[:300]}")
        return 1
    first_connect, first_query = timings[0]
    warm = timings[1:]
    print(f"{driver}: {len(names)} tables, first={names[0]!r}, last={names[-1]!r}")
    print(f"  cold connect {first_connect * 1000:.0f} ms, query {first_query * 1000:.1f} ms")
    print(
        f"  warm connect avg {sum(c for c, _ in warm) / len(warm) * 1000:.0f} ms, "
        f"query avg {sum(q for _, q in warm) / len(warm) * 1000:.1f} ms"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1]))
