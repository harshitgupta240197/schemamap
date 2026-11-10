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
