# Decisions

## D-001 Read-only and metadata-only in v1 (2026-11-08)
The opt-in data-sampling inference signal is deferred until after launch. Reason: the "never reads row data" promise stays absolute.

## D-002 SQL Server first (2026-11-08)
PostgreSQL and MySQL come after launch. Reason: focus on one engine to ship a solid v1.

## D-003 Local-first (2026-11-08)
A CLI plus an offline single-file HTML viewer, with no server in v1. Reason: nothing leaves the user's machine and there is nothing to host.
(The "no server in v1" part is superseded by D-057: a local launcher served from 127.0.0.1. Nothing is hosted and the map file stays offline.)

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

**Allowlist rules** (parsed with sqlglot, T-SQL dialect): exactly one statement; a `SELECT` (CTEs and `UNION` allowed); every table source is `sys.*` or `INFORMATION_SCHEMA.*`, or an unqualified name of a CTE in scope; `sys.dm_*` and `sys.query_store_*` must be approved by name; schema-qualified functions (`sys.fn_my_permissions`) and unqualified built-ins must be on explicit lists; no `SELECT INTO`, temp tables, table variables, `@` variables, `EXEC`, `sp_executesql`, `OPENROWSET`/`OPENQUERY`/`OPENDATASOURCE`/`OPENXML`, DML, DDL or other statements. We also refuse **three-part names** (`OtherDb.sys.tables`), not just four-part ones: a query reads only the database it is connected to. `NEXT VALUE FOR` is refused because it advances a sequence. (Tightened by D-039: every `sys` view by exact name, exact-case schemas, CTE scope.)

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

**Image tag.** `mcr.microsoft.com/mssql/server:2022-CU27-ubuntu-22.04`, the newest `2022-CU*-ubuntu-22.04` tag in the MCR tag list on 2026-11-09. It is not `2022-latest`, which moves under us: it already points at a different image than CU27. `docker-compose.yml` reads the tag from `SCHEMAMAP_LAB_IMAGE_TAG` (default `2022-latest`, so local use is unchanged; since D-040 the default is the CI pin) and the job sets it. Bump the CU deliberately, in a commit of its own.

**A container started by a step, not a `services:` entry.** Service containers start before any step runs, so they cannot receive passwords generated at job start; the only way to use one would be a fixed password committed to the workflow. The job instead runs `lab.py up`, which starts the same compose container as local development. It also keeps the container name, mounts and `sqlcmd` plumbing identical in both places, so CI tests the real lab path. The container listens on host port 14330, bound to loopback (not 1433).

**Passwords.** Random 24-character SA and reader passwords are generated by `lab.generate_password` at job start, masked with `::add-mask::`, then written to `GITHUB_ENV`. `lab.read_env` falls back to those variables only when `.env` is absent; `up` then writes no file. Unit tests prove `up` and `down` never print a password from the environment, that failure output is redacted, and that the passwords reach compose only through the environment.

**All three sample databases, not only AdventureWorks2022.** The crumb names AdventureWorks2022, but the existing integration tests also query AdventureWorksDW2022 and WideWorldImporters, and a test must not be skipped to get green. The job restores all three (about 440 MB). The backups are cached with `actions/cache` keyed on each file name and exact size; a test keeps the key in step with the catalog in `lab.py`. If a download fails, the 0.8a retry and GitHub API fallback apply.

**Performance smoke test.** `test_extract_performance_integration.py` builds a 500-table synthetic database, extracts it as the reader and asserts the extraction stays under a budget. It guards against order-of-magnitude regressions, not drift. Timings for 500 tables (CI: GitHub-hosted `ubuntu-latest`, SQL Server 2022 CU27):

| | build | extract |
| --- | --- | --- |
| Local (Apple Silicon, Docker Desktop, amd64 emulation) | 2.1 s | 2.4 s |
| CI (two runs) | 1.4 to 1.6 s | 2.8 to 3.9 s |

The budget is 12 s of extraction, about 3 times the CI time observed (3.9 s), so a runner twice as slow still passes while a quadratic regression does not. It was set from a single CI observation; if CI proves noisier than that, widen it here and in the test together rather than skipping the test.

**CI is where the lab met Linux.** Two things only showed there. (1) `localhost` resolves to `::1` first on Linux, nothing listens there (Docker publishes on 127.0.0.1) and the driver does not fall back, so every connection failed with `TCP Provider: Error code 0x2749`. The lab and the tests now use `lab.HOST` (`127.0.0.1`); the golden snapshot test normalises `source.server` as it already did the clock and the build number. (2) The `cli` jobs had been red since crumbs 1.7 to 1.9, which were never watched in CI: mypy rejected a star-unpack inside a subscript under Python 3.10, and the help-text tests assumed a 200-column terminal that Typer replaces with an 80-column dumb terminal when `GITHUB_ACTIONS` is set. Both are fixed; the help helpers now also strip ANSI escapes.

**Dependencies.** None added. `actions/cache` v6.1.0 is pinned by commit SHA like the other actions.

## D-039 Allowlist: every sys view by exact name, exact-case system schemas, CTE scope as SQL Server resolves it (2026-11-09)

Gate 1 (docs/gates/GATE1.md) found three ways past the D-029 allowlist, each proven against the lab. None was reachable from a shipped query, because the executor runs only the files in `queries/`; the allowlist exists to catch a bad file before it ships, so each is fixed.

1. **Not every `sys` view is metadata.** Only `sys.dm_*` and `sys.query_store_*` needed approval, so `sys.sql_logins` (password hashes, for a login allowed to see them), `sys.sysprocesses` (other sessions' host and program names; it returned rows to the reader) and `sys.syscacheobjects` (cached batch text, which can hold literals) passed. Now every `sys.*` view is approved by exact name in `APPROVED_SYSTEM_VIEWS`, starting with the 20 our queries use, and a test fails if an approval is not used by any query. `INFORMATION_SCHEMA` views are all catalog metadata and need no approval.
2. **Case-insensitive schema match.** In a case-sensitive database a user can create schema `SYS` and table `SYS.TABLES`; `SELECT * FROM SYS.TABLES` returned its rows. System schemas now match exactly: `sys` and `INFORMATION_SCHEMA`, for views and for schema-qualified functions. The old allowed case `[SYS].[Tables]` was wrong and is now a refused case.
3. **CTE forward references.** SQL Server does not let a CTE see the CTEs defined after it, so in `WITH a AS (SELECT ... FROM ErrorLog), ErrorLog AS (...)` the first `ErrorLog` is the user table `dbo.ErrorLog` (the server denied the reader `SELECT` on it, and returned rows to `sa`). Inside a CTE's body only that CTE (for recursion) and earlier ones now count, and CTE names match case-sensitively.

Correction to D-029: it lists four Query Store views and `sys.dm_db_index_usage_stats` as pre-approved. The code never approved them; only `sys.dm_db_partition_stats` is, and the tests refuse the others until a query needs them. That stays the rule.

**Dependencies.** None added.

## D-040 Local lab defaults to the image tag CI pins (2026-11-09)

`docker-compose.yml` now defaults `SCHEMAMAP_LAB_IMAGE_TAG` to `2022-CU27-ubuntu-22.04`, the tag CI pins (D-038), instead of `2022-latest`. Reason: Gate 1 found the local lab on a cached `2022-latest` that was CU24 while CI ran CU27, so local and CI results came from different builds without anyone choosing that. A test now requires the compose default to equal the CI pin, so a CU bump changes both in one commit. Switching an existing lab is an upgrade from any older 2022 CU: `uv run tools/lab.py down`, then `up` pulls the pinned image and keeps `lab-data/`.

**Dependencies.** None added.
## D-041 Snapshot files: exclusive random temporary, owner-only, never a Windows device (2026-11-09)

Gate 1 found that `write_snapshot` wrote to a fixed temporary name (`.<name>.tmp`) with a call that follows symlinks: anyone who could write to the output folder could plant that name as a symlink and have the snapshot overwrite another of the user's files. The temporary file is now created with `tempfile.mkstemp` in the target folder (random name, exclusive create), then moved into place as before. A side effect we keep on purpose: on POSIX the snapshot is created mode 0600, readable only by its owner, because it holds SQL definitions and the host name and the user decides when to share it. The default file name also gets a leading `_` when the database is named like a Windows device (`CON`, `NUL`, `COM1`...), which Windows opens as a device whatever the extension.

**Dependencies.** None added (standard library).

## D-042 Never write a silently empty snapshot (2026-11-09)

Gate 1 found that a login without `VIEW DEFINITION` gets short catalog views and no error, so extract wrote a valid, empty map. The decision is made from the permission (probed as in D-033), not from row counts alone:

| `VIEW DEFINITION` | Visible objects | Result |
| --- | --- | --- |
| missing | none (no tables, views, routines or synonyms) | `NoVisibleObjectsError`, exit 3, no file; the message names the permission and the exact `GRANT` |
| missing | some | snapshot written, one `partial_visibility` warning, printed first in the stderr summary |
| held | no tables | exit 0, plain note `0 user tables found` (not a warning; skipped when a schema filter was applied) |
| held | tables | normal |

**Model.** `Section` gains `objects` (additive, format stays 1.0, D-032) so the warning has an honest section. `NoVisibleObjectsError` is a `PermissionDeniedError`, so it already exits 3.

**Doctor.** A missing `VIEW DEFINITION` is `FAIL`, not `WARN`. The doctor's exit code is unchanged (3 only when it cannot connect): extract still works for a partial login, so exit 3 for the doctor would disagree with extract.

**Grants name the database user, not the login (Gate 1 O2).** The two can differ, so every hint reads `GRANT <permission> TO [<user>];` plus a note that the user name may differ from the login name. The real name comes from `USER_NAME()` (new query `database_user.sql`; `USER_NAME` added to the allowlist's function list: it returns the caller's own database principal name from the session and reads no object). The name is shown where it is not persisted or already expected: the doctor, the exit-3 error, and the partial-map summary. Snapshot warnings keep the placeholder `[<user>]`: a shared snapshot must not gain an account name. Ordinary `permission_missing` summaries also keep it, because `test_no_secret_is_in_the_file_or_the_output` forbids the login name anywhere in a normal run's output; that test was left as is. `guest` is never named in a hint (granting to it would open the permission to every login), and `]` in a name is doubled.

**Changed wording.** `permission_missing` messages now end `GRANT ... TO [<user>]; <user> is the database user the login maps to, which may differ from the login name.` instead of `TO <login>;`. Tests and the AdventureWorks golden file were updated to match; nothing was loosened.


## D-043 json-schema-to-typescript for the viewer's snapshot types (2026-11-10)

Dependency (devDependency): `json-schema-to-typescript`. The viewer's snapshot types are generated from `schema/snapshot.v1.json` into `viewer/src/generated/snapshot.ts` (`npm run gen:types`), never hand-written, so the CLI model, the schema and the viewer cannot drift apart. CI runs `npm run gen:check`, which regenerates and fails on any diff.

## D-044 Ajv standalone for snapshot validation (2026-11-10)

Dependency (devDependency): `ajv`. The validator is compiled at build time from the same schema (`viewer/src/generated/validate-snapshot.js`, committed, drift-checked with the types) and the viewer ships only the generated code. **CSP reason:** Ajv's normal mode builds validators with `new Function`, which needs `script-src 'unsafe-eval'`. The map is a single offline HTML file that should run under a strict CSP (no eval, no network), so runtime codegen is out; the generated module contains no `eval`/`new Function`. Its only runtime import is Ajv's `ucs2length` helper (a few lines), bundled by Vite.

Choices: draft 2020-12 (`ajv/dist/2020`), strict mode, `allErrors` for useful messages, and `validateFormats: false` (the one format, `date-time`, is display-only; asserting it would need `ajv-formats` at runtime). Because of that, `captured_at` may be any string, so the display helper shows an unparseable value as written, never "Invalid Date". The schema sets no `additionalProperties: false`, so a 1.x snapshot with extra fields still loads. The format version is checked before the schema so a future major reports "unsupported version" instead of schema noise. Gzip is detected by magic bytes, not file name, and decompression is capped at 512 MB. `ajv` and `json-schema-to-typescript` are pinned to exact versions so regenerated output cannot drift; `npm run check:bundle` (run in CI after the build) fails if `dist/index.html` contains `new Function`, `eval(` or `require(`.

**Amendment (2026-11-10, crumb 2.2): the runtime helper is inlined.** Until 2.2 the viewer never called the loader, so the validator was tree-shaken out of `dist/index.html` and `check:bundle` never saw it. Once 2.2 made the validator reachable, the guard caught a `require(` in Ajv's `ucs2length` module (a `.code` string Ajv keeps for its own code generation, never executed). `gen-types.mjs` now copies Ajv's `ucs2length` function verbatim, from the installed pinned Ajv, into `validate-snapshot.js`, with a comment crediting Ajv (MIT) and the version. The generated validator imports nothing from `ajv` (only `validate-snapshot.d.ts` keeps a type-only import, erased at build), and Ajv is absent from the viewer bundle. Tests check there is no Ajv import or require, and that the copy equals Ajv's on ASCII, accented, CJK, surrogate-pair, combining-mark, empty and lone-surrogate strings. Ajv's UTF-16 length mode was rejected because it would make the viewer count lengths differently from the CLI (code points). `check:bundle` now also prints about 80 characters of context around each match; what it detects is unchanged.

## D-045 Viewer graph canvas: raw-HTML lint ban and the ELK worker (2026-11-10)

**Lint.** The crumb asked for `react/no-danger`, but `eslint-plugin-react` (latest 7.37.5, April 2025) declares `eslint: ^3 … ^9.7` and the viewer is on ESLint 10. Installing it would mean ignoring its peer range. Core `no-restricted-syntax` (no new dependency) enforces the same ban and a little more: `dangerouslySetInnerHTML`, assigning `innerHTML`/`outerHTML` (dotted or bracketed), and `insertAdjacentHTML`. The options live in `viewer/scripts/no-raw-html.mjs`. `src/lint-rule.test.ts` proves each ban fires and that the real config enables it as an error. Revisit when `eslint-plugin-react` supports ESLint 10.

**Layout worker.** Dependencies `@xyflow/react` 12.12.0 and `elkjs` 0.12.0 (approved stack, pinned exactly). ELK runs in a Web Worker created from a Blob URL of `elkjs/lib/elk-worker.min.js?raw`, driven by `elkjs/lib/elk-api.js` through `workerFactory`, so the single file lays out over `file://` with no separate worker file and no network. Vite's `?worker&inline` was rejected because it base64-encodes the worker, which would hide its code from `check:bundle`. `elk.bundled.js` and `main.js` are not imported: they contain a `require(` shim for Node. Node sizes are fixed (`NODE_*` in `graph/build.ts`, mirrored by the CSS) so the layout is deterministic and needs no DOM measuring. Layouts are cached per view, by visible tables, their sizes and edges. If the worker fails, the map shows a grid and a notice. React Flow ids and handle ids are synthetic (`t0`, `e0`, `c3-s`), so untrusted names never reach DOM attributes or selectors.

## D-046 Viewer search, schema filter and focus mode (2026-11-10)

**Search.** In-house matcher, no dependency (`viewer/src/search/match.ts`). Tiers: exact, prefix, start of a word (after a non-alphanumeric, digit or camelCase step), then characters in order. Within a tier: how far the name runs past the query (prefix), how late the word starts, or how spread the characters are. Then tables before views before columns, then id. The kind step is a small addition to "ties broken by id": without it a column named `Orders` sorts ahead of the table `Orders` because `column:` < `object:`. Each item is tried by name and by `schema.name`. Search always covers the whole snapshot, not the current view.

**Focus.** Focus is a set of table ids (a view focuses the tables it reads, through nested views, cycle-safe) plus 1 to 3 hops over FK edges in both directions. The schema filter limits which tables the walk may pass through; the focused tables themselves are always kept. Node ids are positions among all tables, so they stay put from view to view and the previous layout never lands on the wrong table while a new one runs.

**Hash.** `#focus=<id>&hops=<n>&schema=<id>`, ids through `encodeURIComponent`. Parsing only accepts a table id for `focus`, a schema id for `schema` and 1, 2 or 3 for `hops`; everything else is dropped. The hash is only ever compared with ids, never rendered. `replaceState` keeps the hash in step with the view and `hashchange` reads manual edits.

## D-047 Large schemas: one layout limit, overview clusters, widescreen layering (2026-11-10)

**Limit.** `LAYOUT_LIMIT = 200` tables (`viewer/src/graph/layout.ts`) is the most the viewer lays out in one ELK run. The full map is the default view only when the tables in view (after the schema filter) number 200 or fewer; above that the overview opens. No cluster is larger than 200, and focus hop counts whose view would pass 200 are disabled (1 hop is always allowed; a hash asking for more is lowered). Why 200: minimum-width layering costs 0.39 s at 150 tables, 0.72 s at 200, 2.0 s at 300 and 5.6 s at 400 (elkjs 0.12, Node, synthetic FK graphs; docs/PERFORMANCE.md). Past 200 the cost climbs steeply, and a 200-table map is already at the edge of readable at fit-view zoom. AdventureWorks (71) and WideWorldImporters (48) stay on the full map.

**Layering.** `elk.layered.layering.strategy=MIN_WIDTH` for graphs of up to `LAYOUT_LIMIT` nodes. The default layering puts every child of a hub table in one layer, so fan-outs stack into a tall strip (aspect 0.29 for a 250-table FK tree). Minimum-width layering gives 1.66 to 1.87 on AdventureWorks, WWI and synthetic trees. Above the limit (a hub-table focus, or an overview with more than 200 clusters) the default layering stays, so time remains bounded. `elk.aspectRatio` was tried and changed nothing for layered layouts, so it is not set. Direction DOWN gave 4 to 9 (too wide).

**Clusters** (`viewer/src/view/clusters.ts`, pure). Schema first, then FK-connected components inside the schema; FKs across schemas become cluster edges. A schema's tables with no FK to another table of the same schema share one cluster ("<schema> · no relationships"), so the overview is not hundreds of single boxes. A component over the limit is split by a spanning-tree partition rooted at its best-connected table: working up from the leaves, a table absorbs its children's subtrees, largest first, while they fit; subtrees that do not fit are packed together. Greedy breadth-first chunks were tried first and left about 60 single-table clusters behind a 350-table component's first chunk; the tree partition gives 200 + 150. Cluster id is `cluster:` plus the smallest member table id: unique, stable when unrelated tables change, independent of input order. Name: the schema name when the schema has one cluster, else "<schema> · <best-connected table>". Edge counts count each FK edge id once, as the map does.

**Levels and hash.** Focus wins, then a drilled cluster (`cluster=<id>`, new hash key), then full map or overview by the limit. Selecting a table that is not on screen (search result or detail-panel link, from the overview or another cluster) drills into its cluster, selects it and centres it; on the full map and in focus, search keeps focusing as before. A toolbar Focus button focuses the selected table from any level. Changing the schema filter leaves the cluster. The one change in how an existing hash reads: on a snapshot over 200 tables, an empty or schema-only hash whose tables exceed 200 opens the overview rather than the full map. No such link exists yet (phase 2 is unmerged), and the full map at that size is what this crumb removes.

**Rendering.** React Flow `onlyRenderVisibleElements` on both canvases. Table and overview layouts share `useLayout` and the per-view cache; keys are prefixed `t:` and `c:`. Performance marks (`schemamap:layout-done`, `schemamap:search`) feed the e2e speed tests and stay in the page.

**Amendment (2026-11-11, crumb 2.9): the overview on a real 2,000-table database.** The claim above that one "no relationships" cluster per schema keeps the overview from being hundreds of single boxes held on the TypeScript synthetic snapshot (115 clusters) but not on the lab's `SchemaMapSynth` (830 foreign keys for 2,000 tables): its overview has 290 clusters, 222 of them with 2 or 3 tables, and at fit view the names are cut to a few letters. It is fast (layout 0.47 s) but not readable. `docs/gates/PHASE2.md` (finding P2-1) proposed the fix; D-053 makes it. The cluster rules here are unchanged; the overview now shows them per schema.

## D-048 Design tokens, semantic zoom and accessibility testing (2026-11-11)

**Tokens.** `viewer/src/tokens.css` holds every colour, space, type size and radius as `--sm-*` variables; light is the default and `prefers-color-scheme: dark` overrides the colours. System font stack only. Colours are hex so `src/theme.test.ts` can compute WCAG contrast for each pairing in both themes (text on surfaces 4.5:1; focus ring, control edges and FK lines 3:1). Plain dividers use `--sm-border`, which is decorative and exempt; anything that marks the edge of a control or node uses `--sm-edge`. There is no manual theme switch: the system setting decides.

**Semantic zoom.** Nodes switch to a compact form when the zoom is below `COMPACT_BELOW_ZOOM = 0.6` (`viewer/src/graph/zoom.ts`). Why 0.6: below it the 11 px badge and column text of a full node renders under about 6.6 px, which is not readable, while the 13 px name is still about 8 px. The compact form is the name alone on one line. Its size follows the zoom, so it stays between 10 px (the least the e2e test accepts) and 12 px on screen: `font-size = max(10px / zoom, min(12px / zoom, fit))`, where `fit` is the size that makes this name fill the node (`nameFitPx`). A name too long for 10 px is cut with an ellipsis and keeps its full text in the tooltip and the detail panel. At fit view on AdventureWorks (zoom 0.23) that cuts about two thirds of the 71 names; two-line names were tried and clip in the shortest nodes, because node height is fixed by the layout. Zoom is written to `--sm-zoom` and `data-compact` on the React Flow element, not to React state, so zooming never re-renders nodes. In the compact form the columns and the All/Less button are hidden, so tests that click them zoom in first (the expand test now opens a focused view).

**Motion.** No fit or zoom is animated (all `duration: 0`); double-click zoom is turned off under `prefers-reduced-motion`; a global reduced-motion rule removes any CSS animation, and the only one, the loading spinner, stops with it.

**Keyboard.** Arrow keys on a focused node move focus to the nearest node in that direction (`graph/navigate.ts`, pure). Nodes are no longer draggable, so React Flow cannot move a node with the arrows. After a drill-down, Esc or breadcrumb click, focus goes to the new current crumb or, if it would otherwise fall to the page body, to the map region.

**Dependency.** `@axe-core/playwright` 4.14.0 (dev only, pinned): runs axe-core against the built file in both colour schemes and fails on serious or critical violations. Nothing else was added.

## D-049 Readable names, schema colours and panel layout (2026-11-11)

**Compact labels.** D-048 found that two-line names clip in the shortest nodes. The fix is to size the node for them and to pick the line count from the real height. A compact name breaks at CamelCase, underscore, dot, dash, space and letter-to-digit boundaries (`graph/labels.ts`), balanced over at most two lines; a line that is still too long gets a middle ellipsis that keeps its start and end; a single long word gets one line with a middle ellipsis. The width of a line comes from the zoom (`compactLimitEm`: the node width at the 10 px minimum, in em) and is checked against the real text width, measured with a canvas in the page's own font (`graph/measure.ts`, padded 4%). A per-character average was tried first and clipped on CI's Linux fonts, where letters like m and the ellipsis are wider; unit tests, which have no canvas, fall back to 0.7 em per character. The line count comes from the node height (`compactLineBudget`). Nodes re-render only when the zoom bucket (a 0.01 step while compact) changes, never on each wheel tick. Table nodes are at least `NODE_MIN_HEIGHT = 140` px tall so two 10 px lines fit at the zoom AdventureWorks opens at (about 0.2); a taller minimum was tried and shrinks the fit zoom more than it gains. The full name stays in the title and, as hidden text, in the accessible name.

**Schema colours.** Eight colour-blind-safe hues in `tokens.css` (`--sm-schema-0` to `-7`, separate light and dark values, each at least 3:1 on the canvas, card and header, checked in `theme.test.ts`). Schemas take slots in code-point order of their names across the whole snapshot (`snapshot/schemaColors.ts`), so a colour does not change with filters or focus. Tables and clusters get a 6 px stripe and their schema badge a matching left edge; the schema name is always text (badge, title, accessible name), so colour is never the only cue.

**Node geometry.** Full nodes are 300 px wide with a 14 px title and 12 px columns (header 60 px, rows 24 px); `NODE_*` in `graph/build.ts` and the CSS agree. Overview clusters show the schema as a small line above the most-connected table's name and the table count.

**Detail panel.** 440 px wide (never wider than the window). Focus goes to the panel heading, not the panel, and the ring shows for keyboard focus only (`:focus-visible`). Names break only at word boundaries through `<wbr>`; header and type cells never wrap. Column headers read "Null" and "Key".

**Load errors.** The screen leads with a plain sentence per error kind (`plainMessage`); the technical message and violation paths sit under a "Details" disclosure.

**Tests changed on purpose.** `keyboard.spec` and `detail.spec` now expect the heading, not the panel, to have focus. `detail.spec` finds a node by its title (qualified name) because a compact label is split over lines. The `graph.spec` expand test uses a 1920×1200 window: with larger nodes the Person.Person focus view no longer fits above the 0.6 compact threshold in the default window.

## D-050 Small views keep full nodes (2026-11-11)

**Threshold.** A view with at most 25 tables (`SMALL_VIEW_TABLES` in `graph/zoom.ts`) never fits below the compact zoom (0.6). If the whole graph does not fit at 0.6, the view centres on the focused or selected table (else on the middle of the graph) and the rest is reached by panning. Why 25: at 300 px wide nodes a 1280×720 screen shows about four columns of nodes at 0.6, so up to a couple of dozen tables is browsable by panning, while larger views are better read as a whole map. Larger views keep fit-all with compact labels below 0.6.

**Node height.** In a small view a full node is as tall as its content (header, rows, padding). The 140 px minimum (`NODE_MIN_HEIGHT`) applies only to larger views, where the two-line compact label needs it. The node's height is carried in its data so layout and render agree.

**Test changed on purpose.** `focus.spec` counted `.react-flow__node`, but nodes outside the panned viewport are not rendered (`onlyRenderVisibleElements`). It now counts minimap nodes, which draw every laid-out table. The `graph.spec` expand test is back on the default viewport.

## D-051 The view command and the packaged viewer (2026-11-11)

**Built viewer is not committed.** `viewer/dist/index.html` is about 2 MB of generated code, so it stays out of git. `uv run tools/build_viewer.py` runs `npm run build`, checks the page holds the data placeholder exactly once, and copies it to `cli/src/schemamap/viewer_dist/index.html` with `manifest.json` (viewer version, byte size, sha256). `viewer_dist/` is gitignored. Release builds run the script before building the wheel; a source checkout runs it once. `schemamap view` checks the page's sha256 against the manifest and refuses a mismatch, so a half-built or hand-edited viewer cannot be used by accident. When the viewer is missing, `view` exits 1 and names `tools/build_viewer.py`: the install is incomplete, which is neither a usage error (2) nor a bad snapshot (4).

**One placeholder, one replace.** The viewer build emits `<script type="application/json" id="schemamap-data"></script>`; the viewer treats empty as "no inline snapshot" and shows its file picker. `embed_snapshot` requires that exact text exactly once (otherwise `EmbedError`) and swaps it with `str.replace`: no regular expression and no format string, so `$&`, `$'`, `\1`, `\g<0>` and `{0}` in a SQL definition are copied as plain text (a test proves it byte for byte).

**Escaping.** The snapshot is serialised with `json.dumps` (compact, `ensure_ascii=False`), then `<`, `>`, `&`, U+2028 and U+2029 become `\u003c`, `\u003e`, `\u0026`, `\u2028`, `\u2029`. In JSON those characters can only occur inside strings, where the escapes are legal, so the browser parses the identical value. No name can close the script element, open a comment (`<!--`) or end a line of script. Two layers prove it: unit tests on the page text, and a Playwright spec that opens a map made by the real CLI from a snapshot of hostile names, then checks no dialog or page error, no injected elements or scripts, names shown as text, and the parsed inline JSON deep-equals the source. The hostile snapshot is `cli/tests/fixtures/hostile.snapshot.json`, generated from `cli/tests/snapshot_builders.py` (a test fails if they drift).

**File handling.** The map is named `<database>-map.html` with the same safe naming as the snapshot (`safe_file_stem`: no separators, no device names) and written with the snapshot writer's atomic exclusive temp file (`write_bytes_atomic`), mode 0600 on POSIX. The map holds the whole snapshot, including definitions, so it is as sensitive as the snapshot. The browser is opened with the file's `file://` URI only; `--no-open` skips it, and a browser that cannot start is a note, not an error.

**Not added.** No new dependency: the standard library (`webbrowser`, `hashlib`, `json`) covers it.

## D-052 Content-Security-Policy in the map file (2026-11-11)

**Decision.** The built viewer carries one `<meta http-equiv="Content-Security-Policy">` tag, so the browser guarantees the map makes no network request and runs no script of ours except the ones we shipped. Policy: `default-src 'none'; script-src 'sha256-…' (one per executable inline script); style-src 'unsafe-inline'; img-src data: blob:; font-src data:; worker-src blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`. There is no `'unsafe-eval'` and no script `'unsafe-inline'`, ever. The reason: "your data never leaves your machine" was a promise backed by code review and tests; now the file itself enforces it, and an escaping bug could not turn into script execution.

**How.** `viewer/scripts/add-csp.mjs` runs after `vite build` (`npm run build`), so after the single-file inlining. It parses the final file with jsdom (already a dev dependency, so no new dependency), hashes each executable inline script's parsed text (what the browser hashes: parsing normalises CRLF, and a regular expression would also trip on `<script>` inside a string of the bundle), and inserts the meta right after the charset tag, before any script. It refuses an external script, an import map, any script type other than JavaScript or a JSON data block, and a page that already has a policy. The JSON data script (`type="application/json"`) is not executable, so it has no hash and `schemamap view` embedding changes nothing; a test proves it.

**Checks.** `check:bundle` also runs `cspProblems`: exactly one policy tag, before every script; no `unsafe-eval`; `script-src` only `sha256` sources; the listed hashes equal the inline scripts' hashes; and the whole policy equals the expected one, so loosening any directive fails. `tools/build_viewer.py` and `tools/check_wheel.py` require exactly one policy tag in the page.

**Tests.** Vitest covers the builder and the guard (missing policy, `unsafe-eval`, a non-hash source, a wrong or stale hash, a script before the policy, two tags, a loosened directive). Playwright, in Chromium and Firefox, on maps made by the real CLI: the flow specs and an open-search-reload spec fail on any `securitypolicyviolation` and check the layout reached `done` (the blob worker runs); a `fetch` and an `<img>` to `https://example.com` are blocked with a violation and no request reaches the network layer; an injected inline `<script>` and `onerror` handler do not run. Each has a control run on a copy without the policy that shows the same page then does the forbidden thing.

**Test changed on purpose.** The `bundle-guard` test's "clean" page had no policy, which the guard now rejects. Its clean and planted pages now carry a valid policy, so only the planted `new Function` can fail it. `flow.spec.ts` now also runs in the Firefox project, so the full flow is proven under the policy in both browsers.

**Not added.** `frame-ancestors` is not supported in a meta tag, so the map can still be framed; it has no authenticated actions, so this is not an exposure. No dependency.

## D-053 Schema containers: a readable overview at 2,000 tables (2026-11-11)

**Problem.** P2-1: the real, sparse SchemaMapSynth (2,000 tables, 0.4 declared keys per table) opened on 290 cluster boxes, 222 of them with 2 or 3 tables, labelled like `Ca…e`. The tests missed it because the TypeScript synthetic was dense (115 clusters; P2-2).

**Decision.** The overview is one **container per schema**: the schema name, its table and cluster counts, and up to 12 tiles. The tiles are its clusters of more than 3 tables (largest first), one **"Small groups"** tile, and its unrelated-tables clusters. Past 12, the smallest related clusters become one "+N clusters" tile. You drill **schema → cluster or small group → tables**:
- A schema of 200 tables or fewer opens as its table map, the same view the schema filter gives.
- A larger schema opens as its boxes. Each cluster of more than 3 tables keeps its own box. Its clusters of 3 or fewer (when there are at least two) fold into a small-groups box, packed in cluster order into parts of at most 200 tables. A small-groups box opens as one table map of all its tables.
- When only one schema is in view, the root is that schema's boxes.
- Pure code: `viewer/src/view/schemaGroups.ts` (`foldSchemas`) and `viewer/src/graph/overview.ts`.

**Why 3.** On SchemaMapSynth, 222 of 290 clusters had 2 or 3 tables, and the dense synthetic has almost none. A box that holds 2 or 3 tables tells you less than the tables themselves.

**Hash.** Cluster ids and `cluster=` are unchanged, so every cluster link still opens the same cluster, folded clusters included. There are two new keys: `drill=<schema id>` and `group=<small group id>`. A group id is `group:` plus its smallest table id, the same rule as cluster ids. The crumb asked for one new key, but small groups need an address of their own, so there are two. Nothing existing is repurposed. At most one place is kept: cluster, then group, then drill. Focus keeps the place as the breadcrumb's way back. The breadcrumb reads Overview › schema › cluster or small group › focus. Search and panel links to a table that is not on screen go to the deepest view that holds it: its schema's map when that fits, else its small group or cluster.

**Layout.**
- The schema overview is not laid out by ELK. Layered layout strung the six connected schemas of SchemaMapSynth into one row, at aspect 9:1. `graph/pack.ts` packs the containers in name order into rows instead. Of every row width that changes the result, it keeps the one whose bounding box is largest on a 1.6:1 screen. With 40 boxes or fewer this is instant and deterministic.
- Edges between schemas are straight lines labelled with key counts. A curve between boxes side by side loops out of the box.
- A schema's boxes still use ELK, as before.

**Type.**
- A full-size box only shows at zoom 0.6 and above, so its text is at least `--sm-text-box` (17 px, new token), which is 10 px on screen at 0.6. Schema containers use 20 px and up.
- A cluster box puts its table count and key counts on one line, so it keeps its 110 px height. A full-size cluster or schema name that does not fit its box is cut in the middle by measuring it in the page's font, as compact names are (D-048), rather than by CSS. On CI's Linux fonts, `No relationships (1 of 2)` overflowed the 260 px box and CSS cut its end off. The whole name stays in the title and in the accessible name. Table nodes are unchanged.
- A small-groups box is titled "<n> small groups".
- Below 0.6, the compact rules of D-048 apply. A container keeps its name and count. Tile names show while a 10 px line fits in a tile, cut with an ellipsis, and the counts always show.

**Accessibility.** Only the container is interactive ("Open schema dbo, 719 tables"). Its tiles are `aria-hidden`; the keyboard reaches clusters through the schema's level. The cluster box's key counts were an `aria-label` on a plain `div`, which ARIA prohibits. It was never seen while clusters were only drawn compact; the schema level draws them full size, so axe caught it. It is now visually hidden text.

**Tests.**
- `syntheticSnapshot` has a `sparse` shape after `tools/synth.py`: six schemas, 30% of about 1.3 true relationships per table declared. At 2,000 tables it gives 287 clusters, 221 of them small, and 811 keys. The real database gives 290, 222 and 830. The dense shape is unchanged byte for byte.
- `e2e/overview.spec.ts` runs on both shapes at 1400×900 in fit view. It checks:
  - 40 or fewer top-level boxes, all schema containers
  - every name is whole, or middle-ellipsised keeping at least 6 letters
  - no two names are the same; every label is at least 10 px and not clipped
  - drill and back, and the keyboard
- The sparse overview screenshot goes to the CI artifact.
- `performance.spec` runs on both shapes.
- **Changed on purpose:** the 2,000-table tests in `readable.spec`, `performance.spec` and `a11y.spec` counted one node per cluster. They now count schema containers, and new tests measure the schema level (readability and axe). The old `buildOverviewGraph` and its unit tests were removed with the one-box-per-cluster overview.

**Known limit.** A database with more than 40 schemas still gets one box per schema. Grouping schemas is not part of this decision.

**Not added.** No dependency.

## D-054 Landing page: static HTML and one function, not Next.js (2026-11-11)

The landing page and waitlist (`site/`) are one static HTML page, one stylesheet, one small script and one Vercel function (`api/join`). No framework and no build step.

**Why.** The page has to be trustworthy to people who care about what code runs: no trackers, no cookies, no third-party requests, a Content-Security-Policy of `default-src 'self'` with no inline script. A static page makes that easy to verify by reading it, and the tests prove it. Next.js would add a build, a runtime, hydration scripts and a dependency tree for a page with one form. The form posts normally without JavaScript; `join.js` only improves it.

**Waitlist storage.** Supabase over its REST API with the public anon key. The table allows INSERT for `anon` and nothing else (`site/supabase/migrations/`), so a leaked key cannot read the list. A duplicate email and a honeypot hit both return the success message, so the endpoint never reveals who signed up. The function never logs the email or Supabase's response.

**Dependencies (dev only, none ship to visitors).** `site/` uses the approved test stack: Vitest, Playwright, `@axe-core/playwright`, ESLint, Prettier, at the versions the viewer uses. `tools/site_shots.py` uses Pillow (pinned, run through `uv run` inline metadata) to reduce the committed screenshots to 256-colour PNGs; no PNG optimiser is installed on CI or developer machines.

**Screenshots** are made by `viewer/site-shots/` (a separate Playwright config, run on purpose) from maps `schemamap view` produced, using the AdventureWorks golden snapshot and the synthetic generator only (D-056 later dropped the synthetic overview shot).

## D-055 Waitlist: Supabase CLI project, migration as the single source, local end-to-end (2026-11-11)

`site/supabase/` is a Supabase CLI project; `site/supabase/migrations/20261111000000_waitlist.sql` replaces `site/supabase.sql` and is also what gets pasted into the production SQL editor. Only Postgres, the API and auth run locally (auth is needed only because `supabase status` hides the keys without it). `npm run local:up` reads the URL and keys from `supabase status` at runtime and never prints or stores them. `api/join` already inserts with `Prefer: return=minimal` and maps Supabase's 409 to success, so insert-only RLS works. Real-Supabase tests live in `site/integration/` behind `npm run test:integration`, so plain `npm test` stays mock-only. The anon key reads get a 401 permission error rather than an empty list, because the table grants anon INSERT only; that is stricter than RLS alone. The GitHub-issue deletion route is replaced by a mailto address. No new dependency: the Supabase CLI is a local and CI tool, not a package.

## D-056 Landing page: light redesign, self-hosted fonts (2026-11-13)

`site/` follows the approved light design in `docs/design/landing-light.dc.html`: violet `#5B3FA0`, teal `#0E7C77`, marker `#FFD25E`, pastel cards, hand-written section labels, app-tile suite section. The reference is visual only; none of its runtime (`support.js`, `<x-dc>`, `/_blob/` URLs, Google Fonts link) is copied. Light theme only: the dark theme is removed, so there is one palette to keep accessible and no `prefers-color-scheme` branch to test. Inline styles became classes in `style.css`, so the CSP stays `style-src 'self'` with no `unsafe-inline`.

**Fonts are self-hosted**: Inter and Caveat as variable latin-subset woff2 (about 120 KB together) in `site/assets/fonts/`, with their OFL licence files, from the `@fontsource-variable` packages (used once to fetch the files; not a dependency). `@font-face` uses `font-display: swap` and a system fallback stack. **Why:** the page promises it "loads nothing from other sites"; Google Fonts would break that promise, send every visitor's IP to a third party, and need `style-src`/`font-src` exceptions. `font-src` falls back to `default-src 'self'`, and the meta CSP now names it explicitly. The only shipped copy of the promise is tested: a Playwright test requires the fonts to load from the page's own origin, and a unit test fails if `googleapis`, `gstatic` or `/_blob/` appears anywhere in `site/`.

**Screenshots:** the hero (AdventureWorks full map) and the detail section (Person.Person focus, panel open) are regenerated by `viewer/site-shots/`. The 2,000-table overview shot is dropped because the design has no place for it; the overview is described in text.

## D-057 Schema Map ships a local UI (`schemamap ui`) served from 127.0.0.1; the map file stays offline (2026-11-13)

**Decision.** `schemamap ui` starts a small HTTP server on the user's machine, bound to 127.0.0.1 on a random port, and opens the browser at a launcher: connect, check, pick a database, extract, open the map, recent maps. The CLI stays for scripts and power users. **Why:** Harshit's decision of 13 Nov 2026. Most target users (BI developers, consultants, new joiners, many DBAs) expect a UI, not a command line, and a CLI-only tool loses them before the first map. This supersedes the "no server in v1" part of D-003. The rest of D-003 holds: nothing is hosted, nothing leaves the machine, and the map file is unchanged (same single offline file, same `connect-src 'none'` policy, D-052). The launcher's own rules (loopback only, Host and Origin checks, a token in the URL fragment sent as a header, no stored passwords, the same allowlisted query layer) are in `docs/plans/PHASE_U.md`, and the design and threat model are in `docs/UI.md`.

## D-058 Launcher server: standard library `http.server`, not Starlette and uvicorn (2026-11-13)

**Decision.** The launcher runs on `http.server.ThreadingHTTPServer` with one request handler (`schemamap/ui/server.py`). **Why:**
- The API is small, JSON-only and request/response. Extract progress is polled about every 500 ms, so nothing needs async, websockets or streaming responses.
- It adds no runtime dependency, so there is no new supply-chain surface in a tool whose promise is "read-only, local, auditable".
- The security checks (Host, Origin, constant-time token, body limits, headers on every response) stay in about a hundred lines we own and test directly, rather than in middleware configuration.

**Cost:** we write our own routing, body-size limits and JSON errors, and `http.server` is not meant for the open internet. That is irrelevant on loopback with one user, and every rule has a test (U.0 skeleton, U.1 hardening). Starlette and uvicorn stay an option if a later need (streaming, many concurrent clients) appears. **Not added:** no dependency.

## D-059 Launcher front end: a second entry in `viewer/`, served with a header policy (2026-11-13)

**Decision.**
- The launcher page lives in `viewer/` (`launcher.html`, `src/launcher/`, `vite.launcher.config.ts`) and is built as its own single file into `viewer/dist-launcher/`. `npm run build` builds both pages.
- `tools/build_viewer.py` packages it next to the map viewer as `viewer_dist/launcher.html` plus `launcher.json` (bytes, sha256 and the hash sources of its inline scripts and styles). `tools/check_wheel.py` requires both, and `schemamap ui` refuses a page that does not match its manifest.

**Why one toolchain:** the launcher reuses the viewer's toolchain, lint rules (no raw HTML), test stack and design tokens, without a second Node project to keep in step. A single file keeps packaging the same as for the map.

**Policy as a header.** `frame-ancestors` has no effect in a meta tag, so the server sends the launcher's Content-Security-Policy as an HTTP header:

`default-src 'self'; script-src <sha256 hashes>; style-src 'self' <sha256 hashes>; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'; object-src 'none'`

- The hashes are computed at build time from the jsdom-parsed page (`scripts/launcher-csp.mjs`, reusing `csp.mjs` as in D-052).
- Python checks each source against `'sha256-<44 base64 chars>'` before it goes into the header, so a tampered manifest can neither loosen the policy nor inject a header.
- `style-src` lists the inline style hashes because a single-file build inlines its CSS. It is no looser than the `default-src 'self'` the plan specifies. There is no `unsafe-inline` or `unsafe-eval`.
- The page carries no meta policy (the build refuses one), so there is a single source of truth.

**Not added.** No dependency.

## D-060 Launch link carries a one-time code, not the token; map tabs check Fetch Metadata (2026-11-13)

**Decision (review of U.0, built in U.1).**
- The launch link is `http://127.0.0.1:<port>/#c=<code>`. The code is 256 random bits, valid 60 seconds from server start, usable once. The page posts it to `POST /api/session` and receives the session token in the response body; it keeps the token in `sessionStorage`, removes the code from the address bar, and sends the token as a header. A used, expired or wrong code is `401`. A wrong guess does not use up the real code, so a stray request cannot burn it. This supersedes D-057's "a token in the URL fragment".
- `/maps/<id>` stays on a random 128-bit id, still with the Host and Origin checks, and now also refuses a request whose `Sec-Fetch-Site` is anything but `same-origin` or `none` (absent is allowed): `403 forbidden_fetch_site`.

**Why.** The browser-launch helper (`open`, `xdg-open`, `start`) receives the whole URL in its arguments, which other local users can read with `ps`, and the terminal and the browser's history database keep it too. With the token in the link, anyone who saw it held a working session until the server stopped. With a one-time code, a link seen later is worthless. The map route cannot carry a header because the map opens by ordinary navigation, so the browser's own cross-site signal is the next best guard, and costs one header check. A single-use ticket for maps was rejected: it would break reload and bookmarks.

**Cost and residual.** One route and one round trip. A link opened after 60 seconds, or a second time (another browser profile, a closed tab), needs `schemamap ui` run again. For the first 60 seconds a local user who sees the link before the owner's browser redeems it could take the session first; the owner then sees "already used", so it is noisy but possible on a shared machine (UI.md threat model). **Not added:** no dependency.
