import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, type Page } from "@playwright/test";

const FIXTURES = path.resolve("..", "cli", "tests", "fixtures");
/** The CLI's AdventureWorks2022 golden snapshot. */
export const AW = path.join(FIXTURES, "adventureworks2022.snapshot.json");
/** The CLI's WideWorldImporters golden snapshot. */
export const WWI = path.join(FIXTURES, "wideworldimporters.snapshot.json");

/** Escape JSON for an inline script, as the export must: `<`, `>`, `&`, U+2028, U+2029. */
export function escapeForScript(json: string): string {
  return json
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll(String.fromCharCode(0x2028), "\\u2028")
    .replaceAll(String.fromCharCode(0x2029), "\\u2029");
}

/** The empty script the build ships; `schemamap view` fills it in. */
const PLACEHOLDER = '<script type="application/json" id="schemamap-data"></script>';

/** Write a copy of the built viewer with `json` inlined as the snapshot; return its file URL. */
export function mapFile(outFile: string, json: string, hash = ""): string {
  const html = readFileSync(path.resolve("dist", "index.html"), "utf8");
  if (html.split(PLACEHOLDER).length !== 2) {
    throw new Error("built file must contain the data placeholder exactly once");
  }
  const data = `<script type="application/json" id="schemamap-data">${escapeForScript(json)}</script>`;
  // A replacer function: a replacement string would expand `$'` and `$&` found in SQL text.
  writeFileSync(
    outFile,
    html.replace(PLACEHOLDER, () => data),
  );
  return pathToFileURL(outFile).href + hash;
}

/** `mapFile` for a snapshot file on disk (AdventureWorks by default). */
export function mapUrl(outFile: string, hash = "", snapshotPath: string = AW): string {
  return mapFile(outFile, readFileSync(snapshotPath, "utf8"), hash);
}

/** Wait until the canvas has laid out its current view. */
export async function settled(page: Page): Promise<void> {
  await expect(page.locator(".sm-canvas")).toHaveAttribute("data-layout-status", "done", {
    timeout: 30_000,
  });
}

/** The CLI's hostile-name snapshot: names and SQL that would break a raw HTML embedding. */
export const HOSTILE = path.join(FIXTURES, "hostile.snapshot.json");

/**
 * Make a map with the real CLI (`schemamap view --no-open`) and return its file URL.
 * Needs `uv` and the packaged viewer (`uv run tools/build_viewer.py`).
 */
export function viewWithCli(snapshotPath: string, outFile: string, hash = ""): string {
  execFileSync(
    "uv",
    [
      "run",
      "--locked",
      "--project",
      path.resolve("..", "cli"),
      "schemamap",
      "view",
      snapshotPath,
      "--output",
      outFile,
      "--no-open",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  return pathToFileURL(outFile).href + hash;
}
