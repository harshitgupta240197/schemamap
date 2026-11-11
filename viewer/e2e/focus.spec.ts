import { expect, test, type Page } from "@playwright/test";
import { mapUrl, settled } from "./helpers";

// The toolbar's count line ("9 of 71 tables") is what the user reads, so the tests count with it.
// The canvas draws only the nodes in view (a focus view that does not fit at readable size is
// panned, D-050), so it cannot be counted; the minimap draws every laid-out table and must agree.
const count = (page: Page) => page.locator(".sm-toolbar__count");
const minimap = (page: Page) => page.locator(".react-flow__minimap-node");

/** The number of tables the toolbar says are shown, checked against the minimap. */
async function shown(page: Page): Promise<number> {
  const text = (await count(page).textContent()) ?? "";
  const match = /^(\d+) of 71 tables$/.exec(text);
  if (match === null) {
    throw new Error(`unexpected count line: ${text}`);
  }
  const tables = Number(match[1]);
  await expect(minimap(page)).toHaveCount(tables);
  return tables;
}

test("search focuses a table, hops re-lay out, breadcrumb returns, reload restores", async ({
  page,
}, testInfo) => {
  const problems: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      problems.push(`${msg.type()}: ${msg.text()}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(mapUrl(testInfo.outputPath("focus.html")));
  await settled(page);
  await expect(count(page)).toHaveText("71 of 71 tables");
  expect(await shown(page)).toBe(71);

  await page.keyboard.press("/");
  const box = page.getByRole("combobox", { name: "Search tables, views and columns" });
  await expect(box).toBeFocused();

  // `/` inside the input types a slash instead of reopening or closing anything.
  await box.fill("sales");
  await page.keyboard.press("/");
  await expect(box).toHaveValue("sales/");
  await box.fill("Person.Person");
  await expect(page.getByRole("option").first()).toContainText("Person");
  await page.keyboard.press("Enter");
  await expect(box).toHaveCount(0);

  await settled(page);
  const oneHop = await shown(page);
  expect(oneHop).toBeGreaterThan(1);
  expect(oneHop).toBeLessThan(71);
  expect(page.url()).toContain("#focus=object%3APerson.Person");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Person.Person");

  await page.getByRole("button", { name: "2", exact: true }).click();
  await expect(page.getByRole("button", { name: "2", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(count(page)).not.toHaveText(`${String(oneHop)} of 71 tables`);
  await settled(page);
  const twoHops = await shown(page);
  expect(twoHops).toBeGreaterThan(oneHop);
  expect(page.url()).toContain("hops=2");

  // Reload with the hash restores the view.
  await page.reload();
  await settled(page);
  await expect(count(page)).toHaveText(`${String(twoHops)} of 71 tables`);
  expect(await shown(page)).toBe(twoHops);
  await expect(page.getByRole("button", { name: "2", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByRole("button", { name: "Full map" }).click();
  await settled(page);
  await expect(count(page)).toHaveText("71 of 71 tables");
  expect(page.url()).not.toContain("#focus");
  expect(problems).toEqual([]);
});

test("Ctrl+K opens the palette and Escape closes it", async ({ page }, testInfo) => {
  await page.goto(mapUrl(testInfo.outputPath("ctrlk.html")));
  await settled(page);
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("combobox")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("combobox")).toHaveCount(0);
});

test("a view focuses the tables it reads", async ({ page }, testInfo) => {
  await page.goto(mapUrl(testInfo.outputPath("view.html")));
  await settled(page);
  await page.keyboard.press("/");
  await page.getByRole("combobox").fill("vEmployee");
  await expect(page.getByRole("option").first()).toContainText("View");
  await page.keyboard.press("Enter");
  await settled(page);
  expect(await shown(page)).toBeLessThan(71);
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("tables");
});

test("the schema filter narrows the map", async ({ page }, testInfo) => {
  await page.goto(mapUrl(testInfo.outputPath("schema.html")));
  await settled(page);
  await page.getByText("Schemas", { exact: false }).first().click();
  await page.getByRole("checkbox", { name: "HumanResources" }).check();
  await settled(page);
  expect(await shown(page)).toBeLessThan(71);
  expect(page.url()).toContain("schema=schema%3AHumanResources");
});

test("a hostile or unknown hash is ignored", async ({ page }, testInfo) => {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("dialog", (dialog) => {
    problems.push(`dialog: ${dialog.message()}`);
    void dialog.dismiss();
  });
  for (const hash of [
    "#focus=%3Cscript%3Ealert(1)%3C/script%3E",
    "#focus=object%3Anope&hops=7",
    "#%",
  ]) {
    await page.goto(mapUrl(testInfo.outputPath("hostile.html"), hash));
    await settled(page);
    await expect(count(page)).toHaveText("71 of 71 tables");
    expect(await shown(page)).toBe(71);
    await expect(page.locator("script:not([id]):not([type])")).toHaveCount(0);
  }
  expect(problems).toEqual([]);
});
