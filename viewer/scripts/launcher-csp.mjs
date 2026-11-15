// Records the hash sources of the built launcher's inline scripts and styles in
// dist-launcher/launcher.csp.json. The launcher server sends its policy as an HTTP header built
// from them (D-059), so the page itself carries no meta tag.
// Usage: node scripts/launcher-csp.mjs [file]
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { inlineScriptSources, inlineStyleSources } from "./csp.mjs";

const file = process.argv[2] ?? "dist-launcher/launcher.html";
try {
  const html = readFileSync(file, "utf8");
  if (/http-equiv\s*=\s*["']?content-security-policy/i.test(html)) {
    throw new Error("the launcher must not carry a policy meta tag; the server sends the header");
  }
  const scriptSources = inlineScriptSources(html);
  if (scriptSources.length === 0) throw new Error("the launcher has no inline script");
  const out = path.join(path.dirname(file), "launcher.csp.json");
  const record = { script_sources: scriptSources, style_sources: inlineStyleSources(html) };
  writeFileSync(out, JSON.stringify(record, null, 2) + "\n");
  console.log(
    `${out}: ${scriptSources.length} script and ${record.style_sources.length} style hashes`,
  );
} catch (error) {
  console.error(`${file}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
