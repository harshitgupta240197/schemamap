# Phase U: Schema Map UI (local launcher)

Branch: `phase-u-launcher` (from `main`). Gate: U.7, then PR, merge commit, tag `v0.1.0-alpha.3`.

## Why

Harshit's decision (13 Nov 2026): most target users (BI developers, consultants, new joiners, many DBAs) expect a UI, not a CLI. Schema Map ships with a local UI. The CLI stays for scripts and power users.

## What the user gets

`schemamap ui` starts a small server on the user's own machine and opens the browser at the launcher:

1. **Connect:** server, port, auth mode (SQL login, Windows on Windows, Entra modes the driver supports), user, password, "trust server certificate" toggle (labelled "local labs only"), advanced timeouts.
2. **Check:** "Test connection" runs the `doctor` checks and shows each result in plain English, with the fix (for example, the permission script with a Copy button).
3. **Pick:** a list of databases the login can open, with search.
4. **Extract:** live progress per section (schemas, tables, columns, keys, indexes, code, dependencies), with Cancel.
5. **Map:** opens the map in a new tab. "Save map file" downloads the same single offline HTML file `schemamap view` makes.
6. **Recent maps:** reopen, re-run with a fresh password prompt, or delete. "Open a snapshot file" for existing snapshots.

## Non-negotiables for the launcher

- **Local only.** Bind to 127.0.0.1 only, never 0.0.0.0. Random free port. Reject any request whose Host is not `127.0.0.1:<port>` or `localhost:<port>` (stops DNS rebinding). Reject cross-origin requests (Origin check). No CORS headers.
- **One-time secret.** The launch URL carries a one-time launch code in the fragment (`#c=…`; random, single use, expires after 60 s), so it never reaches server logs or Referer headers and a link seen later is worthless (D-060). The page removes it from the address bar and POSTs it to `/api/session`, which returns the session token in the body; the page keeps the token in sessionStorage and sends it as a header on every API call. The server compares it in constant time. Missing or wrong token gives 401; a used, expired or wrong code gives 401.
- **No stored credentials.** Passwords live in memory only for the length of one request or job, are never logged, written, echoed back or put in an error. Recent connections keep server, port, database, auth mode and user name only, and only if the user ticks "Remember this connection".
- **Metadata only.** The launcher calls the same allowlisted query layer as the CLI. Any new query (the database list) is a `.sql` file that passes the allowlist test.
- **The map file is unchanged.** Same file, same CSP (`connect-src 'none'`). The launcher page has its own strict CSP: `default-src 'self'; connect-src 'self'; script-src` by hash; `frame-ancestors 'none'; form-action 'self'; base-uri 'none'; object-src 'none'`.
- **Shuts down cleanly.** Ctrl+C, a "Quit" button, or 30 minutes idle with no open page. Temp files cleaned up.
- **Same design as the landing page.** Light theme, violet #5B3FA0 and teal #0E7C77, self-hosted Inter. Screens are mocked in the Claude Project canvas and approved before U.4.

---

### U.0 Launcher design and walking skeleton
- Model: Opus 5.5 · Effort: medium · Mode: plan mode first
- Session: /clear → /model opus → /effort medium
- Depends on: 0.12
- Goal: a reviewed architecture and threat model for the local launcher, proven by a minimal end-to-end skeleton.
- Build:
  - Append this phase's crumbs from `docs/plans/PHASE_U.md` to `docs/BUILD_PLAN.md`
  - `docs/UI.md`: architecture (server module, API, job model, where files go, how the launcher front end is built and packaged), the full HTTP API (routes, request and response shapes, error codes), and a threat model (DNS rebinding, CSRF, token leakage, other local users, malicious web pages, password exposure, path traversal in file paths, oversized requests) with the mitigation for each
  - Decide the server stack and record it in DECISIONS: stdlib `http.server` + `ThreadingHTTPServer`, or Starlette + uvicorn. Prefer no new runtime dependency unless the design needs it; justify either way
  - Decide where the launcher front end lives (recommended: a second entry in `viewer/`, built as its own single file and packaged next to the map viewer by `tools/build_viewer.py`)
  - DECISIONS D-057: "Schema Map ships a local UI (`schemamap ui`) served from 127.0.0.1; the map file stays offline". It supersedes the "no server in v1" part of D-003; record why (target users expect a UI)
  - Walking skeleton: `schemamap ui --no-open` starts on 127.0.0.1 with a random port, prints the launch URL, serves a placeholder page and `GET /api/health` behind the token check
- Tests:
  - Unit: server binds 127.0.0.1 only; wrong Host → 403; missing or wrong token → 401; right token → 200
  - Playwright: open the launch URL, the page shows "Connected to Schema Map", and the token is gone from the address bar
- Done when:
  - [ ] `docs/UI.md` and D-057 written; Harshit reviews them in the Claude Project before U.1
  - [ ] Skeleton tests green locally; CI green on the last pushed commit (PROGRESS commit included)
- Commit: `docs(ui): launcher design, threat model and skeleton`

### U.1 Local server core
- Model: Sonnet 5.5 · Effort: high · Mode: normal
- Session: /clear → /model sonnet → /effort high
- Depends on: U.0
- Goal: a hardened local server every later crumb builds on.
- Build:
  - `schemamap ui` options: `--port` (default random), `--no-open`, `--data-dir` (default per OS: `~/SchemaMap` on macOS/Linux, `%USERPROFILE%\SchemaMap` on Windows)
  - Host and Origin checks, token check on every `/api/*` route, constant-time compare, request body limit (1 MB), JSON only, security headers (CSP from PHASE_U.md, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` on API responses)
  - Serves the packaged launcher page; clear error naming `tools/build_viewer.py` when it's missing (exit code per D-036)
  - Shutdown: Ctrl+C, `POST /api/quit`, 30-minute idle timeout; prints where the data folder is
  - Opens the default browser with the launch URL (file and http only, never a shell command)
- Tests:
  - Unit and HTTP tests: 0.0.0.0 never bound; DNS-rebinding Host (`evil.example:PORT`) → 403; `Origin: https://evil.example` → 403; no token, wrong token, token in query string instead of header → 401; body over 1 MB → 413; non-JSON → 415; every response carries the security headers; idle timeout shuts down (time mocked)
  - CLI: `schemamap ui --help` has examples; exit codes per D-036
- Done when:
  - [ ] All security tests pass; CLI checks green on all CI OSes; CI green on the last pushed commit (PROGRESS commit included)
- Commit: `feat(ui): hardened local server for the launcher`

### U.1a Map light theme matching the site
- Model: Sonnet 5.5 · Effort: medium · Mode: normal
- Session: /clear → /model sonnet → /effort medium
- Depends on: U.1
- Goal: the map looks like the landing page: light, calm, violet, and the same in the launcher later.
- Build:
  - Re-skin the viewer's light tokens (viewer/src/tokens.css) from site/style.css: violet #5B3FA0 accent (hover #432C7A), teal #0E7C77 secondary, ink #1E1B2E text, muted #4A4760, wash #FAF9FC canvas, line #ECEAF2 borders, white nodes and panels with soft shadows and 8–16 px radii like the site cards
  - Light is the default regardless of OS; a Light / Dark / System switch in the toolbar (accessible radio group), remembered in localStorage wrapped in try/catch (falls back to Light); no new URL-hash key
  - Dark theme kept and retuned so the violet accent passes contrast there too
  - Schema colour palette re-checked against the new canvas: still colour-blind safe, ≥ 3:1 in both themes
  - Inter: inline the self-hosted latin variable woff2 into the map file as a data: font only if it adds ≤ 350 KB; otherwise keep the system font stack. Record the choice and size in DECISIONS and PERFORMANCE.md
  - Move these tokens to one shared file the launcher (U.4) will import
- Tests:
  - Existing theme, contrast, axe and readability tests all pass in both themes (none weakened; changed colour values updated with reasons)
  - Playwright: a fresh map with OS set to dark still opens light; the switch changes theme and persists across reload; with localStorage throwing it opens light without errors; zero CSP violations
  - check:bundle and the CSP tests still pass; map size recorded
- Done when:
  - [ ] All viewer checks + check:bundle green locally; CI green on the last pushed commit (PROGRESS commit included)
  - [ ] Light screenshots of full map, panel and overview in CI artifacts for Harshit's review
- Commit: `feat(viewer): light theme matching the site, with theme switch`

### U.2 Connection API
- Model: Sonnet 5.5 · Effort: high · Mode: normal
- Session: /clear → /model sonnet → /effort high
- Depends on: U.1
- Goal: test a connection and list databases from the UI, with credentials never kept.
- Build:
  - `POST /api/connection/test`: runs the `doctor` checks with the submitted settings; returns each check (pass, warn, fail), a plain-English message and fix; never echoes the password
  - `POST /api/databases`: lists databases the login can open, via a new allowlisted query (`sys.databases` with `HAS_DBACCESS(name) = 1`, excluding system databases unless asked)
  - Password handling: held only for the request, then dropped; never logged, put in errors, or written; the existing redaction rules apply to every response
  - Recent connections: saved to `<data-dir>/connections.json` only when "remember" is set, holding server, port, database, auth mode and user only; `GET` and `DELETE` routes
- Tests:
  - Unit: every hostile password from Gate 1 never appears in any response body, log or saved file; connections.json never holds a password field (schema test); the new query passes the allowlist test
  - Integration (lab): test connection green for `schemamap_reader`; wrong password → fail with the right fix; database list includes AdventureWorks2022 and WideWorldImporters
- Done when:
  - [ ] Redaction and allowlist tests pass; integration tests pass in CI; CI green on the last pushed commit (PROGRESS commit included)
- Commit: `feat(ui): connection test and database list API`

### U.3 Extract jobs and maps library
- Model: Sonnet 5.5 · Effort: high · Mode: normal
- Session: /clear → /model sonnet → /effort high
- Depends on: U.2
- Goal: run an extract from the UI with live progress and keep the resulting maps.
- Build:
  - `POST /api/jobs`: starts an extract in a background thread with the submitted settings (password used, then dropped); one job at a time; returns a job id
  - `GET /api/jobs/<id>`: status and per-section progress (the extract pipeline reports progress through a callback, also used by the CLI's progress bar); `POST /api/jobs/<id>/cancel`
  - On success: snapshot and map written to `<data-dir>/maps/` with the existing safe naming and atomic writes; the job returns a map id
  - `GET /api/maps` (list with database, server, extraction time, table count, size), `GET /maps/<id>` serves the map HTML unchanged, `GET /api/maps/<id>/download`, `DELETE /api/maps/<id>`
  - `POST /api/maps/import`: accepts an uploaded `.json`/`.json.gz` snapshot, validates it as `view` does, and makes a map
  - Map ids are generated, never taken from user paths; no route accepts a file path
- Tests:
  - Unit: job lifecycle (start, progress, done, fail, cancel), one-at-a-time, path traversal attempts in ids → 404, imported snapshot with bad version → friendly error, the served map is byte-identical to `schemamap view` output for the same snapshot
  - Integration (lab): extract AdventureWorks2022 via the API; the map lists 71 tables
- Done when:
  - [ ] Job, library and integration tests pass; CI green on the last pushed commit (PROGRESS commit included)
- Commit: `feat(ui): extract jobs and maps library`

### U.4 Launcher screens: connect, check, pick
- Model: Sonnet 5.5 · Effort: medium · Mode: normal
- Session: /clear → /model sonnet → /effort medium
- Depends on: U.3, and the screen mockups approved in the Claude Project (saved as `docs/design/launcher.dc.html`)
- Goal: a first-time user can connect and pick a database without reading docs.
- Build:
  - Launcher front end (React + TypeScript, built as its own single file, packaged by `tools/build_viewer.py`), matching `docs/design/launcher.dc.html`
  - Connect screen: fields, auth modes (Windows shown only on Windows), password field with show/hide, "remember this connection" (never the password), recent connections list, advanced section
  - Check results: each check with status, message and fix; Copy for the permission script
  - Database picker with search; empty and error states; keyboard-only flow; light design with self-hosted Inter
  - All server-returned text rendered as React text only; the no-raw-HTML lint rule applies
- Tests:
  - Vitest: form validation, auth-mode visibility, recent connections never show a password
  - Playwright against a real `schemamap ui` with a stubbed API: full keyboard flow; axe zero serious/critical at 1280 and 375 px; no request leaves 127.0.0.1
- Done when:
  - [ ] Launcher checks green locally; CI green on the last pushed commit (PROGRESS commit included)
- Commit: `feat(ui): connect, check and database picker screens`

### U.5 Launcher screens: extract, map, recent maps
- Model: Sonnet 5.5 · Effort: medium · Mode: normal
- Session: /clear → /model sonnet → /effort medium
- Depends on: U.4
- Goal: from a picked database to an open map in one click, and back again later.
- Build:
  - Extract screen: per-section progress, elapsed time, Cancel, friendly failures with the fix
  - Done screen: "Open map" (new tab, `/maps/<id>`), "Save map file", "Extract another database"
  - Recent maps screen: list, open, re-run (asks for the password again), delete with confirmation, "Open a snapshot file"
  - Quit button (calls `/api/quit`, shows "You can close this tab")
- Tests:
  - Playwright (CI integration job, real lab): connect as `schemamap_reader`, pick AdventureWorks2022, extract, open the map, reach layout status done; re-run from Recent maps; delete a map; import the WWI fixture snapshot; zero CSP violations on launcher and map
  - axe zero serious/critical on every launcher state
- Done when:
  - [ ] End-to-end launcher flow passes in CI against the real lab; CI green on the last pushed commit (PROGRESS commit included)
- Commit: `feat(ui): extract progress, map hand-off and recent maps`

### U.6 Cross-platform and docs
- Model: Sonnet 5.5 · Effort: high · Mode: normal
- Session: /clear → /model sonnet → /effort high
- Depends on: U.5
- Goal: `schemamap ui` works the same on Windows, macOS and Linux, and a newcomer can follow the docs.
- Build:
  - CI: on all three OSes, start `schemamap ui --no-open`, hit `/api/health` with the token, quit cleanly; data folder created in the right place per OS
  - Windows: Windows auth option shown and passed through; paths with spaces and non-ASCII user names
  - README quickstart leads with `schemamap ui`; the CLI path follows; `docs/UI.md` user section with screenshots placeholder list
- Tests:
  - The CI jobs above; data-dir unit tests per OS
- Done when:
  - [ ] UI smoke job green on all three OSes; CI green on the last pushed commit (PROGRESS commit included)
- Commit: `ci(ui): launcher on three operating systems and docs`

### U.7 Launcher security and UX review
- Model: Opus 5.5 · Effort: high · Mode: normal
- Session: /clear → /model opus → /effort high
- Depends on: U.6
- Goal: prove the launcher is safe and pleasant before merging.
- Build:
  - Adversarial review against the U.0 threat model: DNS rebinding (real attempt with a hostile Host), CSRF from a page on another origin, token leakage (history, Referer, logs, process list), password in memory dumps of responses and logs, path traversal, oversized and malformed requests, two browsers at once
  - First-run walkthrough on AdventureWorks2022 and SchemaMapSynth, timed from `schemamap ui` to map open
  - Write `docs/gates/PHASEU.md`: results, findings, fixes made, open issues with severity, proposed crumbs; fix small issues here
  - `gh pr create --fill` from phase-u-launcher to main, then `gh pr checks --watch`; do not merge
- Done when:
  - [ ] PHASEU.md written; PR open with all required checks green
  - [ ] Harshit approves the merge (merge commit) and tags `v0.1.0-alpha.3`
- Commit: `docs: phase U review`

---

## Later (decide after interviews)

- **No-Python install:** a single download for Windows and macOS (PyInstaller or similar) that bundles Python and the driver, so non-technical users skip the install step. Spike crumb in Phase 4.
- **Saved passwords** in the OS keychain, opt-in. Needs its own security review; stays out of v1.
