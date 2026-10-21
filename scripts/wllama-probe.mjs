// Load FrogNano through llama.cpp's WebGPU backend and generate a few tokens.
// A short prompt first, then a few thousand tokens, which is where the ONNX
// WebGPU path hung the GPU. Does not open the app or its agent prompt.
//   node scripts/wllama-probe.mjs
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const root = new URL("..", import.meta.url).pathname;
const ggufDir = join(homedir(), ".cache/suiteleaf-models/gguf");
const modelFile = "FrogNano-4B-2609-Q3_K_M.gguf";
const wasm = join(root, "node_modules/@wllama/wllama/esm/wasm/wllama.wasm");
const lib = join(root, "node_modules/@wllama/wllama/esm/index.js");
const port = Number(process.env.WLLAMA_PROBE_PORT ?? 0);

const pageHtml = `<!doctype html>
<meta charset="utf-8">
<pre id="log"></pre>
<script type="module">
const log = (line) => {
  document.getElementById("log").textContent += line + "\\n";
  console.log("[wllama-probe] " + line);
};
try {
const adapter = await navigator.gpu?.requestAdapter();
log("adapter " + (adapter ? (adapter.info?.description || adapter.info?.vendor || "yes") : "none") + " f16=" + !!adapter?.features.has("shader-f16"));
const { Wllama } = await import("/wllama.js");
const w = new Wllama({ default: new URL("/wllama.wasm", location.href).href });
log("webgpu " + w.isSupportWebGPU());
const started = performance.now();
await w.loadModelFromUrl(new URL("/gguf/${modelFile}", location.href).href, {
  n_ctx: 8192,
  n_batch: 512,
  n_ubatch: 512,
  n_gpu_layers: 99999,
  n_parallel: 1,
  warmup: false,
  progressCallback: ({ loaded, total }) => {
    if (total && (loaded === total || loaded % (256 * 1024 * 1024) < 1024 * 1024)) log("bytes " + loaded + "/" + total);
  },
});
const layers = w.getModelMetadata().hparams.nLayer;
log("loaded in " + Math.round(performance.now() - started) + " ms, layers " + layers);
if (!layers) throw new Error("model did not load");
const short = await w.createCompletion({
  prompt: "<|im_start|>user\\nHi<|im_end|>\\n<|im_start|>assistant\\n",
  max_tokens: 16,
  temperature: 0,
  seed: 1,
});
log("short " + JSON.stringify(short.choices[0].text));
log("short timings " + JSON.stringify(short.timings || short.usage));
const filler = "The quick brown fox jumps over the lazy dog. ".repeat(400);
const longStarted = performance.now();
const long = await w.createCompletion({
  prompt: "<|im_start|>user\\n" + filler + "<|im_end|>\\n<|im_start|>assistant\\n",
  max_tokens: 8,
  temperature: 0,
  seed: 1,
});
log("long " + Math.round(performance.now() - longStarted) + " ms " + JSON.stringify(long.choices[0].text));
log("long timings " + JSON.stringify(long.timings || long.usage));
log("done");
await w.exit();
} catch (error) {
  log("failed " + (error && error.message ? error.message : error));
}
</script>`;

function send(req, res, file, type) {
  return stat(file).then(({ size }) => {
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Number(range[2]) : size - 1;
      res.writeHead(206, {
        "content-type": type,
        "content-length": end - start + 1,
        "content-range": `bytes ${start}-${end}/${size}`,
        "accept-ranges": "bytes",
      });
      if (req.method === "HEAD") return res.end();
      return createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { "content-type": type, "content-length": size, "accept-ranges": "bytes" });
    if (req.method === "HEAD") return res.end();
    return createReadStream(file).pipe(res);
  });
}

const server = createServer((req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  if (path === "/wllama.js") return send(req, res, lib, "text/javascript");
  if (path === "/wllama.wasm") return send(req, res, wasm, "application/wasm");
  if (path.startsWith("/gguf/")) {
    const name = path.slice("/gguf/".length);
    if (!name || name.includes("/") || name.includes("..")) return res.writeHead(404).end();
    return send(req, res, join(ggufDir, name), "application/octet-stream");
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(pageHtml);
});
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
const actualPort = server.address().port;
console.log(`probe http://127.0.0.1:${actualPort}/`);

const profile = await mkdtemp(join(tmpdir(), "wllama-probe-"));
const browser = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: false,
  args: ["--enable-unsafe-webgpu"],
});
const page = browser.pages()[0] ?? (await browser.newPage());
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => {
  const text = m.text();
  if (text.includes("[wllama-probe]") || m.type() === "error" || text.toLowerCase().includes("gpu") || text.toLowerCase().includes("wasm"))
    console.log("[console]", text.slice(0, 500));
});
try {
  await page.goto(`http://127.0.0.1:${actualPort}/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const text = document.getElementById("log").textContent;
    return text.includes("\ndone") || text.includes("\nfailed");
  }, null, { timeout: 12 * 60_000 });
  const text = await page.locator("#log").textContent();
  console.log(text);
  console.log(text.includes("\nfailed") ? "PROBE FAILED" : "PROBE OK");
  if (text.includes("\nfailed")) process.exitCode = 1;
} catch (error) {
  console.log("PROBE FAILED", error instanceof Error ? error.message : error);
  console.log(await page.locator("#log").textContent().catch(() => ""));
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  server.close();
}
