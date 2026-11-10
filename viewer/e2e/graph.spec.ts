import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

const GOLDEN = path.resolve("..", "cli", "tests", "fixtures", "adventureworks2022.snapshot.json");

interface GoldenSnapshot {
  tables: { id: string }[];
  relationships: { edge: string; from_object: string; to_object: string }[];
}

/** Escape JSON for an inline script, as the export must: `<`, `>`, `&`, U+2028, U+2029. */
function escapeForScript(json: string): string {
  const lineSeparator = String.fromCharCode(0x2028);
  const paragraphSeparator = String.fromCharCode(0x2029);
  return json
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll(lineSeparator, "\\u2028")
    .replaceAll(paragraphSeparator, "\\u2029");
}

/** Write a copy of the built viewer with the golden snapshot inlined, and return its file URL. */
function mapWithGolden(outFile: string): string {
  const html = readFileSync(path.resolve("dist", "index.html"), "utf8");
  const data = `<script type="application/json" id="schemamap-data">${escapeForScript(readFileSync(GOLDEN, "utf8"))}</script>`;
  const marker = "<body>";
  if (!html.includes(marker)) {
    throw new Error("built file has no <body>");
  }
  writeFileSync(outFile, html.replace(marker, `${marker}${data}`));
  return pathToFileURL(outFile).href;
}

/** Distinct edge ids between two tables, from the golden itself (not hard-coded). */
function expectedEdgeCount(): number {
  const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as GoldenSnapshot;
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
  await page.goto(mapWithGolden(testInfo.outputPath("adventureworks.html")));

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
  await page.goto(mapWithGolden(testInfo.outputPath("expand.html")));
  const canvas = page.locator(".sm-canvas");
  await expect(canvas).toHaveAttribute("data-layout-status", "done", { timeout: 30_000 });
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
