import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { watchViolations } from "./helpers";

// The walking skeleton of `schemamap ui` (docs/UI.md): the real CLI starts the launcher, the
// page moves the token out of the address bar and reaches the API with it, under the
// launcher's Content-Security-Policy header.

const LAUNCH_LINE = /Schema Map is running at (http:\/\/127\.0\.0\.1:\d+\/#t=[\w-]+)/;

let launcher: ChildProcess | undefined;
let launchUrl = "";

test.beforeAll(async () => {
  const child = spawn(
    "uv",
    ["run", "--locked", "--project", path.resolve("..", "cli"), "schemamap", "ui", "--no-open"],
    // Its own process group, so afterAll stops uv and the server together.
    { stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  launcher = child;
  launchUrl = await new Promise<string>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      reject(new Error(`schemamap ui printed no launch link:\n${output}`));
    }, 60_000);
    const read = (chunk: Buffer) => {
      output += chunk.toString();
      const match = LAUNCH_LINE.exec(output);
      if (match?.[1] !== undefined) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`schemamap ui exited with ${String(code)}:\n${output}`));
    });
  });
});

test.afterAll(() => {
  if (launcher?.pid !== undefined && launcher.exitCode === null) {
    process.kill(-launcher.pid, "SIGTERM");
  }
});

test("the launch link connects and the token leaves the address bar", async ({ page }) => {
  const violations = await watchViolations(page);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  const token = launchUrl.split("#t=")[1] ?? "";
  expect(token.length).toBeGreaterThanOrEqual(40);

  await page.goto(launchUrl);
  await expect(page.getByRole("status")).toHaveText("Connected to Schema Map");

  expect(page.url()).not.toContain("#");
  expect(page.url()).not.toContain(token);
  expect(await page.evaluate(() => sessionStorage.getItem("schemamap.token"))).toBe(token);
  // The token never travels in a URL, and nothing leaves 127.0.0.1.
  expect(requests.length).toBeGreaterThan(0);
  for (const url of requests) {
    expect(url).not.toContain(token);
    expect(new URL(url).hostname).toBe("127.0.0.1");
  }
  expect(violations).toEqual([]);
  // The tokened URL was replaced, not kept as an earlier history entry.
  await page.goBack();
  expect(page.url()).toBe("about:blank");
});

test("a reload keeps working from sessionStorage", async ({ page }) => {
  await page.goto(launchUrl);
  await expect(page.getByRole("status")).toHaveText("Connected to Schema Map");
  await page.reload();
  await expect(page.getByRole("status")).toHaveText("Connected to Schema Map");
});

test("without the token the page says how to get the link", async ({ page }) => {
  await page.goto(launchUrl.split("#")[0] ?? "");
  await expect(page.getByRole("status")).toContainText("needs the link printed by schemamap ui");
});

test("a wrong token is refused by the API", async ({ page }) => {
  await page.goto(`${launchUrl.split("#")[0] ?? ""}#t=wrong-token`);
  await expect(page.getByRole("status")).toContainText("expired");
});
