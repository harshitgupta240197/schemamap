import { mkdirSync } from "node:fs";
import path from "node:path";
import { test, type Page } from "@playwright/test";
import { AW, settled, viewWithCli } from "../e2e/helpers";

// Two light-mode screenshots of the real viewer for the landing page, from maps the real CLI made
// (`schemamap view`). Public data only: the AdventureWorks golden snapshot. Raw PNGs go to .site-shots/; tools/site_shots.py optimises them into site/assets/.

const RAW = path.resolve(".site-shots");
const SIZE = { width: 1280, height: 800 };

async function open(page: Page, url: string): Promise<void> {
  await page.setViewportSize(SIZE);
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(url);
  await settled(page);
}

test.beforeAll(() => {
  mkdirSync(RAW, { recursive: true });
});

test("AdventureWorks full map", async ({ page }) => {
  await open(page, viewWithCli(AW, path.join(RAW, "aw.html")));
  await page.screenshot({ path: path.join(RAW, "map.png") });
});

test("detail panel", async ({ page }) => {
  await open(page, viewWithCli(AW, path.join(RAW, "aw-panel.html")));
  await page.keyboard.press("/");
  await page.keyboard.type("Person.Person");
  await page.keyboard.press("Enter");
  await settled(page);
  await page.getByRole("complementary", { name: /Details: / }).waitFor();
  await page.screenshot({ path: path.join(RAW, "detail.png") });
});
