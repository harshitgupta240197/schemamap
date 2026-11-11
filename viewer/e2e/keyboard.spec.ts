import { expect, test, type Page } from "@playwright/test";
import { mapUrl, settled } from "./helpers";

// No mouse anywhere in this file: every step is a key press.

/** Tab (or Shift+Tab) until the focused element matches `selector`; fail after `limit` presses. */
async function tabTo(
  page: Page,
  selector: string,
  options: { backwards?: boolean; limit?: number } = {},
): Promise<void> {
  const { backwards = false, limit = 400 } = options;
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press(backwards ? "Shift+Tab" : "Tab");
    const hit = await page.evaluate(
      (css) => document.activeElement?.matches(css) ?? false,
      selector,
    );
    if (hit) {
      return;
    }
  }
  throw new Error(`Tab never reached ${selector} after ${String(limit)} presses`);
}

async function focusedDescription(page: Page): Promise<string> {
  return page.evaluate(() => {
    const active = document.activeElement;
    return active === null || active === document.body ? "body" : active.outerHTML.slice(0, 120);
  });
}

test("keyboard only: search, open a table, follow an FK, Esc, breadcrumb back", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(mapUrl(testInfo.outputPath("kb.html")));
  await settled(page);

  // Open the palette, search, open the table.
  await page.keyboard.press("/");
  const box = page.getByRole("combobox", { name: "Search tables, views and columns" });
  await expect(box).toBeFocused();
  await page.keyboard.type("Person.Person");
  await page.keyboard.press("Enter");
  await settled(page);

  // The panel's heading took focus.
  const panel = page.getByRole("complementary", { name: "Details: Person.Person" });
  await expect(panel.getByRole("heading", { level: 2, name: "Person.Person" })).toBeFocused();

  // Follow a foreign-key link inside the panel.
  await tabTo(page, ".sm-detail .sm-link");
  const link = await page.evaluate(() => document.activeElement?.textContent ?? "");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("complementary", { name: /^Details: / })).not.toHaveAccessibleName(
    "Details: Person.Person",
  );
  expect(link).not.toBe("");
  expect(page.url()).toContain("select=");

  // Esc closes the panel and focus is somewhere real, not the page body.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("complementary")).toHaveCount(0);
  await expect.poll(() => focusedDescription(page)).not.toBe("body");

  // Back to the full map through the breadcrumb.
  await tabTo(page, ".sm-toolbar__crumbs button", {
    backwards: true,
  });
  await page.keyboard.press("Enter");
  await settled(page);
  expect(page.url()).not.toContain("focus=");
  // Focus moved to the current crumb instead of being lost with the clicked button.
  await expect(page.locator('.sm-toolbar__crumbs [aria-current="page"]')).toBeFocused();
});

test("arrow keys move between nodes, Enter opens one, Esc closes the panel", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(mapUrl(testInfo.outputPath("arrows.html"), "#focus=object%3APerson.Person"));
  await settled(page);

  await tabTo(page, ".react-flow__node");
  const first = await page.evaluate(() => document.activeElement?.getAttribute("data-id"));
  let moved = false;
  for (const key of ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"]) {
    await page.keyboard.press(key);
    const now = await page.evaluate(() => document.activeElement?.getAttribute("data-id"));
    if (now !== null && now !== first) {
      moved = true;
      break;
    }
  }
  expect(moved).toBe(true);

  await page.keyboard.press("Enter");
  await expect(page.getByRole("complementary")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("complementary")).toHaveCount(0);
  await expect.poll(() => focusedDescription(page)).not.toBe("body");
});

test("every control shows a visible focus ring", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto(mapUrl(testInfo.outputPath("ring.html")));
  await settled(page);
  const seen = new Set<string>();
  for (let i = 0; i < 90; i++) {
    await page.keyboard.press("Tab");
    const ring = await page.evaluate(() => {
      const active = document.activeElement;
      if (active === null || active === document.body) {
        return null;
      }
      const style = getComputedStyle(active);
      const visible = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2;
      return `${active.tagName}.${active.className}:${String(visible)}`;
    });
    if (ring !== null) {
      seen.add(ring);
    }
  }
  const missing = [...seen].filter((entry) => entry.endsWith(":false"));
  expect(missing).toEqual([]);
  expect(seen.size).toBeGreaterThanOrEqual(5);
});
