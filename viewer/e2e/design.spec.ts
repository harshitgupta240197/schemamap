import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { mapUrl, settled } from "./helpers";

test("at fit view the compact form is shown and a table name is at least 10 px tall", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(mapUrl(testInfo.outputPath("compact-fit.html")));
  await settled(page);
  await expect(page.locator(".react-flow")).toHaveAttribute("data-compact", "true");

  // Columns are hidden in the compact form; only names are visible.
  await expect(page.locator(".sm-table__columns").first()).toBeHidden();
  const names = page.locator(".react-flow__node-table .sm-table__name");
  const count = await names.count();
  expect(count).toBeGreaterThan(10);
  for (let i = 0; i < count; i++) {
    const box = await names.nth(i).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(10);
  }
});

test("zooming in shows the full node again", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(mapUrl(testInfo.outputPath("full-node.html"), "#focus=object%3APerson.Person"));
  await settled(page);
  await expect(page.locator(".react-flow")).toHaveAttribute("data-compact", "false");
  await expect(page.locator(".sm-table__columns").first()).toBeVisible();
});

test("reduced motion: zoom changes are instant and nothing animates", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(mapUrl(testInfo.outputPath("motion.html"), "#focus=object%3APerson.Person"));
  await settled(page);
  const viewport = page.locator(".react-flow__viewport");
  const transform = (): Promise<string> =>
    viewport.evaluate((element) => getComputedStyle(element).transform);

  const before = await transform();
  await page.getByRole("button", { name: "Zoom In" }).click();
  const right = await transform();
  expect(right).not.toBe(before);
  await page.waitForTimeout(500);
  expect(await transform()).toBe(right);

  // A double click is the other zoom React Flow animates; with reduced motion it is off.
  await page.locator(".react-flow__pane").dblclick({ position: { x: 300, y: 300 } });
  await page.waitForTimeout(500);
  expect(await transform()).toBe(right);

  const animated = await page.evaluate(
    () => document.getAnimations().filter((animation) => animation.playState === "running").length,
  );
  expect(animated).toBe(0);
});

test("the spinner animates normally and stops under reduced motion", async ({ page }) => {
  const css = ["app.css", path.join("ui", "ui.css")]
    .map((file) => readFileSync(path.resolve("src", file), "utf8"))
    .join("\n");
  await page.setContent(`<style>${css}</style><span class="sm-spinner"></span>`);
  const animation = (): Promise<string> =>
    page.locator(".sm-spinner").evaluate((element) => getComputedStyle(element).animationName);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  expect(await animation()).toBe("sm-spin");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await animation()).toBe("none");
});
