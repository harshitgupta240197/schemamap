import { pathToFileURL } from "node:url";
import path from "node:path";
import { expect, test } from "@playwright/test";

test("built file renders over file:// with no network requests", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (req) => {
    if (!req.url().startsWith("file://") && !req.url().startsWith("data:")) {
      external.push(req.url());
    }
  });
  await page.goto(pathToFileURL(path.resolve("dist", "index.html")).href);
  await expect(page.getByRole("heading", { name: "Schema Map" })).toBeVisible();
  expect(external).toEqual([]);
});
