# CLAUDE.md: Schema Map

Schema Map connects to a SQL Server database with a read-only login, reads only system metadata, and produces an interactive offline map of tables, relationships (declared and inferred) and dependencies. Quality bar: best in class. Ship less rather than ship rough.

## Non-negotiables

1. **Metadata only.** Every query reads `sys.*` catalog views, `INFORMATION_SCHEMA`, Query Store views or DMVs. Never user tables. Never row data.
2. **Read-only.** No INSERT, UPDATE, DELETE, MERGE, DDL, `EXEC` of user procedures, or temp objects on the target database.
3. **Local by default.** No network calls except the opt-in telemetry module. Snapshots and maps stay on the user's machine.
4. **No secrets anywhere.** Never log, print, store or commit passwords, tokens or connection strings. Credentials come from a prompt or environment variables only.
5. **Public data only.** Use the sample databases in the lab and the synthetic generator. Never data from any real company.

## Repo map

```
cli/        Python package `schemamap` (extract, infer, export, CLI)
  src/schemamap/queries/   every SQL statement lives here as a .sql file
viewer/     React + TypeScript single-file viewer (Vite)
schema/     snapshot.v1.json, generated from cli/src/schemamap/snapshot/ (never edit by hand)
tools/      lab.py (SQL Server Docker lab), synthetic schema generator
docs/       BUILD_PLAN.md, ARCHITECTURE.md, DECISIONS.md, PROGRESS.md, gate reports
.github/    CI workflows
```

## Commands

- CLI checks: `cd cli && uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest`
- CLI integration tests (lab must be up): `cd cli && uv run pytest -m integration`
- Viewer checks: `cd viewer && npm run lint && npm run typecheck && npm test && npm run build`
- Viewer end-to-end: `cd viewer && npx playwright test`
- Regenerate the snapshot JSON Schema after changing `snapshot/` models: `cd cli && uv run python scripts/gen_snapshot_schema.py` (a test fails if `schema/snapshot.v1.json` is stale)
- Lab: `uv run tools/lab.py up | restore all | status | down [--purge]` (also `restore <db>`, `grant <db>`; see `docs/LAB.md`)

Run the full checks for every area you touched before every commit. If a command here changes, update this file in the same commit.

## Code standards

- **Python 3.10+**, fully typed, `mypy --strict` clean, `ruff` clean. Typer for the CLI, Rich only in the CLI layer, Pydantic for the snapshot model.
- Library code never prints; it returns values or raises typed errors. The CLI layer turns errors into clear messages and exit codes.
- Inference code is pure functions over the snapshot model: no database access, deterministic output, easy to test.
- **TypeScript strict**, no `any`, no non-null assertions without a comment. Types for the snapshot are generated from the JSON Schema, never hand-written.
- Small modules, clear names, docstrings on public functions. No dead code, no commented-out code.
- Outputs are deterministic: stable ordering everywhere, so snapshots diff cleanly.

## SQL rules

- All SQL lives in `cli/src/schemamap/queries/*.sql`. No SQL strings anywhere else.
- Every query must pass the allowlist test (system objects only, SELECT only). Never weaken that test.
- Parameterize every value. Never build SQL by string concatenation.
- Degrade gracefully when a permission is missing: skip that section, warn once, keep going.

## Security rules

- Object names are untrusted input. In the viewer, render them as text, never as HTML.
- When inlining snapshot JSON into HTML, escape `<`, `>`, `&`, U+2028 and U+2029 so a name like `</script>` cannot break out. Keep the test that proves it.
- Connections use `ApplicationIntent=ReadOnly` where supported and a query executor that refuses any SQL not in the allowlist.

## Testing

- Every change ships with tests. Inference and parsing changes are written test-first.
- Never delete, skip or loosen a test to get green. If a test is wrong, say so in the summary and fix it deliberately.
- Integration tests run against the lab's real SQL Server. Unit tests never need a database.
- Do not report a crumb done while anything fails.

## Working within token limits

- The crumb pasted into the session is your spec. Do not read `docs/BUILD_PLAN.md` in full.
- Use search (grep, glob) to find code before opening files. Open only what you need.
- Never read `node_modules/`, `dist/`, `.venv/`, `lab-data/`, backups or lock files.
- Keep end-of-crumb summaries to about five lines: what changed, test results, commit hash, anything Harshit must decide.
- After two failed approaches to the same problem, stop and report what you tried. Don't thrash.

## Git workflow

- Work on the current phase branch (`phase-<n>-<name>`). Create it from `main` if it doesn't exist.
- Conventional Commits with a scope: `feat(extract): ...`, `fix(viewer): ...`, `test(infer): ...`, `docs: ...`, `ci: ...`.
- At the end of every crumb: run checks → `git add` only the files you meant to change → commit with the crumb's message → `git push`.
- Never force-push, never rewrite `main`, never commit `.env`, credentials, `lab-data/` or `.bak` files.
- At a gate: `gh pr create --fill`, then `gh pr checks --watch`, then report. Harshit approves the merge.

## End of every crumb

1. All checks green for the areas touched.
2. Commit and push, then `gh run watch` the pushed commit. The crumb is not done until CI is green.
3. Append one line to `docs/PROGRESS.md`: `YYYY-MM-DD | <crumb ID> | <commit hash> | <one-line note>`.
4. Five-line summary.

## Decisions and dependencies

- Record architecture and product decisions in `docs/DECISIONS.md` (numbered, dated, with the reason).
- Adding a dependency needs a one-line justification in `docs/DECISIONS.md`. Prefer the standard library and the approved stack: Typer, Rich, Pydantic, sqlglot, the chosen SQL Server driver; React, @xyflow/react, elkjs, Vite, Vitest, Playwright.
