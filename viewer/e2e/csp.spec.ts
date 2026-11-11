import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { AW_MAP, FLOW_DIR, flowUrl } from "./flow-maps";
import { settled, watchViolations } from "./helpers";

// The map carries a Content-Security-Policy (D-052). These specs prove, in both browsers, that
// the real map works under it (flow.spec.ts runs the full flow in both browsers and fails on any
// violation too), that it blocks requests and injected script, and that each proof
// would fail without the policy (the control runs on a copy with the policy meta removed).

const POLICY_META = /<meta http-equiv="Content-Security-Policy"[^>]*>/;
const OUTSIDE = "https://example.com/schemamap-csp-probe";

/** A copy of the AdventureWorks map made by the real CLI, changed by `edit`; returns its URL. */
function variant(name: string, edit: (html: string) => string): string {
  const html = readFileSync(path.join(FLOW_DIR, `${AW_MAP.name}.html`), "utf8");
  const edited = edit(html);
  if (edited === html) {
    throw new Error("the edit changed nothing");
  }
  const file = test.info().outputPath(`${name}.html`);
  writeFileSync(file, edited);
  return pathToFileURL(file).href;
}

const withoutPolicy = (html: string): string => html.replace(POLICY_META, "");
const withInjection = (html: string): string =>
  html.replace(
    '<div id="root"></div>',
    () =>
      '<div id="root"></div><script>window.__injected = "script";</script>' +
      '<img src="data:," onerror="window.__injectedHandler = true" alt="">',
  );

/** Collect the URLs of outside requests that reach the network layer; each one is aborted. */
async function recordOutsideRequests(page: Page): Promise<string[]> {
  const reached: string[] = [];
  await page.route(/^https?:/, (route) => {
    reached.push(route.request().url());
    return route.abort();
  });
  return reached;
}

/** From the page: a fetch and an <img> to an outside https URL; report what the page saw. */
function probe(page: Page): Promise<{ fetched: boolean; imageLoaded: boolean }> {
  return page.evaluate(async (url) => {
    const fetched = await fetch(url, { mode: "no-cors" }).then(
      () => true,
      () => false,
    );
    const imageLoaded = await new Promise<boolean>((resolve) => {
      const image = document.createElement("img");
      image.onload = () => {
        resolve(true);
      };
      image.onerror = () => {
        resolve(false);
      };
      image.src = `${url}.png`;
      document.body.append(image);
    });
    return { fetched, imageLoaded };
  }, OUTSIDE);
}

test("opening, searching and reloading raise no violation, and the layout worker runs", async ({
  page,
}) => {
  const problems: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      problems.push(`${msg.type()}: ${msg.text()}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  await watchViolations(page, problems);

  await page.goto(flowUrl(AW_MAP));
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);
  // "done" means the ELK worker ran; a blocked worker would show "failed" and a plain grid.
  await settled(page);
  await expect(page.locator(".react-flow__node").first()).toBeVisible();

  await page.keyboard.press("/");
  await page.keyboard.type(AW_MAP.table);
  await page.keyboard.press("Enter");
  await settled(page);
  await page.reload();
  await settled(page);
  expect(problems).toEqual([]);
});

test("a fetch and an image to an https URL are blocked and no request leaves", async ({ page }) => {
  const violations = await watchViolations(page);
  const reached = await recordOutsideRequests(page);
  await page.goto(flowUrl(AW_MAP));
  await settled(page);

  expect(await probe(page)).toEqual({ fetched: false, imageLoaded: false });
  await expect.poll(() => violations.length).toBeGreaterThanOrEqual(2);
  expect(violations.some((v) => v.includes("connect-src") && v.includes(OUTSIDE))).toBe(true);
  expect(violations.some((v) => v.includes("img-src") && v.includes(OUTSIDE))).toBe(true);
  expect(reached).toEqual([]);
});

test("control: without the policy the same probe does reach the network layer", async ({
  page,
}) => {
  const violations = await watchViolations(page);
  const reached = await recordOutsideRequests(page);
  await page.goto(variant("no-policy-probe", withoutPolicy));
  await settled(page);

  await probe(page);
  expect(reached.some((url) => url === OUTSIDE)).toBe(true);
  expect(reached.some((url) => url === `${OUTSIDE}.png`)).toBe(true);
  expect(violations).toEqual([]);
});

test("an injected inline script and event handler do not run", async ({ page }) => {
  const violations = await watchViolations(page);
  await page.goto(variant("injected", withInjection));
  await settled(page);

  const ran = await page.evaluate(() => ({
    script: (window as unknown as Record<string, unknown>)["__injected"] ?? null,
    handler: (window as unknown as Record<string, unknown>)["__injectedHandler"] ?? null,
  }));
  expect(ran).toEqual({ script: null, handler: null });
  expect(violations.some((v) => v.startsWith("violation: script-src"))).toBe(true);
  // The map itself is unharmed.
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
});

test("control: without the policy the same injection does run", async ({ page }) => {
  await page.goto(variant("injected-no-policy", (html) => withInjection(withoutPolicy(html))));
  await settled(page);

  const ran = await page.evaluate(() => ({
    script: (window as unknown as Record<string, unknown>)["__injected"] ?? null,
    handler: (window as unknown as Record<string, unknown>)["__injectedHandler"] ?? null,
  }));
  expect(ran).toEqual({ script: "script", handler: true });
});
