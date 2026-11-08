# Decisions

## D-001 Read-only and metadata-only in v1 (2026-11-08)
The opt-in data-sampling inference signal is deferred until after launch. Reason: the "never reads row data" promise stays absolute.

## D-002 SQL Server first (2026-11-08)
PostgreSQL and MySQL come after launch. Reason: focus on one engine to ship a solid v1.

## D-003 Local-first (2026-11-08)
A CLI plus an offline single-file HTML viewer, with no server in v1. Reason: nothing leaves the user's machine and there is nothing to host.

## D-004 Stack (2026-11-08)
Python CLI (uv, Typer, Rich, Pydantic, sqlglot); React and TypeScript viewer (Vite, @xyflow/react, elkjs, Vitest, Playwright). Reason: mature tooling for each side, with strong SQL parsing and graph layout libraries.

## D-005 License: Apache-2.0 (2026-11-08)
Reason: permissive, with an explicit patent grant that makes adoption easy.

## D-006 Telemetry is opt-in and count-only (2026-11-08)
Reason: respects user privacy and is consistent with the metadata-only promise.

## D-007 Working name schemamap (2026-11-08)
Used for the package and command; revisit before launch. Checked 2026-11-08: free on PyPI and GitHub. Reason: descriptive and available.
