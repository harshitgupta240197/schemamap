import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { AW, mapUrl, WWI } from "./helpers";

interface GoldenSnapshot {
  tables: { id: string }[];
  relationships: { edge: string; from_object: string; to_object: string }[];
}

/** Distinct edge ids between two tables, from the golden itself (not hard-coded). */
function expectedEdgeCount(snapshotPath: string = AW): number {
  const golden = JSON.parse(readFileSync(snapshotPath, "utf8")) as GoldenSnapshot;
  const tables = new Set(golden.tables.map((t) => t.id));
  return new Set(
    golden.relationships
      .filter((r) => tables.has(r.from_object) && tables.has(r.to_object))
      .map((r) => r.edge),
  ).size;
}

test("AdventureWorks map lays out in a worker and renders offline over file://", async ({
  page,
}, testInfo) => {
  const external: string[] = [];
  const problems: string[] = [];
  const workers: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (!url.startsWith("file:") && !url.startsWith("data:") && !url.startsWith("blob:")) {
      external.push(url);
    }
  });
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      problems.push(`${msg.type()}: ${msg.text()}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("worker", (worker) => workers.push(worker.url()));

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(mapUrl(testInfo.outputPath("adventureworks.html")));

  const canvas = page.locator(".sm-canvas");
  await expect(canvas).toHaveAttribute("data-layout-status", "done", { timeout: 30_000 });
  expect(workers.length).toBeGreaterThanOrEqual(1);
  expect(workers.every((url) => url.startsWith("blob:"))).toBe(true);

  await expect(page.locator(".react-flow__node")).toHaveCount(71);
  await expect(page.locator(".react-flow__edge")).toHaveCount(expectedEdgeCount());
  await expect(page.locator(".react-flow__minimap")).toBeVisible();
  const fit = page.locator(".react-flow__controls-fitview");
  await expect(fit).toBeVisible();

  // Fit view: after clicking it, every node lies inside the canvas.
  await fit.click();
  await page.waitForTimeout(400);
  const pane = await page.locator(".react-flow").boundingBox();
  if (pane === null) {
    throw new Error("no canvas box");
  }
  const boxes = await page.locator(".react-flow__node").evaluateAll((nodes) =>
    nodes.map((n) => {
      const r = n.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }),
  );
  for (const box of boxes) {
    expect(box.left).toBeGreaterThanOrEqual(pane.x - 1);
    expect(box.top).toBeGreaterThanOrEqual(pane.y - 1);
    expect(box.right).toBeLessThanOrEqual(pane.x + pane.width + 1);
    expect(box.bottom).toBeLessThanOrEqual(pane.y + pane.height + 1);
  }

  expect(external).toEqual([]);
  expect(problems).toEqual([]);
});

test("expanding a table relays out and shows all its columns", async ({ page }, testInfo) => {
  // A focused view, not the full map: the full map fits below the semantic-zoom threshold, where
  // nodes show only their name and the All button is hidden (D-048).
  await page.goto(mapUrl(testInfo.outputPath("expand.html"), "#focus=object%3APerson.Person"));
  const canvas = page.locator(".sm-canvas");
  await expect(canvas).toHaveAttribute("data-layout-status", "done", { timeout: 30_000 });
  await expect(page.locator(".react-flow")).toHaveAttribute("data-compact", "false");
  const button = page.getByRole("button", {
    name: "Show all columns of Person.Person",
    exact: true,
  });
  await button.click();
  await expect(
    page.getByRole("button", { name: "Show key columns only for Person.Person", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(canvas).toHaveAttribute("data-layout-status", "done", { timeout: 30_000 });
  const node = page.locator(".react-flow__node", {
    has: page.getByTitle("Person.Person", { exact: true }),
  });
  await expect(node.getByText("EmailPromotion", { exact: true })).toBeAttached();
});

test("WideWorldImporters map renders every table over file://", async ({ page }, testInfo) => {
  const problems: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      problems.push(`${msg.type()}: ${msg.text()}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(mapUrl(testInfo.outputPath("wideworldimporters.html"), "", WWI));
  await expect(page.locator(".sm-canvas")).toHaveAttribute("data-layout-status", "done", {
    timeout: 30_000,
  });
  await expect(page.locator(".react-flow__node")).toHaveCount(48);
  await expect(page.locator(".react-flow__edge")).toHaveCount(expectedEdgeCount(WWI));
  expect(problems).toEqual([]);
});
