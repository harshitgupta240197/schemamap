import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { watchViolations } from "./helpers";

// `schemamap ui` end to end (docs/UI.md, D-060): the real CLI starts the launcher; the page
// trades the one-time launch code in the link for the session token, removes the code from the
// address bar, and reaches the API with the token, under the launcher's CSP header. A link
// works once, so each test starts its own launcher.

const LAUNCH_LINE = /Schema Map is running at (http:\/\/127\.0\.0\.1:\d+\/#c=[\w-]+)/;

interface Launcher {
  /** The launch link `schemamap ui` printed, with the one-time code in its fragment. */
  readonly url: string;
  /** The same address without the code. */
  readonly bareUrl: string;
  readonly code: string;
}

let child: ChildProcess | undefined;
let dataDir = "";
let launcher: Launcher = { url: "", bareUrl: "", code: "" };

test.beforeEach(async () => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), "schemamap-ui-"));
  const started = spawn(
    "uv",
    [
      "run",
      "--locked",
      "--project",
      path.resolve("..", "cli"),
      "schemamap",
      "ui",
      "--no-open",
      "--data-dir",
      dataDir,
    ],
    // Its own process group, so afterEach stops uv and the server together.
    { stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  child = started;
  const url = await new Promise<string>((resolve, reject) => {
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
    started.stdout.on("data", read);
    started.stderr.on("data", read);
    started.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`schemamap ui exited with ${String(code)}:\n${output}`));
    });
  });
  const [bareUrl = "", code = ""] = url.split("#c=");
  launcher = { url, bareUrl, code };
});

test.afterEach(() => {
  if (child?.pid !== undefined && child.exitCode === null) {
    process.kill(-child.pid, "SIGTERM");
  }
  rmSync(dataDir, { recursive: true, force: true });
});

test("the launch link connects, and neither the code nor the token stays in the address bar", async ({
  page,
}) => {
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
  await expect(page.getByRole("status")).toHaveText("Connected to Schema Map");

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
  await page.goto(launcher.url);
  await expect(page.getByRole("status")).toHaveText("Connected to Schema Map");
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.reload();
  await expect(page.getByRole("status")).toHaveText("Connected to Schema Map");
  expect(requests.some((url) => url.endsWith("/api/session"))).toBe(false);
});

test("a link works once: a second browser profile is refused", async ({ page, browser }) => {
  await page.goto(launcher.url);
  await expect(page.getByRole("status")).toHaveText("Connected to Schema Map");

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
  await expect(page.getByRole("status")).toHaveText("Connected to Schema Map");
});

test("without the link the page says how to get it", async ({ page }) => {
  await page.goto(launcher.bareUrl);
  await expect(page.getByRole("status")).toContainText("needs the link printed by schemamap ui");
});

test("a wrong code is refused and does not spoil the real link", async ({ page }) => {
  await page.goto(`${launcher.bareUrl}#c=wrong-code`);
  await expect(page.getByRole("status")).toContainText("already been used or has expired");
  expect(page.url()).toBe(launcher.bareUrl);

  // A fragment-only change would not reload the page, so leave it first.
  await page.goto("about:blank");
  await page.goto(launcher.url);
  await expect(page.getByRole("status")).toHaveText("Connected to Schema Map");
});
