# Gate 1: extraction review

Crumb 1.11, 2026-11-09, branch `phase-1-extract`. Goal: prove extraction is correct, safe and fast before Phase 2 builds on it.

**Verdict.** Extraction is correct and fast on every database tried, as both logins, and no run broke the allowlist. The adversarial review found three ways past the allowlist (none reachable from a shipped query), a symlink problem in the snapshot writer, and docs that had drifted from the code. All of those are fixed in this crumb. One serious issue is still open and needs a decision: **a login without `VIEW DEFINITION` gets a silently empty snapshot** (proposed crumb 1.12). I recommend doing 1.12 before Phase 2.

## 1. Results

`schemamap extract` run through the real CLI in a subprocess. Wall time runs from process start to exit, so it includes `uv run` and Python start-up (about 0.3 s). Machine: Apple Silicon running Docker Desktop with amd64 emulation. The lab was on SQL Server 16.0.4250.1, which is CU24, the locally cached `2022-latest`. CI runs the same integration tests on CU27, and the lab now defaults to CU27 too (F8). For this run, `schemamap_reader` was given its full documented grant (`lab.py grant <db> --view-database-state`) so all 8 sections ran. The lab's default grants were put back afterwards.

| Database | Login | Wall s | Schemas | Tables | Columns | Indexes | Views | Routines | Synonyms | FKs | Deps | Row counts | Query Store | Warnings |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|---|---|
| AdventureWorks2022 | reader | 2.8 | 6 | 71 | 486 | 173 | 20 | 31 | 0 | 90 | 187 | 71 | off | none |
| AdventureWorks2022 | reader_min | 2.6 | 6 | 71 | 486 | 173 | 20 | 31 | 0 | 90 | 0 | – | unknown | dependencies, row_counts |
| AdventureWorksDW2022 | reader | 0.5 | 1 | 31 | 359 | 39 | 5 | 3 | 0 | 44 | 15 | 31 | off | none |
| AdventureWorksDW2022 | reader_min | 0.5 | 1 | 31 | 359 | 39 | 5 | 3 | 0 | 44 | 0 | – | unknown | dependencies, row_counts |
| WideWorldImporters | reader | 2.0 | 11 | 48 | 557 | 147 | 3 | 44 | 0 | 98 | 120 | 48 | on | none |
| WideWorldImporters | reader_min | 1.9 | 11 | 48 | 557 | 147 | 3 | 44 | 0 | 98 | 0 | – | unknown | dependencies, row_counts |
| SchemaMapEdgeCases | reader | 0.5 | 1 | 6 | 15 | 6 | 4 | 2 | 1 | 2 | 9 | 6 | on | none |
| SchemaMapEdgeCases | reader_min | 0.4 | 1 | 6 | 15 | 6 | 4 | 2 | 1 | 2 | 0 | – | unknown | dependencies, row_counts |
| SchemaMapSynth (2,000 tables) | reader | **10.3** | 6 | 2,000 | 13,193 | 2,933 | 250 | 100 | 0 | 830 | 921 | 2,000 | on | none |
| SchemaMapSynth (2,000 tables) | reader_min | **9.7** | 6 | 2,000 | 13,193 | 2,933 | 250 | 100 | 0 | 830 | 0 | – | unknown | dependencies, row_counts |

- **All 10 runs exited 0.** The minimal login lost exactly the two sections it lacks permission for, each with one `permission_missing` warning that names the exact `GRANT`. Everything else matched the full login object for object.
- **2,000 tables in 10.3 s**, about 6 times under the 60 s budget. Per section (`--verbose`): tables 7.97 s, relationships 0.46, views 0.35, row counts 0.25, routines 0.21, dependencies 0.15, synonyms 0.01. The tables section takes about 80% of the time (13k columns plus 2.9k indexes). Noted for 4.4, not a problem today.
- **Zero allowlist violations.** The executor re-checks every file before running it, so a violation would have stopped a run. None did, and `test_every_real_query_passes` is green for all 17 files.
- **No secrets in any output.** All 20 output files (10 snapshots and 10 redacted stderr captures) were searched for each lab password, raw and brace-escaped, and for `PWD=`. Nothing found.
- **Extra run on a binary collation.** A scratch `Latin1_General_100_BIN2` database (2 tables, an FK, a check constraint, an index, a view, a procedure and a synonym) extracted correctly with no warnings. The database was dropped afterwards. No test covers this yet (proposed crumb 1.13).
- **Stack Overflow: not run.** It is not part of the lab and its procedure is unscripted (LAB.md, "Optional extra"). Scale was covered by the 2,000-table synthetic database instead.

Checks at the end of the crumb: `ruff`, `ruff format --check`, `mypy --strict` clean. `pytest`: 680 passed, which includes the 62 integration tests against the lab (`-m integration`: 62 passed).

## 2. Adversarial review: what I tried

### Allowlist and every `.sql` file

I read all 17 query files. Each one reads only `sys.*` catalog views, `sys.dm_db_partition_stats` and `sys.fn_my_permissions`, never `INFORMATION_SCHEMA` and never a user object. All values are bound as parameters. Every file starts with a comment that says what it reads. Every multi-row object query has a deterministic `ORDER BY` and leaves out `is_ms_shipped` objects. The single-row server, source and Query Store queries need neither.

I sent 45 attack payloads through `violations()`. For each payload the allowlist accepted, I ran it as `schemamap_reader` and let the server show what it really did. That login has no `SELECT` on user tables, so any smuggled read of a user table comes back as "permission denied".

| Attempt | Result |
|---|---|
| Two statements, `GO`, a trailing `WAITFOR`, `EXEC(...)`, `sp_executesql`, `UPDATE` through a CTE, `SELECT INTO`, temp tables, table variables, `@`/`@@` variables, `NEXT VALUE FOR` | refused |
| User tables: qualified, unqualified, bracketed, in a subquery, a join or `EXISTS`; three- and four-part names; user scalar and table functions; `OPENROWSET`, `OPENJSON`, `CONTAINS`; `APPLY sys.dm_exec_sql_text`, `sys.fn_dblog`; non-approved DMVs and Query Store views; XML `.value()` method calls | refused |
| Tokenizer disagreements: nested `/* /* */ */` comments; `--` comments ended by CR, VT, FF, NEL or U+2028; `]]` inside brackets; `''` inside strings | accepted. **The server agreed** each time: it read only `sys.tables`, and the smuggled `UNION ALL SELECT ... FROM Person.Person` never ran. |
| **`sys.sql_logins`, `sys.sysprocesses`, `sys.syscacheobjects`** | **accepted. Hole.** `sysprocesses` returned other sessions' host and program names to the reader. `sql_logins` returns password hashes to a login allowed to see them. `syscacheobjects` holds cached batch text, which can contain literals. Fixed (F1). |
| **`SELECT * FROM SYS.TABLES` in a case-sensitive database** | **accepted. Hole.** In a scratch `Latin1_General_CS_AS` database, a user schema `SYS` holding a table `TABLES` returned its row data. Fixed (F2). |
| **CTE forward reference** `WITH a AS (SELECT ... FROM ErrorLog), ErrorLog AS (...)` | **accepted. Hole.** The server resolved `ErrorLog` to the user table `dbo.ErrorLog`: the reader got "SELECT permission denied on dbo.ErrorLog" and `sa` got rows. Fixed (F3). |
| A CTE named in a different case (`WITH t ... FROM T`) | accepted before the fix. In a case-sensitive database `T` is a user table. Fixed with F3. |

None of the three holes was reachable from a shipped query, because the executor runs only the files in `queries/`. The allowlist exists to catch a bad file before it ships, so each hole was a real defect.

### Executor and static guard

The executor takes only a `QueryName`, re-checks the file before every run, binds values as `str` or `int` (it refuses `bool`), and raises driver failures with fixed wording, never chained. The static guard catches `getattr(conn, 'cursor')`, private-attribute access, driver imports, imports of test helpers, and SQL built with `+` or f-strings (its own tests prove this). Nothing new found. Residual risk: the guard is pattern-based, so `getattr` on a computed string such as `"cur" + "sor"` would get past it. The executor's own allowlist check is the backstop.

### Credentials and redaction (CLI, logs, exceptions, snapshots, CI logs)

I ran 16 failure paths through the real CLI and searched stdout and stderr for the password:

- Five hostile passwords, each with and without `--debug`: `Wr0ng};Database=master;UID=sa;PWD={x`, `pa;ss word=1`, `}}}{{{`, `PWD=leak'"`$(id)`, and a Unicode password.
- Wrong database, closed port, untrusted certificate.
- `doctor` with a right and a wrong password.
- A password crafted to inject `UID={sa` together with the real `sa` password.

Every path was clean, exited 3 and printed the correct Fix hint (apart from F6). The brace-quoting in `ConnectionConfig` stopped the injection: the login did not become `sa`. Other paths I checked: `ConnectionConfig.__repr__` hides the password, Typer is set with `pretty_exceptions_show_locals=False`, a failed connection's exception is raised outside the `except` block so the driver's text is not chained, and the snapshot model has no field that can hold a credential.

In CI, the password step prints `::add-mask::` before anything reaches `GITHUB_ENV`, and a test forbids `printenv`, `set -x` and `echo ...PASSWORD`. One note: `pytest -rP` prints the captured output of passing tests. Masking is the second layer there, and today no test prints a password (4.1).

### Permission probing

I put the reader in a role with a `DENY`, on SchemaMapEdgeCases, and cleaned up afterwards.

| DENY through a role | Probe | Extract |
|---|---|---|
| `SELECT ON sys.sql_expression_dependencies` | sees it | dependencies skipped with a warning ✔ |
| `VIEW DATABASE STATE` | sees it | row counts skipped with a warning ✔ |
| `VIEW DEFINITION ON SCHEMA::dbo` | passes | **0 tables, exit 0, no warning** ✘ (1.12) |
| `SELECT ON sys.columns` | passes | exit 3, "The server denied the query 'columns'" ✘ (known carry-over, 4.2) |

Without `VIEW DEFINITION` at all (revoked from `reader_min`), extract also wrote **0 tables with exit 0**, and its only warnings were about dependencies and row counts. A user would see an empty map and believe it.

### Filename handling

Hostile database names (`../../etc/passwd`, `..`, `.`, `a/b\c`, NUL, 64 snowmen, a space, `-rf`, `.hidden`) all stay in the current folder. Two problems found:

- **`CON` and `nul` were passed through unchanged.** Windows opens a device for those names, whatever the extension. Fixed (F5).
- **A symlink planted at the fixed temporary name `.out.json.tmp` overwrote its target.** `write_bytes` follows symlinks, and the output file ended up being a symlink. This needs write access to the output folder, so it matters in shared folders such as `/tmp`. Fixed (F4).

## 3. Fixes made in this crumb

Each fix was written test-first. The new tests failed before the change and pass after it.

| # | Fix | Where | Decision |
|---|---|---|---|
| F1 | Every `sys.*` view is approved by exact name (the 20 our queries use). A test fails if an approval is unused. `INFORMATION_SCHEMA` views need no approval. | `queries/allowlist.py` | D-039 |
| F2 | System schemas match exactly (`sys`, `INFORMATION_SCHEMA`), for views and for schema-qualified functions. | `queries/allowlist.py` | D-039 |
| F3 | CTE scope follows SQL Server: inside a CTE's body only earlier CTEs and the CTE itself (for recursion) are visible, and names match case-sensitively. | `queries/allowlist.py` | D-039 |
| F4 | The snapshot is written through `mkstemp` in the target folder (random name, exclusive create). On POSIX the snapshot is mode 0600. | `snapshot/io.py` | D-041 |
| F5 | A default file name that is a Windows device name gets a leading `_`. | `snapshot/io.py` | D-041 |
| F6 | mssql-python's closed-port text (`TCP Provider: Error code 0x2726` on macOS, `0x2749` on Linux) now gets the "Cannot reach … port" hint. | `connect/connection.py` | – |
| F7 | `doctor --help` showed `--auth entra`, which is not a valid mode. A new test parses every help example. | `cli.py`, `tests/test_cli.py` | – |
| F8 | `docker-compose.yml` defaults to `2022-CU27-ubuntu-22.04`, the tag CI pins. A test keeps the two equal. The local lab had been on CU24. | `docker-compose.yml` | D-040 |
| F9 | Docs brought in line with the code (list below). | docs | – |

Two tests were wrong, and I changed them on purpose:

- `test_allowlist.py` had `[SYS].[Tables]` as an *allowed* case. F2 shows that is unsafe, so it is now a refused case, and `[sys].[tables]` stays allowed.
- `test_ci_workflow.py` required the literal `2022-latest` default. It now requires the compose default to equal the CI pin.

Doc fixes (F9):

- **SECURITY.md**:
  - It called `--no-definitions` "planned", but it shipped in 1.8.
  - It said snapshots contain extended-property descriptions. Nothing extracts them yet.
  - The allowlist description was wrong (old prefix gate).
  - It claimed every CI check runs on three operating systems. Integration runs on Linux only.
  - It now says snapshots are mode 0600.
  - The `sys.sql_expression_dependencies` grant wording was checked and is accurate: SQL Server grants `SELECT` on it only to `db_owner` by default, it holds no row data, and the grant is per database, after `USE`. Its wider problem is in the CLI hints (O2).
- **ARCHITECTURE.md**:
  - The status line still said gate 0.
  - `infer/`, `export/` and `telemetry/` were shown as existing.
  - `cli_connection.py` and `cli_progress.py` were missing.
  - The extract section said a query's permission error becomes a warning. In fact, sections are skipped up front from the probe, and a refused query exits 3.
  - `row_counts` was missing `reserved_bytes`.
  - `definition_status` was missing `available` and `omitted`.
- **LAB.md**:
  - The image was given as `2022-latest`.
  - The host was given as `localhost`. The lab uses `127.0.0.1`, see `lab.HOST`.
  - The CI-mode default was wrong.
  - The database list was incomplete.
- **DECISIONS.md**: D-029 claimed four Query Store views and `dm_db_index_usage_stats` were pre-approved. The code never approved them. Corrected in D-039.
- **CLAUDE.md**: the lab line was missing `edgecases`, `synth` and `grant --view-database-state`. The other commands were checked and are accurate.

## 4. Open issues

| # | Severity | Issue | Where it goes |
|---|---|---|---|
| O1 | **High** | Without database-level `VIEW DEFINITION`, or with it denied on a schema, extract writes a silently partial (or empty) snapshot with exit 0. `doctor`'s wording for this case is also wrong: it says only module definitions are lost. | **1.12** |
| O2 | Medium | Grant hints say `GRANT … TO <login>`. `GRANT` takes a database user, which can have a different name from the login. | 1.12 |
| O3 | Medium | No test covers case-sensitive or binary collations (it worked by hand on BIN2), and nothing checks that output order is the same under any collation. | **1.13** |
| O4 | Medium | Carry-over: the probe passes but a `DENY` through a role still fails the query (proved with `DENY SELECT ON sys.columns`, exit 3). | 4.2 |
| O5 | Low | Carry-over: trigger pseudo-tables `inserted` and `deleted` are recorded as unresolved references. | 4.2 |
| O6 | Low | SQL Server 2022's narrower `VIEW DATABASE PERFORMANCE STATE` is enough for row counts, but the probe only looks for `VIEW DATABASE STATE`. | 4.2 |
| O7 | Low | Carry-over: `doctor` should re-check Query Store once it is enabled. | 3.4 |
| O8 | Low | Carry-over: Entra ID and Windows authentication are untested end to end. | 4.5 |
| O9 | Low | The allowlist was fuzzed by hand only. Not re-verified at this gate: the SECURITY.md Extended Events claim. `pytest -rP` in CI relies on masking. | 4.1 |
| O10 | Info | The tables section is about 80% of extract time at 2,000 tables. | 4.4 |
| O11 | Low | `lab.py status` reports `schemamap_reader` but not `schemamap_reader_min`. | 4.6 |

## 5. Proposed crumbs

### 1.12 Partial catalog visibility is never silent
- Model: Opus 5.5 · Effort: high · Mode: normal
- Goal: a login that cannot see the catalog gets a clear warning or a clear failure, never an empty map that looks real.
- Build:
  - Test first, as unit and lab integration tests, using two cases: `VIEW DEFINITION` revoked, and `DENY VIEW DEFINITION ON SCHEMA::dbo` through a role. Both give a warning that says objects may be hidden and gives the exact `GRANT`.
  - **Decision for Harshit:** when `VIEW DEFINITION` is not held *and* no user table is visible, exit 3 without writing a snapshot (recommended), or write the snapshot with the warning only.
  - `doctor`: a missing `VIEW DEFINITION` becomes FAIL, not WARN. Correct its consequence text: without it, only objects the login has other permissions on are visible.
  - Grant hints say `TO <database user>` (the user mapped to the login), and SECURITY.md says why. Refresh the golden fixture.
  - Record the decision in DECISIONS.md.
- Done when:
  - [ ] Both lab cases give the warning (or exit 3) in integration tests, and `doctor` FAILs without `VIEW DEFINITION`
  - [ ] All checks and CI green
- Commit: `fix(extract): never write a silently partial snapshot`

### 1.13 Case-sensitive and binary collations
- Model: Opus 5.5 · Effort: medium · Mode: normal
- Goal: prove extraction, IDs and ordering on case-sensitive and binary-collation databases.
- Build:
  - `lab.py edgecases` also builds `SchemaMapEdgeCasesBin2` (`Latin1_General_100_BIN2`) with:
    - tables `dbo.Order` and `dbo.order`, and columns `Id` and `ID`;
    - a user schema `SYS` with a table;
    - FKs, a view, a procedure and a synonym.
  - Integration tests as `schemamap_reader`:
    - every object is present, and names that differ only in case get distinct IDs;
    - `SYS.<table>` is a user table;
    - two runs give byte-identical snapshots;
    - object order matches the `Latin1_General_CI_AS` copy, so sorting is in Python and not by the database collation.
  - Add the database to the CI integration job.
- Done when:
  - [ ] Tests green locally and in CI
- Commit: `test(extract): case-sensitive and binary collation databases`

### Additions to planned crumbs

- **3.4 Query history evidence.** Once Query Store is enabled on the lab database, `doctor` re-checks and reports it ON (O7).
- **4.1 Security audit.**
  - A differential fuzz of the allowlist: generate SELECTs with comments, brackets, strings and CTEs; anything accepted runs as `schemamap_reader`, and a permission-denied error fails the test (the method used in section 2).
  - Re-verify the Extended Events capture described in SECURITY.md.
  - Decide whether CI keeps `-rP` (O9).
- **4.2 Edge-case sweep.**
  - (a) Record `inserted` and `deleted` in DML triggers as pseudo-tables, not unresolved references (O5).
  - (b) A section whose query the server refuses despite a passing probe (for example `DENY SELECT ON sys.columns` through a role) is skipped with a warning instead of ending extraction with exit 3. Add a lab test with that exact `DENY` (O4).
  - (c) Accept `VIEW DATABASE PERFORMANCE STATE` for row counts on SQL Server 2022 and later (O6).
- **4.4 Performance pass.** Profile the tables section at 2,000 and 10,000 tables. Today it is 8 of 10 s (O10).
- **4.5 Beta with real users.** Test Entra ID (password, interactive, default, integrated) and Windows authentication end to end with at least one beta user each. Until then, mark them untested in the docs (O8).
- **4.6 Fix crumbs.** `lab.py status` also reports `schemamap_reader_min` (O11).
