import { expect, test, type Page } from "@playwright/test";
import { FLOW_MAPS, flowUrl } from "./flow-maps";
import { settled, watchViolations } from "./helpers";

// The theme switch on the built map over file://: light by default whatever the OS says, the
// choice remembered, and a blocked localStorage never an error.

const map = FLOW_MAPS[0];
if (map === undefined) {
  throw new Error("no flow map");
}

const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset["theme"]);

test("a fresh map opens light even when the OS is dark", async ({ page }) => {
  const violations = await watchViolations(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(flowUrl(map));
  await settled(page);
  expect(await theme(page)).toBe("light");
  await expect(page.getByRole("radio", { name: "Light" })).toBeChecked();
  expect(violations).toEqual([]);
});

test("the switch changes the theme and the choice survives a reload", async ({ page }) => {
  await page.goto(flowUrl(map));
  await settled(page);
  await page.getByRole("radio", { name: "Dark" }).check();
  expect(await theme(page)).toBe("dark");
  await page.reload();
  await settled(page);
  expect(await theme(page)).toBe("dark");
  await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();
  await page.getByRole("radio", { name: "Light" }).check();
  expect(await theme(page)).toBe("light");
});

test("the switch is a keyboard-operable radio group", async ({ page }) => {
  await page.goto(flowUrl(map));
  await settled(page);
  await page.getByRole("radio", { name: "Light" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();
  expect(await theme(page)).toBe("dark");
});

test("with localStorage throwing, the map opens light with no errors", async ({ page }) => {
  const problems: string[] = [];
  const violations = await watchViolations(page);
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      problems.push(msg.text());
    }
  });
  await page.addInitScript(() => {
    const fail = (): never => {
      throw new DOMException("blocked", "SecurityError");
    };
    Object.defineProperty(window, "localStorage", { get: fail });
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(flowUrl(map));
  await settled(page);
  expect(await theme(page)).toBe("light");
  await page.getByRole("radio", { name: "Dark" }).check();
  expect(await theme(page)).toBe("dark");
  expect(problems).toEqual([]);
  expect(violations).toEqual([]);
});
