import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  addCsp,
  buildPolicy,
  cspProblems,
  inlineScriptSources,
  scriptSource,
} from "../../scripts/csp.mjs";

const GUARD = path.resolve("scripts", "bundle-guard.mjs");
const ADD = path.resolve("scripts", "add-csp.mjs");

const DATA = '<script type="application/json" id="schemamap-data"></script>';
const MAIN = 'console.log("a < b && c > d", "<script><\\/script>");';
/** A page shaped like the single-file build's output. */
const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Schema Map</title>
    <script type="module" crossorigin>${MAIN}</script>
    <style rel="stylesheet" crossorigin>body{margin:0}</style>
  </head>
  <body>
    ${DATA}
    <div id="root"></div>
  </body>
</html>
`;

const sha = (text: string): string =>
  `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;

function metaContent(html: string): string {
  const match = /<meta http-equiv="Content-Security-Policy" content="([^"]*)" \/>/.exec(html);
  if (match === null) throw new Error("no CSP meta");
  return match[1] ?? "";
}

describe("addCsp", () => {
  const built = addCsp(PAGE);

  it("adds exactly one meta, right after the charset and before any script", () => {
    expect(built.match(/http-equiv="Content-Security-Policy"/g)).toHaveLength(1);
    const csp = built.indexOf("Content-Security-Policy");
    expect(csp).toBeGreaterThan(built.indexOf('<meta charset="UTF-8" />'));
    expect(csp).toBeLessThan(built.indexOf("<script"));
    expect(built.replace(/\n {4}<meta http-equiv=[^>]*>/, "")).toBe(PAGE);
  });

  it("writes the policy, with the sha256 of the inline module script", () => {
    expect(metaContent(built)).toBe(
      [
        "default-src 'none'",
        `script-src ${sha(MAIN)}`,
        "style-src 'unsafe-inline'",
        "img-src data: blob:",
        "font-src data:",
        "worker-src blob:",
        "connect-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ].join("; "),
    );
  });

  it("never allows unsafe-eval or unsafe-inline for scripts", () => {
    const policy = metaContent(built);
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it("hashes what the browser hashes: line endings are normalised by the parser", () => {
    const crlf = PAGE.replace(MAIN, "var a = 1;\r\nvar b = 2;\r\n");
    expect(metaContent(addCsp(crlf))).toContain(sha("var a = 1;\nvar b = 2;\n"));
  });

  it("does not hash the JSON data script, so embedding a snapshot changes no hash", () => {
    const embedded = built.replace(DATA, () => {
      const json = JSON.stringify({ name: "</script><script>alert(1)</script>" })
        .replaceAll("<", "\\u003c")
        .replaceAll(">", "\\u003e");
      return `<script type="application/json" id="schemamap-data">${json}</script>`;
    });
    expect(metaContent(embedded)).toBe(metaContent(built));
    expect(cspProblems(embedded)).toEqual([]);
    expect(inlineScriptSources(embedded)).toEqual([sha(MAIN)]);
  });

  it("lists every executable inline script", () => {
    const two = PAGE.replace("</head>", "<script>var second = 2;</script></head>");
    expect(metaContent(addCsp(two))).toContain(
      `script-src ${sha(MAIN)} ${sha("var second = 2;")};`,
    );
  });

  it.each([
    [
      "an external script",
      PAGE.replace("</head>", '<script src="https://x.test/a.js"></script></head>'),
    ],
    ["an import map", PAGE.replace("</head>", '<script type="importmap">{}</script></head>')],
    [
      "a script of another type",
      PAGE.replace("</head>", '<script type="text/x-foo">x</script></head>'),
    ],
  ])("refuses %s", (_name, html) => {
    expect(() => addCsp(html)).toThrow();
  });

  it("refuses a page that already has a policy, and one with no script", () => {
    expect(() => addCsp(built)).toThrow(/already/);
    expect(() =>
      addCsp(PAGE.replace(MAIN, "").replace(/<script type="module"[^>]*>\s*<\/script>/, "")),
    ).toThrow(/no inline script/);
  });

  it("exports the same source function the policy uses", () => {
    expect(scriptSource(MAIN)).toBe(sha(MAIN));
    expect(buildPolicy([sha(MAIN)])).toBe(metaContent(built));
  });
});

describe("cspProblems", () => {
  const built = addCsp(PAGE);

  it("passes the page addCsp made", () => {
    expect(cspProblems(built)).toEqual([]);
  });

  it("fails when the policy is missing", () => {
    expect(cspProblems(PAGE)).toEqual(["no Content-Security-Policy meta tag"]);
  });

  it("fails on two policies", () => {
    const twice = built.replace(
      "</head>",
      `${built.match(/<meta http-equiv[^>]*>/)?.[0] ?? ""}</head>`,
    );
    expect(cspProblems(twice)[0]).toMatch(/2 Content-Security-Policy meta tags/);
  });

  it("fails on unsafe-eval", () => {
    const bad = built.replace("style-src", "script-src-elem 'unsafe-eval'; style-src");
    expect(cspProblems(bad).join("\n")).toContain("'unsafe-eval'");
  });

  it("fails when a script source is not a sha256 hash", () => {
    const unsafe = built.replace(
      `script-src ${sha(MAIN)}`,
      `script-src ${sha(MAIN)} 'unsafe-inline'`,
    );
    expect(cspProblems(unsafe).join("\n")).toContain(
      "'unsafe-inline', which is not a sha256 source",
    );
    const wild = built.replace(`script-src ${sha(MAIN)}`, `script-src ${sha(MAIN)} https:`);
    expect(cspProblems(wild).join("\n")).toContain("https:, which is not a sha256 source");
  });

  it("fails on a wrong hash: the script is not listed and the listed hash matches nothing", () => {
    const wrong = built.replace(sha(MAIN), sha("something else"));
    const problems = cspProblems(wrong).join("\n");
    expect(problems).toContain("does not list an inline script");
    expect(problems).toContain("matches no inline script");
  });

  it("fails when a script changed after the policy was added", () => {
    const changed = built.replace(MAIN, `${MAIN}fetch("https://x.test");`);
    expect(cspProblems(changed).join("\n")).toContain("does not list an inline script");
  });

  it("fails when a script comes before the policy", () => {
    const moved = built
      .replace(/\n {4}<meta http-equiv=[^>]*>/, "")
      .replace(
        "<head>",
        `<head>${built.match(/<script type="module"[\s\S]*?<\/script>/)?.[0] ?? ""}`,
      )
      .replace("</head>", `${built.match(/<meta http-equiv[^>]*>/)?.[0] ?? ""}</head>`);
    expect(cspProblems(moved).join("\n")).toContain("before the Content-Security-Policy");
  });

  it("fails when another directive is loosened", () => {
    expect(cspProblems(built.replace("connect-src 'none'", "connect-src https:"))).toEqual([
      "the policy is not the expected one for this page",
    ]);
  });

  it("fails on an external script", () => {
    const external = built.replace("</head>", '<script src="https://x.test/a.js"></script></head>');
    expect(cspProblems(external)[0]).toContain("external script");
  });
});

describe("check:bundle and add-csp on files", () => {
  function run(script: string, file: string): { code: number; stderr: string } {
    try {
      execFileSync("node", [script, file], { stdio: "pipe" });
      return { code: 0, stderr: "" };
    } catch (error) {
      const failed = error as { status: number; stderr: Buffer };
      return { code: failed.status, stderr: failed.stderr.toString() };
    }
  }

  it("passes a good page and fails missing CSP, unsafe-eval and a wrong hash", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "csp-"));
    try {
      const write = (name: string, html: string): string => {
        const file = path.join(dir, name);
        writeFileSync(file, html);
        return file;
      };
      const good = addCsp(PAGE);
      expect(run(GUARD, write("good.html", good)).code).toBe(0);

      const missing = run(GUARD, write("missing.html", PAGE));
      expect(missing.code).toBe(1);
      expect(missing.stderr).toContain("no Content-Security-Policy meta tag");

      const evalPage = run(
        GUARD,
        write("eval.html", good.replace("style-src", "script-src-elem 'unsafe-eval'; style-src")),
      );
      expect(evalPage.code).toBe(1);
      expect(evalPage.stderr).toContain("'unsafe-eval'");

      const wrong = run(GUARD, write("wrong.html", good.replace(sha(MAIN), sha("other"))));
      expect(wrong.code).toBe(1);
      expect(wrong.stderr).toContain("does not list an inline script");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("add-csp rewrites a file in place and refuses a bad one without touching it", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "csp-"));
    try {
      const file = path.join(dir, "index.html");
      writeFileSync(file, PAGE);
      expect(run(ADD, file).code).toBe(0);
      expect(cspProblems(readFileSync(file, "utf8"))).toEqual([]);
      const again = run(ADD, file);
      expect(again.code).toBe(1);
      expect(again.stderr).toContain("already");
      expect(cspProblems(readFileSync(file, "utf8"))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is part of the build, after vite build", () => {
    const pkg = JSON.parse(readFileSync(path.resolve("package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const build = pkg.scripts["build"] ?? "";
    expect(build.indexOf("scripts/add-csp.mjs")).toBeGreaterThan(build.indexOf("vite build"));
  });
});
