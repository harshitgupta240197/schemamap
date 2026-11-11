import { expect, test, type Page } from "@playwright/test";
import { mapUrl, settled } from "./helpers";

// The minimap draws every laid-out table; the canvas draws only those in view, and a focus view
// that does not fit at readable size is panned (D-050).
const nodes = (page: Page) => page.locator(".react-flow__minimap-node");

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
  await expect(nodes(page)).toHaveCount(71);

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
  const oneHop = await nodes(page).count();
  expect(oneHop).toBeGreaterThan(1);
  expect(oneHop).toBeLessThan(71);
  expect(page.url()).toContain("#focus=object%3APerson.Person");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Person.Person");

  await page.getByRole("button", { name: "2", exact: true }).click();
  await expect(page.getByRole("button", { name: "2", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(nodes(page)).not.toHaveCount(oneHop);
  await settled(page);
  const twoHops = await nodes(page).count();
  expect(twoHops).toBeGreaterThan(oneHop);
  expect(page.url()).toContain("hops=2");

  // Reload with the hash restores the view.
  await page.reload();
  await settled(page);
  await expect(nodes(page)).toHaveCount(twoHops);
  await expect(page.getByRole("button", { name: "2", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByRole("button", { name: "Full map" }).click();
  await settled(page);
  await expect(nodes(page)).toHaveCount(71);
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
  expect(await nodes(page).count()).toBeLessThan(71);
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("tables");
});

test("the schema filter narrows the map", async ({ page }, testInfo) => {
  await page.goto(mapUrl(testInfo.outputPath("schema.html")));
  await settled(page);
  await page.getByText("Schemas", { exact: false }).first().click();
  await page.getByRole("checkbox", { name: "HumanResources" }).check();
  await settled(page);
  expect(await nodes(page).count()).toBeLessThan(71);
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
    await expect(nodes(page)).toHaveCount(71);
    await expect(page.locator("script:not([id]):not([type])")).toHaveCount(0);
  }
  expect(problems).toEqual([]);
});
