import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const GOLDEN = path.resolve("..", "cli", "tests", "fixtures", "adventureworks2022.snapshot.json");

/** Escape JSON for an inline script, as the export must: `<`, `>`, `&`, U+2028, U+2029. */
function escapeForScript(json: string): string {
  return json
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll(String.fromCharCode(0x2028), "\\u2028")
    .replaceAll(String.fromCharCode(0x2029), "\\u2029");
}

function mapUrl(outFile: string, hash = ""): string {
  const html = readFileSync(path.resolve("dist", "index.html"), "utf8");
  const data = `<script type="application/json" id="schemamap-data">${escapeForScript(readFileSync(GOLDEN, "utf8"))}</script>`;
  writeFileSync(outFile, html.replace("<body>", `<body>${data}`));
  return pathToFileURL(outFile).href + hash;
}

async function settled(page: Page): Promise<void> {
  await expect(page.locator(".sm-canvas")).toHaveAttribute("data-layout-status", "done", {
    timeout: 30_000,
  });
}

const panel = (page: Page) => page.getByRole("complementary");
const nodeNamed = (page: Page, name: string) =>
  page.locator(".react-flow__node", {
    has: page.locator(".sm-table__name", { hasText: new RegExp(`^${name}$`) }),
  });

async function open(page: Page, testInfo: { outputPath: (name: string) => string }, hash = "") {
  const problems: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      problems.push(`${msg.type()}: ${msg.text()}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(mapUrl(testInfo.outputPath("detail.html"), hash));
  await settled(page);
  return problems;
}

test("clicking a node opens the panel with its columns; Escape closes it and returns focus", async ({
  page,
}, testInfo) => {
  const problems = await open(page, testInfo);
  await expect(panel(page)).toHaveCount(0);

  await nodeNamed(page, "SalesOrderHeader").locator(".sm-table__name").click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText("Sales.SalesOrderHeader");
  await expect(panel(page).getByRole("row", { name: /^SalesOrderID int/ })).toBeVisible();
  await expect(
    panel(page)
      .getByRole("row", { name: /^OrderDate datetime/ })
      .getByText("default (getdate())"),
  ).toBeVisible();
  await expect(panel(page).getByText("not available").first()).toBeVisible();
  expect(page.url()).toContain("select=object%3ASales.SalesOrderHeader");

  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  expect(page.url()).not.toContain("select=");
  await expect(
    page.locator(".react-flow__node:focus", { hasText: "SalesOrderHeader" }).first(),
  ).toBeFocused();
  expect(problems).toEqual([]);
});

test("Enter on a focused node opens the panel", async ({ page }, testInfo) => {
  await open(page, testInfo);
  const node = nodeNamed(page, "Customer");
  await node.focus();
  await page.keyboard.press("Enter");
  await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText("Sales.Customer");
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await expect(node).toBeFocused();
});

test("a foreign key link jumps to the other table", async ({ page }, testInfo) => {
  await open(page, testInfo);
  await nodeNamed(page, "SalesOrderHeader").locator(".sm-table__name").click();
  await panel(page).getByRole("button", { name: "Sales.Customer" }).first().click();
  await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText("Sales.Customer");
  expect(page.url()).toContain("select=object%3ASales.Customer");
  await expect(panel(page)).toBeFocused();
});

test("a view found in the palette shows its definition", async ({ page }, testInfo) => {
  await open(page, testInfo);
  await page.keyboard.press("/");
  await page.getByRole("combobox").fill("vEmployee");
  await page.keyboard.press("Enter");
  await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText(
    "HumanResources.vEmployee",
  );
  const definition = panel(page).getByLabel("Definition");
  await expect(definition).toContainText("CREATE VIEW");
  await expect(definition.locator(".sm-sql__keyword").first()).toBeVisible();
});

test("copy works or shows the manual fallback", async ({ page }, testInfo) => {
  await open(page, testInfo, "#select=object%3AHumanResources.vEmployee");
  await panel(page).getByRole("button", { name: "Copy definition" }).click();
  await expect(panel(page).locator(".sm-copy__status").last()).toHaveText(
    /Copied|Press Ctrl\/Cmd\+C/,
  );
});

test("reloading with the hash restores the selection without stealing focus", async ({
  page,
}, testInfo) => {
  await open(page, testInfo);
  await nodeNamed(page, "Customer").locator(".sm-table__name").click();
  await expect(panel(page)).toBeVisible();
  await page.reload();
  await settled(page);
  await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText("Sales.Customer");
  await expect(panel(page)).not.toBeFocused();
});

test("a hostile select in the hash is ignored", async ({ page }, testInfo) => {
  const problems = await open(page, testInfo, "#select=%3Cscript%3Ealert(1)%3C/script%3E");
  await expect(panel(page)).toHaveCount(0);
  expect(problems).toEqual([]);
});
