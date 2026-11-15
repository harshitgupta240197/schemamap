# Phase U review: the launcher

Crumb U.7, 2026-11-15, branch `crumb/U.7` from `phase-u-launcher` (issue #6). Goal: prove `schemamap ui` is safe and pleasant before Phase U merges.

**Verdict.** The launcher holds up against every attack in the `docs/UI.md` threat model, using real requests from raw sockets, two browsers and pages on other origins. A hostile Host, a cross-origin page, a guessed or reused code, a traversal id, an oversized or malformed body: each is refused before it reaches anything. The password never appeared in any response, log or saved file, and the session token appeared nowhere but its one response body. The review found one **high** issue, now fixed: **Ctrl+C while an extract ran could crash the process** (segmentation fault) and leave `tmp/` behind. It happened whenever a second SIGINT arrived, either because the user pressed Ctrl+C twice or because `uv run`/`uvx` forwarded the signal. A crash can write a core dump that holds the password, so it was fixed here, not deferred. Two small hardening issues and three visual bugs were also fixed. Eight low-severity findings remain open as issues (#7 to #14). None of them is a security hole. First run is quick: 4.3 s from `schemamap ui` to the AdventureWorks2022 map laid out, keyboard only, and 11.8 s for the 2,000-table SchemaMapSynth.

**Decision for Harshit.** The open findings are all low. I propose they go into one polish crumb after the gate (U.8, below) rather than block the Phase U merge. #10 needs a product decision first: build "See every query it runs" and "Technical details", or drop them from the frames.

## 1. How it was tested

- **Machine:** Apple M5, macOS, Python 3.13.16, Node 26.7, Playwright 1.65 (Chromium and Firefox). SQL Server 2022 CU27 runs in the Docker lab (amd64 emulation) at 127.0.0.1:14330, as `schemamap_reader` with the default lab grants.
- **The real thing:** every attack ran against the real `schemamap ui --no-open` process, built from this branch with `tools/build_viewer.py`, each time with a fresh `--data-dir`. Nothing was stubbed except where noted.
- **Four harnesses** were written for the review and are not committed: they are one-off attack scripts, and each fixed issue has its own regression test in the suites.
  1. **HTTP battery** (Python, raw sockets, 146 cases): Host, Origin, token, launch code, path traversal on every id route, sizes, malformed requests, slow clients, password and token search, Quit with an upload in flight.
  2. **Lifecycle** (Python, 11 cases): Ctrl+C with a job and an upload in flight, idle shutdown (in process, 2 s timeout, the real launcher page), code expiry after a real 61 s wait, and what a browser opener receives in argv (a `BROWSER` recorder, the Linux path).
  3. **Browser** (Playwright, 25 cases): pages on two other origins, DNS rebinding (Chromium `--host-resolver-rules` maps `rebind.example` and `evil.example` to 127.0.0.1), Referer, the map tab, two tabs, Quit from the UI, and the timed walkthroughs.
  4. **History** (Playwright, Chromium new headless and Firefox, persistent profiles): what the browser history database keeps.
- **Secrets:** the reader's password came from `lab.read_env()` and went only into request bodies and the form. The harnesses counted occurrences of it, and of a canary wrong password, in every captured byte, and never printed either. Launch codes in this report are written `<code>`.

## 2. Results against the threat model

| Threat | Attempts | Result |
|---|---|---|
| **DNS rebinding** | 15 hostile `Host` values with a valid token (`evil.example:port`, no port, other port, `localhost.`, `[::1]`, `0.0.0.0`, `127.0.0.2`, `127.1`, `2130706433`, `x@127.0.0.1`, `127.0.0.1:port.evil.example`, `localhost.evil.example`, leading-zero port, empty), no Host (HTTP/1.1 and 1.0), two Host headers with the evil one first, a valid unused code posted with `Host: evil.example`. In Chromium, `rebind.example` resolved to 127.0.0.1: the navigation, then attacker content at that origin fetching `/api/session` with a valid unused code, `/` and `/api/health`. | **All refused.** Every hostile Host got `403 forbidden_host`. In the browser the navigation got 403, and the browser blocked the three fetches before they returned. The code was not used up: the owner's link still worked afterwards. Two Host headers with the good one first get 200; no browser can send that. |
| **CSRF / malicious pages** | Pages at `http://127.0.0.1:<other>` (same-site) and `http://evil.example:<other>` (cross-site), each given the launcher port **and a real map id**: CORS GET, GET with a token header (preflight), no-cors POST to `/api/quit` and `/api/session`, `sendBeacon`, a `text/plain` form shaped as JSON, iframes of `/` and the map, `<img>` and `<script>` of API and map URLs, a link that opens the map in a new tab. Raw: `/api/quit` with a **valid token** from 7 foreign Origins (`evil`, `null`, other port, https, `localhost` other port, with a path, with a suffix), preflights, form-encoded and `text/plain` bodies. | **Nothing read or changed.** CORS reads were blocked, the preflight got 403 with no CORS header, both iframes became error pages, `<img>`/`<script>` failed, and the map tab showed `403 forbidden_fetch_site`. The launcher was still running and unchanged afterwards (`/api/health` 200). Every foreign Origin got `403 forbidden_origin`, even with the token. Form and text bodies got 415. |
| **Token and launch-code leakage** | Process list (`ps -axww`) while running; stdout and stderr of the whole battery; every response; the address bar after load; `history.length`; every request URL and Referer in a full flow (connect, extract, open the map); the map tab's `sessionStorage`; the Chromium and Firefox history databases; a `BROWSER` opener's argv; the code reused after use, and after 61 s. | **Token: nowhere** except the body of `POST /api/session`. It is in no URL, header, log, file, history row or argv. **Code:** absent from the process list with `--no-open`, printed once on stdout (the link line, by design), removed from the address bar at load, never sent in a request or Referer. It **is** kept in the history database by both browsers (`http://127.0.0.1:<port>/#c=<code>`), and a Linux-style opener receives it in argv. Both are the residuals D-060 accepts. The code read back from history got 401 (used), and from argv 61 s later 401 (expired). The map tab, opened with `noopener noreferrer`, has an empty `sessionStorage` and sends no Referer. |
| **Password exposure** | A canary wrong password through `/api/connection/test` (with `remember: true`), `/api/databases` and a job. Then the real password through a test and a job with `remember: true`, plus a lone surrogate in the password, and in the server name with `remember: true`. All responses, stdout, stderr and every file in the data folder were searched (the snapshot unpacked). | **0 occurrences** of either password anywhere. The wrong password gave 200 with `connected: false`, 502 `connect_failed`, and a failed job (`connect_failed`). `connections.json` holds server, port, database, auth and user only. Surrogates were handled, with no 500. The data folder is 0700 and every file is 0600. After fix U7-1 the process no longer crashes, so no core dump can capture it (section 3). |
| **Path traversal** | 21 hostile ids (`..`, `%2e%2e`, `..%2f..%2f.ssh%2fid_rsa`, backslashes, upper-case hex, 31/33 chars, a trailing `/`, `%00`, `/../../connections.json`, `~`, `/etc/passwd`, `.json`, non-ASCII) on all 6 id routes (`/maps/<id>`, download, delete map, job, cancel, delete connection) = 126 requests, plus `/maps/../connections.json`, `/../../../../etc/passwd`, `//etc/passwd` and a real map id in upper case. | **All 404** (or 400) with a short body. No file outside the library was ever read. |
| **Oversized and malformed** | `Content-Length` of 2 MB (no body sent) and 10^30; chunked; chunked plus `Content-Length`; none; 7 malformed lengths (`-1`, `+2`, `0x10`, `1e3`, a full-width digit, a leading space, `2, 2`); import declaring 101 MB; a 597 KB gzip bomb that unpacks to 600 MB; 14 bad JSON bodies (invalid, array, string, empty, invalid UTF-8, 100,000-deep nesting, `NaN`, a 5,000-digit port, a boolean port, an unknown field, NUL, a 10,000-character server, an unknown auth, `connection` as a list); a garbage request line, a 70 KB line, 120 headers, an unknown method, `HTTP/9.9` with `<script>` in the path; a body shorter than its length; slowloris headers. | 413 at once (the body is never read), 411, 400, 415 and 422 as documented. The bomb got 422 in 0.4 s. The short body and slowloris were dropped after the 10 s socket timeout. The standard library's own refusals (400, 414, 431, 501, 505) arrived **without the security headers**: finding U7-2, fixed. Nothing was reflected unescaped. |
| **Two browsers or tabs** | The used link in a second tab; the bare address; a reload of the owner's tab; a tab opened with `window.open` from the launcher (it shares the session); both tabs starting an extract at once (raw API too); Quit in one tab, then an action in the other. | The second tab says "This link has already been used or has expired…". The bare address says "This page needs the link printed by schemamap ui…". The reload keeps working. The second extract got `409 job_running`, and the first finished. Its message reads like a failure of that tab's own extract (U7-10, #12). After Quit the other tab says "Schema Map is not answering. Check that schemamap ui is still running…". |
| **Quit and idle shutdown** | Quit (raw API and from the UI) with an upload streaming into `tmp/`; Ctrl+C with a 2,000-table job **and** an upload in flight, through `uv run` (whole process group) and directly, once and twice; SIGTERM; idle shutdown with refused requests arriving. | Quit and idle: exit 0, `tmp/` empty, port closed, and refused requests do not keep it alive. **Ctrl+C mid-job: crashed** (exit 139 through `uv run`, -11 on a direct double Ctrl+C, nothing printed, an upload file left in `tmp/`): finding U7-1, fixed. After the fix: exit 0 in 3.4 to 4.4 s, "Schema Map launcher stopped.", `tmp/` empty, no map kept, 5 of 5 runs. |
| **Binding, clickjacking, map tab** | The listening address; framing from both attacker origins; the security headers on the page, a 200, a 401 and a 404; the map tab's `Sec-Fetch-Site`. | 127.0.0.1 only (unchanged test). Framing was refused (`X-Frame-Options: DENY`, `frame-ancestors 'none'`). All four responses carry `nosniff`, `no-referrer`, `DENY`, `no-store` and a CSP, with no CORS header. The map opened from the launcher is `same-origin`, cross-site and same-site requests get 403, and no request left 127.0.0.1 during the whole flow. |

## 3. Findings

| ID | Severity | Finding | Status |
|---|---|---|---|
| U7-1 | **high** | **Ctrl+C during an extract crashed the process.** A second SIGINT (Ctrl+C pressed twice, or the copy `uv run`/`uvx` forwards to the child, which also gets the terminal's) raised `KeyboardInterrupt` inside `server_close` while it waited for the job. The interpreter exited, and mssql-python's exit hook (`_cleanup_connections`) closed the cursor on the main thread while the job thread was in `fetchall`. `faulthandler` showed both stacks. Exit 139 or -11, no stop message, an upload left in `tmp/`. On Linux a crash can write a core dump, which would put the in-memory password on disk. A single Ctrl+C or Quit raced the same way if the query in flight outlived the 5 s wait. | **Fixed** (D-069) |
| U7-2 | low | The standard library's refusals (malformed line 400, 414, 431, 501, 505) were HTML pages without `nosniff`, `X-Frame-Options`, `Referrer-Policy` or a CSP. The text was escaped, so not exploitable. | **Fixed** |
| U7-3 | low | The Quit screen's header still said "Running on this computer · 127.0.0.1" above "Schema Map has stopped". | **Fixed** |
| U7-4 | low | On Check, "Database permissions are checked when you choose a database." sat flush against the card's left edge (no padding). On phones, Recent maps' Open, Re-run and Delete touched (`.lc-maps td { display: block }` beat the actions cell's flex), and a stray rule showed above the first map. | **Fixed** |
| U7-5 | low | The header has no icons for Recent maps and Quit, and wraps to two rows at 375 px (the frames keep one). | Open, #7 |
| U7-6 | low | Error, danger and success states lack their colours and marks: neutral Extract-Failed card, amber delete confirmation, no success mark on Done, outline checks in the stepper. | Open, #8 |
| U7-7 | low | "How to fix:" is inline on Check but on its own line on Pick-Empty, Pick-Error and Extract-Failed, and the state cards lack the frames' icon tile. | Open, #9 |
| U7-8 | low | "See every query it runs" (Connect) and "Technical details" (Pick-Error) are in the frames, not the product. Needs a decision. | Open, #10 |
| U7-9 | low | Check says "Choose a database anyway", with "Check again" as primary, even when every check passed. | Open, #11 |
| U7-10 | low | A second tab's extract during a running one shows "The extract could not finish" instead of "another extract is running". | Open, #12 |
| U7-11 | low | `tmp/` can keep an in-flight write until the next start: an upload on Windows (an open file cannot be deleted), or a job saving its map when the `os._exit` path ends the process. Inferred from the code; macOS verified clean. | Open, #13 |
| U7-12 | low | Import validates up to 512 MB unpacked in memory. Only the user can send it; it is self-inflicted slowness, not exposure. | Open, #14 |

Accepted residuals, unchanged from D-060 and confirmed: the launch code in the browser history database and in a Linux opener's argv (worthless once used or after 60 s); a `/maps/<id>` request without `Sec-Fetch-Site` relies on the id, Host and Origin; the password stays in process memory until garbage-collected.

## 4. Fixes made in this crumb

| Finding | Change | Regression tests |
|---|---|---|
| U7-1 | `cli.py`: while serving, SIGINT and SIGTERM call `request_stop("interrupt")` (a context manager restores the previous handlers). After `server_close`, if `JobManager.busy` (new) says the worker is still running, the command reports the stop and ends with `os._exit(0)`. | `test_ui_signals.py`: the real CLI in a child process with a fake job that ignores cancelling for 30 s and an exit hook that stands in for the driver's (exit 99 if it runs under a live job); Ctrl+C twice, Ctrl+C once and SIGTERM each exit 0 with the stop message and an empty `tmp/`. Before the fix: 99, 99, -15. `test_ui_command.py`: a second SIGINT raised during `server_close` no longer cuts it short, and handlers are restored; a busy worker leads to `os._exit(0)`. `test_ui_jobs.py`: `busy` while a worker outlives `shutdown`'s wait. |
| U7-2 | `server.py`: `send_error` is overridden to send the JSON error with the security headers and the status phrase. | `test_ui_hardening.py`: 5 raw-socket cases (400, 505 with `<script>` in the path, 414, 431, 501): JSON, every security header, nothing from the request in the body. All 5 failed before. |
| U7-3 | `Chrome.tsx`/`App.tsx`: `Header stopped` shows a grey "Stopped" pill on the Quit screen. | `launcher-extract.spec.ts` "Quit stops the server…": the pill reads "Stopped" and no "Running" text remains (axe still clean). Failed before. |
| U7-4 | `launcher.css`: the note gets the check items' padding; `.lc-maps td.lc-maps__actions` keeps flex at 375 px; no rule above the first map. `docs/images/ui/launcher-check.png` refreshed. | `launcher-screens.spec.ts`: the note's text starts at least the check items' padding inside the card, at 1280 and 375 px. `launcher-extract.spec.ts`: at 375 px, Open, Re-run and Delete are at least 8 px apart. All failed before. |

Suites after the fixes: CLI `ruff`, `ruff format`, `mypy --strict` clean, 1,506 pytest tests pass (1,411 unit, 95 integration against the lab). Viewer: lint, typecheck, 568 Vitest, build and bundle check pass. Playwright: 122 pass in Chromium and Firefox, plus the real-lab launcher test. The review harnesses re-ran green: HTTP 146/146, lifecycle 11/11.

## 5. First-run walkthrough

Timed from spawning `schemamap ui --no-open` to the map tab's `schemamap:layout-done` mark. Playwright drove the browser at machine speed, so a person adds the time it takes to type a server, user and password.

| Run | Database | Input | Link printed | Connect shown | Checks done | Picker shown | Extract done | **Map laid out** |
|---|---|---|--:|--:|--:|--:|--:|--:|
| 1 | AdventureWorks2022 (71 tables) | **keyboard only**: Tab, Space, Enter, typing; 21 Tab presses in all | 0.20 s | 0.33 s | 0.51 s | 0.54 s | 3.86 s | **4.26 s** |
| 2 | SchemaMapSynth (2,000 tables) | mouse | 0.21 s | 0.34 s | 0.45 s | 0.58 s | 11.48 s | **11.79 s** |

- **Keyboard only works end to end.** Skip link first, then the top bar, then Server, Port, User name, Password, Trust (Space), Test connection (Enter), Choose a database, the search box, the radio (Space), Extract map, Open map (Enter opens the new tab). There was no trap and no mouse-only control.
- **Pleasant:** every wait shows what is happening (the spinner on Check, per-section progress and elapsed time on Extract). The link works once and says so plainly in a second tab. After Quit, both the quitting tab and any other tab say what to do next.
- **Rough edges** (all low, filed): "anyway" when all checks passed (#11), the 409 wording in a second tab (#12).

## 6. Visual pass

The 18 frames in `docs/design/launcher/` were rendered in Chromium without the canvas runtime, with the network blocked, so Inter fell back to the system font and the frames show their template placeholders and every conditional block at once. Each was placed beside the matching `viewer/screenshots/launcher/` shot from the e2e suite (12 at 1280 px, 6 at 375 px). The README's mockup-only items were skipped: Trust ticked, the "Prototype: skip to Done" link, the placeholder logo, Google Fonts, the hard-coded Entra methods and `os` tweak, and sample data. So were deviations already decided: no section durations or mockup section names on Extract (D-066), no port on map rows (D-066), "Kept only in this tab until your map is made" for the password hint, and Windows hidden off Windows (D-065).

Real deviations:

| Screen | Deviation | Where now |
|---|---|---|
| All | Header: no icons on Recent maps and Quit; Quit is outlined, not ghost; two rows on phones. | #7 |
| All | Stepper: finished steps use an outline check (frames: filled). | #8 |
| Check | The permissions note had no padding. | Fixed (U7-4) |
| Check | "Choose a database anyway" when all passed (the frames show only the warning state). | #11 |
| Connect | No "See every query it runs" link. | #10 |
| Pick-Empty, Pick-Error | No icon tile above the heading; "How to fix:" on its own line; Pick-Error has no "Technical details". | #9, #10 |
| Extract-Failed | A neutral card with a triangle (frame: red banner, ×, red progress bar). | #8 |
| Done | No success mark, heading outside the card, no icons on Open map and Extract another database, no folder path. | #8 |
| Recent-Delete | Amber confirmation (frame: red tint). | #8 |
| Recent (375 px) | Action buttons touching; a stray rule above the first map. | Fixed (U7-4) |
| Quit | "Running" pill on a stopped server (the frame has it too). | Fixed (U7-3) |

Layout, spacing, type scale, colours of the normal states, copy and the order of actions otherwise match the frames.

## 7. Open issues

| Issue | Severity | Title |
|---|---|---|
| [#7](https://github.com/harshitgupta240197/schemamap/issues/7) | low | Launcher header lacks icons and wraps to two rows on phones |
| [#8](https://github.com/harshitgupta240197/schemamap/issues/8) | low | Error, danger and success states do not use their colours and marks |
| [#9](https://github.com/harshitgupta240197/schemamap/issues/9) | low | "How to fix" layout and state-card icons differ between screens |
| [#10](https://github.com/harshitgupta240197/schemamap/issues/10) | low | Decide on "See every query it runs" and "Technical details" |
| [#11](https://github.com/harshitgupta240197/schemamap/issues/11) | low | Check says "Choose a database anyway" when every check passed |
| [#12](https://github.com/harshitgupta240197/schemamap/issues/12) | low | A second tab's extract during a running one reads as a failure |
| [#13](https://github.com/harshitgupta240197/schemamap/issues/13) | low | `tmp/` can keep an in-flight write until the next start (Windows upload, late job) |
| [#14](https://github.com/harshitgupta240197/schemamap/issues/14) | low | Import validates up to 512 MB unpacked in memory |

## 8. Proposed crumbs

- **U.8 Launcher polish (after the gate):** #7, #8, #9, #11 and #12, each with its test and refreshed screenshots, plus #10 once decided. About one crumb of front-end work, no server change.
- **U.9 Stop and import limits:** #13 (a Windows `ui-smoke` step that quits with an upload in flight, then a fix or the wording), and #14 (measure peak memory for large imports, then pick a cap or a streaming parse, recorded in `docs/PERFORMANCE.md` and a D-entry).
