import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { buildIndexes } from "../src/snapshot/indexes";
import { syntheticSnapshot } from "../src/testing/synthetic";
import { clusterTables } from "../src/view/clusters";
import { foldSchemas } from "../src/view/schemaGroups";
import { mapFile, mapUrl, settled } from "./helpers";

// Axe on the built single file over file://, in both colour schemes. Only serious and critical
// violations fail; every state is also screenshotted into screenshots/ for CI to upload (the
// folder is gitignored, nothing is committed).

const SCREENSHOTS = path.resolve("screenshots");
const SCHEMES = ["light", "dark"] as const;
const BLOCKING = new Set(["serious", "critical"]);

async function audit(page: Page, scheme: string, state: string): Promise<void> {
  mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SCREENSHOTS, `${state}-${scheme}.png`) });
  const { violations } = await new AxeBuilder({ page }).analyze();
  const blocking = violations
    .filter((violation) => BLOCKING.has(violation.impact ?? ""))
    .map((violation) => ({
      rule: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.slice(0, 3).map((node) => node.target.join(" ")),
    }));
  expect(blocking, `${state} (${scheme})`).toEqual([]);
}

async function open(page: Page, scheme: (typeof SCHEMES)[number], url: string): Promise<void> {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto(url);
}

/** Zoom out with the on-screen control until the canvas switches to the compact form. */
async function zoomOutUntilCompact(page: Page): Promise<void> {
  const canvas = page.locator(".react-flow");
  for (let i = 0; i < 20 && (await canvas.getAttribute("data-compact")) !== "true"; i++) {
    await page.getByRole("button", { name: "Zoom Out" }).click();
  }
  await expect(canvas).toHaveAttribute("data-compact", "true");
}

for (const scheme of SCHEMES) {
  test.describe(`axe, ${scheme} theme`, () => {
    test("empty state", async ({ page }) => {
      await open(page, scheme, pathToFileURL(path.resolve("dist", "index.html")).href);
      await expect(
        page.getByRole("heading", { name: "Open a snapshot to see the map" }),
      ).toBeVisible();
      await audit(page, scheme, "empty");
    });

    test("load error", async ({ page }, testInfo: TestInfo) => {
      await open(page, scheme, mapFile(testInfo.outputPath("bad.html"), '{"not":"a snapshot"}'));
      await expect(page.getByRole("alert")).toBeVisible();
      await audit(page, scheme, "load-error");
    });

    test("AdventureWorks full map", async ({ page }, testInfo) => {
      await open(page, scheme, mapUrl(testInfo.outputPath("aw.html")));
      await settled(page);
      await audit(page, scheme, "full-map");
    });

    test("palette open", async ({ page }, testInfo) => {
      await open(page, scheme, mapUrl(testInfo.outputPath("palette.html")));
      await settled(page);
      await page.keyboard.press("/");
      await page.keyboard.type("Person");
      await expect(page.getByRole("option").first()).toBeVisible();
      await audit(page, scheme, "palette");
    });

    test("panel open", async ({ page }, testInfo) => {
      await open(page, scheme, mapUrl(testInfo.outputPath("panel.html")));
      await settled(page);
      await page.keyboard.press("/");
      await page.keyboard.type("Person.Person");
      await page.keyboard.press("Enter");
      await settled(page);
      await expect(page.getByRole("complementary", { name: /Details: / })).toBeVisible();
      await audit(page, scheme, "panel");
    });

    test("2,000-table overview", async ({ page }, testInfo) => {
      const snapshot = syntheticSnapshot({ tables: 2000, seed: 2000 });
      const schemas = foldSchemas(clusterTables(buildIndexes(snapshot))).schemas.length;
      await open(page, scheme, mapFile(testInfo.outputPath("big.html"), JSON.stringify(snapshot)));
      await settled(page);
      await expect(page.locator(".react-flow__node-schema")).toHaveCount(schemas);
      await audit(page, scheme, "overview-2000");
    });

    test("2,000-table schema level", async ({ page }, testInfo) => {
      const snapshot = syntheticSnapshot({ tables: 2000, seed: 2000, shape: "sparse" });
      const dbo = foldSchemas(clusterTables(buildIndexes(snapshot))).schemaById.get("schema:dbo");
      await open(
        page,
        scheme,
        mapFile(
          testInfo.outputPath("schema.html"),
          JSON.stringify(snapshot),
          "#drill=schema%3Adbo",
        ),
      );
      await settled(page);
      await expect(page.locator(".react-flow__node-cluster")).toHaveCount(
        (dbo?.tiles.length ?? 0) + (dbo?.smallGroups.length ?? 0),
      );
      await audit(page, scheme, "schema-2000");
    });

    test("compact zoom", async ({ page }, testInfo) => {
      await open(
        page,
        scheme,
        mapUrl(testInfo.outputPath("compact.html"), "#focus=object%3APerson.Person"),
      );
      await settled(page);
      await zoomOutUntilCompact(page);
      await audit(page, scheme, "compact-zoom");
    });
  });
}
