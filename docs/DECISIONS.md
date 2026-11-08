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

## D-008 Python toolchain dependencies (2026-11-08)
Python 3.13 via uv for development, `requires-python >=3.10` for users. Runtime: `typer` (CLI framework, per D-004). Dev only: `ruff` (lint and format in one tool), `mypy` (strict typing), `pytest` (test runner, with an `integration` marker for lab tests), `pytest-cov` (coverage reporting). Build backend `uv_build` (matches uv, no extra tooling).

## D-009 Viewer toolchain dependencies (2026-11-08)
Runtime: `react`, `react-dom` (UI, per D-004). Build: `vite` (bundler and dev server), `@vitejs/plugin-react` (JSX transform), `vite-plugin-singlefile` (inlines JS and CSS so the build is one offline `dist/index.html`). Types and lint: `typescript` (strict), `@types/react`, `@types/react-dom`, `@types/node` (Node types for the e2e test), `eslint`, `@eslint/js`, `typescript-eslint` (type-aware strict rules), `eslint-plugin-react-hooks` (hook correctness), `globals` (browser globals for ESLint), `prettier` (formatting). Tests: `vitest` (unit tests, per D-004), `jsdom` (DOM for Vitest), `@testing-library/react` (render components in tests), `@playwright/test` (end-to-end tests in Chromium, per D-004).

## D-010 SQL Server lab design (2026-11-08)
`docker-compose.yml` and `.env.example` live at the repo root; `tools/lab.py` (standard library only, so no new dependency) drives it with `up`, `restore`, `status`, `down`, plus `grant` for databases added by hand. Container `schemamap-lab`, image `mssql/server:2022-latest` pinned to `linux/amd64`, host port 14330 bound to `127.0.0.1` only (1433 is taken on the dev machine, and the SA login should never be reachable from the network). Data and backups bind-mount from `lab-data/`. Passwords are generated into the gitignored `.env` under `SCHEMAMAP_LAB_*` names (so a stray shell variable cannot override them), are letters and digits only, and travel to sqlcmd as environment variables, never on a command line. Reason: one reproducible command, nothing secret on disk outside `.env` or in process listings.

## D-011 Lab SQL is outside the product query rules (2026-11-08)
The lab creates logins and restores databases, so its SQL (`tools/lab-sql/*.sql`) is DDL by design. It runs only against the throwaway lab container, never against a user's database, and deliberately lives outside `cli/src/schemamap/queries/` so the allowlist test never has to admit it. Likewise `restore` downloads the sample backups over the network only when the user runs it; the "no network calls" rule governs the product, not this developer tool. Logical file names from a downloaded backup are whitelisted before they reach T-SQL.

## D-012 Reader-login integration test uses docker exec for now (2026-11-08)
`cli/tests/test_lab_integration.py` proves the reader is denied `SELECT` on a user table and can read `sys.tables` by running sqlcmd through `docker exec schemamap-lab` (`/opt/mssql-tools18/bin/sqlcmd -C -b`), because the SQL Server driver is not chosen yet. This test moves to the real driver in crumb 1.2. Integration tests stay out of the default run through the `integration` marker (CI runs `pytest -m "not integration"`).
