// A static file server for the Playwright tests. It serves this folder exactly as Vercel does,
// and answers 501 to anything under /api: the tests mock that endpoint themselves.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".png": "image/png",
};
const PUBLIC = new Set(["index.html", "style.css", "join.js"]);

createServer((req, res) => {
  const name =
    new URL(req.url ?? "/", "http://localhost").pathname.replace(/^\/+/, "") || "index.html";
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
}).listen(4173, "127.0.0.1");
