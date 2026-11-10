import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { buildIndexes } from "../src/snapshot/indexes";
import { syntheticSnapshot } from "../src/testing/synthetic";
import { clusterTables } from "../src/view/clusters";
import { AW, mapFile, mapUrl, settled, WWI } from "./helpers";

// Speed and shape on the built single file over file://. Every number is printed and attached,
// so CI logs carry the runner's figures for docs/PERFORMANCE.md.

const INTERACTIVE_BUDGET_MS = 3000;
const SEARCH_BUDGET_MS = 100;
const VIEWPORT = { width: 1400, height: 900 };

function record(testInfo: TestInfo, name: string, value: number, unit: string): void {
  const description = `${name}: ${value.toFixed(unit === "ms" ? 0 : 2)}${unit === "ms" ? " ms" : ""}`;
  testInfo.annotations.push({ type: "perf", description });
  console.log(`PERF ${testInfo.project.name || "chromium"} ${description}`);
}

/** Fail on console errors, page errors and any request that leaves the machine. */
function watch(page: Page): { problems: string[]; external: string[] } {
  const problems: string[] = [];
  const external: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      problems.push(`${msg.type()}: ${msg.text()}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("request", (req) => {
    const url = req.url();
    if (!url.startsWith("file:") && !url.startsWith("data:") && !url.startsWith("blob:")) {
      external.push(url);
    }
  });
  return { problems, external };
}

test("2,000 tables: the overview is interactive within 3 s and search answers within 100 ms", async ({
  page,
}, testInfo) => {
  const snapshot = syntheticSnapshot({ tables: 2000, seed: 2000 });
  const clustering = clusterTables(buildIndexes(snapshot));
  const { problems, external } = watch(page);
  await page.setViewportSize(VIEWPORT);
  await page.goto(mapFile(testInfo.outputPath("synthetic-2000.html"), JSON.stringify(snapshot)));

  // Overview first: one box per cluster, never 2,000 tables in one layout.
  await settled(page);
  await expect(page.locator(".react-flow__node-cluster")).toHaveCount(clustering.clusters.length);
  await expect(page.locator(".react-flow__node-table")).toHaveCount(0);
  const layoutDone = await page.evaluate(
    () => performance.getEntriesByName("schemamap:layout-done", "mark")[0]?.startTime ?? NaN,
  );

  // A click on a cluster responds when the breadcrumb shows the cluster.
  const first = clustering.clusters[0];
  if (first === undefined) {
    throw new Error("no clusters");
  }
  const clickMs = await page.evaluate(
    async (label) => {
      const node = [...document.querySelectorAll<HTMLElement>(".react-flow__node-cluster")].find(
        (candidate) => candidate.getAttribute("aria-label") === label,
      );
      const crumbs = document.querySelector('nav[aria-label="Breadcrumb"]');
      if (node === undefined || crumbs === null) {
        throw new Error("no cluster node or breadcrumb");
      }
      const start = performance.now();
      node.click();
      await new Promise<void>((resolve) => {
        const check = (): void => {
          if (crumbs.querySelectorAll("li").length > 1) {
            resolve();
          } else {
            requestAnimationFrame(check);
          }
        };
        check();
      });
      return performance.now() - start;
    },
    `Open cluster ${first.name}, ${String(first.tableIds.length)} tables`,
  );
  const interactive = layoutDone + clickMs;
  record(testInfo, "2000 tables: overview layout done", layoutDone, "ms");
  record(testInfo, "2000 tables: click response", clickMs, "ms");
  record(testInfo, "2000 tables: interactive", interactive, "ms");
  record(testInfo, "2000 tables: clusters", clustering.clusters.length, "");
  expect(interactive).toBeLessThan(INTERACTIVE_BUDGET_MS);

  // The drilled cluster lays out on its own; the breadcrumb leads back to the cached overview.
  await settled(page);
  await expect(page.locator(".react-flow__node-table")).toHaveCount(first.tableIds.length);
  const nav = page.getByRole("navigation", { name: "Breadcrumb" });
  await nav.getByRole("button", { name: "Overview" }).click();
  await settled(page);
  await expect(page.locator(".react-flow__node-cluster")).toHaveCount(clustering.clusters.length);

  // Search: every keystroke's results are on screen within the budget.
  await page.keyboard.press("/");
  const input = page.getByRole("combobox");
  await expect(input).toBeFocused();
  const target = (snapshot.tables ?? []).find(
    (table) => clustering.clusterOf.get(table.id) === clustering.clusters[3]?.id,
  );
  if (target === undefined) {
    throw new Error("no search target");
  }
  await page.keyboard.type(target.name);
  await expect(page.getByRole("option").first()).toContainText(target.name);
  const searches = await page.evaluate(() =>
    performance.getEntriesByName("schemamap:search", "measure").map((entry) => entry.duration),
  );
  expect(searches).toHaveLength(target.name.length);
  const slowest = Math.max(...searches);
  record(testInfo, "2000 tables: slowest search keystroke", slowest, "ms");
  expect(slowest).toBeLessThan(SEARCH_BUDGET_MS);

  // Choosing the table drills into its cluster and opens it in the panel.
  await page.keyboard.press("Enter");
  await settled(page);
  const hash = await page.evaluate(() => window.location.hash);
  expect(hash).toContain(`cluster=${encodeURIComponent(clustering.clusters[3]?.id ?? "")}`);
  expect(hash).toContain(`select=${encodeURIComponent(target.id)}`);
  await expect(page.getByRole("complementary")).toBeVisible();
  const chosen = page.locator(".react-flow__node-table.selected");
  await expect(chosen).toHaveCount(1);
  // The chosen table is brought into view, not left wherever fit view puts it.
  await page.waitForTimeout(300);
  const pane = await page.locator(".react-flow").boundingBox();
  const box = await chosen.boundingBox();
  if (pane === null || box === null) {
    throw new Error("no pane or node box");
  }
  expect(box.x).toBeGreaterThanOrEqual(pane.x);
  expect(box.x + box.width).toBeLessThanOrEqual(pane.x + pane.width);
  expect(box.y).toBeGreaterThanOrEqual(pane.y);
  expect(box.y + box.height).toBeLessThanOrEqual(pane.y + pane.height);

  expect(external).toEqual([]);
  expect(problems).toEqual([]);
});

for (const [name, snapshotPath] of [
  ["AdventureWorks", AW],
  ["WideWorldImporters", WWI],
] as const) {
  test(`${name} lays out widescreen: bounding box aspect ratio between 0.6 and 2.5`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(VIEWPORT);
    await page.goto(mapUrl(testInfo.outputPath(`${name}-shape.html`), "", snapshotPath));
    await settled(page);
    await page.locator(".react-flow__controls-fitview").click();
    await page.waitForTimeout(300);
    // After fit view every node is in the viewport, so the screen box has the layout's shape.
    const shape = await page.evaluate(() => {
      const boxes = [...document.querySelectorAll(".react-flow__node")].map((node) =>
        node.getBoundingClientRect(),
      );
      const left = Math.min(...boxes.map((b) => b.left));
      const right = Math.max(...boxes.map((b) => b.right));
      const top = Math.min(...boxes.map((b) => b.top));
      const bottom = Math.max(...boxes.map((b) => b.bottom));
      const viewport = document.querySelector<HTMLElement>(".react-flow__viewport");
      const zoom = Number(/scale\(([0-9.]+)\)/.exec(viewport?.style.transform ?? "")?.[1] ?? NaN);
      return { ratio: (right - left) / (bottom - top), zoom, nodes: boxes.length };
    });
    record(testInfo, `${name}: aspect ratio`, shape.ratio, "");
    record(testInfo, `${name}: fit-view zoom`, shape.zoom, "");
    expect(shape.nodes).toBeGreaterThan(40);
    expect(shape.ratio).toBeGreaterThanOrEqual(0.6);
    expect(shape.ratio).toBeLessThanOrEqual(2.5);
  });
}
