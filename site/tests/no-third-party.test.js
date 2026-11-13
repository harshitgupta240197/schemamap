import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SKIP = new Set(["node_modules", "test-results", "playwright-report", ".vercel"]);
const TEXT = new Set([".html", ".css", ".js", ".mjs", ".json", ".md", ".sql", ".toml", ".txt"]);

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (SKIP.has(name)) continue;
    if (statSync(full).isDirectory()) yield* files(full);
    else if (TEXT.has(path.extname(name))) yield full;
  }
}

describe("site/ has no third-party or design-tool leftovers", () => {
  const banned = ["googleapis", "gstatic", "/_blob/"];
  // This file names the banned strings, so it cannot be scanned for them.
  const self = fileURLToPath(import.meta.url);

  for (const term of banned) {
    it(`never mentions "${term}"`, () => {
      const hits = [...files(ROOT)]
        .filter((file) => file !== self)
        .filter((file) => readFileSync(file, "utf8").includes(term))
        .map((file) => path.relative(ROOT, file));
      expect(hits).toEqual([]);
    });
  }
});
