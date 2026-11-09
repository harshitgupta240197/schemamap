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
