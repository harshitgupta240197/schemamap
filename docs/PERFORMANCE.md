# Viewer performance

What the viewer has to hit, how it is measured, and the numbers. Decisions behind the design are in `docs/DECISIONS.md` (D-047).

## Targets

| What | Target | Test |
| --- | --- | --- |
| 2,000-table snapshot: interactive (layout done and a click responds) | < 3 s | `viewer/e2e/performance.spec.ts` |
| 2,000-table snapshot: search results on screen, slowest keystroke | < 100 ms | same |
| AdventureWorks and WideWorldImporters: laid-out bounding box width/height | 0.6 to 2.5 | same |

## Method

- The built single file (`npm run build`) with the snapshot inlined, opened over `file://` in Playwright's Chromium at 1400×900.
- **2,000 tables** come from `syntheticSnapshot({ tables: 2000, seed: 2000 })` (`viewer/src/testing/synthetic.ts`): 12 schemas, about 1.2 keys per table, about 10% unrelated tables, about 3% cross-schema keys, one 350-table component. Generated at test time; nothing large is committed.
- **Interactive** = the `schemamap:layout-done` mark (time from navigation start until the first layout is on screen) plus the in-page latency of clicking a cluster until the breadcrumb shows it.
- **Search** = the `schemamap:search` measure for each keystroke: from the input change to the results being in the DOM. The test types a full table name and takes the slowest keystroke (the first, which matches the most items).
- **Aspect ratio** = the bounding box of every node on screen after fit view (all nodes are visible then, so the screen box has the layout's shape). Fit-view zoom is read from the React Flow viewport transform.

## Results

### Local: Apple M5, 16 GB, macOS, Node 26.7, Playwright 1.65 Chromium

| Measure | Value |
| --- | --- |
| 2,000 tables: overview layout done | 467 ms |
| 2,000 tables: click response | 17 ms |
| 2,000 tables: **interactive** | **484 ms** |
| 2,000 tables: overview clusters | 115 |
| 2,000 tables: **slowest search keystroke** | **6 ms** |
| AdventureWorks: aspect ratio / fit-view zoom | **1.80** / 0.23 |
| WideWorldImporters: aspect ratio / fit-view zoom | **1.73** / 0.27 |

### CI: GitHub Actions `ubuntu-latest`, viewer job (run 42826636988, commit dc7f71f)

Recorded from the `PERF` lines of the viewer job's Playwright output.

| Measure | Value |
| --- | --- |
| 2,000 tables: overview layout done | 879 ms |
| 2,000 tables: click response | 48 ms |
| 2,000 tables: **interactive** | **926 ms** |
| 2,000 tables: **slowest search keystroke** | **19 ms** |
| AdventureWorks: aspect ratio / fit-view zoom | **1.80** / 0.23 |
| WideWorldImporters: aspect ratio / fit-view zoom | **1.73** / 0.27 |

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
- The real 2,000-table database is sparser than the TypeScript synthetic snapshot (0.4 keys per table against 1.2), so its overview has 290 clusters against 115. That is fast but not readable at fit view (D-047 amendment, `docs/gates/PHASE2.md` P2-1).

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
