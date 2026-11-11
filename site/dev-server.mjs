// A static file server for local work and the Playwright tests. It serves this folder as Vercel does.
// By default it answers 501 under /api (the Playwright tests mock that endpoint). When SUPABASE_URL
// is set it runs the real api/join handler instead, so the waitlist works end to end locally.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import join from "./api/join.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".png": "image/png",
};
const PUBLIC = new Set(["index.html", "style.css", "join.js"]);

const LIVE_API = Boolean(process.env.SUPABASE_URL);

/** Run api/join with the small slice of Vercel's req/res that it uses. */
async function runJoin(req, res) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const reply = {
    setHeader: (key, value) => res.setHeader(key, value),
    status(code) {
      res.statusCode = code;
      return reply;
    },
    json: (value) => res.setHeader("content-type", "application/json").end(JSON.stringify(value)),
    send: (value) => res.end(value),
  };
  await join(
    { method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString() },
    reply,
  );
}

createServer((req, res) => {
  const name =
    new URL(req.url ?? "/", "http://localhost").pathname.replace(/^\/+/, "") || "index.html";
  if (LIVE_API && name === "api/join") {
    runJoin(req, res).catch(() => res.writeHead(500).end());
    return;
  }
  const file = PUBLIC.has(name) || name.startsWith("assets/") ? path.join(ROOT, name) : null;
  if (file === null || file.includes("..")) {
    res.writeHead(name.startsWith("api/") ? 501 : 404).end();
    return;
  }
  readFile(file).then(
    (data) =>
      res
        .writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" })
        .end(data),
    () => res.writeHead(404).end(),
  );
}).listen(Number(process.env.PORT ?? 4173), "127.0.0.1");
