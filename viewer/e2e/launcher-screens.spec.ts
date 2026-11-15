import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { watchViolations } from "./helpers";
import { launcherPerTest } from "./launcher-server";

// The launcher's Connect, Check and Choose-database screens (U.4) in a real browser, served by
// the real `schemamap ui`. The session and the capabilities come from the real server; the
// routes that would need SQL Server (the checks, the database list) and the remembered list are
// stubbed with synthetic data. Each state is checked with axe at 1280 and 375 px, and the main
// ones are screenshotted into screenshots/launcher/ for CI to upload (the folder is gitignored).

const SHOTS = path.resolve("screenshots", "launcher");
const WIDTHS = [
  { width: 1280, height: 900 },
  { width: 375, height: 800 },
] as const;
const BLOCKING = new Set(["serious", "critical"]);

const permissionScript =
  "USE [AdventureWorks2022];\nGRANT VIEW DEFINITION TO [schemamap_reader];\nGRANT SELECT ON sys.sql_expression_dependencies TO [schemamap_reader];";

// What the server answers when the request names no database: server checks only.
const CHECKS = {
  checks: [
    {
      name: "SQL Server driver",
      status: "ok",
      scope: "server",
      message: "The mssql-python driver is installed and loads.",
      fix: null,
      fix_sql: null,
    },
    {
      name: "Certificate not verified",
      status: "warn",
      scope: "server",
      message: "The connection is encrypted, but the certificate was not checked.",
      fix: "Fine for a local lab. For a shared server, turn the option off.",
      fix_sql: null,
    },
    {
      name: "Server reachable",
      status: "ok",
      scope: "server",
      message: "Reached 127.0.0.1 on port 1433 in 38 ms.",
      fix: null,
      fix_sql: null,
    },
  ],
  connected: true,
  ok: true,
  remembered: false,
};

// What it answers when the request names AdventureWorks2022 and the login lacks permissions.
const DATABASE_CHECKS = {
  checks: [
    {
      name: "Server reachable",
      status: "ok",
      scope: "server",
      message: "Reached 127.0.0.1 on port 1433 in 38 ms.",
      fix: null,
      fix_sql: null,
    },
    {
      name: "VIEW DEFINITION",
      status: "fail",
      scope: "database",
      message:
        "VIEW DEFINITION is missing: schemamap_reader can sign in but can’t see definitions in AdventureWorks2022, so a map made now would be empty.",
      fix: "Ask a DBA to run GRANT VIEW DEFINITION TO [schemamap_reader];",
      fix_sql: "USE [AdventureWorks2022];\nGRANT VIEW DEFINITION TO [schemamap_reader];",
    },
    {
      name: "SELECT sys.sql_expression_dependencies",
      status: "warn",
      scope: "database",
      message: "Dependency and impact information is skipped.",
      fix: "Ask a DBA to run GRANT SELECT ON sys.sql_expression_dependencies TO [schemamap_reader];",
      fix_sql:
        "USE [AdventureWorks2022];\nGRANT SELECT ON sys.sql_expression_dependencies TO [schemamap_reader];",
    },
  ],
  connected: true,
  ok: false,
  remembered: false,
};

const DATABASES = {
  databases: [
    "AdventureWorks2022",
    "AdventureWorksDW2022",
    "SchemaMapSynth",
    "WideWorldImporters",
  ].map((name) => ({ name })),
};

const RECENTS = {
  connections: [
    {
      id: "a".repeat(32),
      server: "localhost",
      port: 14333,
      database: "master",
      auth: "sql",
      user: "schemamap_reader",
    },
    {
      id: "b".repeat(32),
      server: "lab-sql.example.local",
      port: 1433,
      database: "master",
      auth: "entra-integrated",
      user: null,
    },
  ],
};

interface Stub {
  readonly test?: { readonly status: number; readonly body: unknown };
  readonly databaseTest?: { readonly status: number; readonly body: unknown };
  readonly databases?: { readonly status: number; readonly body: unknown };
}

async function stubApi(page: Page, stub: Stub = {}): Promise<void> {
  const answer = (
    route: { fulfill: (o: object) => Promise<void> },
    status: number,
    body: unknown,
  ) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/connection/test", (route) => {
    const sent = route.request().postDataJSON() as { connection?: { database?: string } };
    const { status, body } =
      sent.connection?.database === undefined
        ? (stub.test ?? { status: 200, body: CHECKS })
        : (stub.databaseTest ?? { status: 200, body: DATABASE_CHECKS });
    return answer(route, status, body);
  });
  await page.route("**/api/databases", (route) => {
    const { status, body } = stub.databases ?? { status: 200, body: DATABASES };
    return answer(route, status, body);
  });
  await page.route("**/api/connections", (route) =>
    route.request().method() === "GET" ? answer(route, 200, RECENTS) : route.fallback(),
  );
}

const current = launcherPerTest();

async function open(page: Page, stub: Stub = {}): Promise<void> {
  await stubApi(page, stub);
  await page.goto(current().url);
  await expect(page.getByRole("heading", { name: "Connect to SQL Server" })).toBeVisible();
}

async function fillConnection(page: Page): Promise<void> {
  await page.getByLabel("Server", { exact: true }).fill("127.0.0.1");
  await page.getByLabel("User name", { exact: true }).fill("schemamap_reader");
  await page.getByLabel("Password", { exact: true }).fill("lab-only-example");
}

async function toCheck(page: Page): Promise<void> {
  await fillConnection(page);
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByRole("heading", { name: "Connection checks" })).toBeVisible();
  await expect(page.getByText("Reached 127.0.0.1")).toBeVisible();
}

async function toPick(page: Page, stub: Stub = {}): Promise<void> {
  await open(page, stub);
  await toCheck(page);
  await page.getByRole("button", { name: "Choose a database anyway" }).click();
  await expect(page.getByRole("heading", { name: "Choose a database" })).toBeVisible();
}

/** Choose AdventureWorks2022 and press Extract map: the database checks run and fail. */
async function toDatabaseCheck(page: Page): Promise<void> {
  await toPick(page);
  await page.getByRole("radio", { name: /AdventureWorks2022/ }).check({ force: true });
  await page.getByRole("button", { name: "Extract map" }).click();
  await expect(page.getByRole("heading", { name: /needs a permission/ })).toBeVisible();
}

/** Axe at each width: no serious or critical violation, no sideways scroll; optional screenshot. */
async function audit(page: Page, state: string, shot: boolean): Promise<void> {
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
async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let presses = 0; presses < 40; presses += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("the keyboard never reached the control");
}

test("a keyboard alone gets from Connect through Check to a chosen database", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page);
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Server", { exact: true })).toBeFocused();
  await page.keyboard.type("127.0.0.1");
  await tabTo(page, page.getByLabel("User name", { exact: true }));
  await page.keyboard.type("schemamap_reader");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
  await page.keyboard.type("lab-only-example");
  await page.keyboard.press("Tab");
  const toggle = page.getByRole("button", { name: "Show password" });
  await expect(toggle).toBeFocused();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
  await tabTo(page, page.getByRole("button", { name: "Test connection" }));
  await page.keyboard.press("Enter");

  const checks = page.getByRole("heading", { name: "Connection checks" });
  await expect(checks).toBeFocused();
  await expect(
    page.getByText("Database permissions are checked when you choose a database."),
  ).toBeVisible();
  await tabTo(page, page.getByRole("button", { name: "Choose a database anyway" }));
  await page.keyboard.press("Enter");

  await expect(page.getByRole("heading", { name: "Choose a database" })).toBeFocused();
  await expect(page.getByRole("radio", { name: /AdventureWorks2022/ })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Search databases")).toBeFocused();
  await page.keyboard.type("adventureworks2");
  await expect(page.getByText("1 of 4 databases")).toBeVisible();
  await tabTo(page, page.getByRole("radio", { name: /AdventureWorks2022/ }));
  await page.keyboard.press("Space");
  await expect(page.getByText("AdventureWorks2022 selected")).toBeVisible();
  await tabTo(page, page.getByRole("button", { name: "Extract map" }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: /needs a permission/ })).toBeVisible();
  await tabTo(page, page.getByRole("button", { name: "Copy script" }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  await expect(page.getByText("Script copied to the clipboard")).toBeAttached();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(permissionScript);
});

test("Connect, with its error and warning states, passes axe at both widths", async ({ page }) => {
  await open(page);
  await audit(page, "connect", true);

  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText("Enter the server name or address.")).toBeVisible();
  await audit(page, "connect-errors", false);

  await page.getByLabel("Server", { exact: true }).fill("127.0.0.1");
  await page.getByLabel("User name", { exact: true }).fill("schemamap_reader");
  await page.getByLabel("Password", { exact: true }).fill("x");
  await page.getByRole("checkbox", { name: /Trust server certificate/ }).check();
  await page.getByText("Advanced").click();
  await page.getByRole("radio", { name: "Microsoft Entra ID" }).check({ force: true });
  await expect(page.getByLabel("Entra method")).toBeVisible();
  await audit(page, "connect-entra-trust-advanced", false);
});

test("Check passes axe at both widths", async ({ page }) => {
  await open(page);
  await toCheck(page);
  await audit(page, "check", true);
});

test("Pick, its search states and its system-database toggle pass axe", async ({ page }) => {
  await toPick(page);
  await expect(page.getByRole("radio", { name: /AdventureWorks2022/ })).toBeVisible();
  await page.getByRole("radio", { name: /AdventureWorks2022/ }).check({ force: true });
  await audit(page, "pick", true);
  await page.getByLabel("Search databases").fill("zzz");
  await expect(page.getByText("No database matches “zzz”.")).toBeVisible();
  await audit(page, "pick-no-results", false);
});

test("Extract map with a failing database shows a script for that database", async ({ page }) => {
  const sent: unknown[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/connection/test")) sent.push(request.postDataJSON());
  });
  await toDatabaseCheck(page);
  expect(sent).toHaveLength(2);
  expect(sent[0]).not.toHaveProperty("connection.database");
  expect(sent[1]).toMatchObject({ connection: { database: "AdventureWorks2022" } });
  const script = page.getByRole("region", { name: "Permission script · T-SQL" });
  await expect(script).toHaveText(permissionScript);
  await audit(page, "pick-dbcheck", true);
  // The label never breaks across lines at 375 px; Copy may wrap below it.
  await page.setViewportSize({ width: 375, height: 800 });
  const label = page.locator(".lc-script__title");
  const lines = await label.evaluate(
    (element) =>
      element.getBoundingClientRect().height / parseFloat(getComputedStyle(element).lineHeight),
  );
  expect(Math.round(lines)).toBe(1);
});

test("the password is in no storage, URL or cookie on the way to Pick", async ({
  page,
  context,
}) => {
  const password = "hunter2-Zq9!unique-marker";
  await open(page);
  await page.getByLabel("Server", { exact: true }).fill("127.0.0.1");
  await page.getByLabel("User name", { exact: true }).fill("schemamap_reader");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByRole("heading", { name: "Connection checks" })).toBeVisible();
  await page.getByRole("button", { name: "Choose a database anyway" }).click();
  await expect(page.getByRole("radio", { name: /AdventureWorks2022/ })).toBeVisible();
  const held = await page.evaluate(() => {
    const dump = (store: Storage) =>
      Object.keys(store).map((key) => `${key}=${store.getItem(key) ?? ""}`);
    return JSON.stringify([dump(window.localStorage), dump(window.sessionStorage), location.href]);
  });
  expect(held).not.toContain(password);
  expect(held).not.toContain(encodeURIComponent(password));
  expect(JSON.stringify(await context.cookies())).not.toContain(password);
  expect(JSON.stringify(await context.cookies())).toBe("[]");
});

test("Pick with no databases passes axe", async ({ page }) => {
  await toPick(page, { databases: { status: 200, body: { databases: [] } } });
  await expect(
    page.getByRole("heading", { name: "This login can’t open any databases yet" }),
  ).toBeVisible();
  await audit(page, "pick-empty", true);
});

test("Pick when the list cannot load passes axe, and Try again recovers", async ({ page }) => {
  await toPick(page, {
    databases: {
      status: 502,
      body: {
        error: {
          code: "connect_failed",
          message: "The server stopped answering after 15 seconds (the connection timeout).",
          fix: "Check that the server is still running and reachable from this computer, then try again.",
        },
      },
    },
  });
  await expect(
    page.getByRole("heading", { name: "Couldn’t load the list of databases" }),
  ).toBeVisible();
  await audit(page, "pick-error", true);
  await page.unroute("**/api/databases");
  await page.route("**/api/databases", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(DATABASES),
    }),
  );
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("radio", { name: /AdventureWorks2022/ })).toBeVisible();
});

test("nothing leaves 127.0.0.1, no policy is violated, and Inter is the page's own", async ({
  page,
}) => {
  const violations = await watchViolations(page);
  const hosts = new Set<string>();
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith("data:")) hosts.add(new URL(url).hostname);
  });
  await toPick(page);
  expect([...hosts]).toEqual(["127.0.0.1"]);
  const inter = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].some(
      (face) => face.family.includes("Inter") && face.status === "loaded",
    );
  });
  expect(inter).toBe(true);
  expect(violations).toEqual([]);
});

test("a name that looks like HTML is shown as text", async ({ page }) => {
  await toPick(page, {
    databases: {
      status: 200,
      body: { databases: [{ name: "<img src=x onerror=alert(1)>" }, { name: "</script>" }] },
    },
  });
  await expect(page.getByText("<img src=x onerror=alert(1)>")).toBeVisible();
  await expect(page.locator("main img")).toHaveCount(0);
});
