# Schema Map UI: the local launcher

`schemamap ui` starts a small HTTP server on the user's own machine and opens the browser at the
launcher: connect, check, pick a database, extract, open the map. The CLI stays for scripts. The
map file it produces is the same offline file `schemamap view` writes (D-057).

Status: U.0 design. The walking skeleton (`GET /`, `GET /api/health`, Host/Origin/token checks)
is built; everything else here is the contract that crumbs U.1–U.3 implement. Plan and
non-negotiables: `docs/plans/PHASE_U.md`.

## 1. Architecture

```
browser tab (launcher page, http://127.0.0.1:<port>/)
   │  fetch /api/*  + X-SchemaMap-Token header
   ▼
schemamap.ui.server   ThreadingHTTPServer on 127.0.0.1:<random>, one thread per request
   ├─ security.py     Host check → Origin check → token check (pure functions)
   ├─ assets.py       packaged launcher page + its Content-Security-Policy
   ├─ jobs.py         (U.3) one extract job at a time, in a worker thread
   ├─ library.py      (U.3) maps on disk: list, serve, download, delete, import
   └─ connections.py  (U.2) remembered connections, never a password
        │
        ▼
schemamap.connect / extract / viewer   the same allowlisted query layer and map embedding as the CLI
```

- **Server stack:** standard library `http.server` with `ThreadingHTTPServer` (D-058). No new
  runtime dependency.
- **Bind:** always `127.0.0.1`, port 0 (the OS picks a free port; U.1 adds `--port`). The
  address is a constant with no parameter, so nothing can bind `0.0.0.0` by accident.
- **CLI layer:** the `ui` command in `cli.py` loads the launcher, starts the server, prints the
  launch URL on one stdout line, opens the browser (`webbrowser.open` with the http URL, never
  a shell command), and stops on Ctrl+C. Library modules never print.
- **Logging:** none. The handler's `log_message` and the server's `handle_error` are silenced,
  so request lines, headers and tracebacks (which could quote request data) never reach the
  terminal or a file.
- **Request handling order:** Host → Origin → route. For `/api/*`: token → route → method →
  body limits (U.1) → handler. Unknown `/api/*` paths need the token before they answer 404, so
  nobody without it can map the API.

### Job model (U.3)

- One job at a time; a second `POST /api/jobs` gets `409 job_running`.
- A job runs `extract_snapshot` in a worker thread. The extract pipeline reports progress through
  a callback (the CLI's progress bar uses the same one). The job records per-section state:
  `pending | running | done | skipped | failed`, plus counts.
- Job states: `running → done | failed | cancelled`. Cancel is cooperative: it is checked between
  sections and between queries, and the query timeout bounds the wait for the query in flight.
- **Password lifetime:** the request body is parsed into a connection config; the password is
  used to open the connection and then the job drops its reference. Python cannot scrub memory,
  so "dropped" means no reference is kept and nothing writes it anywhere. It is never logged,
  never put in an error (the existing `redact()` applies to every message), never echoed in a
  response, and never on any command line.
- Finished jobs are kept in memory for the life of the server (status only, no credentials).

### Where files go

`<data-dir>` defaults to `~/SchemaMap` on macOS and Linux and `%USERPROFILE%\SchemaMap` on
Windows (U.1, `--data-dir`). It is created with mode 0700, and files are written 0600 with the
existing atomic writer (`write_bytes_atomic`).

```
<data-dir>/
  connections.json        remembered connections: server, port, database, auth mode, user. No password field.
  maps/<id>/
    snapshot.json.gz      the snapshot
    map.html              the map, byte-identical to `schemamap view` output for that snapshot
    meta.json             database, server (as shown), extracted_at, table count, size
  tmp/                    uploads and in-progress writes; emptied at start and at shutdown
```

`<id>` is 32 lowercase hex characters from `secrets.token_hex(16)`. It is generated, never
taken from a user path, and looked up in the library index. Request input is never joined into
a filesystem path.

### Front end and packaging (D-059)

- The source lives in `viewer/`, as a second entry: `viewer/launcher.html` and
  `viewer/src/launcher/`, built by `vite.launcher.config.ts` into the single file
  `viewer/dist-launcher/launcher.html`. The skeleton is plain TypeScript; U.4 brings React with
  the same toolchain, lint rules (no raw HTML) and tests.
- `npm run build` builds the map viewer, then the launcher (`npm run build:launcher`).
  `scripts/launcher-csp.mjs` writes `dist-launcher/launcher.csp.json`: the sha256 sources of
  the page's inline scripts and styles, computed from the jsdom-parsed page (the same hashing
  as the map's CSP, D-052).
- `tools/build_viewer.py` copies the page to `cli/src/schemamap/viewer_dist/launcher.html` with
  `launcher.json` (bytes, sha256, `script_sources`, `style_sources`). `tools/check_wheel.py`
  requires both, with a matching sha256. `schemamap ui` refuses a launcher that does not match
  its manifest and names `tools/build_viewer.py` (exit 1, like `view`).
- Fonts (U.4): self-hosted Inter, as on the landing page, served from the launcher's own origin
  or inlined; never a third-party origin.

## 2. HTTP API

All API responses are JSON (`application/json`) with `Cache-Control: no-store`. Every response,
page or API, carries:

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `X-Frame-Options: DENY`
- a Content-Security-Policy:
  - the launcher policy for `/`
  - the map's own meta policy plus the header `frame-ancestors 'none'` for `/maps/<id>`
  - `default-src 'none'; frame-ancestors 'none'` for everything else

No CORS header is ever sent.

### Errors

```json
{ "error": { "code": "unauthorized", "message": "Missing or wrong token." } }
```

`message` is plain English, safe to show as text, and never contains a password, token,
connection string or traceback.

| Status | `code` | When |
|---|---|---|
| 400 | `bad_request` | Malformed JSON, missing or ill-typed field |
| 401 | `unauthorized` | `/api/*` without the right `X-SchemaMap-Token` header (a query-string token does not count) |
| 403 | `forbidden_host` | Host is not `127.0.0.1:<port>` or `localhost:<port>` |
| 403 | `forbidden_origin` | Origin present and not this launcher's origin |
| 403 | `forbidden_fetch_site` | `/maps/<id>` requested with `Sec-Fetch-Site` other than `same-origin` or `none` |
| 404 | `not_found` | Unknown route or id |
| 405 | `method_not_allowed` | Known route, wrong method (with `Allow`) |
| 409 | `job_running` | A job is already running |
| 411 | `length_required` | Body without `Content-Length` (chunked bodies are refused) |
| 413 | `too_large` | Body over 1 MB (over 100 MB for import) |
| 415 | `unsupported_media_type` | Body not `application/json` (import: not `application/json` or `application/gzip`) |
| 422 | `invalid` | Well-formed but unacceptable: bad snapshot version, unknown auth mode |
| 500 | `internal` | Anything unexpected; generic message, details never sent |

### Routes

Unless marked, every route needs the token header. Request bodies are JSON with a 1 MB limit.

**`GET /`** (no token) serves the launcher page.

**`GET /api/health`** (U.0)
```json
{ "status": "ok", "version": "0.0.1" }
```

**`POST /api/quit`** (U.1) stops the server after the response.
Returns `{ "status": "stopping" }`.

A *connection* is the same set of settings the CLI takes:
```json
{ "server": "localhost", "port": 1433, "database": "master",
  "auth": "sql | windows | entra-password | entra-interactive | entra-default | entra-integrated",
  "user": "schemamap_reader", "password": "…", "trust_server_certificate": false,
  "connect_timeout": 15, "query_timeout": 60 }
```
`password` is accepted on request bodies only. It never appears in any response.

**`POST /api/connection/test`** (U.2) takes `{ "connection": {…} }` and runs the `doctor` checks.
```json
{ "checks": [ { "name": "login", "status": "ok | warn | fail",
                "message": "…", "fix": "…", "fix_sql": "GRANT VIEW DEFINITION …" } ] }
```

**`POST /api/databases`** (U.2) takes `{ "connection": {…}, "include_system": false }`.
It answers `{ "databases": [ { "name": "AdventureWorks2022" } ] }`, using the new allowlisted
query over `sys.databases` with `HAS_DBACCESS(name) = 1`.

**`GET /api/connections`** (U.2) lists remembered connections:
```json
{ "connections": [ { "id": "<hex32>", "server": "…", "port": 1433, "database": "…",
                     "auth": "sql", "user": "…" } ] }
```

**`DELETE /api/connections/<id>`** (U.2) returns `{ "deleted": true }`.

A connection is remembered when `POST /api/jobs` or `/api/connection/test` carries
`"remember": true`.

**`POST /api/jobs`** (U.3) takes `{ "connection": {…}, "remember": false }`.
It answers `202` with `{ "job_id": "<hex32>" }`.

**`GET /api/jobs/<id>`** (U.3)
```json
{ "job_id": "…", "state": "running | done | failed | cancelled",
  "sections": [ { "name": "tables", "state": "done", "count": 71 } ],
  "elapsed_ms": 1234, "map_id": "<hex32 when done>",
  "error": { "code": "…", "message": "…", "fix": "…" } }
```
The client polls about every 500 ms. There is no SSE or websocket.

**`POST /api/jobs/<id>/cancel`** (U.3) returns `{ "state": "cancelling" }`.

**`GET /api/maps`** (U.3)
```json
{ "maps": [ { "id": "…", "database": "…", "server": "…", "extracted_at": "…",
              "tables": 71, "bytes": 123456 } ] }
```

**`GET /maps/<id>`** (U.3, no token, see below) serves the map HTML, unchanged.

**`GET /api/maps/<id>/download`** (U.3) returns the map HTML with
`Content-Disposition: attachment`. The page fetches it with the token and saves it via a blob.

**`DELETE /api/maps/<id>`** (U.3) returns `{ "deleted": true }`.

**`POST /api/maps/import`** (U.3) takes a raw `.json` or `.json.gz` body, up to 100 MB, streamed
to `tmp/`. It answers `{ "map_id": "…" }`, or `422 invalid` with the same friendly message
`view` gives.

### Why `/maps/<id>` has no token

The map opens in a new tab by ordinary navigation, which cannot send a header. The page is
static. The spec's token rule covers `/api/*`, and this route sits outside it. It is guarded by:

1. **A capability id.** 128 random bits, generated by the server and known only to the
   launcher page and the browser history. It never leaves the machine.
2. **The Host and Origin checks**, as on every route.
3. **`Sec-Fetch-Site`** must be `same-origin` (opened from the launcher) or `none` (typed,
   bookmarked, reloaded). A cross-site page cannot open or embed it.
4. **`frame-ancestors 'none'`** and `no-store` headers. The map's own meta policy
   (`connect-src 'none'`) still applies, so the map makes no request even when served over http.

## 3. Threat model

Assets:

- the SQL password, held only while a request or job runs
- the session token
- the snapshot and map contents (schema metadata and SQL definitions)
- the user's database server, which an attacker could probe using the user's network position

| Threat | Attack | Mitigation | Residual |
|---|---|---|---|
| **DNS rebinding** | A web page on `evil.example` re-points its DNS to 127.0.0.1 and calls the launcher as same-origin | Host must be exactly `127.0.0.1:<port>` or `localhost:<port>`, otherwise 403 before any routing. The page still lacks the token, so it gets 401 regardless | None known |
| **CSRF / malicious web pages** | Any page the user visits sends requests to `http://127.0.0.1:<port>` | The token header is required. A custom header makes the request non-simple, so a preflight is needed, and the server answers no CORS headers. Origin is checked (403). POST bodies must be `application/json`, which form posts cannot send. The random port must also be found first | A page can still learn that *something* listens on a port (timing). It cannot read or change anything |
| **Token leakage** | Token read from logs, Referer, history or screen | The token sits in the URL fragment, which browsers never send in requests or Referer. The page moves it to sessionStorage and `replaceState`s it out of the address bar and the history entry. `Referrer-Policy: no-referrer`. The server logs nothing. The token is 256 bits from `secrets.token_urlsafe` and dies when the server stops | The browser-launch subprocess (`open` / `xdg-open`) carries the URL in its argv for a moment, visible to other local users on the same machine. The terminal shows the link. The browser's global history database may record the original URL. Each is useless once the server stops. See open question 1 |
| **Other local users** | Another account on the same machine connects to 127.0.0.1:<port> | Loopback is shared between users, so the token is the control. Constant-time compare (`hmac.compare_digest`). The data dir is 0700 and files are 0600 | See the argv residual above |
| **Malicious local process (same user)** | Malware running as the user | Out of scope: it can already read the user's files and memory | — |
| **Clickjacking** | The launcher is framed by another site to trick clicks | `frame-ancestors 'none'` in the header policy, `X-Frame-Options: DENY` | None |
| **XSS via object names** | A table named `<img onerror=…>` reaches the launcher, for example in a database list or map list | Server text is rendered as React text only (lint rule). The launcher CSP allows scripts by hash only and no `unsafe-inline`/`unsafe-eval`. JSON responses are served with `nosniff` and `default-src 'none'` | None known |
| **Password exposure** | Password in a log, response, error, file, crash output or URL | Held in memory for one request or job only. Bodies are never logged. Every message goes through the existing `redact()`. 500s are generic. Typer runs with `pretty_exceptions_show_locals=False`. Remembered connections have no password field (schema test, U.2). The password is never in a URL or command line | Python strings cannot be wiped, so it stays in process memory until garbage collected |
| **Path traversal** | `GET /maps/../../.ssh/id_rsa`, ids with `%2e%2e` | No route takes a path. Ids must match `^[0-9a-f]{32}$` and are looked up in the library index, so anything else gets 404. Import writes to a server-chosen temp name | None |
| **Oversized or slow requests** | Huge bodies, chunked bodies, slowloris, header floods | `Content-Length` required (411), 1 MB cap (413), chunked bodies refused. Import is capped at 100 MB and streamed. Each connection has a 10 s socket timeout. The stdlib caps header count (100) and line length (64 KiB). One job at a time | A local flood can slow the launcher, which only affects the user themself |
| **Map file leakage** | The served map makes requests or can be framed | The map is byte-identical to `view` output and keeps `connect-src 'none'`. `frame-ancestors 'none'` is in the header | None |
| **Binding to the network** | The server reachable from the LAN | Bind is the constant `127.0.0.1`, and a test asserts it. There is no option to change the interface | None |

U.7 attacks each row for real (hostile Host, a cross-origin page, process list, logs, oversized
and malformed requests, two browsers at once) and records the results in `docs/gates/PHASEU.md`.

## 4. Open questions for review

1. **Token in argv at launch.** `webbrowser.open` hands the URL with the token to a helper
   process, so another local user could read it with `ps` for a moment. Option: the launch URL
   carries a one-time code. The page swaps it via `POST /api/session` for the session token and
   the code is burned, so a code seen later is worthless. Cost: one route and one round trip.
   Recommendation: adopt it in U.1 if multi-user machines (shared jump boxes) matter for the
   target users.
2. **`/maps/<id>` without a token** (section 2): approve the capability-id design, or require a
   short-lived single-use ticket instead (safer if history leaks; worse on reload).
