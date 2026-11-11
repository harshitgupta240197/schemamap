# Viewer performance

What the viewer has to hit, how it is measured, and the numbers. Decisions behind the design are in `docs/DECISIONS.md` (D-047, D-053).

## Targets

| What | Target | Test |
| --- | --- | --- |
| 2,000-table snapshot, dense and sparse: interactive (layout done and a click responds) | < 3 s | `viewer/e2e/performance.spec.ts` |
| 2,000-table snapshot, dense and sparse: search results on screen, slowest keystroke | < 100 ms | same |
| 2,000-table snapshot, dense and sparse, at fit view: top-level boxes; names whole or kept to 6+ letters, ≥ 10 px, all different | ≤ 40 | `viewer/e2e/overview.spec.ts` |
| AdventureWorks and WideWorldImporters: laid-out bounding box width/height | 0.6 to 2.5 | same |

## Method

- The built single file (`npm run build`) with the snapshot inlined, opened over `file://` in Playwright's Chromium at 1400×900.
- **2,000 tables** come from `syntheticSnapshot({ tables: 2000, seed: 2000, shape })` (`viewer/src/testing/synthetic.ts`), generated at test time, so nothing large is committed.
  - **Dense:** 12 schemas, about 1.2 keys per table, about 10% unrelated tables, about 3% cross-schema keys, one 350-table component.
  - **Sparse:** after `tools/synth.py`. Six schemas, 0.41 declared keys per table, 287 clusters of which 221 hold 2 or 3 tables. The lab's SchemaMapSynth has 0.42, 290 and 222.
- **Interactive** = the `schemamap:layout-done` mark (time from navigation start until the first layout is on screen) plus the in-page latency of clicking the largest schema's box until the breadcrumb shows it.
- **Search** = the `schemamap:search` measure for each keystroke: from the input change to the results being in the DOM. The test types a full table name and takes the slowest keystroke (the first, which matches the most items).
- **Aspect ratio** = the bounding box of every node on screen after fit view (all nodes are visible then, so the screen box has the layout's shape). Fit-view zoom is read from the React Flow viewport transform.

## Results

### Local: Apple M5, 16 GB, macOS, Node 26.7, Playwright 1.65 Chromium (crumb 2.10)

| Measure | Dense | Sparse |
| --- | --: | --: |
| 2,000 tables: overview layout done | 193 ms | 184 ms |
| 2,000 tables: click response | 11 ms | 15 ms |
| 2,000 tables: **interactive** | **204 ms** | **199 ms** |
| 2,000 tables: overview boxes (schemas) | 12 | 6 |
| 2,000 tables: **slowest search keystroke** | **8 ms** | **8 ms** |

| Measure | Value |
| --- | --- |
| AdventureWorks: aspect ratio / fit-view zoom | **1.68** / 0.20 |
| WideWorldImporters: aspect ratio / fit-view zoom | **1.68** / 0.22 |

Before 2.10 (one box per cluster), the dense overview had 115 boxes and its layout was done at 467 ms. Schema containers are packed on the main thread instead of laid out by ELK (D-053), so the first layout is faster.

### CI: GitHub Actions `ubuntu-latest`, viewer job (run 43019358060, commit 8ba7763, crumb 2.10)

Recorded from the `PERF` lines of the viewer job's Playwright output.

| Measure | Dense | Sparse |
| --- | --: | --: |
| 2,000 tables: overview layout done | 392 ms | 396 ms |
| 2,000 tables: click response | 27 ms | 30 ms |
| 2,000 tables: **interactive** | **419 ms** | **426 ms** |
| 2,000 tables: **slowest search keystroke** | **20 ms** | **23 ms** |

| Measure | Value |
| --- | --- |
| AdventureWorks: aspect ratio / fit-view zoom | **1.68** / 0.20 |
| WideWorldImporters: aspect ratio / fit-view zoom | **1.68** / 0.22 |

Before 2.10 (run 42826636988, commit dc7f71f, dense only), the overview layout was done at 879 ms and the interactive total was 926 ms.

## Real lab databases (crumb 2.9)

Every lab database the reader can open, run through the real CLI: `schemamap extract` as `schemamap_reader` (default lab grants, so row counts were skipped with one warning), then `schemamap view --no-open`. Each map was opened three times over `file://` in Playwright 1.65's Chromium and Firefox at 1400×900; the table shows the median `schemamap:layout-done` mark. "Drill" is a click on the first overview cluster until its own layout is done. Extract and view times are wall time, including `uv run` and Python start-up. Apple M5, macOS, Node 26.7, SQL Server 2022 CU27 in Docker (amd64 emulation).

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

- On SchemaMapSynth, drilling into the largest cluster (200 tables, no relationships) takes 203 ms including its layout, and the slowest search keystroke is 12 ms (Chromium).
- 60 page loads, 0 requests other than `file:`, `data:` or `blob:`, and 0 console errors or warnings.
- `SchemaMapEdgeCasesOther` is not in the table: it exists only as the target of cross-database references, and the reader login has no user there, so extract exits 3 with a clear login message (as designed).
- The real 2,000-table database is sparser than the TypeScript synthetic snapshot (0.4 keys per table against 1.2), so its overview has 290 clusters against 115. That is fast but not readable at fit view (D-047 amendment, `docs/gates/PHASE2.md` P2-1). Crumb 2.10 fixes it; see below.

## Real SchemaMapSynth with schema containers (crumb 2.10)

The same method as above, on today's build:
- `schemamap extract` as `schemamap_reader`: 10.1 s, 2,000 tables, 830 keys, one `row_counts` warning.
- `schemamap view --no-open`: 1.6 s, map 8.60 MB.
- The map was opened three times in each browser at 1400×900.
- "Drill" is a click on the largest schema's box until its boxes have laid out.

| Measure | Chromium | Firefox |
| --- | --: | --: |
| Overview layout done (median of 3) | 107 ms | 186 ms |
| Drill into `dbo` (719 tables), median of 3 | 112 ms | 169 ms |
| Slowest search keystroke ("Customer") | 7 ms | 10 ms |
| Top-level boxes at fit view | 6 | 6 |
| Fit-view zoom | 0.64 | 0.64 |

- **Boxes and labels at fit view:**

  | Box | Count line |
  | --- | --- |
  | `dbo` | 719 tables · 105 clusters |
  | `dw` | 374 tables · 53 clusters |
  | `finance` | 226 tables · 34 clusters |
  | `hr` | 213 tables · 28 clusters |
  | `inventory` | 235 tables · 36 clusters |
  | `sales` | 233 tables · 34 clusters |

  Every name is whole, at 18 px on screen.
- **Sample tiles:**
  - `dbo`: EnrollmentType 34, ServerLog 25, VehicleLevel 15, …, +14 clusters 58, Small groups 184, No relationships (1 of 2) 200.
  - `dw`: factGuestSnapshot 5, factMessage 4, …, Small groups 97.
- **`dbo`'s level:** 25 boxes, made of 22 clusters of 4 to 34 tables, two "no relationships" parts of 200 and 165, and one small-groups box ("Open dbo · small groups, 184 tables in 81 groups").
- **Before and after:** 290 boxes with labels like `Ca…e` became 6 named boxes. Layout went from 466 ms to 107 ms in Chromium.
- The screenshot is not committed; the CI artifact `ui-screenshots` carries `overview-sparse-2000.png` from the sparse synthetic.

## Map file (`schemamap view`)

`cli/tests/test_view_performance.py` embeds a seeded 2,000-table snapshot built in Python (`cli/tests/snapshot_builders.py`: 12 schemas, 2,012 foreign keys, 400 views with definitions) and fails above 2 s. The map is the packaged viewer plus the snapshot JSON, so its size is the viewer's 2.19 MB plus the data.

| Measure | Value (Apple M5, macOS, Python 3.13) |
| --- | --- |
| Embed 2,000 tables (`embed_snapshot`) | 0.13 s |
| Whole `schemamap view` run, 2,000 tables (read, validate, embed, write) | 1.4 s |
| Snapshot JSON on disk | 7.3 MB |
| Inline data in the map | 4.58 MB (compact JSON, no indentation) |
| **Map file, 2,000 tables** | **6.77 MB** |
| Map file, AdventureWorks | 2.72 MB |

## Layout measurements behind the limit

elkjs 0.12 `layered` in Node on the same machine, viewer options, synthetic FK trees (one key per table plus extra keys) and the two golden snapshots.

Aspect ratio (width/height) by layering strategy:

| Graph | Default (network simplex) | Minimum width |
| --- | --- | --- |
| AdventureWorks (71 tables) | 1.01 | 1.66 |
| WideWorldImporters (48) | 1.60 | 1.73 |
| Synthetic tree, 100 | 0.61 | 1.77 |
| Synthetic tree, 250 | 0.29 (tall strip) | 1.76 |

Minimum-width layering time by size (denser graphs, about 1.5 keys per table):

| Tables | Time |
| --- | --- |
| 150 | 0.39 s |
| 200 | 0.72 s |
| 300 | 2.0 s |
| 400 | 5.6 s |

The default layering takes 1.6 s at 800 tables but lays fan-outs out as tall strips. So minimum width is used up to the 200-table layout limit and the default beyond it.
