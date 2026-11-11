import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const OK = { ok: true, message: "Thank you. You are on the list." };
const BAD = { ok: false, message: "That email address does not look right." };

/** Every URL the page asks for, so we can prove nothing leaves the origin. */
function watchRequests(page) {
  const urls = [];
  page.on("request", (request) => urls.push(request.url()));
  return urls;
}

function originsOf(urls) {
  return [...new Set(urls.filter((u) => !u.startsWith("data:")).map((u) => new URL(u).origin))];
}

async function fill(page, email = "ada@example.com") {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Your role").selectOption("DBA");
}

test("loads the page with only same-origin requests", async ({ page }) => {
  const urls = watchRequests(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Join the waitlist" }).scrollIntoViewIfNeeded();
  await page.locator("img").last().scrollIntoViewIfNeeded();
  await page.waitForLoadState("networkidle");
  expect(originsOf(urls)).toEqual(["http://127.0.0.1:4173"]);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Point it at a database. In five minutes, see how everything connects.",
  );
  await expect(page.getByText("The map file cannot send anything anywhere.")).toBeVisible();
  await expect(page.locator("img")).toHaveCount(3);
});

test("sets no cookies and has no inline script", async ({ page, context }) => {
  await page.goto("/");
  expect(await context.cookies()).toEqual([]);
  expect(await page.locator("script:not([src])").count()).toBe(0);
  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute("content");
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("form-action 'self'");
});

test("a valid signup shows the success message", async ({ page }) => {
  let posted;
  await page.route("**/api/join", async (route) => {
    posted = route.request().postData();
    await route.fulfill({ json: OK });
  });
  await page.goto("/");
  await fill(page);
  await page.getByLabel("I'm happy to do a 20-minute call").check();
  await page.getByRole("button", { name: "Join the waitlist" }).last().click();
  await expect(page.getByRole("status")).toHaveText(OK.message);
  const body = new URLSearchParams(posted);
  expect(body.get("email")).toBe("ada@example.com");
  expect(body.get("role")).toBe("DBA");
  expect(body.get("wants_call")).toBe("on");
  expect(body.get("website")).toBe("");
  await expect(page.getByLabel("Email")).toHaveValue("");
});

test("a rejected signup shows the error and keeps what was typed", async ({ page }) => {
  await page.route("**/api/join", (route) => route.fulfill({ status: 400, json: BAD }));
  await page.goto("/");
  await fill(page, "ada@example.com");
  await page.getByRole("button", { name: "Join the waitlist" }).last().click();
  await expect(page.getByRole("status")).toHaveText(BAD.message);
  await expect(page.getByRole("status")).toHaveAttribute("data-state", "error");
  await expect(page.getByLabel("Email")).toHaveValue("ada@example.com");
});

test("a server that cannot be reached shows a friendly error", async ({ page }) => {
  await page.route("**/api/join", (route) => route.abort());
  await page.goto("/");
  await fill(page);
  await page.getByRole("button", { name: "Join the waitlist" }).last().click();
  await expect(page.getByRole("status")).toContainText("could not reach the server");
});

test("the browser blocks an empty email before anything is sent", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/join", (route) => {
    calls += 1;
    return route.fulfill({ json: OK });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Join the waitlist" }).last().click();
  expect(calls).toBe(0);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the form still posts and the answer is a page", async ({ page }) => {
    let method;
    let accept;
    await page.route("**/api/join", async (route) => {
      method = route.request().method();
      accept = await route.request().headerValue("accept");
      await route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>You are on the list</title><h1>You are on the list</h1>",
      });
    });
    await page.goto("/");
    await fill(page);
    await page.getByRole("button", { name: "Join the waitlist" }).last().click();
    await expect(page.getByRole("heading", { name: "You are on the list" })).toBeVisible();
    expect(method).toBe("POST");
    expect(accept).toContain("text/html");
  });
});

for (const width of [375, 1280]) {
  test.describe(`at ${width}px wide`, () => {
    test.use({ viewport: { width, height: 800 } });

    for (const scheme of ["light", "dark"]) {
      test(`no horizontal scroll and no serious axe issues, ${scheme}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto("/");
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
        const { violations } = await new AxeBuilder({ page }).analyze();
        const blocking = violations
          .filter((v) => ["serious", "critical"].includes(v.impact ?? ""))
          .map((v) => ({ rule: v.id, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) }));
        expect(blocking).toEqual([]);
      });
    }

    test("the form is usable", async ({ page }) => {
      await page.route("**/api/join", (route) => route.fulfill({ json: OK }));
      await page.goto("/");
      await fill(page);
      await page.getByRole("button", { name: "Join the waitlist" }).last().click();
      await expect(page.getByRole("status")).toHaveText(OK.message);
      await page.screenshot({ path: `test-results/form-${String(width)}.png`, fullPage: true });
    });
  });
}
