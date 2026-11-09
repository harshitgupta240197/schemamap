"""MetadataExecutor: the only code in the package that touches a driver cursor.

It runs named queries from ``queries/`` and nothing else. Each file is checked against the
allowlist again just before it runs, and values are bound as parameters, never formatted in.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from schemamap.errors import (
    ConnectError,
    PermissionDeniedError,
    QueryRefusedError,
    QueryTimeoutError,
)
from schemamap.queries import QueryName, load_query, query_params
from schemamap.queries.allowlist import check_query

Row = tuple[Any, ...]
ParamValue = str | int
Params = Mapping[str, ParamValue]


class MetadataExecutor:
    """An open, read-only-intent connection that runs only allowlisted named queries."""

    def __init__(self, driver_connection: Any) -> None:
        self._driver_connection = driver_connection

    def run(self, query: QueryName, params: Params | None = None) -> list[Row]:
        """Run the named query with ``params`` bound and return every row as a tuple.

        Raises QueryRefusedError if ``query`` is not a QueryName, the file fails the
        allowlist, or ``params`` do not match the file's ``-- params:`` header.
        """
        if not isinstance(query, QueryName):
            raise QueryRefusedError(
                "The executor runs only named queries from queries/, never SQL text."
            )
        sql = load_query(query)
        check_query(sql)
        values = bind_params(query_params(sql), params or {})
        cursor = self._driver_connection.cursor()
        failure: ConnectError | None = None
        try:
            if values:
                cursor.execute(sql, values)
            else:
                cursor.execute(sql)
            return [tuple(row) for row in cursor.fetchall()]
        except Exception as exc:  # the driver raises its own hierarchy; classify by its text
            failure = classify_query_failure(exc, query)
            if failure is None:
                raise
        finally:
            cursor.close()
        # Raised outside the except block so the driver exception is not chained.
        raise failure

    def close(self) -> None:
        """Close the connection; safe to call twice."""
        self._driver_connection.close()

    def __enter__(self) -> MetadataExecutor:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()


def classify_query_failure(exc: Exception, query: QueryName) -> ConnectError | None:
    """A friendly error for a driver failure while running ``query``, or None if unrecognised.

    Only fixed wording is used, never the driver's text, which could echo more than we want.
    """
    text = str(exc).lower()
    if "timeout" in text or "timed out" in text or "hyt00" in text:
        return QueryTimeoutError(
            f"The query {query.value!r} ran past the query timeout. "
            "Fix: raise --query-timeout, or run during a quieter period."
        )
    if "permission" in text and ("denied" in text or "does not have" in text):
        return PermissionDeniedError(
            f"The server denied the query {query.value!r}. "
            "Fix: run `schemamap doctor` to see which permission is missing."
        )
    if "communication link" in text or "08s01" in text or "connection is closed" in text:
        return ConnectError(
            "The connection to the server was lost during extraction. "
            "Fix: check the network and run the command again."
        )
    return None


def bind_params(declared: tuple[str, ...], params: Params) -> tuple[ParamValue, ...]:
    """Order ``params`` by the declared names for positional binding.

    Raises QueryRefusedError for a missing or unexpected name, or a value that is not a
    str or int (bool is refused even though it is an int).
    """
    missing = [name for name in declared if name not in params]
    extra = sorted(set(params) - set(declared))
    if missing or extra:
        raise QueryRefusedError(
            f"Parameters do not match the query: missing {missing}, unexpected {extra}."
        )
    values = tuple(params[name] for name in declared)
    for name, value in zip(declared, values, strict=True):
        if isinstance(value, bool) or not isinstance(value, (str, int)):
            raise QueryRefusedError(
                f"Parameter {name!r} must be str or int, not {type(value).__name__}."
            )
    return values
