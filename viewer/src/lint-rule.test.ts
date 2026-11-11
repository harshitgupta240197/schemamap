// @vitest-environment node
import { ESLint, Linter } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import { NO_RAW_HTML } from "../scripts/no-raw-html.mjs";

/** Lint `code` as TSX with only the raw-HTML ban enabled. */
function violations(code: string): string[] {
  const linter = new Linter({ configType: "flat" });
  const messages = linter.verify(
    code,
    [
      {
        files: ["**/*.tsx"],
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        rules: { "no-restricted-syntax": ["error", ...NO_RAW_HTML] },
      },
    ],
    "probe.tsx",
  );
  return messages.map((m) => `${m.ruleId ?? "fatal"}: ${m.message}`);
}

describe("raw HTML ban (D-045)", () => {
  it("rejects dangerouslySetInnerHTML", () => {
    const found = violations(`const a = <div dangerouslySetInnerHTML={{ __html: name }} />;`);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("no-restricted-syntax: Render object names as React text");
  });

  it.each(["innerHTML", "outerHTML"])("rejects assigning %s", (property) => {
    const found = violations(`el.${property} = name; el["${property}"] = name;`);
    expect(found).toHaveLength(2);
    for (const message of found) {
      expect(message).toContain("no-restricted-syntax: Assigning innerHTML/outerHTML is banned");
    }
  });

  it("rejects insertAdjacentHTML", () => {
    expect(violations(`el.insertAdjacentHTML("beforeend", name);`)).toHaveLength(1);
  });

  it("allows text rendering and reading innerHTML", () => {
    expect(
      violations(
        `const a = <div title={name}>{name}</div>; el.textContent = name; const h = el.innerHTML;`,
      ),
    ).toEqual([]);
  });

  it("is enabled as an error in the real config for viewer source", async () => {
    const config = (await new ESLint().calculateConfigForFile("src/App.tsx")) as {
      rules: Record<string, unknown>;
    };
    expect(config.rules["no-restricted-syntax"]).toEqual([2, ...NO_RAW_HTML]);
  });
});
