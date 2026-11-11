# Phase 2 review: the viewer

Crumb 2.9, 2026-11-11, branch `phase-2-viewer`. Goal: prove the viewer does the four jobs in `docs/PLAN.md`, safely and fast, before Phase 2 merges.

**Verdict.** On every real lab database the map is fast, offline and safe. Every map lays out in under 0.8 s in both browsers, makes no network request in 60 loads, and hostile names stay text. Up to 200 tables, the first two jobs are well served: the map shows the shape, and focus, hops, search and the panel are quick to use. The 2,000-table SchemaMapSynth is the exception. Its overview opens in 0.47 s, but it is **not readable**: 290 cluster boxes, 222 of them with 2 or 3 tables, with names cut to a few letters (P2-1, High). The TypeScript synthetic that the performance and readability tests use gives 115 clusters, so those tests could not catch this. Impact is direct and object-level only (P2-4). Connecting A to B and shareable docs are planned for Phase 3 (3.9, 3.10). A strict, hash-based Content-Security-Policy works in Chromium and Firefox with no change to the viewer, and blocks injected scripts. I propose it as crumb 2.11.

**Decision for Harshit.** Should 2.10 (readable overview) and 2.11 (CSP) run on this branch before the merge and the `v0.1.0-alpha.2` tag, or on their own branch after it? I recommend before. "Fast **and readable** at 2,000 tables" was the goal of 2.5, and the CSP is a small change that makes "no network" provable.

## 1. Real-data results

The real CLI ran on every lab database: `schemamap extract` as `schemamap_reader` with the default lab grants, then `schemamap view --no-open`. Each map was opened 3 times over `file://` in Playwright 1.65 Chromium and Firefox at 1400×900; the table shows the median `schemamap:layout-done` mark. "Drill" is a click on the first overview cluster, timed until its own layout is done. Machine: Apple M5, macOS, Node 26.7; SQL Server 2022 CU27 in Docker (amd64 emulation). The same table is in `docs/PERFORMANCE.md`.

| Database | Tables | FKs | Extract s | Snapshot MB | View s | Map MB | Opens as | Layout ms Chromium | Layout ms Firefox | Drill ms Chr / FF |
| --- | --: | --: | --: | --: | --: | --: | --- | --: | --: | --: |
| AdventureWorks2022 | 71 | 90 | 2.9 | 0.78 | 0.4 | 2.72 | full map | 337 | 551 | – |
| AdventureWorksDW2022 | 31 | 44 | 0.5 | 0.29 | 0.3 | 2.38 | full map | 275 | 452 | – |
| WideWorldImporters | 48 | 98 | 1.9 | 0.85 | 0.4 | 2.86 | full map | 373 | 577 | – |
| SchemaMapEdgeCases | 6 | 2 | 0.4 | 0.02 | 0.2 | 2.21 | full map | 214 | 336 | – |
| SchemaMapEdgeCasesBIN2 | 3 | 1 | 0.4 | 0.01 | 0.3 | 2.20 | full map | 195 | 319 | – |
| SchemaMapEdgeCasesCS | 3 | 1 | 0.4 | 0.01 | 0.3 | 2.20 | full map | 196 | 323 | – |
| SchemaMapSynth200 | 200 | 82 | 1.6 | 1.05 | 0.4 | 2.84 | full map | 337 | 571 | – |
| SchemaMapSynthTest200 | 200 | 79 | 0.9 | 1.03 | 0.4 | 2.83 | full map | 335 | 564 | – |
| SchemaMapSynthPerf500 | 500 | 203 | 1.8 | 2.61 | 0.6 | 3.81 | overview, 73 clusters | 285 | 463 | 78 / 118 |
| **SchemaMapSynth** | **2,000** | 830 | **10.7** | 10.34 | **1.5** | **8.58** | overview, **290 clusters** | **466** | **754** | 124 / 153 |

- **All 10 extractions exited 0** with one warning each (`row_counts`: the reader has no `VIEW DATABASE STATE` by default), and all 10 `view` runs exited 0. `SchemaMapEdgeCasesOther` is the 11th lab database. It exists only as the target of cross-database references, and the reader has no user there, so extract exits 3 with a plain login message. That is by design.
- **Speed is far inside budget.** The 3 s interactive budget is met with about 6× headroom in Chromium and 4× in Firefox. On SchemaMapSynth, drilling into the largest cluster (200 unrelated tables) takes 203 ms. The slowest search keystroke is 12 ms (budget 100 ms).
- **Map size.** The map is the 2.19 MB viewer plus the compact snapshot. At 2,000 tables it is 8.58 MB, against 6.77 MB for the Python-built test snapshot in `test_view_performance.py`. The real one has more SQL text.
- **No console errors or warnings, and no requests other than `file:`, `data:` or `blob:`** in any of the 60 loads.
- **Screenshots** were taken from each map at open, plus the SchemaMapSynth overview and two drills. Following 2.8, they are not committed: the e2e suite's own step screenshots are CI artifacts (`ui-screenshots`). Run the steps in section 1 to reproduce them.

## 2. The four jobs

| Job | Verdict | Evidence |
| --- | --- | --- |
| 1. Show me how this database is shaped, fast | **Good up to 200 tables; fast but not readable at 2,000** | `graph.spec` (AW, WWI render offline), `performance.spec` (aspect ratio 1.80 / 1.73, 2,000-table interactive), `readable.spec` (labels ≥ 10 px, unclipped, distinct), `laptop.spec` (focus keeps full nodes at 1280×720). On real data: AW, WWI and the 200-table databases open as a full map in ≤ 0.6 s with schema stripes. At fit view the labels are compact (often ellipsised), and zooming brings back full nodes. **SchemaMapSynth**: the overview at fit view is a grid of 290 boxes, most labelled like `Ca…e`. Only the nine large clusters (a 34-table component and eight "no relationships" groups) say anything about the shape (P2-1). |
| 2. Tell me how table A connects to table B | **Partial: by browsing** | `flow.spec` and `focus.spec`: search → focus → hops 1 to 3 → breadcrumb back, with the view kept in the hash. You find B by focusing A and raising hops until B appears. The UI focuses one table at a time; two `focus` keys work only in a hand-edited hash. The path finder is planned crumb 3.9, and inferred edges (3.8) matter more here than anything else, because many databases declare few keys. |
| 3. Tell me what breaks if I change this | **Partial: direct, object-level** | `detail.spec` and `flow.spec` ("impact links"): the panel lists incoming and outgoing FKs, "depends on" and "used by", and each link opens that object. Gaps: (a) only one level, so a view built on a view built on a table shows only the first view; (b) no column-level impact, so "Can I drop this column?" (the DBA's question in PLAN.md) is not answered. The snapshot keeps dependencies at object level only (P2-4). |
| 4. Give me documentation I can share without writing it | **Partial: the map file only** | `view.spec` and `built-file.spec`: one offline file, made by one command, with an "About this map" footer (tool version, extraction time, read-only note). The hash reopens the same view, but only in the same file. A colleague needs the file plus the hash, so a link is not a URL anyone can open (P2-5). The data dictionary export is planned crumb 3.10. |

## 3. Security review of the viewer and `view`

| Area | What I checked | Result |
| --- | --- | --- |
| Embedding and escaping | `viewer.py`: an exact placeholder that must occur once, a plain `str.replace`, `<`, `>`, `&`, U+2028 and U+2029 escaped after compact `json.dumps`. Tests: unit tests on the page text, and `view.spec` "hostile names never run script and show as text" on a map made by the real CLI. | **Pass.** No way found to break out. A lone surrogate in a name is refused when the snapshot is read (exit 4), so it never reaches the page. The message is raw Pydantic text with a pydantic.dev URL (P2-6). |
| No raw HTML | The lint rule (`scripts/no-raw-html.mjs`, `src/lint-rule.test.ts`), plus a search of `viewer/src` for `innerHTML`, `dangerouslySetInnerHTML`, `insertAdjacentHTML`, `eval`, `new Function`, `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `importScripts`, `window.open` and assignments to `location` | **Pass.** None in the source; the inline data is read with `textContent`. `check:bundle` keeps `eval(`, `new Function` and `require(` out of the build. |
| URL hash | `viewState.ts` parsing, VIEWER.md "What is ignored", `focus.spec` (hostile hash), `detail.spec` (hostile `select`) | **Pass.** Values are only compared with snapshot ids, never rendered. Bad pairs are dropped, and a `<script>` in a hash creates no element. |
| External requests | 60 loads over 10 real maps in two browsers, plus a static scan of the built file | **None.** The scan found only XML namespace URIs, React error-page strings, the React Flow attribution link (followed only if clicked; P2-7) and Vite's modulepreload polyfill. That polyfill is a `fetch` that can never run: it fetches only `<link rel="modulepreload">` hrefs, and the single file has none. 2.11 removes it. |
| Packaged viewer manifest | `load_viewer` checks sha256 on every `view` and refuses a mismatch; CI runs `check_wheel.py` | **Pass.** The manifest catches a half-built or hand-edited page by accident. It is not a defence against tampering: whoever can edit the package can edit the manifest too, and that is as intended (D-051). |
| Map file | `write_bytes_atomic`, mode 0600, `safe_file_stem`; the help says the map holds definitions | **Pass.** |

### Content-Security-Policy: measured, proposed as 2.11

I added a `<meta http-equiv="Content-Security-Policy">` to copies of the real AdventureWorks and SchemaMapSynth maps and ran open → layout → drill → search → panel in Chromium and Firefox:

```
default-src 'none'; script-src 'sha256-<hash of the one module script>'; style-src 'unsafe-inline';
worker-src blob:; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'
```

- **Works unchanged.** The layout status reached `done` (the ELK worker ran; a blocked worker shows `failed` and a grid), with zero `securitypolicyviolation` events and no console errors, in both browsers. A variant with `script-src 'unsafe-inline'` also works.
- **It defends in depth.** I injected `<script>`, `<img onerror>` and `<img src="https://example.com/…">` into the page. Under the hash policy none of them ran. Chromium failed the image request with `csp`, and Firefox never sent it. Under `'unsafe-inline'` the script and handler ran (only the image was blocked). So a hash, not `'unsafe-inline'`, is what makes an escaping bug harmless.
- **It makes "no network" provable** from the file itself (`connect-src 'none'`, `default-src 'none'`), which supports the "your data never leaves your machine" promise.
- The data script (`type="application/json"`) is not executed, so it needs no hash, and `schemamap view` does not have to recompute anything.

## 4. Documentation consistency

| Document | Finding | Action |
| --- | --- | --- |
| DECISIONS D-051 | The escape list showed literal `<`, `>`, `&` and two invisible line separators instead of `<` … ` ` | **Fixed** |
| DECISIONS D-047 | Says the "no relationships" grouping keeps the overview from being "hundreds of single boxes"; this does not hold on real SchemaMapSynth | **Amendment added** (points to P2-1) |
| ARCHITECTURE.md | Status said the viewer was planned; module list had `export/ (planned) builds the HTML map` (it is `viewer.py`); data flow had `view = infer → export`; no viewer section | **Fixed**: status, `viewer.py` and import rule, data flow, new "The viewer" subsection |
| PERFORMANCE.md | No real-database numbers | **Added** the section 1 table |
| CLAUDE.md | Commands all exist and are correct (`npm run` scripts, `build_viewer.py`, `check_wheel.py`, `gen:types`/`gen:check`); the repo map did not mention `check_wheel.py` | **Fixed** |
| VIEWER.md | Hash format and default view match `viewState.ts` and `level.ts` (including the D-047 exception) | No change |
| DECISIONS D-043 to D-050 | Match the code: generated types, standalone Ajv with inlined helper, lint ban and Blob worker, search and focus, 200-table limit, tokens and zoom, labels, small views | No change. D-050's test note is superseded by the focus.spec change below. |

## 5. Fixes made in this crumb

1. **`focus.spec` counts with the toolbar** (carry-over). Every count now reads the toolbar's `N of 71 tables` line, which is what the user sees, and checks that the minimap shows the same number. The checks are tighter: the full map must read exactly `71 of 71 tables`.
2. **`flow.spec` no longer skips a hop button** (carry-over). The question was why the hop-3 button gets skipped on AdventureWorks. I measured it: it never does. Neither AW (Person.Person: 9, 23, 38 tables) nor WWI (Sales.Orders: 5, 29, 29) comes near the 200-table limit, so hop 3 is always enabled. The `if disabled → continue` branch was dead and would have let a broken button pass. The spec now requires hops 2 and 3 to be enabled and reached on both maps. The disabled case stays covered by the `allowedHops` unit tests in `level.test.ts`.
3. Documentation fixes from section 4.

## 6. Open issues

| ID | Severity | Issue | Where it goes |
| --- | --- | --- | --- |
| P2-1 | **High** | The overview of a real, sparse 2,000-table database is unreadable at fit view: 290 clusters, 222 of them with 2 or 3 tables, labels cut to a few letters. `readable.spec` passes because it measures font size and clipping on the TypeScript synthetic (115 clusters), not usefulness on real data. | **Resolved in 2.10** (D-053): 6 schema boxes with whole names on the real database |
| P2-2 | Medium | The TypeScript synthetic (1.2 keys per table) does not look like the lab's SchemaMapSynth (0.4). Speed and readability are tested only on the denser shape. | **Resolved in 2.10**: a `sparse` synthetic shape; speed, readability and axe now run on both |
| P2-3 | Medium | No CSP, so "no network" and "no script injection" rest on code review and tests alone. | **2.11** (proposed) |
| P2-4 | Medium | Impact is one level and object-level only. No column-level impact, so "Can I drop this column?" is not answered. | **3.10a** (proposed) |
| P2-5 | Low | A view link works only in the same map file at the same path. | 5.1 (README: "send the file, then the link"); revisit with 3.10 |
| P2-6 | Low | A lone surrogate in a snapshot name gives exit 4 with raw Pydantic text and a pydantic.dev URL | 4.2 (carry-over, evidence added) |
| P2-7 | Low | The React Flow attribution is a link to reactflow.dev. It is not a request, only a navigation the user can click. It is kept as the MIT library asks. | Note only |

### Carry-over list

| Item | Placement |
| --- | --- |
| Overview groups clusters into per-schema containers | **Confirmed and raised to High**: it is the core of 2.10 (P2-1) |
| Demo snapshots with a real extraction date | Confirmed: **5.2** |
| Unpaired surrogates in object names | Confirmed: **4.2**. New evidence: `view` refuses at read (exit 4) with an unfriendly message, so it is safe; extract-side behaviour is still untested (P2-6). |
| sdist without the viewer, documented | Confirmed: **4.3**. Measured: `uv_build` packs whatever is on disk, so an sdist carries `viewer_dist/` only when `build_viewer.py` ran first; from a clean checkout it does not, and `view` then exits 1 naming the build script. 4.3 should build the viewer before both the sdist and the wheel, and check both. |
| `focus.spec` asserts the toolbar count, not minimap nodes | **Done in 2.9** (section 5) |
| Why a hop button gets skipped in `flow.spec` on AdventureWorks | **Resolved in 2.9**: it never is; the dead branch is removed (section 5) |

## 7. Proposed crumbs

### 2.10 A readable overview at 2,000 tables
- Model: Opus 5.5 · Effort: high · Mode: plan mode first
- Goal: the overview of a real, sparse 2,000-table database shows its shape at a glance.
- Build:
  - Test first: add a sparse shape to `syntheticSnapshot` (about 0.4 keys per table, many 2- or 3-table components, like `tools/synth.py`). Assert that the overview at fit view at 1400×900 has at most about 40 top-level boxes and that every top-level label is shown whole or with at most a middle ellipsis that keeps 6 or more letters.
  - Per-schema containers: the overview shows one box per schema with its table count, its large components inside, and small components (≤ 3 tables) folded into one "small groups" box per schema. Drilling opens a schema, then a cluster. Keep cluster ids and the `cluster=` hash stable (VIEWER.md compatibility promise); a schema level may need a new key such as `schema-open=`.
  - Run the perf and readable specs on both synthetic shapes; record SchemaMapSynth in PERFORMANCE.md again.
  - Record the decision as an amendment to D-047 or as a new D-0xx.
- Done when:
  - [ ] SchemaMapSynth's overview is readable at fit view (screenshot in the CI artifacts) and still interactive in < 3 s on CI
  - [ ] All checks and CI green
- Commit: `feat(viewer): schema containers for a readable overview`

### 2.11 Content-Security-Policy in the map
- Model: Sonnet 5.5 · Effort: high · Mode: normal
- Goal: the map file itself proves it cannot make network requests or run injected script.
- Build:
  - The viewer build emits `<meta http-equiv="Content-Security-Policy">` with the policy in section 3 and the sha256 of the one module script, computed after bundling (a small Vite plugin, or `tools/build_viewer.py`). No `'unsafe-inline'` for scripts and no `'unsafe-eval'`.
  - Turn off Vite's modulepreload polyfill (`build.modulePreload.polyfill: false`); `check:bundle` also forbids `fetch(`, `XMLHttpRequest`, `WebSocket` and `sendBeacon`.
  - `load_viewer` / `check_wheel.py` check that the CSP meta is present; `embed_snapshot` stays as it is (the JSON data script needs no hash).
  - Playwright: no `securitypolicyviolation` in any spec (add it to the shared watchers); a map with an injected `<script>` and `<img onerror>` runs neither (Chromium and Firefox); the ELK worker still runs (status `done`, not `failed`).
  - Record in DECISIONS.md.
- Done when:
  - [ ] All e2e specs pass with the CSP in place, in both browsers
  - [ ] All checks and CI green
- Commit: `feat(viewer): strict content security policy in the map`

### 3.10a Deeper impact: transitive and column-level
- Model: Opus 5.5 · Effort: high · Mode: plan mode first
- Goal: answer "what breaks if I change this table or column?" in full.
- Build:
  - Extract: keep `referenced_minor_id` from `sys.sql_expression_dependencies` as an optional column target. This is a snapshot format 1.x addition; regenerate the schema and the viewer types.
  - Viewer: an impact list that follows "used by" transitively (cycle-safe, grouped by distance), and a "used by" list for each column in the panel.
  - Golden: AdventureWorks views that read `Person.Person.LastName`.
- Done when:
  - [ ] Tests (unit, integration and e2e) pass, and CI is green
- Commit: `feat(viewer): transitive and column-level impact`

### Additions to planned crumbs

- **4.2 Edge-case sweep.** Unpaired surrogates: what extract writes for a name holding one, and a plain message (no Pydantic text or URL) when `view` or the viewer refuses it (P2-6).
- **4.3 Install experience.** Build the viewer before the sdist as well as the wheel, and check both artifacts carry `viewer_dist/` with a matching manifest.
- **4.4 Performance pass.** Rerun section 1 on the real SchemaMapSynth after 2.10. The extract tables section is still about 80% of extract time (Gate 1).
- **5.1 README.** Explain that a view link opens only in the same map file (P2-5).
- **5.2 Live demo.** Demo snapshots carry a real extraction date (carry-over).

## 8. Checks

Viewer: `lint`, `typecheck`, `test`, `build`, `check:bundle`, and the full Playwright suite (Chromium and Firefox) are green locally. CLI: `ruff`, `ruff format --check`, `mypy --strict` and `pytest` are green. The PR CI results are in the PR.
