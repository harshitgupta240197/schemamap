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

## D-031 Extract relationships, code objects and dependencies (2026-11-09)

Six new queries (`foreign_keys`, `views`, `view_columns`, `routines`, `synonyms`, `dependencies`; views reuse the column mapper). The pure `build_*` functions are tested with hand-written rows, and the extractors against AdventureWorks2022, WideWorldImporters and the lab's `SchemaMapEdgeCases` database (`lab.py edgecases`).

**Foreign keys** are grouped from one row per column pair; columns follow key order and the edge ID comes from the ordered column IDs, so two keys on the same columns share an edge and keep their own `foreign_key` IDs.

**Definitions** come from `sys.sql_modules`. `definition` is null with status `encrypted` (`OBJECTPROPERTY(..., 'IsEncrypted')`), `not_applicable` (CLR objects, which have no module row) or `not_permitted` (a module row exists but the text is hidden from this login).

**Dependencies** are one entry per distinct reference (the catalog has one row per referenced column). A name with a server part is `cross_server`, with a database part `cross_database`; both are kept as written and never resolved. A local name is `resolved` only if it points to a table, view, routine or synonym in the snapshot, otherwise it is recorded as unresolved. Note that SQL Server itself records XML and UDT method calls (`Demographics.exist(...)`, `OrganizationNode.GetAncestor(...)`) as three-part names, so AdventureWorks reports 14 `cross_database` dependencies whose "database" is really a column or alias. D-034 reclassifies them as `column_method`.

**Synonym targets** are split with `PARSENAME` because `sys.sql_expression_dependencies` does not list synonyms. `PARSENAME` is added to the function allowlist: it is a pure string function over its argument and reads nothing.

**Reader permission.** `sys.sql_expression_dependencies` needs an explicit `SELECT` (SQL Server grants it to `db_owner` only). The lab's `grant_reader.sql` now grants it; it is a catalog view with no user data, so the "no SELECT on user tables" guarantee is unchanged. Real users need the same grant for the dependencies section.

## D-032 Snapshot format versioning until v0.1.0 (2026-11-09)

Until v0.1.0 ships, new optional fields may stay in format 1.0. After release, any added field bumps the minor version. Reason: nothing outside this repo reads snapshots yet, so a minor bump now would only create churn; after release readers exist and the version must say what a file contains.

## D-033 Optional row counts, sizes and section warnings (2026-11-09)

**Permission gaps are found by probing, not by catching driver errors.** The crumb asked to detect SQL Server error numbers (229, 297, 300). The mssql-python driver does not expose them: its exceptions carry only a SQLSTATE-derived class (`42000`, shared with syntax errors) and the server's message text (checked on 1.17.0 against the lab: `ProgrammingError` with args `("Driver Error: Syntax error or access violation; DDBC Error: [Microsoft][SQL Server]The SELECT permission was denied ...",)`). Matching that text would break on a localised server, which is what the crumb meant to avoid. Instead one query (`permissions.sql`, over `sys.fn_my_permissions`, already allowlisted) reads the permissions the login holds, as data. A section that needs one it lacks declares it (`Requirement`), is never run, and is recorded as one `ExtractionWarning` (`code: permission_missing`, message names the exact `GRANT`). The runner also catches `PermissionMissing` raised from inside a section, so a driver wrapper that later exposes error numbers can raise it without changing callers. Every other error propagates untouched; a test pins that a driver error whose text says "permission was denied" is not swallowed. Revisit if the driver gains a numeric error code.

**Sections.** `extract_database` runs every section through the runner: schemas, tables, views, routines, synonyms and relationships need nothing optional; `dependencies` needs `SELECT` on `sys.sql_expression_dependencies`; `row_counts` needs `VIEW DATABASE STATE`. A skipped section is empty (`row_counts` is `None`) plus one warning.

**Row counts and sizes** come from `sys.dm_db_partition_stats`, approved in the allowlist for this query only (it is a DMV, so it needs a named exception, D-029; it reads page and row counters, never rows). Rows are counted on the heap or clustered index (`index_id` 0 or 1) so secondary indexes do not double them; `reserved_bytes` sums reserved pages of the table and all its indexes. Model change, additive and still format 1.0 (D-032): `RowCount.reserved_bytes` (optional). On SQL Server 2022 this DMV asks for `VIEW DATABASE PERFORMANCE STATE`, which `VIEW DATABASE STATE` implies; a login holding only the former is treated as lacking the latter and skipped, which errs on the safe side.

**Query Store flag.** `SourceInfo.query_store` is `on`, `off` or `unknown` (additive, default `unknown`). Measured on the lab: a login without `VIEW DATABASE STATE` still gets `OFF` from `sys.database_query_store_options`, so that answer is not trusted and the query is not even sent; the state is `unknown`. The doctor uses the same function and no longer reports "off" for an unreadable setting. Not a section, so it never adds a warning.

**Doctor** gains a `SELECT sys.sql_expression_dependencies` check: WARN with the exact `GRANT` line, saying dependency and impact information is skipped. `doctor_permissions.sql` and `doctor_query_store.sql` became `permissions.sql` and `query_store_state.sql` because extract now uses them too.

**Lab.** `grant_reader.sql` also creates `schemamap_reader_min` with `VIEW DEFINITION` only, in every database, and revokes the other two grants so re-running `grant` resets it. It reuses the reader's lab password (a lab-only login on public data), which avoids a third `.env` secret. `test_executor_runs_every_named_query` now skips `row_counts` for the plain reader (it fails there by design); `test_extract_sections_integration.py` runs it with `VIEW DATABASE STATE` granted through `lab.grant_reader` and puts the previous grant back afterwards.

**Docs.** SECURITY.md and LAB.md now say: no SELECT on any user table; one SELECT on the system catalog view `sys.sql_expression_dependencies` for dependency tracking, and show the full permission script with that line.

## D-034 Column method calls are their own reference scope (2026-11-09)

`Reference.scope` gains `column_method` (format stays 1.0, per D-032). SQL Server records `Demographics.exist(...)`, `s.Demographics.value(...)` and `OrganizationNode.GetAncestor(...)` as multi-part names, so they showed up as `cross_database` (14 rows in AdventureWorks) or as unresolved `local` references (2 more). Such a row keeps its name exactly as written: the parts are an alias, a column and a method, not a database, schema and object.

**Rule.** A non-server reference is `column_method` when the catalog row has `is_ambiguous = 1` **and** `referenced_id IS NULL`. A server part always means `cross_server`.

**Evidence** (AdventureWorks2022, WideWorldImporters, and a throwaway lab database with hand-built cases):
- All 16 AdventureWorks method-call rows have `is_ambiguous = 1`, `referenced_id` NULL, `referenced_class = 1`, `referenced_minor_id = 0`, `is_caller_dependent = 0`, `is_schema_bound_reference = 0`. Those other columns do not separate anything.
- Every genuine cross-database reference tested has `is_ambiguous = 0`: table, view, function call (`Db.dbo.Fn(1)`), `EXEC Db.dbo.Proc`, `Db..Table`, a missing object in a real database, and a database that does not exist.
- `is_ambiguous` alone is not enough: WideWorldImporters `Website.CalculateCustomerPrice(...)` is flagged ambiguous but resolves to a real function (`referenced_id` set). It stays `local` and resolved.
- `referenced_id IS NULL` alone is not enough: it is also true for every genuine cross-database reference and for references to missing local objects.
- A `sys.databases` lookup is not used: an alias can share a real database's name (tested, and still a method call), and a login only sees the databases it can access.
- A four-part method call (`dbo.T.Doc.value(...)`) is rejected by SQL Server, so a server part never carries a method call.

**Recorded, not dropped.** Dropping was rejected: if the rule ever misfires, a dropped genuine reference is lost for good, while a mislabelled one is still in the snapshot with its full name. The cost of keeping them is one more scope value that consumers (viewer, scoring) must treat as "not an object".

**Limit.** The rule reads the catalog's own ambiguity flag, which Microsoft describes as a reference that may resolve to a function, a UDT method or an XQuery reference to an XML column. A genuine call to a function that is both ambiguous and missing from the database would be labelled `column_method`; no such case was found in either sample database or in the lab. Not yet covered: the unresolved local `inserted` and `deleted` trigger pseudo-tables (not ambiguous, still `local` and unresolved), left for a later crumb.

## D-035 The extract command and the snapshot file (2026-11-09)

`schemamap extract` shares its connection options with `doctor` (`cli_connection.py`: one definition per option, one credential path), so the two cannot drift. The summary goes to stderr; stdout stays empty. Exit codes: 0 (also with warnings), 3 for a bad connection setting or a connect/auth failure, 1 for any other `SchemaMapError` or a file that cannot be written.

**Source details.** `source.server` is the host exactly as the user typed it. The server's own name for itself (`@@SERVERNAME`, `MachineName`) is never read, so `--redact-server` (D-026) has one value to drop and a container ID cannot leak. Version, compatibility level, collation and the database name come from `source_info.sql` (`SERVERPROPERTY` and the connected database's row in `sys.databases`). `engine_edition` is the numeric `EngineEdition` as a string (`"3"` Enterprise/Developer, `"5"` Azure SQL Database): a stable machine value, unlike the free-text edition name.

**Files.** The default name is `<database>.snapshot.json`; the database name is untrusted, so anything outside letters, digits, `.`, `_` and `-` becomes `_` and leading dots are removed (no path escape, no hidden file). `--gzip` appends `.gz` unless the name already ends in it, because a `.json` file holding gzip bytes is a trap. The gzip header carries no file name and a zero time, so equal snapshots give equal bytes. Files are written beside the target and moved into place, so an interrupted run leaves the old file. Readers detect gzip by its magic bytes, not by extension. `captured_at` is truncated to the second.

**Golden file.** `tests/fixtures/adventureworks2022.snapshot.json` is the whole snapshot with two values normalised: `captured_at` (the clock) and `source.product_version` (the lab image is `2022-latest`, so its build number moves and would fail the test for a reason that has nothing to do with extraction). It was taken as `schemamap_reader`, which lacks `VIEW DATABASE STATE`, so `row_counts` is null with its warning. To refresh it, run the command, then apply `normalised()` from `test_extract_command_integration.py`.

**Secret check.** A bare `Password` search is meaningless on AdventureWorks (it has a `Person.Password` table), so the test searches the file and the command output for the actual lab password, the reader login name, and connection-string forms (`PWD=`, `Password=`, `ApplicationIntent`, `TrustServerCertificate`).

**Dev dependencies.** `jsonschema`: checks the written file against `schema/snapshot.v1.json` independently of the Pydantic models that produced it, which is the point of a published schema. `types-jsonschema`: its type stubs, because mypy runs strict and the package ships none. Rejected: a mypy `ignore_missing_imports` override, which would weaken the strict check for one library.

## D-036 CLI experience: filters, omitted definitions, errors (2026-11-09)

**Filters run after extraction, as pure functions** (`extract/filters.py`). `--schema` (allow-list) and `--exclude-schema` (deny-list) are case-insensitive and repeatable; a name in both is excluded. Objects in omitted schemas are removed, then everything that pointed at or came from them: relationships, dependencies, synonyms whose target is gone, trigger routines whose parent table is gone, and row counts. This keeps the model's reference checks true without loosening them. One `filters` warning (`references_dropped`) states how many entries were dropped; a schema name that does not exist gives one `schema_not_found` warning, so a typo cannot silently produce an empty map. The applied filters are stored in the optional top-level `filters` field (still format 1.0, pre-release). `Section.FILTERS` was added for these warnings.

**`--no-definitions` is also post-processing.** Definition text of views, routines, computed columns, defaults, check constraints and index filters is removed; the objects stay. Module `definition_status` goes from `available` to the new value `omitted`; `encrypted` and `not_permitted` are kept because they say something true about the database. For the non-module definitions (computed, default, check) the text fields became optional: null only when omitted.

**Edition string.** `source.edition` holds `SERVERPROPERTY('Edition')` beside the numeric `engine_edition`. The golden file changed by exactly that field plus `"filters": null` (the new optional field is written as null like the other optional sections).

**Progress is a callback, not printing.** `SectionRunner` takes an optional `SectionObserver`; the CLI's `ExtractProgress` draws a transient Rich bar on stderr only when stderr is a terminal and `--quiet` is off. `--verbose` prints one timing line per section on any stream setup. `--quiet` and `--verbose` together are a usage error (exit 2).

**Errors.** `MetadataExecutor` turns recognisable driver failures (timeout, permission denied, lost connection) into `QueryTimeoutError`, `PermissionDeniedError` and `ConnectError` with fixed wording and no chained driver exception, as the connection step already did. All are `ConnectError`s, so they exit 3 together with login, certificate and unreachable-server failures. Classification is by driver text because the driver exposes no error numbers (see D-033). Unexpected errors exit 1 printing only the exception type, since its message could echo a secret; `--debug` re-raises for the full traceback. Exit 4 is wired for `SnapshotError`; no command reads snapshots yet.

## D-037 Synthetic schema generator (2026-11-09)

**What.** `tools/synth.py` (standard library only) writes a T-SQL build script and a ground-truth JSON from `--seed`, `--tables` (default 2,000), `--schemas`, `--declared-fk-share` and `--name`; the same arguments give byte-identical files. `uv run tools/lab.py synth` runs it, applies the script as `sa` through sqlcmd's standard input (GO-separated batches, fail on first error) and grants the reader the same permissions as the other lab databases. Database names must start with `SchemaMapSynth`, so a sample database can never be dropped and recreated by mistake. Output goes to `lab-data/synth/` (gitignored).

**Not shaped around the scorer.** The generator imitates what real databases look like: naming drifts between conventions inside one database, most relationships are undeclared, some code joins on columns that are not keys, some tables have no key. It deliberately does not read or follow the inference scoring rules in PLAN.md; tuning the data to the scorer would make every later accuracy number meaningless. The declared share is exact (rounded count of a seeded shuffle), because it is a parameter, not a distribution.

**Ground truth.** `relationships` (ordered from and to columns in snapshot column IDs, the edge ID built the same way as `snapshot/ids.py`, a `declared` flag, a `kind`), `traps` (pairs and column sets that must NOT be inferred: `plain_code`, `same_name_different_meaning`, `type_mismatch`, `orphan_id`) and `code_joins` (what each generated view and procedure joins, marked `relationship` or `non_key`, so code evidence can be scored as sometimes wrong). `synth.py` keeps its own copy of the ID escaping because it must stay standard-library only; a test proves it equals `escape_part`.

**Dependencies.** None added.

## D-038 Integration tests in CI (2026-11-09)

**What.** An `integration` job (ubuntu only) in `ci.yml` starts SQL Server, restores the sample databases, builds `SchemaMapEdgeCases` and runs `pytest -m integration`. The unit and viewer jobs are unchanged; the workflow keeps `contents: read` and its single concurrency group.

**Image tag.** `mcr.microsoft.com/mssql/server:2022-CU27-ubuntu-22.04`, the newest `2022-CU*-ubuntu-22.04` tag in the MCR tag list on 2026-11-09. It is not `2022-latest`, which moves under us: it already points at a different image than CU27. `docker-compose.yml` reads the tag from `SCHEMAMAP_LAB_IMAGE_TAG` (default `2022-latest`, so local use is unchanged) and the job sets it. Bump the CU deliberately, in a commit of its own.

**A container started by a step, not a `services:` entry.** Service containers start before any step runs, so they cannot receive passwords generated at job start; the only way to use one would be a fixed password committed to the workflow. The job instead runs `lab.py up`, which starts the same compose container as local development. It also keeps the container name, mounts and `sqlcmd` plumbing identical in both places, so CI tests the real lab path. The container listens on host port 14330, bound to loopback (not 1433).

**Passwords.** Random 24-character SA and reader passwords are generated by `lab.generate_password` at job start, masked with `::add-mask::`, then written to `GITHUB_ENV`. `lab.read_env` falls back to those variables only when `.env` is absent; `up` then writes no file. Unit tests prove `up` and `down` never print a password from the environment, that failure output is redacted, and that the passwords reach compose only through the environment.

**All three sample databases, not only AdventureWorks2022.** The crumb names AdventureWorks2022, but the existing integration tests also query AdventureWorksDW2022 and WideWorldImporters, and a test must not be skipped to get green. The job restores all three (about 440 MB). The backups are cached with `actions/cache` keyed on each file name and exact size; a test keeps the key in step with the catalog in `lab.py`. If a download fails, the 0.8a retry and GitHub API fallback apply.

**Performance smoke test.** `test_extract_performance_integration.py` builds a 500-table synthetic database, extracts it as the reader and asserts the extraction stays under a budget. It guards against order-of-magnitude regressions, not drift. Timings for 500 tables, one run each (CI: GitHub-hosted `ubuntu-latest`, SQL Server 2022 CU27):

| | build | extract |
| --- | --- | --- |
| Local (Apple Silicon, Docker Desktop, amd64 emulation) | 2.1 s | 2.4 s |
| CI | 1.4 s | 3.9 s |

The budget is 12 s of extraction, about 3 times the CI time observed (3.9 s), so a runner twice as slow still passes while a quadratic regression does not. It was set from a single CI observation; if CI proves noisier than that, widen it here and in the test together rather than skipping the test.

**CI is where the lab met Linux.** Two things only showed there. (1) `localhost` resolves to `::1` first on Linux, nothing listens there (Docker publishes on 127.0.0.1) and the driver does not fall back, so every connection failed with `TCP Provider: Error code 0x2749`. The lab and the tests now use `lab.HOST` (`127.0.0.1`); the golden snapshot test normalises `source.server` as it already did the clock and the build number. (2) The `cli` jobs had been red since crumbs 1.7 to 1.9, which were never watched in CI: mypy rejected a star-unpack inside a subscript under Python 3.10, and the help-text tests assumed a 200-column terminal that Typer replaces with an 80-column dumb terminal when `GITHUB_ACTIONS` is set. Both are fixed; the help helpers now also strip ANSI escapes.

**Dependencies.** None added. `actions/cache` v6.1.0 is pinned by commit SHA like the other actions.

