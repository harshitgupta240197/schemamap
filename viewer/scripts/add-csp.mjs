// Adds the Content-Security-Policy meta tag to the built single-file viewer, in place.
// Runs after `vite build` (so after the scripts are inlined). Usage: node scripts/add-csp.mjs [file]
import { readFileSync, writeFileSync } from "node:fs";
import { addCsp } from "./csp.mjs";

const file = process.argv[2] ?? "dist/index.html";
try {
  writeFileSync(file, addCsp(readFileSync(file, "utf8")));
} catch (error) {
  console.error(`${file}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
console.log(`${file}: Content-Security-Policy added`);
