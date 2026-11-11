import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { buildIndexes } from "../src/snapshot/indexes";
import { syntheticSnapshot } from "../src/testing/synthetic";
import { clusterTables } from "../src/view/clusters";
import { foldSchemas } from "../src/view/schemaGroups";
import { labels, mapFile, settled } from "./helpers";

// The overview of a 2,000-table database must show its shape at a glance (crumb 2.10, D-053):
// a handful of schema boxes whose names can be read at fit view, on the dense synthetic and on
// the sparse one that looks like the lab's SchemaMapSynth.

const SCREENSHOTS = path.resolve("screenshots");
const VIEWPORT = { width: 1400, height: 900 };
const MAX_TOP_LEVEL_BOXES = 40;
const MIN_KEPT_LETTERS = 6;

/** Letters (any script) in a label. */
function letters(text: string): number {
  return [...text.matchAll(/\p{L}/gu)].length;
}

for (const shape of ["dense", "sparse"] as const) {
  const snapshot = syntheticSnapshot({ tables: 2000, seed: 2000, shape });
  const json = JSON.stringify(snapshot);
  const folding = foldSchemas(clusterTables(buildIndexes(snapshot)));

  test(`${shape} 2,000 tables at fit view: few top-level boxes, every label whole or kept to ${String(MIN_KEPT_LETTERS)}+ letters`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(VIEWPORT);
    await page.goto(mapFile(testInfo.outputPath(`overview-${shape}.html`), json));
    await settled(page);
    await page.locator(".react-flow__controls-fitview").click();
    await page.waitForTimeout(300);

    const boxes = page.locator(".react-flow__node");
    await expect(boxes).toHaveCount(folding.schemas.length);
    expect(await boxes.count()).toBeLessThanOrEqual(MAX_TOP_LEVEL_BOXES);
    await expect(page.locator(".react-flow__node-schema")).toHaveCount(folding.schemas.length);

    const found = await labels(page, "schema");
    expect(found).toHaveLength(folding.schemas.length);
    expect(found.map((label) => label.full).sort()).toEqual(
      folding.schemas.map((schema) => schema.schemaName).sort(),
    );
    const cut = found.filter(
      (label) =>
        label.name !== label.full &&
        !(label.name.includes("…") && letters(label.name) >= MIN_KEPT_LETTERS),
    );
    expect(cut.map((label) => `${label.full} → ${label.name}`)).toEqual([]);
    expect(new Set(found.map((label) => label.name)).size).toBe(found.length);
    expect(found.filter((label) => label.screenPx < 10).map((label) => label.text)).toEqual([]);
    expect(found.filter((label) => label.clipped).map((label) => label.text)).toEqual([]);
    // Every box says how many tables it holds.
    for (const label of found) {
      expect(label.text).toMatch(/^\d+ tables? · \d+ clusters? \/ /);
    }

    if (shape === "sparse") {
      mkdirSync(SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SCREENSHOTS, "overview-sparse-2000.png") });
    }
  });

  test(`${shape} 2,000 tables: schema → cluster or small group → tables, and back`, async ({
    page,
  }, testInfo) => {
    const largest = [...folding.schemas].sort((a, b) => b.tableCount - a.tableCount)[0];
    const group = largest?.smallGroups[0];
    const cluster = largest?.tiles[0];
    if (largest === undefined || cluster === undefined) {
      throw new Error("no large schema");
    }
    await page.setViewportSize(VIEWPORT);
    await page.goto(mapFile(testInfo.outputPath(`drill-${shape}.html`), json));
    await settled(page);
    const nav = page.getByRole("navigation", { name: "Breadcrumb" });

    await page
      .getByLabel(`Open schema ${largest.schemaName}, ${String(largest.tableCount)} tables`, {
        exact: true,
      })
      .click();
    await settled(page);
    expect(await page.evaluate(() => window.location.hash)).toBe(
      `#drill=${encodeURIComponent(largest.schemaId)}`,
    );
    await expect(nav.locator('[aria-current="page"]')).toHaveText(largest.schemaName);
    await expect(page.locator(".react-flow__node-cluster")).toHaveCount(
      largest.tiles.length + largest.smallGroups.length,
    );

    // Into a small group when the schema has one, else into its largest cluster.
    const into =
      group === undefined
        ? {
            name: `Open cluster ${cluster.name}, ${String(cluster.tableIds.length)} tables`,
            crumb: cluster.name,
            tables: cluster.tableIds.length,
            hash: `#cluster=${encodeURIComponent(cluster.id)}`,
          }
        : {
            name: `Open ${group.name}, ${String(group.tableIds.length)} tables in ${String(group.clusterIds.length)} groups`,
            crumb: group.name,
            tables: group.tableIds.length,
            hash: `#group=${encodeURIComponent(group.id)}`,
          };
    await page.getByLabel(into.name, { exact: true }).click();
    await settled(page);
    expect(await page.evaluate(() => window.location.hash)).toBe(into.hash);
    await expect(page.locator(".react-flow__node-table")).toHaveCount(into.tables);
    await expect(nav.locator('[aria-current="page"]')).toHaveText(into.crumb);

    await nav.getByRole("button", { name: largest.schemaName, exact: true }).click();
    await settled(page);
    await expect(page.locator(".react-flow__node-cluster")).toHaveCount(
      largest.tiles.length + largest.smallGroups.length,
    );
    await nav.getByRole("button", { name: "Overview" }).click();
    await settled(page);
    await expect(page.locator(".react-flow__node-schema")).toHaveCount(folding.schemas.length);
  });

  test(`${shape} 2,000 tables: the keyboard moves between schema boxes and Enter opens one`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(VIEWPORT);
    await page.goto(mapFile(testInfo.outputPath(`keys-${shape}.html`), json));
    await settled(page);
    const first = page.locator(".react-flow__node-schema").first();
    await first.focus();
    const name = (await first.getAttribute("aria-label")) ?? "";
    expect(name).toMatch(/^Open schema /);
    await page.keyboard.press("Enter");
    await settled(page);
    expect(await page.evaluate(() => window.location.hash)).toMatch(/^#drill=schema%3A/);
  });
}
