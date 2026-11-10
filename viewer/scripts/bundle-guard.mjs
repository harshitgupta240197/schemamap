// Fails if the built single-file viewer contains runtime code generation, which a strict
// no-eval Content-Security-Policy would block. Usage: node scripts/bundle-guard.mjs [file]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FORBIDDEN = ["new Function", "eval(", "require("];

/** Characters of context printed on each side of a match. */
export const CONTEXT_CHARS = 80;

/** Returns the forbidden constructs found in `html`, in FORBIDDEN order. */
export function findForbidden(html) {
  return FORBIDDEN.filter((needle) => html.includes(needle));
}

/** Every occurrence of every forbidden construct, with surrounding text, in FORBIDDEN order. */
export function findForbiddenWithContext(html) {
  const matches = [];
  for (const needle of FORBIDDEN) {
    for (let at = html.indexOf(needle); at !== -1; at = html.indexOf(needle, at + needle.length)) {
      const before = html.slice(Math.max(0, at - CONTEXT_CHARS), at);
      const after = html.slice(at + needle.length, at + needle.length + CONTEXT_CHARS);
      matches.push({ needle, offset: at, context: `${before}${needle}${after}` });
    }
  }
  return matches;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] ?? "dist/index.html";
  const html = readFileSync(file, "utf8");
  const found = findForbidden(html);
  if (found.length > 0) {
    console.error(`${file} contains runtime codegen: ${found.join(", ")}`);
    for (const match of findForbiddenWithContext(html)) {
      console.error(
        `  ${match.needle} at offset ${String(match.offset)}: ${JSON.stringify(match.context)}`,
      );
    }
    process.exit(1);
  }
  console.log(`${file}: no runtime codegen`);
}
