// Fake cloud sidecar for stress tests. Runs the real Better Auth sidecar on a
// private port and stands in for the Vercel Blob bridge with a shared local
// directory (FAKE_BLOB_DIR), so several node containers on one Postgres
// behave like Fluid instances without any Vercel service.
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const port = Number(process.env.SUITELEAF_AUTH_PORT);
const root = process.env.FAKE_BLOB_DIR || "/fakeblobs";
const token = process.env.SUITELEAF_INTERNAL_TOKEN || "";
fs.mkdirSync(root, { recursive: true });

const child = spawn("node", ["/opt/suiteleaf/auth/server.mjs"], {
  env: { ...process.env, SUITELEAF_AUTH_PORT: "0" },
  stdio: ["pipe", "pipe", "inherit"],
});
process.stdin.on("end", () => {
  child.kill();
  process.exit(0);
});
process.stdin.resume();
child.on("exit", (code) => process.exit(code ?? 1));

const file = (hash) => path.join(root, hash);
function blobs(req, res, name) {
  if (req.headers.authorization !== `Bearer ${token}`) return res.writeHead(401).end();
  if (name === "usage") {
    let total = 0;
    for (const f of fs.readdirSync(root)) if (/^[a-f0-9]{64}$/.test(f)) total += fs.statSync(file(f)).size;
    return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(total));
  }
  if (!/^[a-f0-9]{64}$/.test(name)) return res.writeHead(400).end();
  const target = file(name);
  if (req.method === "GET" || req.method === "HEAD") {
    if (!fs.existsSync(target)) return res.writeHead(404).end();
    if (req.method === "HEAD") return res.writeHead(200).end();
    return res.writeHead(200, { "content-type": "application/octet-stream" }).end(fs.readFileSync(target));
  }
  if (req.method === "PUT") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const tmp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      fs.writeFileSync(tmp, Buffer.concat(chunks));
      fs.renameSync(tmp, target);
      res.writeHead(200).end();
    });
    return;
  }
  if (req.method === "DELETE") {
    fs.rmSync(target, { force: true });
    fs.appendFileSync(path.join(root, "_deletes.log"), `${name}\n`);
    return res.writeHead(200).end();
  }
  res.writeHead(405).end();
}

let upstream = 0;
let buffered = "";
child.stdout.on("data", (chunk) => {
  buffered += chunk;
  let i;
  while ((i = buffered.indexOf("\n")) >= 0) {
    const line = buffered.slice(0, i);
    buffered = buffered.slice(i + 1);
    const ready = line.match(/^SUITELEAF_AUTH_READY (\d+)/);
    if (ready && !upstream) {
      upstream = Number(ready[1]);
      server.listen(port, "127.0.0.1", () => console.log(`SUITELEAF_AUTH_READY ${port}`));
    } else if (!ready) console.log(line);
  }
});

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname.startsWith("/internal/cloud/blobs/"))
    return blobs(req, res, url.pathname.slice("/internal/cloud/blobs/".length));
  const proxied = http.request(
    { host: "127.0.0.1", port: upstream, method: req.method, path: req.url, headers: req.headers },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  proxied.on("error", () => res.writeHead(502).end());
  req.pipe(proxied);
});
