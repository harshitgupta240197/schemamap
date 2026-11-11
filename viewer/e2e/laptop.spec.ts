import { expect, test, type Page } from "@playwright/test";
import { buildIndexes } from "../src/snapshot/indexes";
import { syntheticSnapshot } from "../src/testing/synthetic";
import { clusterTables } from "../src/view/clusters";
import { SMALL_VIEW_TABLES } from "../src/graph/zoom";
import { mapFile, mapUrl, settled } from "./helpers";

const LAPTOPS = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
];

/** Whether the React Flow element is in its compact form, and the focused node's box. */
async function state(page: Page, title: string) {
  await expect(page.locator(".react-flow")).toHaveAttribute("data-compact", "false");
  const node = page.locator(".react-flow__node", { has: page.getByTitle(title, { exact: true }) });
  const box = await node.boundingBox();
  const canvas = await page.locator(".sm-canvas").boundingBox();
  return { box, canvas, rows: await node.locator(".sm-table__columns li").count() };
}

for (const size of LAPTOPS) {
  for (const hops of [1, 2]) {
    test(`${String(size.width)}x${String(size.height)}: focus Person.Person at ${String(hops)} hops shows full nodes`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(size);
      await page.goto(
        mapUrl(
          testInfo.outputPath("laptop.html"),
          `#focus=object%3APerson.Person&hops=${String(hops)}`,
        ),
      );
      await settled(page);
      const { box, canvas, rows } = await state(page, "Person.Person");
      expect(rows).toBeGreaterThan(0);
      expect(box).not.toBeNull();
      expect(canvas).not.toBeNull();
      if (box === null || canvas === null) {
        return;
      }
      expect(box.x).toBeGreaterThanOrEqual(canvas.x);
      expect(box.y).toBeGreaterThanOrEqual(canvas.y);
      expect(box.x + box.width).toBeLessThanOrEqual(canvas.x + canvas.width);
      expect(box.y + box.height).toBeLessThanOrEqual(canvas.y + canvas.height);
    });
  }
}

test("drilling into a small cluster of the 2,000-table snapshot shows full nodes", async ({
  page,
}, testInfo) => {
  const snapshot = syntheticSnapshot({ tables: 2000, seed: 2000 });
  const small = clusterTables(buildIndexes(snapshot)).clusters.find(
    (cluster) => cluster.tableIds.length >= 5 && cluster.tableIds.length <= SMALL_VIEW_TABLES,
  );
  expect(small).toBeDefined();
  await page.setViewportSize(LAPTOPS[0] ?? { width: 1280, height: 720 });
  await page.goto(
    mapFile(
      testInfo.outputPath("drill.html"),
      JSON.stringify(snapshot),
      `#cluster=${encodeURIComponent(small?.id ?? "")}`,
    ),
  );
  await settled(page);
  await expect(page.locator(".react-flow")).toHaveAttribute("data-compact", "false");
  await expect(page.locator(".sm-table__columns").first()).toBeVisible();
});
