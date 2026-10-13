import { test as base, expect, type Page } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

const root = resolve(import.meta.dirname, "../..");
export const videos = join(root, "storyboards/videos");
const size = { width: 1280, height: 800 };

/** Draws the pointer, which Playwright's recordings do not show. */
const cursorScript = `
(() => {
  const install = () => {
    if (document.getElementById("storyboard-cursor")) return;
    const dot = document.createElement("div");
    dot.id = "storyboard-cursor";
    dot.style.cssText = "position:fixed;left:0;top:0;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(26,115,232,.35);border:2px solid #1a73e8;z-index:2147483647;pointer-events:none;transition:transform .12s;";
    document.documentElement.appendChild(dot);
    addEventListener("mousemove", (e) => { dot.style.left = e.clientX + "px"; dot.style.top = e.clientY + "px"; }, true);
    addEventListener("mousedown", () => { dot.style.transform = "scale(.6)"; }, true);
    addEventListener("mouseup", () => { dot.style.transform = "scale(1)"; }, true);
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", install);
  else install();
})();`;

/**
 * Each storyboard is one test whose title is its slug (for example
 * "08-sort-data"). A passing run saves storyboards/videos/<slug>.mp4.
 */
export const test = base.extend<{ page: Page }>({
  page: async ({ browser, baseURL }, provide, info) => {
    const dir = mkdtempSync(join(tmpdir(), "storyboard-video-"));
    const context = await browser.newContext({
      baseURL,
      viewport: size,
      recordVideo: { dir, size },
      acceptDownloads: true,
    });
    context.setDefaultTimeout(15000);
    await context.addInitScript(cursorScript);
    const page = await context.newPage();
    await provide(page);
    const video = page.video();
    await context.close();
    if (info.status === info.expectedStatus && video) {
      mkdirSync(videos, { recursive: true });
      const webm = await video.path();
      execFileSync("ffmpeg", [
        "-y", "-loglevel", "error", "-i", webm,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-r", "20",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        join(videos, `${info.title}.mp4`),
      ]);
    }
    rmSync(dir, { recursive: true, force: true });
  },
});
export { expect };

/** Show a caption bar describing the current scene, then let viewers read it. */
export async function caption(page: Page, text: string, hold = 1400) {
  await page.evaluate((value) => {
    let bar = document.getElementById("storyboard-caption");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "storyboard-caption";
      bar.style.cssText =
        "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);max-width:80%;padding:10px 18px;border-radius:10px;background:rgba(32,33,36,.88);color:#fff;font:500 17px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;text-align:center;z-index:2147483646;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,.25);";
      document.documentElement.appendChild(bar);
    }
    bar.textContent = value;
  }, text);
  await page.waitForTimeout(hold);
}

/** A pause so the result of an action is visible in the recording. */
export const beat = (page: Page, ms = 900) => page.waitForTimeout(ms);

/** Type like a person, so text appears progressively in the video. */
export async function typeSlowly(page: Page, text: string, delay = 35) {
  await page.keyboard.type(text, { delay });
}

/** Select a spreadsheet cell or range through the name box, e.g. "B2" or "A1:C5". */
export async function selectCells(page: Page, ref: string) {
  const box = page.locator(".sheet-host input.univer-size-full");
  await box.fill(ref);
  await box.press("Enter");
  await beat(page, 300);
}

async function freePort() {
  return new Promise<number>((done) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => done(port));
    });
  });
}

export interface Server {
  url: string;
  p2p: string;
  stop: () => void;
}

const nodeBinary = process.env.STORYBOARD_NODE ?? join(root, "target/debug/suiteleaf-node");
const authBundle = process.env.STORYBOARD_AUTH ?? join(root, "services/auth/dist/server.mjs");
export const clusterReady = existsSync(nodeBinary) && existsSync(authBundle);

/**
 * Start a SuiteLeaf server serving the storyboard web build in cluster mode.
 * `join` adds it to an existing server's cluster; `corsOrigins` lets apps
 * served elsewhere (such as the storyboard static build) connect to it.
 */
export async function startServer(
  join_?: { dataDir: string; p2p: string },
  corsOrigins: string[] = [],
): Promise<Server & { dataDir: string }> {
  const dataDir = mkdtempSync(join(tmpdir(), "storyboard-node-"));
  const children: ChildProcess[] = [];
  if (join_)
    execFileSync(nodeBinary, [
      "init", "--data-dir", dataDir, "--swarm-key", join(join_.dataDir, "swarm.key"),
    ]);
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const config = join(dataDir, "node.toml");
  writeFileSync(config, `[auth]\ncommand = ${JSON.stringify(["node", authBundle])}\n`);
  const child = spawn(
    nodeBinary,
    [
      "run", "--init", "--config", config, "--data-dir", dataDir,
      "--http", `127.0.0.1:${port}`, "--public-url", url,
      "--listen", "/ip4/127.0.0.1/tcp/0", "--sync-interval", "1",
      "--web-root", resolve(process.env.STORYBOARD_DIST ?? join(root, "apps/web/dist")),
      ...(join_ ? ["--bootstrap", join_.p2p] : []),
      ...corsOrigins.flatMap((origin) => ["--cors-origin", origin]),
    ],
    {
      env: {
        ...process.env,
        SUITELEAF_AUTH_SECRET: "storyboard-recording-secret-0123456789abcdef",
        RUST_LOG: "warn",
      },
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  children.push(child);
  const p2p = await new Promise<string>((done, fail) => {
    child.once("exit", (code) => fail(new Error(`server exited (${code})`)));
    createInterface({ input: child.stdout! }).on("line", (line) => {
      if (line.startsWith("SUITELEAF_NODE_READY ")) done(JSON.parse(line.slice(21)).p2p[0]);
    });
  });
  await expect
    .poll(async () => (await (await fetch(`${url}/api/node/info`)).json()).auth.enabled, {
      timeout: 20000,
    })
    .toBe(true);
  return { url, p2p, dataDir, stop: () => children.forEach((c) => c.kill()) };
}
