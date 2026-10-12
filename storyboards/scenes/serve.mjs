// Serves a built SuiteLeaf web app (single-node mode) for storyboard recording.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";

const port = Number(process.argv[2] ?? 4180);
const root = resolve(process.env.STORYBOARD_DIST ?? "apps/web/dist");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};
createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = resolve(join(root, path === "/" ? "index.html" : path));
  if (!file.startsWith(root + sep) && file !== root) file = join(root, "index.html");
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, "127.0.0.1");
