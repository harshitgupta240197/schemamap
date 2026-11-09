"""Test-only: run arbitrary SQL by opening the driver directly.

Integration tests use this to prove what the lab login can NOT do (for example that SELECT on
a user table is denied). It lives under tests/, which is not part of the installed package,
and tests/test_static_guard.py fails if package code ever imports it.
"""

from __future__ import annotations

from typing import Any

from schemamap.connect import ConnectionConfig, load_driver


def run_raw_sql(config: ConnectionConfig, sql: str) -> list[tuple[Any, ...]]:
    """Open a fresh connection with ``config``, run ``sql`` and return every row."""
    driver = load_driver()
    connection = driver.connect(
        config.connection_string(), autocommit=True, timeout=config.connect_timeout
    )
    try:
        cursor = connection.cursor()
        cursor.execute(sql)
        return [tuple(row) for row in cursor.fetchall()]
    finally:
        connection.close()
