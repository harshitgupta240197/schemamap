import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";

// What the launcher specs share: the viewport sizes, the axe-and-screenshot audit, a Tab helper
// and a JSON answer for stubbed routes.

export const SHOTS = path.resolve("screenshots", "launcher");
export const WIDTHS = [
  { width: 1280, height: 900 },
  { width: 375, height: 800 },
] as const;
const BLOCKING = new Set(["serious", "critical"]);

/** Answer a stubbed route with JSON. */
export function answer(
  route: { fulfill: (options: object) => Promise<void> },
  status: number,
  body: unknown,
): Promise<void> {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

/** Axe at each width: no serious or critical violation, no sideways scroll; optional screenshot. */
export async function audit(page: Page, state: string, shot: boolean): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  for (const size of WIDTHS) {
    await page.setViewportSize(size);
    const { violations } = await new AxeBuilder({ page }).analyze();
    const blocking = violations
      .filter((violation) => BLOCKING.has(violation.impact ?? ""))
      .map((violation) => ({
        rule: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.slice(0, 3).map((node) => node.target.join(" ")),
      }));
    expect(blocking, `${state} at ${String(size.width)} px`).toEqual([]);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${state} scrolls sideways at ${String(size.width)} px`).toBeLessThanOrEqual(
      0,
    );
    if (shot) {
      await page.screenshot({
        path: path.join(SHOTS, `${state}-${String(size.width)}.png`),
        fullPage: true,
      });
    }
  }
}

/** Press Tab until `target` has focus: proves the control can be reached from the keyboard. */
export async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let presses = 0; presses < 40; presses += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("the keyboard never reached the control");
}
