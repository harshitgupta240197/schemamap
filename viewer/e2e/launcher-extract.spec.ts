import { expect, test, type Page } from "@playwright/test";
import { launcherPerTest } from "./launcher-server";
import { answer, audit, tabTo } from "./launcher-stubs";

// The launcher's Extract, Done, Recent maps and Quit screens (U.5) in a real browser, served by
// the real `schemamap ui`. The session and capabilities come from the real server; every route
// that would need SQL Server or a finished job is stubbed with synthetic data, so each state can
// be held still for axe and screenshots.

const JOB = "a".repeat(32);
const MAP = "b".repeat(32);
const OTHER = "c".repeat(32);
const PASSWORD = "hunter2-Zq9!unique-marker";

const SERVER_CHECKS = {
  checks: [
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

const DATABASES = { databases: [{ name: "AdventureWorks2022" }, { name: "WideWorldImporters" }] };

const SECTION_NAMES = [
  "schemas",
  "tables",
  "views",
  "routines",
  "synonyms",
  "relationships",
  "dependencies",
  "row_counts",
];

function job(
  state: string,
  sectionStates: string[],
  extra: Record<string, unknown> = {},
  counts = false,
) {
  return {
    job_id: JOB,
    state,
    elapsed_ms: 3400,
    sections: SECTION_NAMES.map((name, index) => ({
      name,
      state: sectionStates[index] ?? "pending",
      count: counts ? 10 + index : null,
    })),
    ...extra,
  };
}

const RUNNING = job("running", ["done", "done", "done", "running"]);
const DONE = job("done", Array<string>(8).fill("done"), { map_id: MAP }, true);
const FAILED = job("failed", ["done", "done", "done", "failed"], {
  elapsed_ms: 62_000,
  error: {
    code: "query_timeout",
    message: "A query ran longer than the 60-second query timeout.",
    fix: "Raise Query timeout under Advanced (300 seconds is a safe start for large databases), then extract again.",
  },
});

const MAPS = (extra: unknown[] = []) => [
  {
    id: MAP,
    database: "AdventureWorks2022",
    server: "127.0.0.1",
    extracted_at: new Date().toISOString(),
    tables: 71,
    bytes: 2_516_582,
  },
  {
    id: OTHER,
    database: "WideWorldImporters",
    server: "127.0.0.1",
    extracted_at: new Date(Date.now() - 86_400_000 * 20).toISOString(),
    tables: 48,
    bytes: 2_621_440,
  },
  ...extra,
];

interface World {
  /** What `GET /api/jobs/<id>` answers; set it to move the extract along. */
  status: unknown;
  maps: unknown[];
  posted: unknown[];
  cancelled: number;
  quit: number;
  /** When set, `POST /api/jobs` answers 409 `job_running` naming this job (a second tab). */
  runningElsewhere?: boolean;
}

async function stub(page: Page, world: World): Promise<void> {
  await page.route("**/api/connection/test", (route) => answer(route, 200, SERVER_CHECKS));
  await page.route("**/api/databases", (route) => answer(route, 200, DATABASES));
  await page.route("**/api/connections", (route) =>
    route.request().method() === "GET" ? answer(route, 200, { connections: [] }) : route.fallback(),
  );
  await page.route(/\/api\/(jobs|maps|quit)/, (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (url.pathname === "/api/jobs" && method === "POST") {
      world.posted.push(request.postDataJSON());
      if (world.runningElsewhere === true) {
        return answer(route, 409, {
          error: {
            code: "job_running",
            message: "An extract is already running.",
            fix: "Wait for it to finish, or cancel it, then try again.",
            job_id: JOB,
          },
        });
      }
      return answer(route, 202, { job_id: JOB });
    }
    if (url.pathname === `/api/jobs/${JOB}/cancel`) {
      world.cancelled += 1;
      world.status = job("cancelled", ["done", "done", "done", "running"]);
      return answer(route, 200, { state: "cancelling" });
    }
    if (url.pathname === `/api/jobs/${JOB}`) return answer(route, 200, world.status);
    if (url.pathname === "/api/maps" && method === "GET") {
      return answer(route, 200, { maps: world.maps });
    }
    if (url.pathname.startsWith("/api/maps/") && method === "DELETE") {
      const id = url.pathname.split("/").pop();
      world.maps = world.maps.filter((entry) => (entry as { id: string }).id !== id);
      return answer(route, 200, { deleted: true });
    }
    if (url.pathname === "/api/quit") {
      world.quit += 1;
      return answer(route, 200, { status: "stopping" });
    }
    return route.fallback();
  });
}

const current = launcherPerTest();

function newWorld(status: unknown = RUNNING): World {
  return { status, maps: MAPS(), posted: [], cancelled: 0, quit: 0 };
}

async function connectToPick(page: Page, world: World): Promise<void> {
  await stub(page, world);
  await page.goto(current().url);
  await expect(page.getByRole("heading", { name: "Connect to SQL Server" })).toBeVisible();
  await page.getByLabel("Server", { exact: true }).fill("127.0.0.1");
  await page.getByLabel("User name", { exact: true }).fill("schemamap_reader");
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Test connection" }).click();
  await page.getByRole("button", { name: "Choose a database", exact: true }).click();
  await page.getByRole("radio", { name: /AdventureWorks2022/ }).check({ force: true });
}

async function startExtract(page: Page, world: World): Promise<void> {
  await connectToPick(page, world);
  await page.getByRole("button", { name: "Extract map" }).click();
  await expect(page.getByRole("heading", { name: "Extracting AdventureWorks2022" })).toBeVisible();
}

test("a running extract shows sections and progress without counts, and passes axe", async ({
  page,
}) => {
  const world = newWorld();
  await startExtract(page, world);
  const bar = page.getByRole("progressbar", { name: "Extract progress" });
  await expect(bar).toHaveAttribute("aria-valuenow", "3");
  await expect(bar).toHaveAttribute("aria-valuemax", "8");
  await expect(page.getByText("3 of 8 sections done")).toBeVisible();
  await expect(page.getByText("Elapsed 0:03")).toBeVisible();
  await expect(page.getByText("Reading…")).toBeVisible();
  await expect(page.getByText(/ tables · /)).toHaveCount(0);
  expect(world.posted).toHaveLength(1);
  await audit(page, "extract", true);
});

test("a failed extract shows the fix, says nothing was saved, and offers a way on", async ({
  page,
}) => {
  const world = newWorld(FAILED);
  await startExtract(page, world);
  await expect(
    page.getByRole("heading", { name: "The extract stopped at Procedures and functions" }),
  ).toBeVisible();
  await expect(
    page.getByText("A query ran longer than the 60-second query timeout."),
  ).toBeVisible();
  await expect(page.getByText(/Raise Query timeout under Advanced/)).toBeVisible();
  await expect(page.getByText(/Nothing was saved/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  await page.getByText("Technical details").click();
  await expect(page.getByText("query_timeout")).toBeVisible();
  await expect(page.locator(".lc-details")).not.toContainText("127.0.0.1");
  await audit(page, "extract-failed", true);

  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Choose a database" })).toBeVisible();
  await expect(page.getByText("AdventureWorks2022 selected")).toBeVisible();
});

test("an extract started while another runs says so and links to its progress (#12)", async ({
  page,
}) => {
  const world = newWorld();
  world.runningElsewhere = true;
  await connectToPick(page, world);
  await page.getByRole("button", { name: "Extract map" }).click();
  await expect(
    page.getByRole("heading", { name: "Another extract is running", level: 2 }),
  ).toBeVisible();
  await expect(page.getByText(/could not finish/)).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await audit(page, "extract-busy", true);

  await page.getByRole("button", { name: "See its progress" }).click();
  await expect(page.getByRole("heading", { name: "Extract in progress" })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Extract progress" })).toBeVisible();
});

/** The brand and both nav buttons share one row: nothing wraps below the brand line. */
async function expectOneRowHeader(page: Page, where: string): Promise<void> {
  const header = page.locator(".lc-header");
  const brand = await header.locator(".lc-brand").boundingBox();
  const recent = await header.getByRole("button", { name: "Recent maps" }).boundingBox();
  const quit = await header.getByRole("button", { name: "Quit" }).boundingBox();
  const box = await header.boundingBox();
  if (brand === null || recent === null || quit === null || box === null) {
    throw new Error("header not on screen");
  }
  const middle = (b: { y: number; height: number }) => b.y + b.height / 2;
  expect(
    Math.abs(middle(recent) - middle(brand)),
    `${where}: Recent maps level with brand`,
  ).toBeLessThan(6);
  expect(Math.abs(middle(quit) - middle(brand)), `${where}: Quit level with brand`).toBeLessThan(6);
  expect(box.height, `${where}: one row`).toBeLessThanOrEqual(72);
  expect(await header.getByRole("button", { name: "Quit" }).locator("svg").count()).toBe(1);
  expect(await header.getByRole("button", { name: "Recent maps" }).locator("svg").count()).toBe(1);
}

test("the header keeps one row with icons at 375 px on Connect, Pick, Extract and Recent (#7)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const world = newWorld();
  await stub(page, world);
  await page.goto(current().url);
  await expect(page.getByRole("heading", { name: "Connect to SQL Server" })).toBeVisible();
  await expectOneRowHeader(page, "connect");
  await page.getByLabel("Server", { exact: true }).fill("127.0.0.1");
  await page.getByLabel("User name", { exact: true }).fill("schemamap_reader");
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByRole("heading", { name: "Connection checks" })).toBeVisible();
  await expectOneRowHeader(page, "check");
  await page.getByRole("button", { name: "Choose a database", exact: true }).click();
  await page.getByRole("radio", { name: /AdventureWorks2022/ }).check({ force: true });
  await expectOneRowHeader(page, "pick");
  await page.getByRole("button", { name: "Extract map" }).click();
  await expect(page.getByRole("heading", { name: "Extracting AdventureWorks2022" })).toBeVisible();
  await expectOneRowHeader(page, "extract");
  await page.getByRole("button", { name: "Recent maps" }).click();
  await expect(page.getByRole("heading", { name: "Recent maps", level: 1 })).toBeVisible();
  await expectOneRowHeader(page, "recent");
});

test("Cancel stops the job and returns to Pick, asking for the password again", async ({
  page,
}) => {
  const world = newWorld();
  await startExtract(page, world);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Choose a database" })).toBeVisible();
  expect(world.cancelled).toBe(1);
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Extract map" })).toBeDisabled();
  await audit(page, "pick-password-again", false);
});

test("after the job starts the password is in no React state, storage key, URL or cookie", async ({
  page,
  context,
}) => {
  const world = newWorld();
  await startExtract(page, world);
  // The password went out in the one request that needed it...
  expect(JSON.stringify(world.posted)).toContain(PASSWORD);
  await expect(page.getByRole("progressbar")).toBeVisible();

  // ...and nowhere else. Walk the React tree's props and hook state, not just the DOM.
  const held = await page.evaluate(() => {
    const strings: string[] = [];
    const seen = new WeakSet();
    const collect = (value: unknown, depth: number): void => {
      if (typeof value === "string") {
        strings.push(value);
        return;
      }
      if (typeof value !== "object" || value === null || depth > 8) return;
      if (value instanceof Node || seen.has(value)) return;
      seen.add(value);
      for (const key of Object.keys(value)) {
        if (key.startsWith("_") || key === "return" || key === "alternate") continue;
        collect((value as Record<string, unknown>)[key], depth + 1);
      }
    };
    const root = document.getElementById("root");
    const key =
      root === null ? undefined : Object.keys(root).find((k) => k.startsWith("__reactContainer$"));
    let fibers = 0;
    const visit = (fiber: unknown): void => {
      if (typeof fiber !== "object" || fiber === null) return;
      const node = fiber as {
        child?: unknown;
        sibling?: unknown;
        memoizedState?: unknown;
        memoizedProps?: unknown;
      };
      fibers += 1;
      collect(node.memoizedState, 0);
      collect(node.memoizedProps, 0);
      visit(node.child);
      visit(node.sibling);
    };
    if (root !== null && key !== undefined)
      visit((root as unknown as Record<string, unknown>)[key]);
    const dump = (store: Storage) =>
      Object.keys(store).map((name) => `${name}=${store.getItem(name) ?? ""}`);
    return {
      fibers,
      react: strings.join("\n"),
      other: JSON.stringify([
        dump(window.localStorage),
        dump(window.sessionStorage),
        location.href,
        document.body.innerHTML,
      ]),
    };
  });
  // The walk really saw the page: the form's server and the database name are in it.
  expect(held.fibers).toBeGreaterThan(20);
  expect(held.react).toContain("127.0.0.1");
  expect(held.react).toContain("AdventureWorks2022");
  expect(held.react).not.toContain(PASSWORD);
  expect(held.other).not.toContain(PASSWORD);
  expect(held.other).not.toContain(encodeURIComponent(PASSWORD));
  expect(JSON.stringify(await context.cookies())).toBe("[]");
});

test("Done offers the map in a new tab, a download, and another database", async ({ page }) => {
  const world = newWorld(DONE);
  await connectToPick(page, world);
  await page.getByRole("button", { name: "Extract map" }).click();
  await expect(
    page.getByRole("heading", { name: "Your map of AdventureWorks2022 is ready" }),
  ).toBeVisible();
  await expect(page.getByText(/71 tables · 127.0.0.1, 1433/)).toBeVisible();
  const open = page.getByRole("link", { name: /Open map/ });
  await expect(open).toHaveAttribute("href", `/maps/${MAP}`);
  await expect(open).toHaveAttribute("target", "_blank");
  await expect(open).toHaveAttribute("rel", "noopener noreferrer");
  await expect(page.getByRole("button", { name: "Save map file" })).toBeVisible();
  await audit(page, "done", true);

  await page.getByRole("button", { name: "Extract another database" }).click();
  await expect(page.getByRole("heading", { name: "Choose a database" })).toBeVisible();
});

test("Recent maps lists, confirms a delete inline, and passes axe in each state", async ({
  page,
}) => {
  const world = newWorld();
  await stub(page, world);
  await page.goto(current().url);
  await page.getByRole("button", { name: "Recent maps" }).click();
  await expect(page.getByRole("heading", { name: "Recent maps", level: 1 })).toBeFocused();
  const table = page.getByRole("table");
  await expect(table.getByRole("row")).toHaveCount(3);
  await expect(table.getByText("2.4 MB")).toBeVisible();
  await expect(table.getByText("71", { exact: true })).toBeVisible();
  await audit(page, "recent", true);

  await page.getByRole("button", { name: "Delete the map of AdventureWorks2022" }).click();
  await expect(page.getByText("Delete the map of AdventureWorks2022?")).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep" })).toBeFocused();
  await audit(page, "recent-delete", true);

  await page.getByRole("button", { name: "Delete map" }).click();
  await expect(page.getByText("Deleted the map of AdventureWorks2022.")).toBeVisible();
  await expect(table.getByRole("row")).toHaveCount(2);
});

test("the Re-run dialog is keyboard-operable: focus trapped, Esc closes, password asked again", async ({
  page,
}) => {
  const world = newWorld();
  await connectToPick(page, world);
  await page.getByRole("button", { name: "Recent maps" }).click();
  const opener = page.getByRole("button", { name: "Re-run AdventureWorks2022" });
  await tabTo(page, opener);
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Re-run AdventureWorks2022" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Password")).toBeFocused();
  await expect(dialog).toContainText("127.0.0.1, 1433 · SQL Server login · schemamap_reader");
  await audit(page, "recent-rerun", true);

  // Tab and Shift+Tab never leave the dialog.
  for (let presses = 0; presses < 6; presses += 1) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((box) => box.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Shift+Tab");
  expect(await dialog.evaluate((box) => box.contains(document.activeElement))).toBe(true);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();

  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(dialog.getByText("Enter the password.")).toBeVisible();
  await page.keyboard.type("second-time");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Extracting AdventureWorks2022" })).toBeVisible();
  expect(JSON.stringify(world.posted.at(-1))).toContain("second-time");
});

test("a snapshot that is not a snapshot gets a friendly error", async ({ page }) => {
  const world = newWorld();
  await stub(page, world);
  await page.route("**/api/maps/import", (route) =>
    answer(route, 422, {
      error: { code: "invalid", message: "The file is not a Schema Map snapshot." },
    }),
  );
  await page.goto(current().url);
  await page.getByRole("button", { name: "Recent maps" }).click();
  await page.getByLabel("Snapshot file").setInputFiles({
    name: "notes.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"hello":"world"}'),
  });
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("That file could not be used.");
  await expect(alert).toContainText("The file is not a Schema Map snapshot.");
  await expect(alert).toContainText(".json or .json.gz");
  await audit(page, "recent-import-error", false);
});

test("Quit stops the server and says the tab can be closed", async ({ page }) => {
  const world = newWorld();
  await stub(page, world);
  await page.goto(current().url);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Quit" }).click();
  await expect(page.getByRole("heading", { name: "Schema Map has stopped" })).toBeVisible();
  await expect(page.getByText(/You can close this tab/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Quit" })).toHaveCount(0);
  // U.7: the header no longer claims the stopped server is running.
  await expect(page.locator(".lc-pill")).toHaveText("Stopped");
  await expect(page.getByText(/Running on this computer|This computer only/)).toHaveCount(0);
  expect(world.quit).toBe(1);
  expect(await page.evaluate(() => document.body.innerHTML)).not.toContain(PASSWORD);
  await audit(page, "quit", true);
});

/** The skip link is the first tabbable thing on the page, and activating it focuses main. */
async function expectSkipLinkFirst(page: Page, screen: string): Promise<void> {
  const firstTabbable = await page.evaluate(() => {
    const first = document.querySelector<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    return first?.textContent ?? null;
  });
  expect(firstTabbable, `${screen}: the first Tab stop`).toBe("Skip to main content");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await skip.focus();
  await expect(skip, `${screen}: visible on focus`).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("Enter");
  await expect(page.locator("main"), `${screen}: focus moves to main`).toBeFocused();
}

test("the skip link is the first Tab stop on every launcher screen and axe stays clean", async ({
  page,
}) => {
  const world = newWorld(RUNNING);
  await stub(page, world);
  await page.goto(current().url);
  await expect(page.getByRole("heading", { name: "Connect to SQL Server" })).toBeVisible();
  // A real Tab from a fresh page lands on it.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await expectSkipLinkFirst(page, "connect");
  await page.getByRole("link", { name: "Skip to main content" }).focus();
  await audit(page, "connect-skip-focused", false);

  await page.getByLabel("Server", { exact: true }).fill("127.0.0.1");
  await page.getByLabel("User name", { exact: true }).fill("schemamap_reader");
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByRole("heading", { name: "Connection checks" })).toBeVisible();
  await expectSkipLinkFirst(page, "check");

  await page.getByRole("button", { name: "Choose a database", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Choose a database" })).toBeVisible();
  await expectSkipLinkFirst(page, "pick");

  await page.getByRole("radio", { name: /AdventureWorks2022/ }).check({ force: true });
  await page.getByRole("button", { name: "Extract map" }).click();
  await expect(page.getByRole("heading", { name: "Extracting AdventureWorks2022" })).toBeVisible();
  await expectSkipLinkFirst(page, "extract");

  world.status = DONE;
  await expect(
    page.getByRole("heading", { name: "Your map of AdventureWorks2022 is ready" }),
  ).toBeVisible();
  await expectSkipLinkFirst(page, "done");

  await page
    .getByRole("navigation", { name: "Launcher" })
    .getByRole("button", { name: "Recent maps" })
    .click();
  await expect(page.getByRole("heading", { name: "Recent maps", level: 1 })).toBeVisible();
  await expectSkipLinkFirst(page, "recent");

  await page.getByRole("button", { name: "Quit" }).click();
  await expect(page.getByRole("heading", { name: "Schema Map has stopped" })).toBeVisible();
  await expectSkipLinkFirst(page, "quit");
});

test("Re-run with no matching connection says how to make it a password only", async ({ page }) => {
  const world = newWorld();
  await stub(page, world);
  await page.goto(current().url);
  await page.getByRole("button", { name: "Recent maps" }).click();
  await page.getByRole("button", { name: "Re-run AdventureWorks2022" }).click();
  const dialog = page.getByRole("dialog", { name: "Re-run AdventureWorks2022" });
  await expect(dialog).toContainText(
    "Tick “Remember this connection” next time to re-run with just a password.",
  );
  await expect(dialog.getByLabel("Password")).toHaveCount(0);
  await audit(page, "recent-rerun-unknown", true);

  await dialog.getByRole("button", { name: "Set up the connection" }).click();
  await expect(page.getByRole("heading", { name: "Connect to SQL Server" })).toBeFocused();
  await expect(page.getByLabel("Server", { exact: true })).toHaveValue("127.0.0.1");
  expect(world.posted).toHaveLength(0);
});

test("on a phone the Open, Re-run and Delete buttons of a map keep their gap", async ({ page }) => {
  // U.7: `.lc-maps td { display: block }` beat the actions cell's flex layout, so the buttons
  // touched at 375 px.
  await page.setViewportSize({ width: 375, height: 800 });
  const world = newWorld();
  await stub(page, world);
  await page.goto(current().url);
  await page.getByRole("button", { name: "Recent maps" }).click();
  const open = page.getByRole("link", {
    name: "Open the map of AdventureWorks2022 (opens in a new tab)",
  });
  const rerun = page.getByRole("button", { name: "Re-run AdventureWorks2022" });
  const del = page.getByRole("button", { name: "Delete the map of AdventureWorks2022" });
  const [a, b, c] = await Promise.all([open.boundingBox(), rerun.boundingBox(), del.boundingBox()]);
  if (a === null || b === null || c === null) throw new Error("a map action is not on screen");
  expect(b.x - (a.x + a.width)).toBeGreaterThanOrEqual(8);
  expect(c.x - (b.x + b.width)).toBeGreaterThanOrEqual(8);
});
