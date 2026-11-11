import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONTEXT_CHARS,
  findForbidden,
  findForbiddenWithContext,
} from "../../scripts/bundle-guard.mjs";
import { addCsp } from "../../scripts/csp.mjs";

const GUARD = path.resolve("scripts", "bundle-guard.mjs");

function runGuard(file: string): { code: number; stderr: string } {
  try {
    execFileSync("node", [GUARD, file], { stdio: "pipe" });
    return { code: 0, stderr: "" };
  } catch (error) {
    const failed = error as { status: number; stderr: Buffer };
    return { code: failed.status, stderr: failed.stderr.toString() };
  }
}

describe("bundle guard", () => {
  it.each(["new Function", "eval(", "require("])("finds %s", (needle) => {
    expect(findForbidden(`var a=1;${needle}"x");`)).toEqual([needle]);
  });

  it("finds nothing in clean code", () => {
    expect(findForbidden("<script>const retrieval = 1; medieval;</script>")).toEqual([]);
  });

  it("reports every occurrence with surrounding context", () => {
    const pad = "x".repeat(200);
    const html = `${pad}A require("m") B${pad}eval(1)`;
    const matches = findForbiddenWithContext(html);
    expect(matches.map((m) => m.needle)).toEqual(["eval(", "require("]);
    const req = matches.find((m) => m.needle === "require(");
    expect(req?.offset).toBe(html.indexOf("require("));
    expect(req?.context).toBe(html.slice(200 + 2 - CONTEXT_CHARS, 200 + 2 + 8 + CONTEXT_CHARS));
    expect(req?.context).toContain('A require("m") B');
  });

  it("clips context at the start and end of the file", () => {
    expect(findForbiddenWithContext("eval(1)")).toEqual([
      { needle: "eval(", offset: 0, context: "eval(1)" },
    ]);
  });

  it("fails on a planted new Function in a temp copy and passes on the clean copy", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bundle-guard-"));
    try {
      // Both copies carry a valid policy, so only the planted code generation can fail the guard.
      const page = (code: string): string =>
        addCsp(`<html><head><meta charset="UTF-8" /><script>${code}</script></head></html>`);
      const clean = page("const a = 1;");
      const cleanFile = path.join(dir, "clean.html");
      const plantedFile = path.join(dir, "planted.html");
      writeFileSync(cleanFile, clean);
      writeFileSync(plantedFile, page('new Function("return 1")();'));
      expect(runGuard(cleanFile).code).toBe(0);
      const planted = runGuard(plantedFile);
      expect(planted.code).toBe(1);
      expect(planted.stderr).toContain("new Function");
      expect(planted.stderr).toContain('new Function(\\"return 1\\")();</script></head></html>');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is wired into CI after the build", () => {
    const ci = readFileSync(path.resolve("..", ".github", "workflows", "ci.yml"), "utf8");
    expect(ci.indexOf("npm run check:bundle")).toBeGreaterThan(ci.indexOf("npm run build"));
  });
});
