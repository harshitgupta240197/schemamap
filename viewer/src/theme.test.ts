import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const css = readFileSync(path.resolve("src", "tokens.css"), "utf8");
const [lightPart = "", darkPart = ""] = css.split("@media (prefers-color-scheme: dark)");

function tokens(block: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of block.matchAll(/--(sm-[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    found.set(match[1] ?? "", match[2] ?? "");
  }
  return found;
}

const light = tokens(lightPart);
const themes = new Map<string, Map<string, string>>([
  ["light", light],
  ["dark", new Map([...light, ...tokens(darkPart)])],
]);

function channel(hex: string, at: number): number {
  const value = parseInt(hex.slice(at, at + 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

/** WCAG 2.x contrast ratio between two `#rrggbb` colours. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

/** Foreground token, background tokens, minimum ratio. */
const PAIRS: readonly (readonly [string, readonly string[], number])[] = [
  ["sm-text", ["sm-bg", "sm-surface", "sm-header", "sm-badge-bg"], 4.5],
  ["sm-muted", ["sm-bg", "sm-surface", "sm-header", "sm-badge-bg"], 4.5],
  ["sm-accent", ["sm-bg", "sm-surface", "sm-header"], 4.5],
  ["sm-badge-fg", ["sm-badge-bg"], 4.5],
  ["sm-warn-fg", ["sm-warn-bg"], 4.5],
  ["sm-error-fg", ["sm-error-bg", "sm-bg", "sm-surface"], 4.5],
  ["sm-on-accent", ["sm-accent"], 4.5],
  ["sm-sql-keyword", ["sm-header"], 4.5],
  ["sm-sql-string", ["sm-header"], 4.5],
  ["sm-sql-quoted", ["sm-header"], 4.5],
  ["sm-sql-comment", ["sm-header"], 4.5],
  ["sm-sql-number", ["sm-header"], 4.5],
  ["sm-sql-variable", ["sm-header"], 4.5],
  ["sm-edge", ["sm-bg", "sm-surface", "sm-header", "sm-badge-bg"], 3],
  ["sm-focus", ["sm-bg", "sm-surface", "sm-header", "sm-badge-bg"], 3],
  ["sm-accent", ["sm-bg", "sm-surface"], 3],
];

describe.each([...themes])("%s theme contrast", (_name, theme) => {
  test.each(PAIRS.flatMap(([fg, bgs, min]) => bgs.map((bg) => [fg, bg, min] as const)))(
    "%s on %s is at least %s:1",
    (fg, bg, min) => {
      const front = theme.get(fg);
      const back = theme.get(bg);
      expect(front, fg).toBeDefined();
      expect(back, bg).toBeDefined();
      expect(contrast(front ?? "", back ?? "")).toBeGreaterThanOrEqual(min);
    },
  );
});
