import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { tokenize, type Token } from "./tokenize";

const kinds = (text: string): [string, string][] =>
  tokenize(text)
    .filter((t) => t.kind !== "plain")
    .map((t) => [t.kind, t.text]);
const joined = (tokens: readonly Token[]): string => tokens.map((t) => t.text).join("");

test("empty input gives no tokens", () => {
  expect(tokenize("")).toEqual([]);
});

test("keywords are case-insensitive and whole-word only", () => {
  expect(kinds("select Selected FROM t1")).toEqual([
    ["keyword", "select"],
    ["keyword", "FROM"],
  ]);
});

test("strings keep '' escapes and N prefixes", () => {
  expect(kinds("SELECT 'it''s', N'x''y', ''")).toEqual([
    ["keyword", "SELECT"],
    ["string", "'it''s'"],
    ["string", "N'x''y'"],
    ["string", "''"],
  ]);
});

test("an unterminated string runs to the end", () => {
  expect(kinds("SELECT 'oops\nFROM")).toEqual([
    ["keyword", "SELECT"],
    ["string", "'oops\nFROM"],
  ]);
});

test('bracketed and double-quoted names keep ]] and "" escapes', () => {
  expect(kinds('SELECT [a]]b], [x y], "q""r" FROM')).toEqual([
    ["keyword", "SELECT"],
    ["quoted", "[a]]b]"],
    ["quoted", "[x y]"],
    ["quoted", '"q""r"'],
    ["keyword", "FROM"],
  ]);
});

test("a bracketed name containing -- or /* is not a comment", () => {
  expect(kinds("[a--b] [c/*d]")).toEqual([
    ["quoted", "[a--b]"],
    ["quoted", "[c/*d]"],
  ]);
});

test("line comments stop before the newline", () => {
  expect(kinds("SELECT 1 -- note 'x'\r\nFROM")).toEqual([
    ["keyword", "SELECT"],
    ["number", "1"],
    ["comment", "-- note 'x'"],
    ["keyword", "FROM"],
  ]);
});

test("block comments nest", () => {
  expect(kinds("a /* one /* two */ still */ SELECT")).toEqual([
    ["comment", "/* one /* two */ still */"],
    ["keyword", "SELECT"],
  ]);
});

test("an unterminated block comment runs to the end", () => {
  expect(kinds("a /* open /* inner */ rest")).toEqual([["comment", "/* open /* inner */ rest"]]);
});

test("numbers: integers, decimals, exponents, hex", () => {
  expect(kinds("1 2.50 .5 1e-3 0xFF 7")).toEqual([
    ["number", "1"],
    ["number", "2.50"],
    ["number", ".5"],
    ["number", "1e-3"],
    ["number", "0xFF"],
    ["number", "7"],
  ]);
});

test("digits inside identifiers are not numbers", () => {
  expect(kinds("t1 col2x @p3 #tmp9")).toEqual([["variable", "@p3"]]);
});

test("variables", () => {
  expect(kinds("@id @@ROWCOUNT")).toEqual([
    ["variable", "@id"],
    ["variable", "@@ROWCOUNT"],
  ]);
});

test("the output joins back to the input exactly, including odd input", () => {
  const samples = [
    "",
    "   \r\n\t",
    "SELECT * FROM [dbo].[T] WHERE a = N' ' --  \n",
    "/* never closed",
    "'never closed",
    "[never closed",
    "@",
    "@@",
    "0x",
    "1e",
    "é ü ñ 日本語 SELECT",
    "</script><b onerror=1>",
    "/*/ */ /**/ --",
  ];
  for (const sample of samples) {
    expect(joined(tokenize(sample))).toBe(sample);
  }
});

test("hostile text stays in token text, never reinterpreted", () => {
  const tokens = tokenize("SELECT '</script><img src=x onerror=alert(1)>'");
  expect(tokens.find((t) => t.kind === "string")?.text).toBe(
    "'</script><img src=x onerror=alert(1)>'",
  );
});

function definitionsFrom(file: string): string[] {
  const fixtures = path.resolve(__dirname, "..", "..", "..", "cli", "tests", "fixtures", file);
  const data: unknown = JSON.parse(readFileSync(fixtures, "utf8"));
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (typeof node === "object" && node !== null) {
      for (const [key, value] of Object.entries(node)) {
        if (key === "definition" && typeof value === "string") {
          found.push(value);
        } else {
          walk(value);
        }
      }
    }
  };
  walk(data);
  return found;
}

test("round trip on every definition in the AdventureWorks golden", () => {
  const all = definitionsFrom("adventureworks2022.snapshot.json");
  expect(all.length).toBeGreaterThan(50);
  for (const definition of all) {
    expect(joined(tokenize(definition))).toBe(definition);
  }
});

test("round trip on every definition in the WideWorldImporters snapshot", () => {
  const all = definitionsFrom("wideworldimporters.snapshot.json");
  expect(all.length).toBeGreaterThan(20);
  for (const definition of all) {
    expect(joined(tokenize(definition))).toBe(definition);
  }
});

test("round trip on the WideWorldImporters code fixture", () => {
  const all = definitionsFrom("wideworldimporters_code.json");
  expect(all.length).toBeGreaterThan(0);
  for (const definition of all) {
    expect(joined(tokenize(definition))).toBe(definition);
  }
});
