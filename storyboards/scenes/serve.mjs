// Serves a built SuiteLeaf web app (single-node mode) for storyboard recording.
// /models/<repo>/<file> serves local model weights (STORYBOARD_MODELS) so the
// in-browser Gemma backend loads from disk instead of the Hugging Face Hub.
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join, resolve, sep } from "node:path";

const port = Number(process.argv[2] ?? 4180);
const root = resolve(process.env.STORYBOARD_DIST ?? "apps/web/dist");
const models = resolve(
  process.env.STORYBOARD_MODELS ?? join(homedir(), ".cache/suiteleaf-models"),
);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".json": "application/json",
  ".jinja": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

async function serveModel(req, res, path) {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "range",
    "access-control-expose-headers": "content-length, content-range",
  };
  if (req.method === "OPTIONS") return res.writeHead(204, cors).end();
  // Accept Hugging Face style paths (<repo>/resolve/<revision>/<file>) too.
  const relative = path.slice("/models/".length).replace(/\/resolve\/[^/]+\//, "/");
  const file = resolve(join(models, relative));
  if (!file.startsWith(models + sep)) return res.writeHead(404, cors).end();
  try {
    const { size } = await stat(file);
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
    const type = { "content-type": types[extname(file)] ?? "application/octet-stream" };
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Number(range[2]) : size - 1;
      res.writeHead(206, {
        ...cors,
        ...type,
        "content-length": end - start + 1,
        "content-range": `bytes ${start}-${end}/${size}`,
      });
      if (req.method === "HEAD") return res.end();
      return createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...cors, ...type, "content-length": size, "accept-ranges": "bytes" });
    if (req.method === "HEAD") return res.end();
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, cors).end();
  }
}

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path.startsWith("/models/")) return serveModel(req, res, path);
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
