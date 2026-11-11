import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { AW, HOSTILE, settled, viewWithCli } from "./helpers";

// These specs open maps written by the real `schemamap view` (Python), not by a test helper,
// so the escaping the CLI does is what is proven here.

const DATA = '<script type="application/json" id="schemamap-data">';

/** The JSON the page carries, parsed by the browser the way the viewer reads it. */
async function inlineJson(page: Page): Promise<unknown> {
  return page.evaluate(() => {
    const element = document.getElementById("schemamap-data");
    return element === null ? null : (JSON.parse(element.textContent) as unknown);
  });
}

/** How many <script> elements the unmodified build has once parsed (the baseline). */
async function builtScriptCount(page: Page): Promise<number> {
  await page.goto(pathToFileURL(path.resolve("dist", "index.html")).href);
  return page.evaluate(() => document.scripts.length);
}

test("hostile names never run script and show as text", async ({ page }, testInfo) => {
  const dialogs: string[] = [];
  const errors: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const baselineScripts = await builtScriptCount(page);

  const out = testInfo.outputPath("hostile-map.html");
  const url = viewWithCli(HOSTILE, out);

  // The data element holds no character that could end it or open a comment.
  const html = readFileSync(out, "utf8");
  const start = html.indexOf(DATA) + DATA.length;
  const data = html.slice(start, html.indexOf("</script>", start));
  expect(html.split(DATA)).toHaveLength(2);
  for (const char of ["<", ">", "&", " ", " "]) {
    expect(data.includes(char)).toBe(false);
  }

  await page.goto(url);
  await settled(page);

  // No dialog, no page error, and nothing the names tried to create exists.
  expect(dialogs).toEqual([]);
  expect(errors).toEqual([]);
  await expect(page.locator("img[src='x'], svg[onload]")).toHaveCount(0);
  expect(await page.evaluate(() => document.scripts.length)).toBe(baselineScripts);

  // The names are on screen as text.
  const shown = (await page.locator(".react-flow__node-table").allTextContents()).join("\n");
  expect(shown).toContain("<!--");
  expect(shown).toContain("]]>");
  expect(shown).toContain("Orders");

  // The browser parses the inline JSON to exactly the source snapshot.
  const source: unknown = JSON.parse(readFileSync(HOSTILE, "utf8"));
  expect(await inlineJson(page)).toEqual(source);
});

test("the AdventureWorks map opens over file:// and lays out", async ({ page }, testInfo) => {
  const external: string[] = [];
  // Local schemes only: the layout worker is a blob: URL made by the page itself.
  const local = ["file://", "data:", "blob:"];
  page.on("request", (request) => {
    if (!local.some((scheme) => request.url().startsWith(scheme))) {
      external.push(request.url());
    }
  });
  const url = viewWithCli(AW, testInfo.outputPath("aw-map.html"));
  expect(url.startsWith("file://")).toBe(true);
  await page.goto(url);
  await settled(page);
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  expect(external).toEqual([]);
  const source: unknown = JSON.parse(readFileSync(AW, "utf8"));
  expect(await inlineJson(page)).toEqual(source);
});
