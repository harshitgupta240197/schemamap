import { expect, test } from "@playwright/test";
import { launcherPerTest } from "./launcher-server";
import { audit } from "./launcher-stubs";

// "Queries Schema Map runs" (#10) in a real browser, served by the real `schemamap ui`: nothing
// on this page is stubbed, so it shows the .sql files of the installed version.

const current = launcherPerTest();

test("the queries page opens from Connect, filters, copies and passes axe", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(current().url);
  await page.getByRole("button", { name: "See every query it runs" }).first().click();
  await expect(page.getByRole("heading", { name: "Queries Schema Map runs" })).toBeFocused();
  await expect(page.getByText(/These are the only queries this version can send\./)).toContainText(
    "none read your tables. Version ",
  );
  const total = await page.locator(".lc-queries__item").count();
  expect(total).toBeGreaterThan(10);
  await expect(page.getByText(`${String(total)} queries`)).toBeVisible();

  await page.getByRole("searchbox", { name: "Search queries" }).fill("foreign_keys");
  await expect(page.getByRole("heading", { name: "foreign_keys", exact: true })).toBeVisible();
  expect(await page.locator(".lc-queries__item").count()).toBeLessThan(total);
  await page.getByRole("searchbox", { name: "Search queries" }).fill("");

  await page.getByRole("button", { name: "Copy foreign_keys query" }).click();
  await expect(page.getByRole("button", { name: "Copied foreign_keys query" })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const shown = await page
    .locator(".lc-queries__item", { has: page.getByRole("heading", { name: "foreign_keys" }) })
    .locator("pre")
    .innerText();
  expect(copied).toContain("sys.foreign_keys");
  expect(copied.trim()).toBe(shown.trim());
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "Connect to SQL Server" })).toBeVisible();

  await page
    .getByRole("contentinfo")
    .getByRole("button", { name: "See every query it runs" })
    .click();
  await expect(page.getByRole("heading", { name: "Queries Schema Map runs" })).toBeVisible();
  await audit(page, "queries", true);
});
