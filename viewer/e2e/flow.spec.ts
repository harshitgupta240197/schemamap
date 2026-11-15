import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { FLOW_MAPS, flowUrl, type FlowMap } from "./flow-maps";
import { settled, watchViolations } from "./helpers";

// The main flows as a user meets them: maps made by the real `schemamap view`, opened over
// file:// at the default 1280x720 viewport. Each step is screenshotted into screenshots/flow/
// for CI to upload (gitignored, never committed).

const SHOTS = path.resolve("screenshots", "flow");
const nodes = (page: Page) => page.locator(".react-flow__minimap-node");
const panel = (page: Page) => page.getByRole("complementary");
const searchBox = (page: Page) =>
  page.getByRole("combobox", { name: "Search tables, views and columns" });

async function shot(page: Page, map: FlowMap, step: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${map.name}-${step}.png`) });
}

/** Collect console problems, page errors and CSP violations for the whole flow. */
async function watch(page: Page): Promise<string[]> {
  const problems: string[] = [];
  await watchViolations(page, problems);
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      problems.push(`${msg.type()}: ${msg.text()}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

async function search(page: Page, text: string): Promise<void> {
  await page.keyboard.press("/");
  await expect(searchBox(page)).toBeFocused();
  await page.keyboard.type(text);
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(searchBox(page)).toHaveCount(0);
  await settled(page);
}

for (const map of FLOW_MAPS) {
  test.describe(map.name, () => {
    test("open, search, focus with hops 1 to 3, panel, impact links, hash reload", async ({
      page,
    }) => {
      const problems = await watch(page);
      await page.goto(flowUrl(map));
      await settled(page);
      await expect(page.locator(".react-flow__node").first()).toBeVisible();
      const all = await nodes(page).count();
      expect(all).toBeGreaterThan(10);
      await shot(page, map, "1-open");

      await search(page, map.table);
      await shot(page, map, "2-search");
      expect(page.url()).toContain(`#focus=object%3A${map.table}`);
      await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText(map.table);

      // Hops: both maps are far under the 200-table limit, so 2 and 3 are always enabled, and
      // each step shows at least as many tables (WWI's Sales.Orders has the same 29 at 2 and 3).
      // The disabled case is covered by the allowedHops unit tests.
      const hopButton = (hops: number) =>
        page.getByRole("group", { name: "Hops from the focused table" }).getByRole("button", {
          name: String(hops),
          exact: true,
        });
      let previous = await nodes(page).count();
      expect(previous).toBeGreaterThan(1);
      expect(previous).toBeLessThan(all);
      let reached = 1;
      for (const hops of [2, 3]) {
        await expect(hopButton(hops)).toBeEnabled();
        await hopButton(hops).click();
        await expect(hopButton(hops)).toHaveAttribute("aria-pressed", "true");
        await settled(page);
        const count = await nodes(page).count();
        expect(count).toBeGreaterThanOrEqual(previous);
        previous = count;
        reached = hops;
        await shot(page, map, `3-hops-${String(hops)}`);
      }
      expect(reached).toBe(3);

      // Panel: open the focused table from its node.
      await page
        .locator(".react-flow__node", {
          has: page.locator(`.sm-table__name[title="${map.table}"]`),
        })
        .first()
        .locator(".sm-table__name")
        .click();
      await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText(map.table);
      await expect(panel(page).getByRole("row").nth(1)).toBeVisible();
      await shot(page, map, "4-panel");

      // Impact: a view lists what it depends on, and each link opens that object.
      await search(page, map.view);
      await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText(map.view);
      const depends = panel(page).locator(".sm-detail__list .sm-link").first();
      await expect(depends).toBeVisible();
      const target = (await depends.textContent()) ?? "";
      expect(target).not.toBe("");
      await shot(page, map, "5-impact");
      await depends.click();
      await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText(target);
      expect(page.url()).toContain("select=");
      await shot(page, map, "6-impact-followed");

      // Reload keeps the view, the selection and the hops.
      const hash = new URL(page.url()).hash;
      const shown = await nodes(page).count();
      await page.reload();
      await settled(page);
      expect(new URL(page.url()).hash).toBe(hash);
      await expect(nodes(page)).toHaveCount(shown);
      await expect(panel(page).getByRole("heading", { level: 2 })).toHaveText(target);
      await expect(hopButton(reached)).toHaveAttribute("aria-pressed", "true");
      await shot(page, map, "7-reload");

      // Back to the full map.
      await page.getByRole("button", { name: "Full map" }).click();
      await settled(page);
      await expect(nodes(page)).toHaveCount(all);
      expect(problems).toEqual([]);
    });

    test("System theme follows the OS and changes the page", async ({ page }) => {
      const problems = await watch(page);
      await page.emulateMedia({ colorScheme: "light" });
      await page.goto(flowUrl(map, `#focus=object%3A${map.table}`));
      await settled(page);
      const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      const light = await background();
      await shot(page, map, "8-light");

      // Light is the default, so the OS only matters once System is chosen.
      await page.emulateMedia({ colorScheme: "dark" });
      expect(await background()).toBe(light);
      await page.getByRole("radio", { name: "System" }).check();
      await expect.poll(background).not.toBe(light);
      await shot(page, map, "9-dark");
      await page.reload();
      await settled(page);
      expect(await background()).not.toBe(light);
      await expect(page.locator(".react-flow__node").first()).toBeVisible();
      expect(problems).toEqual([]);
    });

    test("keyboard only: search, open, follow a link, Esc, back to the full map", async ({
      page,
    }) => {
      const problems = await watch(page);
      await page.goto(flowUrl(map));
      await settled(page);
      await search(page, map.table);
      const heading = panel(page).getByRole("heading", { level: 2, name: map.table });
      await expect(heading).toBeFocused();
      await shot(page, map, "10-keyboard-panel");

      for (let i = 0; i < 200; i++) {
        await page.keyboard.press("Tab");
        if (await page.evaluate(() => document.activeElement?.matches(".sm-detail .sm-link"))) {
          break;
        }
      }
      await expect(page.locator(".sm-detail .sm-link:focus")).toBeVisible();
      await page.keyboard.press("Enter");
      await expect(panel(page).getByRole("heading", { level: 2 })).not.toHaveText(map.table);
      expect(page.url()).toContain("select=");

      await page.keyboard.press("Escape");
      await expect(panel(page)).toHaveCount(0);
      await expect
        .poll(() => page.evaluate(() => document.activeElement === document.body))
        .toBe(false);

      for (let i = 0; i < 200; i++) {
        await page.keyboard.press("Shift+Tab");
        if (
          await page.evaluate(() => document.activeElement?.matches(".sm-toolbar__crumbs button"))
        ) {
          break;
        }
      }
      await page.keyboard.press("Enter");
      await settled(page);
      expect(page.url()).not.toContain("focus=");
      await shot(page, map, "11-keyboard-back");
      expect(problems).toEqual([]);
    });
  });
}
