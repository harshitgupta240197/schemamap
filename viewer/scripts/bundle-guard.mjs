// Fails if the built single-file viewer contains runtime code generation, which a strict
// no-eval Content-Security-Policy would block. Usage: node scripts/bundle-guard.mjs [file]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FORBIDDEN = ["new Function", "eval(", "require("];

/** Returns the forbidden constructs found in `html`, in FORBIDDEN order. */
export function findForbidden(html) {
  return FORBIDDEN.filter((needle) => html.includes(needle));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] ?? "dist/index.html";
  const found = findForbidden(readFileSync(file, "utf8"));
  if (found.length > 0) {
    console.error(`${file} contains runtime codegen: ${found.join(", ")}`);
    process.exit(1);
  }
  console.log(`${file}: no runtime codegen`);
}
