import { readFileSync } from "node:fs";
import ajvUcs2length from "ajv/dist/runtime/ucs2length.js";
import { describe, expect, it } from "vitest";
import { ucs2length } from "../generated/validate-snapshot";

const GENERATED = readFileSync("src/generated/validate-snapshot.js", "utf8");

describe("generated validator runtime", () => {
  it("imports and requires nothing from ajv", () => {
    expect(GENERATED).not.toMatch(/\bimport\b[^;]*["']ajv/);
    expect(GENERATED).not.toMatch(/\brequire\s*\(/);
    expect(GENERATED).not.toMatch(/["']ajv(\/[^"']*)?["']/);
  });

  it("credits Ajv and names the pinned version", () => {
    const pinned = (
      JSON.parse(readFileSync("package.json", "utf8")) as {
        devDependencies: Record<string, string>;
      }
    ).devDependencies.ajv;
    expect(GENERATED).toContain(`copied verbatim from ajv@${String(pinned)}`);
    expect(GENERATED).toContain("MIT");
  });

  it.each([
    ["empty", ""],
    ["ASCII", "SalesOrderHeader"],
    ["accented", "Café_Größe"],
    ["CJK", "顧客テーブル"],
    ["emoji (surrogate pairs)", "orders_📦_🚚"],
    ["combining marks", "e\u0301a\u0300"],
    ["lone high surrogate", "a\ud800b"],
    ["lone low surrogate", "a\udc00b"],
    ["trailing high surrogate", "x\ud83d"],
  ])("matches Ajv's ucs2length on %s", (_label, text) => {
    expect(ucs2length(text)).toBe(ajvUcs2length(text));
  });
});
