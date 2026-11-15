import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { settled, WWI } from "./helpers";
import { launcherPerTest } from "./launcher-server";

// The whole launcher flow against the real lab SQL Server, driven through the real browser and
// the real `schemamap ui` (no stubs): connect as schemamap_reader, extract AdventureWorks2022,
// open its map, re-run it from Recent maps, delete a map and import a snapshot file.
//
// It needs the lab (`uv run tools/lab.py up` and `restore all`), so it runs only when
// SCHEMAMAP_E2E_LAB=1 (the CI integration job sets it). The reader's password comes from
// `lab.read_env()` and goes straight into the form; it is never printed or written down.

const LAB = process.env["SCHEMAMAP_E2E_LAB"] === "1";
test.skip(!LAB, "needs the SQL Server lab; set SCHEMAMAP_E2E_LAB=1 with the lab up");
test.setTimeout(240_000);

interface LabLogin {
  readonly host: string;
  readonly port: string;
  readonly user: string;
  readonly password: string;
}

function labLogin(): LabLogin {
  const root = path.resolve("..");
  const script = [
    "import json, runpy",
    'lab = runpy.run_path("tools/lab.py")',
    "env = lab['read_env']()",
    "print(json.dumps({'host': lab['HOST'], 'port': str(lab['HOST_PORT']),",
    "  'user': lab['READER_LOGIN'], 'password': env[lab['ENV_READER']]}))",
  ].join("\n");
  const out = execFileSync("python3", ["-I", "-c", script], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out) as LabLogin;
}

const current = launcherPerTest();

async function extractAdventureWorks(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Extract map" }).click();
  await expect(
    page.getByRole("heading", { name: "Your map of AdventureWorks2022 is ready" }),
  ).toBeVisible({
    timeout: 180_000,
  });
}

test("connect, extract, open the map, re-run, delete and import against the real lab", async ({
  page,
  context,
}) => {
  const login = labLogin();
  const violations: string[] = [];
  // Every page of the context, the launcher and the map tab alike.
  await context.exposeFunction("__smViolation", (text: string) => violations.push(text));
  await context.addInitScript(() => {
    document.addEventListener(
      "securitypolicyviolation",
      (event) => {
        const report = (window as unknown as Record<string, (text: string) => void>)[
          "__smViolation"
        ];
        report?.(`${location.pathname}: ${event.violatedDirective} ${event.blockedURI}`);
      },
      true,
    );
  });

  await page.goto(current().url);
  await expect(page.getByRole("heading", { name: "Connect to SQL Server" })).toBeVisible();
  await page.getByLabel("Server", { exact: true }).fill(login.host);
  await page.getByLabel("Port", { exact: true }).fill(login.port);
  await page.getByLabel("User name", { exact: true }).fill(login.user);
  await page.getByLabel("Password", { exact: true }).fill(login.password);
  await page.getByRole("checkbox", { name: /Trust server certificate/ }).check();
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByRole("heading", { name: "Connection checks" })).toBeVisible();
  await page.getByRole("button", { name: "Choose a database anyway" }).click();
  await page.getByRole("radio", { name: /AdventureWorks2022/ }).check({ force: true });
  await extractAdventureWorks(page);
  await expect(page.getByText(/71 tables/)).toBeVisible();

  // The map opens in a new tab and finishes its layout.
  const [map] = await Promise.all([
    context.waitForEvent("page"),
    page.getByRole("link", { name: /Open map/ }).click(),
  ]);
  await map.waitForLoadState();
  expect(new URL(map.url()).pathname).toMatch(/^\/maps\/[0-9a-f]{32}$/);
  await settled(map);
  await map.close();

  // Recent maps lists it; Re-run asks for the password again and makes a second map.
  await page.getByRole("button", { name: "Recent maps" }).click();
  const rows = page.getByRole("table").getByRole("row");
  await expect(rows).toHaveCount(2);
  await expect(page.getByRole("table").getByText("71", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Re-run AdventureWorks2022" }).click();
  const dialog = page.getByRole("dialog", { name: "Re-run AdventureWorks2022" });
  await dialog.getByLabel("Password").fill(login.password);
  await dialog.getByRole("button", { name: "Re-run extract" }).click();
  await expect(
    page.getByRole("heading", { name: "Your map of AdventureWorks2022 is ready" }),
  ).toBeVisible({
    timeout: 180_000,
  });

  // Delete one of the two maps.
  await page.getByRole("button", { name: "Recent maps" }).click();
  await expect(rows).toHaveCount(3);
  await page.getByRole("button", { name: "Delete the map of AdventureWorks2022" }).first().click();
  await page.getByRole("button", { name: "Delete map" }).click();
  await expect(page.getByText("Deleted the map of AdventureWorks2022.")).toBeVisible();
  await expect(rows).toHaveCount(2);

  // Import the WideWorldImporters fixture snapshot.
  await page.getByLabel("Snapshot file").setInputFiles(WWI);
  await expect(page.getByText(/Added a map from wideworldimporters.snapshot.json/)).toBeVisible();
  await expect(page.getByRole("table").getByText("WideWorldImporters")).toBeVisible();
  await expect(rows).toHaveCount(3);

  expect(violations).toEqual([]);
});
