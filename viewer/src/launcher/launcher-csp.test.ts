import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inlineStyleSources } from "../../scripts/csp.mjs";

const SCRIPT = path.resolve("scripts", "launcher-csp.mjs");
const sha = (text: string) => `'sha256-${createHash("sha256").update(text).digest("base64")}'`;
const page = (head: string) =>
  `<!doctype html><html><head><meta charset="UTF-8" />${head}</head><body></body></html>`;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function run(html: string): { ok: boolean; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "launcher-csp-"));
  dirs.push(dir);
  const file = path.join(dir, "launcher.html");
  writeFileSync(file, html);
  try {
    execFileSync("node", [SCRIPT, file], { stdio: "pipe" });
    return { ok: true, dir };
  } catch {
    return { ok: false, dir };
  }
}

describe("inlineStyleSources", () => {
  it("hashes each inline style once, in order", () => {
    const html = page("<style>a{}</style><style>b{}</style><style>a{}</style>");
    expect(inlineStyleSources(html)).toEqual([sha("a{}"), sha("b{}")]);
  });
});

describe("launcher-csp.mjs", () => {
  it("records the script and style hashes beside the page", () => {
    const { ok, dir } = run(page('<style>p{}</style><script type="module">go()</script>'));
    expect(ok).toBe(true);
    const record: unknown = JSON.parse(readFileSync(path.join(dir, "launcher.csp.json"), "utf8"));
    expect(record).toEqual({ script_sources: [sha("go()")], style_sources: [sha("p{}")] });
  });

  it("refuses a page with a policy meta tag, no script, or an external script", () => {
    const meta = '<meta http-equiv="Content-Security-Policy" content="default-src *" />';
    expect(run(page(`${meta}<script>go()</script>`)).ok).toBe(false);
    expect(run(page("<style>p{}</style>")).ok).toBe(false);
    expect(run(page('<script src="https://evil.example/x.js"></script>')).ok).toBe(false);
  });
});
