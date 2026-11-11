// The Content-Security-Policy of the built map: one <meta> tag, added after the single-file
// build, that allows exactly the inline scripts in the file (by sha256) and nothing else.
// The hashes are computed from the parsed document, so they are the ones the browser computes.
import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";

/** Matches the charset meta, which opens the head: the policy goes right after it. */
const CHARSET_META = /<meta\s+charset="[^"]*"\s*\/?>/i;

/** The id of the JSON data script that `schemamap view` fills in. It is a data block. */
export const DATA_SCRIPT_ID = "schemamap-data";

/** The directives that do not depend on the page's scripts, in policy order. */
const BEFORE_SCRIPTS = ["default-src 'none'"];
const AFTER_SCRIPTS = [
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "worker-src blob:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
];

/** The `script-src` source for `text`: `'sha256-<base64 of the SHA-256 of its UTF-8 bytes>'`. */
export function scriptSource(text) {
  return `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
}

/** The full policy for a page whose executable inline scripts have these sources. */
export function buildPolicy(sources) {
  const scriptSrc = `script-src ${sources.join(" ")}`;
  return [...BEFORE_SCRIPTS, scriptSrc, ...AFTER_SCRIPTS].join("; ");
}

/** The CSP meta tag for `policy`. The policy holds no double quote, so it needs no escaping. */
export function metaTag(policy) {
  return `<meta http-equiv="Content-Security-Policy" content="${policy}" />`;
}

/** Whether a script `type` attribute value makes the script executable by the browser. */
function isExecutableType(type) {
  return type === null || type === "" || type === "module";
}

/**
 * Parse `html` as a browser does and describe its scripts.
 * Throws on a script the policy could not describe: an external one, an import map, or any type
 * that is neither JavaScript nor a JSON data block.
 */
function parsePage(html) {
  const document = new JSDOM(html).window.document;
  const executable = [];
  for (const script of document.querySelectorAll("script")) {
    if (script.hasAttribute("src")) {
      throw new Error(`external script ${JSON.stringify(script.getAttribute("src"))}`);
    }
    const type = script.getAttribute("type");
    if (isExecutableType(type)) {
      executable.push(script);
    } else if (type !== "application/json") {
      throw new Error(`script of unsupported type ${JSON.stringify(type)}`);
    }
  }
  return { document, executable };
}

/** The sources of the executable inline scripts of `html`, in document order, without repeats. */
export function inlineScriptSources(html) {
  const { executable } = parsePage(html);
  return [...new Set(executable.map((script) => scriptSource(script.textContent ?? "")))];
}

/** The CSP meta elements of a document. */
function policyMetas(document) {
  return [...document.querySelectorAll("meta[http-equiv]")].filter(
    (meta) => meta.getAttribute("http-equiv")?.toLowerCase() === "content-security-policy",
  );
}

/** Returns `html` with the CSP meta added after the charset meta. Throws if it cannot. */
export function addCsp(html) {
  const { document, executable } = parsePage(html);
  if (policyMetas(document).length > 0) {
    throw new Error("the page already has a Content-Security-Policy meta tag");
  }
  if (executable.length === 0) {
    throw new Error("the page has no inline script; the build output is not what is expected");
  }
  const charset = CHARSET_META.exec(html);
  if (charset === null) {
    throw new Error("the page has no charset meta tag to place the policy after");
  }
  const sources = inlineScriptSources(html);
  const at = charset.index + charset[0].length;
  return `${html.slice(0, at)}\n    ${metaTag(buildPolicy(sources))}${html.slice(at)}`;
}

/** The sources named by one directive of a policy (empty if it is absent). */
function directiveSources(policy, name) {
  for (const directive of policy.split(";")) {
    const [directiveName, ...sources] = directive.trim().split(/\s+/);
    if (directiveName === name) {
      return sources;
    }
  }
  return [];
}

/**
 * Everything wrong with the policy of a built map, as messages; empty when it is right.
 * The policy must be one meta tag before every script, `script-src` must hold only the sha256
 * sources of the inline scripts, it must not allow `eval`, and the rest must be the exact policy.
 */
export function cspProblems(html) {
  let page;
  try {
    page = parsePage(html);
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
  const { document, executable } = page;
  const metas = policyMetas(document);
  if (metas.length === 0) {
    return ["no Content-Security-Policy meta tag"];
  }
  if (metas.length > 1) {
    return [`${String(metas.length)} Content-Security-Policy meta tags, expected exactly one`];
  }
  const meta = metas[0];
  const policy = meta.getAttribute("content") ?? "";
  const problems = [];

  const early = [...document.querySelectorAll("script")].find(
    (script) => meta.compareDocumentPosition(script) & 2, // DOCUMENT_POSITION_PRECEDING
  );
  if (early !== undefined) {
    problems.push("a script comes before the Content-Security-Policy meta tag");
  }
  if (policy.includes("unsafe-eval")) {
    problems.push("the policy allows 'unsafe-eval'");
  }
  const allowed = directiveSources(policy, "script-src");
  for (const source of allowed.filter(
    (source) => !/^'sha256-[A-Za-z0-9+/]+={0,2}'$/.test(source),
  )) {
    problems.push(`script-src has ${source}, which is not a sha256 source`);
  }
  const actual = new Set(executable.map((script) => scriptSource(script.textContent ?? "")));
  for (const source of actual) {
    if (!allowed.includes(source)) {
      problems.push(
        `script-src does not list an inline script (${source}); the browser would block it`,
      );
    }
  }
  for (const source of allowed) {
    if (/^'sha256-/.test(source) && !actual.has(source)) {
      problems.push(`script-src lists ${source}, which matches no inline script`);
    }
  }
  if (problems.length === 0 && policy !== buildPolicy([...actual])) {
    problems.push("the policy is not the expected one for this page");
  }
  return problems;
}
