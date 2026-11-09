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
`cli/tests/test_lab_integration.py` proves the reader is denied `SELECT` on a user table and can read `sys.tables` by running sqlcmd through `docker exec schemamap-lab` (`/opt/mssql-tools18/bin/sqlcmd -C -b`), because the SQL Server driver is not chosen yet. Crumb 1.2 moved the reader checks onto the connect module (D-028); only the restored-databases check still uses docker exec. Integration tests stay out of the default run through the `integration` marker (CI runs `pytest -m "not integration"`).

## D-013 The snapshot file is the boundary between stages (2026-11-09)
Only `connect` and `extract` touch the database; infer, export, the viewer and later Pulse read snapshot files. Reason: everything downstream is testable without a server and a user can reproduce a bug by sending a redacted snapshot. Rejected: infer and export querying the database on demand, which would make them impure and need credentials at every step.

## D-014 Pydantic models are the source of truth for snapshot format v1 (2026-11-09)
Models live in `cli/src/schemamap/snapshot/`; `schema/snapshot.v1.json` is generated by `cli/scripts/gen_snapshot_schema.py`, committed, and checked by a test; viewer types are generated from it. Dependency: `pydantic` (runtime, approved stack: typed validation plus JSON Schema generation in one library). Rejected: a hand-written JSON Schema with generated Python, which leaves validators (sorting, integrity) with nowhere to live.

## D-015 Object IDs are kind-prefixed, percent-escaped names (2026-11-09)
`<kind>:<part>.<part>…` with only `%`, `. ( ) , >` and control characters percent-encoded (uppercase hex, UTF-8), no Unicode normalization, and a strict canonical parser so each name has exactly one ID. Reason: readable in diffs and overrides, round-trips any name, safe as a map key. Rejected: SQL bracket quoting (`[a]]b]`, needs a real parser and is noisy in URLs and DOM keys), numeric `object_id` (changes on restore or rebuild, so overrides would break) and hashes (unreadable).

## D-016 Relationship edges are identified by their column mapping (2026-11-09)
`edge:dbo.A(x,y)>dbo.B(p,q)` is derived from the ordered from-column and to-column IDs; foreign keys also get their own `foreign_key:` ID. Reason: `overrides.json` entries survive constraint renames, and an inferred edge matches a key later declared on the same columns. Rejected: keying relationships by constraint name, which inferred edges do not have.

## D-017 Inferred relationships get a separate list in v1.1 (2026-11-09)
v1.1 adds a top-level `inferred_relationships` list (edge, score, typed evidence); `relationships` stays declared keys only. The name is reserved in ARCHITECTURE.md and the v1 schema description, not implemented. Reason: a v1.0 reader ignores the unknown list, so it can never present a guess as a declared key. Trade-off: consumers that want "all edges" must merge two lists. Rejected: adding `source: declared | inferred`, `score` and `evidence` to `relationships` entries, because a v1.0 reader ignoring `source` would show inferred edges as real foreign keys.

## D-018 Readers ignore unknown fields; minor versions only add (2026-11-09)
Models use `extra="ignore"`; `format_version` is `MAJOR.MINOR`; readers reject only a different major. Reason: v1.0 readers keep working on v1.x files. Rejected: `extra="forbid"`, which would make every addition a breaking change.

## D-019 Determinism is enforced by the models (2026-11-09)
Validators sort unordered lists by ID (or canonical content), reject duplicates and check that references resolve; ordered lists keep catalog order. Reason: snapshots diff cleanly regardless of how extract queried them. Rejected: relying on `ORDER BY` in each query, which one forgotten clause would silently break.

## D-020 Optional sections are null when not collected (2026-11-09)
`row_counts`, `query_history` and `join_evidence` are `null` for "not collected" and an empty list for "collected, nothing found". Reason: inference and the viewer must not mistake a missing permission for a clean result. Rejected: omitting the keys or using empty lists for both.

## D-021 Cross-database references are flagged, never resolved (2026-11-09)
`Reference.scope` is `local`, `cross_database` or `cross_server`; only local references carry `resolved`. Reason: resolving would mean connecting to other databases or servers the user did not point us at. Rejected: best-effort resolution against other databases on the same instance.

## D-022 Definitions are on by default (2026-11-09)
Module, computed, default, check and filter definitions are stored. They are metadata but free text that may contain literals; this is documented in ARCHITECTURE.md and SECURITY.md, and a `--no-definitions` flag is planned. Reason: they drive dependency and join evidence and are what users want to read. Rejected: off by default, which would gut the map for the common case.

## D-023 Join evidence is parsed in extract; infer stays pure (2026-11-09)
Extract parses module definitions and optional Query Store text into typed `(from_column, to_column, source, count)` pairs plus `parse_failure_count`, then discards the text. Reason: query text can contain row literals and never enters the snapshot, so the stage that holds it must do the parsing; infer stays a deterministic function of data. Rejected: storing query text for infer to parse.

## D-024 Pulse writes its own artifact (2026-11-09)
Pulse adds its own allowlisted Query Store queries and a separate versioned file keyed by snapshot object IDs. Reason: the Map snapshot stays small and metadata-only, and Pulse can evolve on its own. Rejected: adding performance sections to the snapshot.

## D-025 Hypothesis for property tests (2026-11-09)
Dev only: `hypothesis` generates hostile and arbitrary names for the ID round-trip, canonical-form and injectivity tests. Reason: it explores Unicode and delimiter edge cases far better than fixed examples and shrinks failures. Rejected: a hand-rolled seeded fuzzer.

## D-026 Redaction covers linked-server names (2026-11-09)
`--redact-server` (`redact_server()`) drops `source.server` and the server part of every cross-server reference; dependencies that become identical collapse into one. Reason: linked-server names are host names too. Rejected: redacting only the source host.

## D-027 SQL Server driver: mssql-python (2026-11-09)
Dependency: `mssql-python>=1.17` (runtime, the chosen SQL Server driver: Microsoft's GA driver, `pip install` brings everything it needs, and it supports Entra ID on every OS).

**Why.** It is the only candidate that installs with pip alone on Windows, supports Entra ID on Windows, macOS and Linux, and accepts the full ODBC Driver 18 keyword set (`ApplicationIntent=ReadOnly`, `Encrypt=yes|strict`, `TrustServerCertificate`, `HostnameInCertificate`). The native driver ships as the `mssql-python-odbc` wheel, a pinned dependency, so users never install msodbcsql18 or unixODBC and never accept a EULA by hand.

**Comparison** (sources checked 2026-11-09):

| | mssql-python 1.17.0 (chosen) | pyodbc 5.5.0 + ODBC Driver 18.7.1.1 | pymssql 2.4.6 |
|---|---|---|---|
| System install | Windows: none. macOS: `brew install openssl`. Linux: `libltdl7 libkrb5-3 libgssapi-krb5-2` (Debian/Ubuntu), `libtool-ltdl krb5-libs` (RHEL) [1] | ODBC Driver 18 on every OS, plus unixODBC on macOS and Linux. macOS: `brew tap microsoft/mssql-release …; brew trust …; HOMEBREW_ACCEPT_EULA=Y brew install msodbcsql18`. Linux: add the Microsoft package repo, then `ACCEPT_EULA=Y apt-get/yum install msodbcsql18`. Windows: run the MSI installer [4][5][6] | None: FreeTDS and OpenSSL are statically linked into the wheels [8] |
| Wheels | CPython 3.10–3.15. win_amd64, win_arm64 (3.11+), macOS 15+ universal2, manylinux_2_28 and musllinux x86_64/aarch64 [2] | **CPython 3.11+ only** (`requires_python >=3.11`; we support 3.10). win32/amd64/arm64, macOS x86_64/arm64, manylinux/musllinux [3] | CPython 3.9–3.15. win_amd64/arm64, macOS 15+ x86_64/arm64, manylinux_2_28 and musllinux x86_64/aarch64 [8] |
| Windows authentication | `Trusted_Connection=yes` (SSPI), Kerberos via `ActiveDirectoryIntegrated` [1][9] | SSPI on Windows, Kerberos on macOS/Linux [7] | Only `DOMAIN\user` with a password (NTLM); no SSPI option [10] |
| Azure SQL / Entra ID | Password, Interactive, DeviceCode, MSI, ServicePrincipal, Integrated, Default on all OSes; `token_provider` hook [9] | Interactive on Windows only; MSI, ServicePrincipal and Integrated on all OSes; Password deprecated; access token [7] | Azure SQL with SQL logins only; **no Entra ID** [11] |
| Read-only intent | `ApplicationIntent=ReadOnly` [12] | `ApplicationIntent=ReadOnly` [6] | `read_only=True` (FreeTDS `read-only intent`) [10] |
| Encryption / certificates | `Encrypt=yes|no|strict`, `TrustServerCertificate` [12] | Default `Encrypt=yes` (18+), `strict` (TDS 8), `TrustServerCertificate` default no, `ServerCertificate` [6] | `encryption=off|request|require`; certificate validation only through `ca file` in `freetds.conf`, and **any certificate is accepted when it is not set** [10][13] |
| Maintenance | Microsoft, GA since 1.0.0 (2025-11-18); 18 releases, every 2–4 weeks [2] | Community; 5.3.0 2025-10, 5.4.0 and 5.5.0 2026-11 [3]; ODBC Driver 18.7.1.1 2026-09-07 [5] | One maintainer; 19 releases since 2024-11, with a 6.5-month gap in 2026 [8] |
| License | MIT; the bundled driver libraries are under Microsoft Software License Terms [1] | MIT-0; ODBC Driver EULA [3][5] | LGPL-2.1 [8] |

**Prototype** (`cli/spikes/driver_spike.py`, kept for reference; outside the package, mypy and coverage). Each driver connected to the lab (`localhost,14330`, AdventureWorks2022, `schemamap_reader`, read-only intent, encrypted) and ran `SELECT name FROM sys.tables`, 5 runs per driver, on macOS 26 arm64. No system install was needed: Homebrew `openssl@3` 3.6.3 was already present.

| | Python | Install (cold uv cache) | Packages | Tables | Cold connect | Warm connect | Query (warm) |
|---|---|---|---|---|---|---|---|
| mssql-python 1.17.0 | 3.10 | 20.7 s | 17 (azure-identity and others) | 71 | 2100 ms | 2 ms (pooled) | 4.8 ms |
| mssql-python 1.17.0 | 3.13 | 3.0 s | 17 | 71 | 1340 ms | 1 ms (pooled) | 4.8 ms |
| pymssql 2.4.6 | 3.10 | 5.9 s | 1 | 71 | 2258 ms | 13 ms | 4.7 ms |
| pymssql 2.4.6 | 3.13 | 6.3 s | 1 | 71 | 1685 ms | 14 ms | 5.0 ms |

Most of the cold-connect time is the first login to the lab server, and the two drivers are close. On a failed login, neither driver put the password or a `PWD=` fragment in its exception message (checked with a fake password).

**Trade-offs we accept.** 17 transitive packages (mostly from `azure-identity`). macOS wheels need macOS 15+ and Homebrew OpenSSL. Linux needs libltdl and Kerberos libraries, which most distributions already have. Connection pooling is on by default. The wiki contradicts itself on the default autocommit setting, so the connect layer will set autocommit explicitly. Error messages are still redacted in our CLI layer, whatever the driver does.

**Rejected.**
- **pyodbc + ODBC Driver 18:** every user needs a system-level driver install with EULA acceptance, plus unixODBC on macOS and Linux. That is the most install friction of the three, and the current release drops Python 3.10.
- **pymssql:** the easiest install, but it has no Entra ID support, so it cannot reach most Azure SQL setups. Certificate validation needs a `freetds.conf` file and is off by default. The LGPL licence and single maintainer are further risks.

Sources: [1] https://github.com/microsoft/mssql-python (README) and https://github.com/microsoft/mssql-python/wiki/Installation · [2] https://pypi.org/project/mssql-python/ · [3] https://pypi.org/project/pyodbc/ and https://github.com/mkleehammer/pyodbc/wiki/Install · [4] https://learn.microsoft.com/en-us/sql/connect/odbc/linux-mac/install-microsoft-odbc-driver-sql-server-macos · [5] https://learn.microsoft.com/en-us/sql/connect/odbc/download-odbc-driver-for-sql-server · [6] https://learn.microsoft.com/en-us/sql/connect/odbc/dsn-connection-string-attribute and https://learn.microsoft.com/en-us/sql/connect/odbc/linux-mac/installing-the-microsoft-odbc-driver-for-sql-server · [7] https://learn.microsoft.com/en-us/sql/connect/odbc/using-azure-active-directory · [8] https://pypi.org/project/pymssql/ and https://pymssql.readthedocs.io/en/latest/changelog.html · [9] https://github.com/microsoft/mssql-python/wiki/Microsoft-Entra-ID-support · [10] https://pymssql.readthedocs.io/en/latest/ref/pymssql.html · [11] https://pymssql.readthedocs.io/en/latest/azure.html · [12] https://github.com/microsoft/mssql-python/wiki/Connection-to-SQL-Database · [13] https://www.freetds.org/userguide/freetdsconf.html

## D-028 Connection layer and doctor (2026-11-09)

`schemamap.connect` builds the mssql-python connection string itself, brace-quoting every value so a `;` in a password or name cannot inject keywords, and sets `ApplicationIntent=ReadOnly`, `Encrypt=yes` by default, and `autocommit=True` explicitly. Driver exceptions are never chained or re-raised: they become `ConnectError` with the driver text passed through a redactor that masks the password and the whole connection string. `ConnectionConfig` keeps the password out of `repr`/`str`, and the Typer app sets `pretty_exceptions_show_locals=False` so a crash cannot print it. Credentials come only from `SCHEMAMAP_USER`/`SCHEMAMAP_PASSWORD` or a hidden prompt; there is no `--password` flag. Auth modes: `sql`, `windows` (Windows only; refused elsewhere), and Entra ID `entra-password`, `entra-interactive`, `entra-default`, `entra-integrated`. Doctor SQL lives in `queries/doctor_*.sql`. The raw `Connection.cursor()` exists only until crumb 1.3 replaces it with the allowlisting executor.

Dependency: `rich` is now declared directly (it was already installed through Typer) because the CLI layer imports it for doctor output, as the approved stack allows.

## D-029 Query allowlist and read-only guard (2026-11-09)

`MetadataExecutor` (`connect/executor.py`) replaces D-028's `Connection` and its raw `cursor()`. It takes a `QueryName`, never text, re-checks the file with `queries/allowlist.py` before every run, and binds values positionally. Tests that must run other SQL (proving the reader is denied `SELECT` on a user table) use `cli/tests/raw_sql.py`, which opens the driver directly and is outside the package.

**Allowlist rules** (parsed with sqlglot, T-SQL dialect): exactly one statement; a `SELECT` (CTEs and `UNION` allowed); every table source is `sys.*` or `INFORMATION_SCHEMA.*`, or an unqualified name of a CTE in scope; `sys.dm_*` and `sys.query_store_*` must be approved by name; schema-qualified functions (`sys.fn_my_permissions`) and unqualified built-ins must be on explicit lists; no `SELECT INTO`, temp tables, table variables, `@` variables, `EXEC`, `sp_executesql`, `OPENROWSET`/`OPENQUERY`/`OPENDATASOURCE`/`OPENXML`, DML, DDL or other statements. We also refuse **three-part names** (`OtherDb.sys.tables`), not just four-part ones: a query reads only the database it is connected to. `NEXT VALUE FOR` is refused because it advances a sequence.

**Function names** are resolved to T-SQL names (sqlglot types some built-ins and leaves others anonymous; typed ones are rendered back to T-SQL and named by their leading word), so the approved list is written in T-SQL and survives sqlglot moving a function between node types. A test calls every approved function once, so an upgrade that changes this fails loudly.

**Approved views and functions start small.** Query Store views (`query_store_query`, `query_store_query_text`, `query_store_plan`, `query_store_runtime_stats`) and two DMVs (`dm_db_partition_stats`, `dm_db_index_usage_stats`) are pre-approved for join evidence and usage hints; everything else is added when a query needs it, with a reason here.

**Parameters.** Files use `?` placeholders and declare names in order with a `-- params: a, b` header; the allowlist checks the counts match, and the executor refuses missing, unexpected or non-`str`/`int` values (and `bool`). mssql-python reports `pyformat` but binds `?` with a tuple; on the wire it becomes `sp_prepexec` with `@P1…` (checked with Extended Events on the lab).

**Static guard** (`tests/test_static_guard.py`) parses every `.py` under `cli/src/` with `ast` and fails on SQL-shaped strings (including `+` chains and f-strings), on `.cursor`/`.execute`/`.executemany`/`.callproc` or the executor's private attribute outside the executor (also as `getattr` strings), on importing the driver anywhere but `connect/driver.py`, and on importing test helpers. The SQL detector matches upper-case statement shapes (this repo's SQL style) plus case-insensitive shapes that need structure prose lacks; its own tests pin both sides. `GRANT ... TO` is not flagged, because the doctor's advice text quotes it and the executor could not run it anyway.

**`QueryRefusedError` is a bug, not a warning.** The doctor re-raises it instead of reporting "could not be checked", so a broken query cannot hide as a permissions problem.

Dependency: `sqlglot>=30.30,<31` (runtime, on the approved stack): the executor parses every query before running it. Pinned to one major version because the allowlist walks its AST.

## D-030 Extract tables, columns, keys and indexes (2026-11-09)

`schemamap.extract` returns snapshot models from a `MetadataExecutor`; one NamedTuple per query (`extract/rows.py`) fixes the column order, and the `build_*` functions are pure so they are tested with hand-written rows. Six queries: `schemas`, `tables`, `columns`, `indexes`, `index_columns`, `check_constraints`. AdventureWorks2022 (71 tables, 486 columns, 173 indexes) extracts in about 2.5 s against the 10 s budget.

**Model change (additive, still format 1.0):** `Table` gains `temporal_type` (`none`, `system_versioned`, `history`) and `memory_optimized`, because the crumb asks for those flags and the model had nowhere to hold them. Both default, so older readers and files are unaffected.

**Mapping rules.** `length` is characters for `nchar`/`nvarchar` (catalog bytes / 2) and bytes for `char`, `varchar`, `binary`, `varbinary`; `max` sets `is_max` and leaves `length` null. `precision` is set only for `decimal`/`numeric`, `scale` also for `time`, `datetime2`, `datetimeoffset`, so an `int` does not claim a precision of 10. An alias type reports its base type in `data_type` and `schema.name` in `user_type`. `collation` is stored for every string column. Index columns: included ones go to `included_columns` (columnstore columns are listed that way by the catalog); a non-included column is a key if it has a key ordinal, or has no partition ordinal (this keeps the column of an XML or spatial index while dropping columns that only partition the index). Rows for an object dropped between two queries are ignored.

**Allowlist trimmed.** The pre-approved Query Store views and DMVs (D-029) are removed because no query uses them yet; each returns with a reason in the crumb that first needs it. The three-part-name refusal is unchanged.
