import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "@playwright/test";

const LAUNCH_LINE = /Schema Map is running at (http:\/\/127\.0\.0\.1:\d+\/#c=[\w-]+)/;

export interface Launcher {
  /** The launch link `schemamap ui` printed, with the one-time code in its fragment. */
  readonly url: string;
  /** The same address without the code. */
  readonly bareUrl: string;
  readonly code: string;
}

/**
 * Start the real `schemamap ui` before each test and stop it after. A link works once, so every
 * test gets its own launcher. Returns a getter for the current one.
 */
export function launcherPerTest(): () => Launcher {
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

  return () => launcher;
}
