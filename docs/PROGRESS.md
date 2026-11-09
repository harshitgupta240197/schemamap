# Progress

2026-11-08 | 0.3 | 0d13cca | Scaffold the monorepo: folders, .gitignore, LICENSE, README/SECURITY stubs, DECISIONS seeded
2026-11-08 | 0.4 | ec534bd | Claude Code project settings: deny secrets/huge dirs, allow check commands and read-only git (tightened in 41cb707)
2026-11-08 | 0.5 | 9c0e1f4 | Python toolchain and CLI skeleton: uv project, Typer --version, ruff/mypy/pytest
2026-11-08 | 0.6 | ebd1482 | Viewer toolchain: Vite/React/strict TS, ESLint, Prettier, Vitest, Playwright, single-file dist/index.html
2026-11-08 | 0.7 | ab22994 | CI on 3 OSes (cli 6 jobs + viewer with Playwright), actions pinned to SHAs, all green
2026-11-08 | 0.8 | 2d8a73d | SQL Server 2022 lab: tools/lab.py (up/restore/status/down/grant), 3 sample DBs, schemamap_reader without SELECT, integration tests
2026-11-08 | 0.8a | b484a53 | Lab downloads: 3-attempt backoff, Range resume via .part, GitHub API fallback, manual-download hint; tested on local server only
2026-11-09 | 0.9 | eb3b6a7 | Architecture doc, snapshot v1 Pydantic models + committed JSON Schema, canonical ID scheme (incl. index/constraint/FK/edge), D-013..D-026
2026-11-09 | 0.9a | feb3766 | Gate 0 architecture fixes: redaction scope, stage commands, join edge direction, collation matching; added test for two FKs with identical columns sharing one edge
2026-11-09 | 1.1 | f9aafe9 | Driver spike: mssql-python chosen over pymssql (no Entra ID) and pyodbc (system driver, no py3.10); prototype in cli/spikes/
2026-11-09 | 1.2 | d8ead1f | Connection layer (mssql-python, read-only intent, redacted ConnectError) and schemamap doctor; reader-permission tests moved off sqlcmd
2026-11-09 | 1.3 | 1844998 | MetadataExecutor runs only allowlisted named queries (sqlglot T-SQL allowlist, bound params); raw cursor removed; static AST guard; SECURITY.md read-only section
2026-11-09 | 1.4 | 5b18466 | Extract schemas, tables, columns, keys, indexes and checks into snapshot models; AdventureWorks2022 in 2.5 s (budget 10 s); allowlist trimmed to used views
2026-11-09 | 1.5 | 6db4fe0 | Extract foreign keys, views, routines, synonyms and dependencies; lab.py edgecases; reader needs SELECT on sys.sql_expression_dependencies; PARSENAME allowlisted
2026-11-09 | 1.6 | 0a1a50d | Optional row counts/sizes (dm_db_partition_stats), per-section permission warnings via probing (driver has no error numbers, D-033), Query Store on/off/unknown, doctor dependencies check, schemamap_reader_min lab login
