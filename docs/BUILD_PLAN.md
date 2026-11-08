# Schema Map: Build Plan for Claude Code

This is the step-by-step plan for building Schema Map with Claude Code, from an empty folder to `v0.1.0` on PyPI. The work is cut into **crumbs**: small steps that each fit in one Claude Code session and end with tests passing, a commit and a push.

Keep this file at `docs/BUILD_PLAN.md` in the repo and upload it to the Claude Project as knowledge.

---

## How to run a crumb

1. **Fresh session.** Run `/clear`, or start a new conversation in the VS Code extension. One crumb per session keeps context small and cheap.
2. **Set the model and effort first**, before you paste anything. Switching models mid-session throws away cached context and costs more.
   - `/model sonnet` (Sonnet 5.5), `/model opus` (Opus 5.5), `/model haiku` (Haiku 5.5), or `/model opusplan` (Opus while planning, Sonnet while building)
   - `/effort low | medium | high`
3. **Plan-mode crumbs:** switch to plan mode (Shift+Tab in the terminal, or the mode menu in the extension). Read the plan, ask for changes if needed, then approve.
4. **Paste the standard prompt** (below) with the crumb block under it.
5. **Paste Claude Code's summary into the Claude Project** for review before starting the next crumb.

### The standard prompt

```
Crumb <ID>. Follow CLAUDE.md. The crumb below is your full spec; don't read docs/BUILD_PLAN.md.
When finished: run the checks, commit with the crumb's message, push, add a line to docs/PROGRESS.md, and reply with a 5-line summary.

<paste the crumb block here>
```

### Setting effort in VS Code

Yes, you can. The Claude Code extension panel has a model picker and an effort control in its menu. The effort control only appears for models that support effort, and it can disappear if you hit a usage limit and Claude Code falls back to another model. If anything looks off, open VS Code's integrated terminal and run `claude`: `/model` and `/effort` work there exactly as documented, on the same Pro plan.

### Pro plan facts that shape this plan

Checked against Anthropic's docs in November 2026; re-check if something behaves differently.

- On Pro, the default model in Claude Code is **Opus 5.5**. Switch to Sonnet for most crumbs to make your limits last.
- Opus 5.5, Sonnet 5.5 and Haiku 5.5 support `low`, `medium`, `high`, `xhigh` and `max` effort, and all three default to `medium`.
- `max` applies to the current session only and tends to overthink. This plan never uses it.
- Typing `ultrathink` in a prompt asks for deeper reasoning on that one turn without changing your effort setting. Use it for one hard question instead of switching models.
- Pro has a five-hour session limit and a weekly limit, **shared between claude.ai and Claude Code**. `/status` shows what's left.
- Fable models may bill to usage credits on Pro. Don't use them for this build.
- If Claude Code offers API credits when you hit a limit, decline unless you've decided to pay for them.
- Make sure no `ANTHROPIC_API_KEY` environment variable is set, or Claude Code bills the API instead of your plan.

### Model and effort rules

| Work | Model | Effort |
| --- | --- | --- |
| Docs, config, renames, tiny edits | Haiku 5.5 | low |
| Standard feature from a clear spec | Sonnet 5.5 | medium |
| Tests, bug fixes, CI, cross-platform work | Sonnet 5.5 | high |
| Medium-hard feature that needs a good plan | opusplan | medium |
| Architecture, algorithms, hard debugging | Opus 5.5 | medium |
| Gate reviews, security audit, release checks | Opus 5.5 | high |

**Escalation rule.** If a crumb fails twice: raise effort one level (Claude skipped steps or didn't verify). If it still fails with full context, move up a model (the problem is genuinely hard). Start Opus crumbs at the beginning of a fresh five-hour window.

### Git setup and rules

You do the one-time setup in crumb 0.1. After that, Claude Code commits and pushes as part of every crumb.

- One branch per phase: `phase-1-extract`, `phase-2-viewer`, `phase-3-infer`, `phase-4-harden`, `phase-5-launch`.
- At least one commit per crumb, Conventional Commits with a scope, pushed at the end of the crumb.
- At each gate: Claude Code opens a pull request and watches CI; **you** approve the merge and the tag.
- Never force-push, never rewrite `main`, never commit secrets, `.env` files, `lab-data/` or `.bak` files.
- Claude Code may add a co-author line to commits. That's fine.

### Pace

There are about 50 crumbs. On Pro, expect 2 to 4 crumbs a day. If the build runs past the 20 Dec go/no-go date, move the date, not the quality bar.

---

## Quality targets (the definition of "best in class")

| Area | Target |
| --- | --- |
| Read-only guarantee | Zero non-system queries, proven by the allowlist test in CI |
| Extract speed | AdventureWorks under 10 s; synthetic 2,000-table database under 60 s |
| Viewer speed | 2,000-table map interactive in under 3 s; search results under 100 ms |
| Inference accuracy | On held-out databases with keys removed: precision ≥ 0.90, recall ≥ 0.80, high-band false positives ≤ 5% |
| Security | Hostile object names render as text; no credentials in logs, errors or snapshots |
| Accessibility | Zero serious axe violations; every flow works keyboard-only |
| Install | One command on Windows, macOS and Linux; `schemamap doctor` explains anything missing |
| Tests | ≥ 90% line coverage on extract and infer; end-to-end tests cover every main flow |

---

## Phase 0: Foundations (week 1)

Work on `main` in this phase.

### 0.1 [You] Machine and account setup
- No model. You do this yourself.
- Install: Git, GitHub CLI (`gh`), Python 3.12+, `uv`, Node.js LTS, Docker Desktop, VS Code with the Claude Code extension. Run `claude update`.
- Run `git config --global user.name "<your name>"` and `git config --global user.email "<your email>"`.
- Run `gh auth login` (GitHub.com, HTTPS, log in with browser), then `gh auth setup-git` so git pushes use the same login.
- Check that `ANTHROPIC_API_KEY` is not set. Log in to Claude Code with your Pro account.
- Create an empty folder named `schemamap`. Put `CLAUDE.md` at its root, and `BUILD_PLAN.md` and `PLAN.md` (the plan doc exported as Markdown) in `docs/`.
- Done when:
  - [ ] `git --version`, `gh auth status`, `uv --version`, `node --version` and `docker run hello-world` all work

### 0.2 [You] Name, license and visibility
- No model. Decide in the Claude Project.
- Working name: `schemamap` (package and command) unless you pick another now. Renaming later is possible but tedious.
- License: Apache-2.0.
- Repo visibility: public from day one (build in public) or private until launch.
- Done when:
  - [ ] Decisions noted for crumb 0.3

### 0.3 Scaffold the monorepo
- Model: Sonnet 5.5 · Effort: medium · Mode: normal
- Session: `/clear` → `/model sonnet` → `/effort medium`
- Goal: an empty but well-organized repo on GitHub.
- Build:
  - Folders from the CLAUDE.md repo map: `cli/`, `viewer/`, `tools/`, `docs/`, `.github/`
  - `.gitignore` for Python, Node, `.env*`, `.venv/`, `dist/`, `lab-data/`, `*.bak`, Playwright reports
  - `LICENSE` (Apache-2.0, copyright Harshit), `README.md` stub (one-liner and "under construction"), `SECURITY.md` stub
  - `docs/DECISIONS.md` seeded with the decisions in Appendix A, `docs/PROGRESS.md` with a header line
  - `git init` on `main`, then `gh repo create schemamap --public --source . --remote origin --push` (use `--private` if chosen in 0.2)
- Done when:
  - [ ] Repo exists on GitHub with `main` pushed
- Commit: `chore: scaffold monorepo`

### 0.4 Claude Code project settings
- Model: Sonnet 5.5 · Effort: medium · Mode: normal
- Session: `/clear` → `/model sonnet` → `/effort medium`
- Goal: Claude Code never reads secrets or huge folders, and runs routine checks without prompting.
- Build:
  - `.claude/settings.json` (committed) that denies reading `.env*`, `node_modules/`, `dist/`, `.venv/`, `lab-data/` and `*.bak`
  - Allow rules for the project's check commands and read-only git commands
  - Look up the exact permission-rule syntax in the current Claude Code settings docs. Don't guess.
- Done when:
  - [ ] Claude Code starts in the repo with no settings warnings
- Commit: `chore: add Claude Code project settings`

### 0.5 Python toolchain and CLI skeleton
- Model: Sonnet 5.5 · Effort: medium · Mode: normal
- Session: `/clear` → `/model sonnet` → `/effort medium`
- Goal: a typed, linted Python package with a working `schemamap` command.
- Build:
  - `cli/` as a `uv` project, `src/` layout, package `schemamap`, Python ≥ 3.10
  - Typer entry point `schemamap` with `--version`
  - `ruff` (lint and format), `mypy --strict`, `pytest` with an `integration` marker, `pytest-cov`
- Tests:
  - `--version` prints `0.0.1`
- Done when:
  - [ ] The CLI checks command from CLAUDE.md passes
- Commit: `chore(cli): python toolchain and CLI skeleton`

### 0.6 Viewer toolchain and single-file build
- Model: Sonnet 5.5 · Effort: medium · Mode: normal
- Session: `/clear` → `/model sonnet` → `/effort medium`
- Goal: a strict TypeScript React app that builds into one self-contained HTML file.
- Build:
  - `viewer/` with Vite, React, TypeScript strict, ESLint, Prettier, Vitest, Playwright (Chromium)
  - `vite-plugin-singlefile` so `npm run build` emits a single `dist/index.html`
  - npm scripts: `lint`, `typecheck`, `test`, `build`, `e2e`
- Tests:
  - One Vitest test; one Playwright test that opens the built file over `file://`
- Done when:
  - [ ] Viewer checks pass and `dist/index.html` works offline
- Commit: `chore(viewer): toolchain and single-file build`

### 0.7 Continuous integration
- Model: Sonnet 5.5 · Effort: high · Mode: normal
- Session: `/clear` → `/model sonnet` → `/effort high`
- Goal: every push is checked on three operating systems.
- Build:
  - `.github/workflows/ci.yml`: a `cli` job (Ubuntu, Windows, macOS × Python 3.10 and 3.13, unit tests only) and a `viewer` job (Ubuntu, all viewer checks plus Playwright)
  - Caching for `uv` and npm; cancel superseded runs; least-privilege `permissions:`
- Done when:
  - [ ] `gh run watch` shows every job green
- Commit: `ci: lint, typecheck and test on three OSes`

### 0.8 SQL Server lab
- Model: Sonnet 5.5 · Effort: high · Mode: normal
- Session: `/clear` → `/model sonnet` → `/effort high`
- Goal: a one-command local SQL Server with the sample databases and a read-only login.
- Build:
  - `tools/lab.py` (cross-platform, no bash-only scripts) with `up`, `down`, `status`, `restore <db>`
  - SQL Server 2022 Linux container via Docker Compose, data in `lab-data/`
  - `restore` downloads the official AdventureWorks2022, AdventureWorksDW2022 and WideWorldImporters backups from Microsoft's sql-server-samples releases and restores them
  - Creates login `schemamap_reader` in each database with `VIEW DEFINITION` (and `VIEW DATABASE STATE` as an option), no SELECT
  - SA password from a gitignored `.env`; commit `.env.example`
  - `docs/LAB.md`: how to use it, Stack Overflow database as an optional local extra, and notes for Apple Silicon if the container needs emulation on your machine
- Tests:
  - Integration test: connecting as `schemamap_reader`, `SELECT TOP 1 * FROM Person.Person` is denied (proves the reader login has no data access)
- Done when:
  - [ ] All three databases restored; the reader login cannot read rows
- Commit: `feat(lab): SQL Server docker lab with sample databases`

### 0.9 Architecture and snapshot schema
- Model: Opus 5.5 · Effort: medium · Mode: plan mode first
- Session: `/clear` → `/model opus` → `/effort medium`
- Goal: agree the shape of the system before building it.
- Build:
  - `docs/ARCHITECTURE.md`: modules (connect, queries, extract, snapshot, infer, export, viewer, telemetry), data flow, error model, versioning, how Pulse will extend it later
  - Snapshot schema v1 as Pydantic models in `cli/src/schemamap/snapshot/`, with generated `schema/snapshot.v1.json`
  - A stable object ID scheme (schema, object, column) with safe escaping of odd names
  - New entries in `docs/DECISIONS.md`
- Tests:
  - Model round-trip test; JSON Schema generation test
- Done when:
  - [ ] You review `ARCHITECTURE.md` in the Claude Project and approve it (gate 0)
- Commit: `docs: architecture and snapshot schema v1`

---

## Phase 1: Extract (week 2)

Branch: `phase-1-extract`.

### 1.1 Driver spike
- Model: Opus 5.5 · Effort: medium · Mode: normal
- Session: `/clear` → `/model opus` → `/effort medium`
- Goal: pick the SQL Server driver with the least install friction for users.
- Build:
  - Compare pyodbc with Microsoft ODBC Driver 18, Microsoft's `mssql-python` driver, and pymssql on: install steps per OS, Windows authentication, Azure SQL and Entra ID support, `ApplicationIntent=ReadOnly`, maintenance status, license
  - Prototype a connection plus one catalog query with the top two candidates against the lab
  - Record the decision and evidence in `docs/DECISIONS.md`; add the chosen driver to `cli/`
- Done when:
  - [ ] Decision recorded with evidence; driver installed
- Commit: `docs: choose SQL Server driver`

### 1.2 Connection layer and `doctor`
- Model: Sonnet 5.5 · Effort: medium · Mode: normal
- Session: `/clear` → `/model sonnet` → `/effort medium`
- Goal: connect safely and tell the user exactly what's working.
- Build:
  - `connect` module: server, port, database, auth (SQL login, Windows, Entra where the driver supports it), read-only intent, timeouts, encryption on by default with an explicit `--trust-server-certificate` flag for local labs
  - Credentials from a hidden prompt or `SCHEMAMAP_USER` / `SCHEMAMAP_PASSWORD`; never stored
  - `schemamap doctor`: connectivity, server version and edition, which permissions are present, Query Store state, and next steps in plain English
- Tests:
  - Unit tests for option parsing and redaction: the password and connection string never appear in logs or exception messages
  - Integration test: `doctor` against the lab
- Done when:
  - [ ] `doctor` reports all green on the lab; redaction tests pass
- Commit: `feat(cli): connection layer and doctor command`

### 1.3 Query allowlist and read-only guard
- Model: Opus 5.5 · Effort: high · Mode: normal
- Session: `/clear` → `/model opus` → `/effort high`
- Goal: make "metadata only" provable, not just promised.
- Build:
  - Loader for `cli/src/schemamap/queries/*.sql` and an executor that runs only named queries from that folder
  - A test that parses every `.sql` file with sqlglot (T-SQL dialect) and asserts: one SELECT statement (CTEs allowed); every referenced object is in `sys`, `INFORMATION_SCHEMA`, or an approved list of DMVs and Query Store views; no `SELECT INTO`, temp tables, `EXEC` or dynamic SQL
  - Runtime check that rejects any SQL text not loaded from the folder
  - Draft section for `SECURITY.md`: "How we guarantee read-only"
- Tests:
  - Positive tests on the real queries; negative tests where a fake query touching `dbo.Customers` or containing `INSERT` fails
- Done when:
  - [ ] Allowlist test runs in CI and passes
- Commit: `feat(extract): query allowlist and read-only guard`

### 1.4 Extract tables, columns, keys and indexes
- Model: Sonnet 5.5 · Effort: medium · Mode: normal
- Session: `/clear` → `/model sonnet` → `/effort medium`
- Goal: the core structure of a database, mapped into the snapshot model.
- Build:
  - Schemas; tables with temporal and memory-optimized flags; columns with type, length, precision, scale, nullability, identity, computed, default and collation
  - Primary keys, unique constraints, indexes (key and included columns, uniqueness, filters), check constraint names
- Tests:
  - Integration tests on AdventureWorks with expected values captured once from the lab and frozen as fixtures
- Done when:
  - [ ] Integration tests pass; AdventureWorks extraction under 10 s
- Commit: `feat(extract): tables, columns, keys and indexes`

### 1.5 Extract relationships and code objects
- Model: Sonnet 5.5 · Effort: medium · Mode: normal
- Session: `/clear` → `/model sonnet` → `/effort medium`
- Goal: declared relationships, code, and what depends on what.
- Build:
  - Foreign keys: multi-column, delete and update rules, disabled and untrusted flags
  - Views, procedures, functions, triggers and synonyms with definitions (encrypted modules recorded without a definition)
  - Dependencies from `sys.sql_expression_dependencies`, including cross-database references (flagged) and unresolved references
- Tests:
  - Integration tests on AdventureWorks and WideWorldImporters; unit tests for encrypted modules and cross-database references
- Done when:
  - [ ] Tests pass
- Commit: `feat(extract): foreign keys, code objects and dependencies`

### 1.6 Optional row counts and sizes
- Model: Sonnet 5.5 · Effort: medium · Mode: normal
- Session: `/clear` → `/model sonnet` → `/effort medium`
- Goal: useful context when the permission exists, graceful when it doesn't.
- Build:
  - Row counts and sizes from partition stats DMVs when `VIEW DATABASE STATE` is granted; otherwise skip with one warning
  - Query Store enabled flag
  - Lab creates a second reader login without `VIEW DATABASE STATE`
- Tests:
  - Integration tests with and without the permission
- Done when:
  - [ ] Both paths pass
- Commit: `feat(extract): optional row counts and sizes`

### 1.7 Deterministic snapshot writer
- Model: Sonnet 5.5 · Effort: high · Mode: normal
- Session: `/clear` → `/model sonnet` → `/effort high`
- Goal: one portable, diffable, versioned file.
- Build:
  - `schemamap extract` writes `snapshot.json`: schema version, tool version, UTC timestamp, server version, database name; no credentials; `--redact-server` to drop the host name
  - Stable ordering everywhere; optional gzip for large databases
- Tests:
  - Golden-file test on AdventureWorks (ignoring timestamps); two runs produce identical output; output validates against the JSON Schema
- Done when:
  - [ ] Tests pass
- Commit: `feat(extract): deterministic versioned snapshot writer`

### 1.8 CLI experience
- Model: Sonnet 5.5 · Effort: medium · Mode: normal
- Session: `/clear` → `/model sonnet` → `/effort medium`
- Goal: a CLI that feels calm and clear, even when things go wrong.
- Build:
  - Rich progress per section; `--schema` and `--exclude-schema` filters; `--output`, `--quiet`, `--verbose`
  - Documented exit codes; friendly errors with fix hints for failed login, missing permission, timeout and unreachable server
  - Polished `--help` text for every command
- Tests:
  - CLI runner tests for each error path (mocked)
- Done when:
  - [ ] Tests pass; help text reads well
- Commit: `feat(cli): progress, filters and friendly errors`

### 1.9 Synthetic schema generator
- Model: Sonnet 5.5 · Effort: medium · Mode: normal
- Session: `/clear` → `/model sonnet` → `/effort medium`
- Goal: big, messy test databases with known answers.
- Build:
  - `tools/synth.py`: N tables (default 2,000) across schemas, with realistic naming variants (`CustomerID`, `customer_id`, `CustId`, plural and singular tables, `dim`/`fact` prefixes), a configurable share of declared foreign keys, and views and procedures that join tables
  - Writes a ground-truth JSON of every true relationship
- Tests:
  - Unit tests for the generator; integration test builds a 200-table database in the lab
- Done when:
  - [ ] A 2,000-table database builds in the lab with its ground-truth file
- Commit: `feat(lab): synthetic schema generator with ground truth`

### 1.10 Integration tests in CI
- Model: Sonnet 5.5 · Effort: high · Mode: normal
- Session: `/clear` → `/model sonnet` → `/effort high`
- Goal: real SQL Server tests on every push.
- Build:
  - CI job with a SQL Server service container; restore AdventureWorks (cache the backup between runs); create the reader login; run `pytest -m integration`
  - A 500-table synthetic performance smoke test with a time budget
- Done when:
  - [ ] CI green, including the integration job
- Commit: `ci: SQL Server integration tests`

### 1.11 Gate 1 review
- Model: Opus 5.5 · Effort: high · Mode: normal
- Session: `/clear` → `/model opus` → `/effort high`
- Goal: prove extraction is correct, safe and fast before building on it.
- Build:
  - Run extract on every lab database and the 2,000-table synthetic one; record timings
  - Review the allowlist, executor and redaction code; check docs
  - Write `docs/gates/GATE1.md` with a results table, issues found and fixes made; list bigger issues as proposed crumbs
  - `gh pr create --fill` from `phase-1-extract` to `main`, then `gh pr checks --watch`
- Done when:
  - [ ] Runs on AdventureWorks, AdventureWorksDW, WideWorldImporters and synthetic (Stack Overflow optional, locally)
  - [ ] 2,000 tables under 60 s; zero allowlist violations
  - [ ] You approve the merge and tag `v0.1.0-alpha.1`
- Commit: `docs: gate 1 report`

---

## Phase 2: See (week 3)

Branch: `phase-2-viewer`.

### 2.1 Viewer data layer
- Model: Sonnet 5.5 · Effort: medium · Mode: normal
- Session: `/clear` → `/model sonnet` → `/effort medium`
- Goal: load and index a snapshot safely.
- Build:
  - Generate TypeScript types from `schema/snapshot.v1.json` as a build step
  - Loader for inline `<script type="application/json" id="schemamap-data">` or a dropped file; runtime validation with a clear error screen for wrong versions
  - In-memory indexes: by ID, by name, adjacency lists
- Tests:
  - Vitest for the loader, validation errors and indexes
- Done when:
  - [ ] Tests pass
- Commit: `feat(viewer): snapshot loading and indexes`

### 2.2 Graph canvas with auto-layout
- Model: opusplan · Effort: medium · Mode: plan mode first
- Session: `/clear` → `/model opusplan` → `/effort medium`
- Goal: the map itself.
- Build:
  - React Flow canvas; table nodes showing name, schema badge, key columns and column count, expandable to all columns
  - Foreign key edges drawn column to column
  - elkjs layout in a Web Worker; zoom, pan, minimap, fit view; layout cached per view
- Tests:
  - Vitest for graph building; Playwright: the AdventureWorks fixture renders the expected nodes and edges
- Done when:
  - [ ] Tests pass
- Commit: `feat(viewer): graph canvas with auto-layout`

### 2.3 Search, filters and focus mode
- Model: Sonnet 5.5 · Effort: medium · Mode: normal
- Session: `/clear` → `/model sonnet` → `/effort medium`
- Goal: find anything in seconds.
- Build:
  - Command-palette search over tables, columns and views (fuzzy, keyboard-first: `/` or Ctrl+K)
  - Schema filter; focus mode showing one table plus 1 to 3 hops, with a breadcrumb back
  - View state in the URL hash so links can be shared
- Tests:
  - Vitest for search ranking and hop expansion; Playwright flows
- Done when:
  - [ ] Tests pass
- Commit: `feat(viewer): search, schema filter and focus mode`

### 2.4 Detail panel and impact view
- Model: Sonnet 5.5 · Effort: medium · Mode: normal
- Session: `/clear` → `/model sonnet` → `/effort medium`
- Goal: answer "what is this, and what breaks if I change it?"
- Build:
  - Side panel for a table or view: columns with types and keys, indexes, incoming and outgoing relationships
  - Impact: objects that depend on it and that it depends on
  - View and procedure definitions with lightweight syntax highlighting; copy buttons
- Tests:
  - Vitest and Playwright
- Done when:
  - [ ] Tests pass
- Commit: `feat(viewer): detail panel and impact view`

### 2.5 Large schemas
- Model: Opus 5.5 · Effort: high · Mode: plan mode first
- Session: `/clear` → `/model opus` → `/effort high`
- Goal: 2,000+ tables stay fast and readable.
- Build:
  - Overview mode clustering by schema and connected components, with counts and drill-down
  - Render only the visible subgraph; incremental layout
  - Playwright performance test on the 2,000-table synthetic snapshot using performance marks
- Done when:
  - [ ] Interactive in under 3 s and search under 100 ms on the CI runner (local numbers recorded too)
- Commit: `perf(viewer): overview mode and large-schema rendering`

### 2.6 Design polish and accessibility
- Model: Sonnet 5.5 · Effort: medium · Mode: normal
- Session: `/clear` → `/model sonnet` → `/effort medium`
- Goal: it looks calm and professional and works for everyone.
- Build:
  - Visual pass: clean, high-contrast, light and dark themes following the system setting
  - Empty, loading and error states; keyboard navigation across nodes and panel; visible focus; reduced motion
  - "About this map" footer: tool version, extraction time, read-only note
  - axe checks in Playwright
- Done when:
  - [ ] Zero serious axe violations; keyboard-only path works
- Commit: `feat(viewer): design polish and accessibility`

### 2.7 The `view` command
- Model: Sonnet 5.5 · Effort: high · Mode: normal
- Session: `/clear` → `/model sonnet` → `/effort high`
- Goal: one command from snapshot to an HTML map, safely.
- Build:
  - `schemamap view` injects a snapshot into the prebuilt viewer (packaged as `schemamap/viewer_dist/index.html`), writes `<db>-map.html` and opens it (`--no-open` to skip)
  - Safe JSON inlining: escape `<`, `>`, `&`, U+2028 and U+2029
  - Build pipeline copies the viewer build into the Python package; CI checks they match
- Tests:
  - Hostile names such as `</script><img src=x onerror=alert(1)>`: Playwright confirms no script runs and the name shows as text
  - Size check on a 2,000-table map
- Done when:
  - [ ] Tests pass
- Commit: `feat(cli): view command with safe snapshot embedding`

### 2.8 End-to-end suite
- Model: Sonnet 5.5 · Effort: high · Mode: normal
- Session: `/clear` → `/model sonnet` → `/effort high`
- Goal: every main flow is tested like a user would use it.
- Build:
  - Playwright on generated AdventureWorks and WideWorldImporters maps: open, search, focus, panel, impact, URL state, dark mode, keyboard-only
  - Screenshots saved as CI artifacts, not committed
- Done when:
  - [ ] Suite passes in CI
- Commit: `test(viewer): end-to-end suite`

### 2.9 Phase 2 review
- Model: Opus 5.5 · Effort: medium · Mode: normal
- Session: `/clear` → `/model opus` → `/effort medium`
- Goal: check the viewer against the jobs in PLAN.md.
- Build:
  - Review against the four jobs: see the shape fast, connect A to B, see impact, share docs
  - Write `docs/gates/PHASE2.md`; list gaps as proposed crumbs; `gh pr create --fill`, then `gh pr checks --watch`
- Done when:
  - [ ] You approve the merge and tag `v0.1.0-alpha.2`
- Commit: `docs: phase 2 review`

---

## Phase 3: Infer (weeks 4–5)

Branch: `phase-3-infer`.

### 3.1 Inference design
- Model: Opus 5.5 · Effort: high · Mode: plan mode first
- Session: `/clear` → `/model opus` → `/effort high`
- Goal: design the differentiator properly before coding it.
- Build:
  - `docs/INFERENCE.md` covering:
    - Candidate generation without comparing every column to every column (index columns by normalized name tokens; targets are primary key and unique columns)
    - Signals and starting weights (from PLAN.md); type compatibility rules
    - Name normalization: case, underscores, `Id`/`ID`/`_id`/`Key`/`Code`/`No`, plural and singular, prefixes such as `tbl`, `dim`, `fact`
    - Self-references, composite keys, bridge tables
    - Confidence bands (High ≥ 70, Medium 40–69, Hidden < 40), explanation records, overrides file format
    - Tuning set (AdventureWorks, synthetic) versus holdout set (WideWorldImporters, AdventureWorksDW)
- Done when:
  - [ ] You approve the design in the Claude Project
- Commit: `docs: inference design`

### 3.2 Candidates and naming/type signals
- Model: Sonnet 5.5 · Effort: medium · Mode: normal (write tests first)
- Session: `/clear` → `/model sonnet` → `/effort medium`
- Goal: the first two signals, as pure functions.
- Build:
  - `infer/normalize.py`, `infer/candidates.py`, `infer/signals/naming.py`, `infer/signals/types.py`
- Tests:
  - Table-driven tests for 40+ naming variants and type pairs; property tests (Hypothesis) that normalization is idempotent
- Done when:
  - [ ] Tests pass
- Commit: `feat(infer): candidate generation and naming/type signals`

### 3.3 Join evidence from code
- Model: Opus 5.5 · Effort: medium · Mode: normal
- Session: `/clear` → `/model opus` → `/effort medium`
- Goal: learn relationships from how the database's own code joins tables.
- Build:
  - Parse view, procedure and function definitions with sqlglot (T-SQL) to extract equality join predicates and column-to-column WHERE equalities
  - Resolve aliases, default schemas, CTEs and subqueries where feasible; count evidence per column pair
  - Parse failures never stop the run; record them with object names in a report
- Tests:
  - Fixtures of tricky T-SQL: bracketed names, aliases, CTEs, APPLY, temp tables inside procedures, dynamic SQL (ignored)
- Done when:
  - [ ] Tests pass
- Commit: `feat(infer): join evidence from view and procedure code`

### 3.4 Query history evidence
- Model: Sonnet 5.5 · Effort: medium · Mode: normal
- Session: `/clear` → `/model sonnet` → `/effort medium`
- Goal: an optional extra signal from Query Store.
- Build:
  - Allowlisted query reading Query Store query text (top N by execution count, capped), parsed like 3.3
  - Skipped with a note when Query Store is off or the permission is missing
  - Lab script enables Query Store and runs sample joins
- Tests:
  - Unit tests with recorded fixtures; integration test in the lab
- Done when:
  - [ ] Tests pass
- Commit: `feat(infer): optional query history evidence`

### 3.5 Scoring, explanations and overrides
- Model: Sonnet 5.5 · Effort: high · Mode: normal
- Session: `/clear` → `/model sonnet` → `/effort high`
- Goal: one score per candidate, with reasons, that users can correct.
- Build:
  - Combine signals into a 0–100 score; a type mismatch rules a pair out; assign bands
  - Explanation list per edge; `overrides.json` (confirm or reject by edge ID) applied on every run
  - Inferred edges stored in the snapshot with source `inferred` versus `declared` (schema v1.1, backward compatible)
- Tests:
  - Unit tests for scoring and overrides; schema compatibility test
- Done when:
  - [ ] Tests pass
- Commit: `feat(infer): scoring, explanations and overrides`

### 3.6 Accuracy harness
- Model: Sonnet 5.5 · Effort: high · Mode: normal
- Session: `/clear` → `/model sonnet` → `/effort high`
- Goal: a real accuracy number, measured against known answers.
- Build:
  - `tools/harness.py`: for each lab database, make a lab-only copy with all foreign keys dropped, run extract and infer, compare with the original keys (and the synthetic ground truth)
  - Report precision, recall and F1 per database and per band in `docs/ACCURACY.md`
  - CI runs it on AdventureWorks and a 500-table synthetic database, failing below thresholds (start at current numbers, raise as they improve)
- Done when:
  - [ ] Harness runs locally and in CI
- Commit: `test(infer): accuracy harness with ground truth`

### 3.7 Tuning
- Model: Opus 5.5 · Effort: high · Mode: normal
- Session: `/clear` → `/model opus` → `/effort high`
- Goal: hit the accuracy targets without overfitting.
- Build:
  - Iterate on weights and rules using the tuning set only, then measure the holdout set once
  - Log every change and its effect in `docs/ACCURACY.md`
- Done when:
  - [ ] Holdout precision ≥ 0.90, recall ≥ 0.80, high-band false positives ≤ 5%, or a clear report of the gap and next ideas
- Commit: `perf(infer): tune scoring`

### 3.8 Inferred edges in the viewer
- Model: Sonnet 5.5 · Effort: medium · Mode: normal
- Session: `/clear` → `/model sonnet` → `/effort medium`
- Goal: show guesses honestly and let users correct them.
- Build:
  - Solid edges for High, dashed for Medium; legend; confidence filter
  - "Why" popover listing the evidence
  - Review panel for Medium and Hidden candidates with confirm and reject; builds an `overrides.json` the user downloads (the viewer stays offline and static)
- Tests:
  - Vitest and Playwright
- Done when:
  - [ ] Tests pass
- Commit: `feat(viewer): inferred relationships, evidence and review`

### 3.9 Join path finder
- Model: Sonnet 5.5 · Effort: medium · Mode: normal
- Session: `/clear` → `/model sonnet` → `/effort medium`
- Goal: "how do I get from table A to table B?" answered with SQL.
- Build:
  - Shortest path weighted by confidence (declared edges preferred); top 3 alternatives
  - `schemamap path <A> <B>` prints the path and a ready-to-copy SQL `JOIN` snippet
  - Viewer: two pickers, highlighted path, copy-SQL button
- Tests:
  - Unit tests with ties and missing paths; Playwright flow
- Done when:
  - [ ] Tests pass
- Commit: `feat: join path finder with SQL snippet`

### 3.10 Data dictionary export
- Model: Sonnet 5.5 · Effort: medium · Mode: normal
- Session: `/clear` → `/model sonnet` → `/effort medium`
- Goal: shareable documentation with zero writing.
- Build:
  - `schemamap docs` writes Markdown (one file per schema plus an index) and a single-file HTML dictionary: tables, columns, types, keys, relationships (declared and inferred with confidence), dependencies
  - Deterministic output
- Tests:
  - Golden files for AdventureWorks
- Done when:
  - [ ] Tests pass
- Commit: `feat(export): Markdown and HTML data dictionary`

### 3.11 Gate 2 review
- Model: Opus 5.5 · Effort: high · Mode: normal
- Session: `/clear` → `/model opus` → `/effort high`
- Goal: confirm the differentiator works before hardening.
- Build:
  - Run the harness; review inference code and explanations; test the full flow on every lab database
  - Write `docs/gates/GATE2.md`; `gh pr create --fill`, then `gh pr checks --watch`
- Done when:
  - [ ] Holdout recall ≥ 0.80 with precision ≥ 0.90
  - [ ] You approve the merge and tag `v0.1.0-beta.1`
- Commit: `docs: gate 2 report`

---

## Phase 4: Harden (weeks 5–6)

Branch: `phase-4-harden`.

### 4.1 Security audit
- Model: Opus 5.5 · Effort: high · Mode: normal
- Session: `/clear` → `/model opus` → `/effort high`
- Goal: a DBA can verify every claim we make.
- Build:
  - Threat model in `SECURITY.md`: what the tool touches, what it never does, how to verify it
  - Review the allowlist, executor, credential flow, redaction and viewer escaping
  - `pip-audit`, `npm audit --omit=dev`, pinned versions and lockfiles, least-privilege CI permissions
  - Fix issues; list bigger ones as proposed crumbs
- Done when:
  - [ ] No open high-severity findings
- Commit: `docs(security): threat model and audit fixes`

### 4.2 Edge-case sweep
- Model: Sonnet 5.5 · Effort: high · Mode: normal
- Session: `/clear` → `/model sonnet` → `/effort high`
- Goal: no surprises on real-world databases.
- Build and test:
  - Case-sensitive collations; Unicode, bracketed and quoted names with spaces and dots; reserved words
  - Very long definitions; encrypted modules; cross-database and linked-server references; synonyms
  - Temporal and history tables, memory-optimized, partitioned and columnstore tables
  - Empty schemas; databases with zero foreign keys
  - Azure SQL Database differences, with a note of what is and isn't tested
- Done when:
  - [ ] Each case has a test and passes
- Commit: `fix: edge cases across collations, names and object types`

### 4.3 Install experience
- Model: Sonnet 5.5 · Effort: high · Mode: normal
- Session: `/clear` → `/model sonnet` → `/effort high`
- Goal: one-command install, verified on three operating systems.
- Build:
  - CI job builds the wheel and sdist, installs with `pipx` and `uv tool install` on Windows, macOS and Linux, then runs `--version`, `doctor --help` and `view` on a fixture snapshot
  - `docs/INSTALL.md` with per-OS driver steps (from 1.1) and troubleshooting
- Done when:
  - [ ] Install jobs green on all three
- Commit: `ci: install tests on three OSes`

### 4.4 Performance pass
- Model: Opus 5.5 · Effort: medium · Mode: normal
- Session: `/clear` → `/model opus` → `/effort medium`
- Goal: meet every speed target with headroom.
- Build:
  - Profile extraction (query timings, safe parallelism) and the viewer (React profiler, layout worker)
  - Record results in `docs/PERFORMANCE.md`
- Done when:
  - [ ] All speed targets met
- Commit: `perf: extract and viewer performance pass`

### 4.5 [You] Beta with real users
- No model for the outreach itself. Use a Haiku · low crumb for Claude Code to add `.github/ISSUE_TEMPLATE/` (bug report and feedback).
- Send a GitHub pre-release and install steps to 5–10 interviewees. Ask them to run `doctor`, `extract` and `view` on a non-sensitive database and file issues.
- Bring the issue list to the Claude Project for triage into fix crumbs.

### 4.6 Fix crumbs
- Model: Sonnet 5.5 · Effort: high (escalate per the rule)
- The Claude Project writes one crumb per issue in the standard format.
- Commit: `fix(<area>): <issue summary> (#<issue number>)`

---

## Phase 5: Launch (week 6)

Branch: `phase-5-launch`.

### 5.1 README and docs
- Model: Sonnet 5.5 · Effort: medium · Mode: normal
- Session: `/clear` → `/model sonnet` → `/effort medium`
- Goal: a README that earns a DBA's trust in 60 seconds.
- Build:
  - One-liner, demo GIF placeholder, live demo link, three-command quickstart, permission script
  - "What it reads and never reads"; accuracy numbers from `docs/ACCURACY.md`; FAQ; honest comparison; Pulse waitlist teaser; contributing guide
- Done when:
  - [ ] README and docs index reviewed in the Claude Project
- Commit: `docs: launch README and docs`

### 5.2 Live demo on GitHub Pages
- Model: Sonnet 5.5 · Effort: medium · Mode: normal
- Session: `/clear` → `/model sonnet` → `/effort medium`
- Goal: people can try it before installing anything.
- Build:
  - Workflow that builds AdventureWorks and WideWorldImporters maps from committed fixture snapshots and publishes them to GitHub Pages; README links to them
- Done when:
  - [ ] Demo pages live
- Commit: `ci: publish live demo maps to GitHub Pages`

### 5.3 Landing page and waitlist
- Model: Sonnet 5.5 · Effort: medium · Mode: normal
- Session: `/clear` → `/model sonnet` → `/effort medium`
- Goal: a simple home on the web that collects Pulse leads.
- Build:
  - `site/`: a single static page or small Next.js app (decide and record in `docs/DECISIONS.md`), deployed on Vercel
  - Headline, demo GIF, live demo link, install command, Pulse waitlist form posting to a Supabase table with insert-only row-level security; privacy note; no trackers
  - You create the Vercel and Supabase accounts and set the keys as environment variables; Claude Code never sees real keys
- Done when:
  - [ ] Site live; a test signup lands in the table
- Commit: `feat(site): landing page and waitlist`

### 5.4 Opt-in telemetry
- Model: Sonnet 5.5 · Effort: high · Mode: normal
- Session: `/clear` → `/model sonnet` → `/effort high`
- Goal: count usage without ever touching anyone's metadata.
- Build:
  - Off by default; asks once after the first successful run
  - Sends only event name, tool version, OS and a table-count bucket; no names, metadata or host names
  - `schemamap telemetry on | off | status`; an environment variable to disable; documented in README and `PRIVACY.md`; insert-only endpoint
- Tests:
  - Payload contents test; nothing is sent when telemetry is off or undecided
- Done when:
  - [ ] Tests pass
- Commit: `feat(cli): opt-in count-only telemetry`

### 5.5 Release automation
- Model: Sonnet 5.5 · Effort: high · Mode: normal
- Session: `/clear` → `/model sonnet` → `/effort high`
- Goal: tag a version and everything else happens.
- Build:
  - On a `v*` tag: build the viewer and Python package, run all checks, publish to PyPI with trusted publishing, create a GitHub Release with a changelog generated from Conventional Commits, attach the demo maps
  - You create the PyPI project and set up trusted publishing; Claude Code walks you through it
- Done when:
  - [ ] A test release to TestPyPI succeeds
- Commit: `ci: release automation to PyPI`

### 5.6 Release candidate review
- Model: Opus 5.5 · Effort: high · Mode: normal
- Session: `/clear` → `/model opus` → `/effort high`
- Goal: the final check before the world sees it.
- Build:
  - Check every quality target, gate report, doc, demo link, `SECURITY.md`, `LICENSE`, version number, and that telemetry is off by default; install on a clean machine
  - Write `docs/gates/RELEASE.md`; open the PR
- Done when:
  - [ ] You merge and tag `v0.1.0`; the release workflow publishes; `pipx install schemamap` works on a clean machine
- Commit: `docs: release report v0.1.0`

### 5.7 [You + Claude Project] Launch content
- Not a Claude Code crumb. Draft in the Claude Project: the technical article, Show HN post, Reddit posts, LinkedIn post and emails to interviewees, using `docs/ACCURACY.md` and the demo links.

---

## Appendix A: seed entries for `docs/DECISIONS.md`

- **D-001** Read-only and metadata-only in v1. The opt-in data-sampling inference signal from PLAN.md is deferred until after launch, so the "never reads row data" promise stays absolute.
- **D-002** SQL Server first. PostgreSQL and MySQL after launch.
- **D-003** Local-first: a CLI plus an offline single-file HTML viewer. No server in v1.
- **D-004** Stack: Python CLI (uv, Typer, Rich, Pydantic, sqlglot); React and TypeScript viewer (Vite, @xyflow/react, elkjs, Vitest, Playwright).
- **D-005** License: Apache-2.0.
- **D-006** Telemetry is opt-in and count-only.
- **D-007** Working name `schemamap` for the package and command; revisit before launch.

## Appendix B: Later list (not in v1)

- AI-written column descriptions (bring your own key, names only)
- dbt `sources.yml` export
- Snapshot diff ("what changed since last run")
- PostgreSQL and MySQL support
- Cloud workspace for sharing maps with a team (first paid hook)
- Opt-in data-sampling signal for inference
- Pulse: query performance module (product #2)
