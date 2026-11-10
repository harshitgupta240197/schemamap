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

/** Write a copy of the built viewer with `json` inlined as the snapshot; return its file URL. */
export function mapFile(outFile: string, json: string, hash = ""): string {
  const html = readFileSync(path.resolve("dist", "index.html"), "utf8");
  const data = `<script type="application/json" id="schemamap-data">${escapeForScript(json)}</script>`;
  const marker = "<body>";
  if (!html.includes(marker)) {
    throw new Error("built file has no <body>");
  }
  // A replacer function: a replacement string would expand `$'` and `$&` found in SQL text.
  writeFileSync(
    outFile,
    html.replace(marker, () => `${marker}${data}`),
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
