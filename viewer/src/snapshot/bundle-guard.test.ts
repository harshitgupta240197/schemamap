import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findForbidden } from "../../scripts/bundle-guard.mjs";

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

  it("fails on a planted new Function in a temp copy and passes on the clean copy", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bundle-guard-"));
    try {
      const clean = "<html><script>const a = 1;</script></html>";
      const cleanFile = path.join(dir, "clean.html");
      const plantedFile = path.join(dir, "planted.html");
      writeFileSync(cleanFile, clean);
      writeFileSync(plantedFile, clean.replace("const a = 1;", 'new Function("return 1")();'));
      expect(runGuard(cleanFile).code).toBe(0);
      const planted = runGuard(plantedFile);
      expect(planted.code).toBe(1);
      expect(planted.stderr).toContain("new Function");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is wired into CI after the build", () => {
    const ci = readFileSync(path.resolve("..", ".github", "workflows", "ci.yml"), "utf8");
    expect(ci.indexOf("npm run check:bundle")).toBeGreaterThan(ci.indexOf("npm run build"));
  });
});
