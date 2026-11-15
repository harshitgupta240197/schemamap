import { expect, test, type Page } from "@playwright/test";
import { watchViolations } from "./helpers";
import { launcherPerTest } from "./launcher-server";

// `schemamap ui` end to end (docs/UI.md, D-060): the real CLI starts the launcher; the page
// trades the one-time launch code in the link for the session token, removes the code from the
// address bar, and reaches the API with the token, under the launcher's CSP header. A link
// works once, so each test starts its own launcher.

const current = launcherPerTest();

/** The Connect screen: what a connected launcher shows. */
const connected = (page: Page) => page.getByRole("heading", { name: "Connect to SQL Server" });

test("the launch link connects, and neither the code nor the token stays in the address bar", async ({
  page,
}) => {
  const launcher = current();
  const violations = await watchViolations(page);
  const requests: { url: string; referer: string | undefined; post: string | null }[] = [];
  page.on("request", (request) => {
    requests.push({
      url: request.url(),
      referer: request.headers().referer,
      post: request.postData(),
    });
  });
  expect(launcher.code.length).toBeGreaterThanOrEqual(40);

  await page.goto(launcher.url);
  await expect(connected(page)).toBeVisible();

  const token = await page.evaluate(() => sessionStorage.getItem("schemamap.token"));
  expect(token?.length).toBeGreaterThanOrEqual(40);
  // The token is not the code.
  expect(token).not.toBe(launcher.code);
  expect(page.url()).toBe(launcher.bareUrl);
  expect(page.url()).not.toContain(launcher.code);
  expect(page.url()).not.toContain(token ?? "x");

  // The code is posted once, in a body; the token never travels in a URL or a Referer, and
  // nothing leaves 127.0.0.1.
  expect(requests.filter((r) => r.url.endsWith("/api/session"))).toHaveLength(1);
  expect(requests.filter((r) => r.post?.includes(launcher.code) === true)).toHaveLength(1);
  for (const request of requests) {
    expect(request.url).not.toContain(launcher.code);
    expect(request.url).not.toContain(token ?? "x");
    expect(request.referer ?? "").not.toContain(launcher.code);
    expect(request.referer ?? "").not.toContain(token ?? "x");
    expect(new URL(request.url).hostname).toBe("127.0.0.1");
  }
  expect(violations).toEqual([]);
  // The coded URL was replaced, not kept as an earlier history entry.
  await page.goBack();
  expect(page.url()).toBe("about:blank");
});

test("a reload keeps working from sessionStorage, without the code", async ({ page }) => {
  const launcher = current();
  await page.goto(launcher.url);
  await expect(connected(page)).toBeVisible();
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.reload();
  await expect(connected(page)).toBeVisible();
  expect(requests.some((url) => url.endsWith("/api/session"))).toBe(false);
});

test("a link works once: a second browser profile is refused", async ({ page, browser }) => {
  const launcher = current();
  await page.goto(launcher.url);
  await expect(connected(page)).toBeVisible();

  const other = await browser.newContext();
  try {
    const second = await other.newPage();
    await second.goto(launcher.url);
    await expect(second.getByRole("status")).toContainText("already been used or has expired");
    expect(await second.evaluate(() => sessionStorage.getItem("schemamap.token"))).toBeNull();
    expect(second.url()).not.toContain("#");
  } finally {
    await other.close();
  }
  // The first tab is unaffected.
  await page.reload();
  await expect(connected(page)).toBeVisible();
});

test("without the link the page says how to get it", async ({ page }) => {
  const launcher = current();
  await page.goto(launcher.bareUrl);
  await expect(page.getByRole("status")).toContainText("needs the link printed by schemamap ui");
});

test("a wrong code is refused and does not spoil the real link", async ({ page }) => {
  const launcher = current();
  await page.goto(`${launcher.bareUrl}#c=wrong-code`);
  await expect(page.getByRole("status")).toContainText("already been used or has expired");
  expect(page.url()).toBe(launcher.bareUrl);

  // A fragment-only change would not reload the page, so leave it first.
  await page.goto("about:blank");
  await page.goto(launcher.url);
  await expect(connected(page)).toBeVisible();
});
