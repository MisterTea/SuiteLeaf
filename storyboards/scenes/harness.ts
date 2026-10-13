import { test as base, expect, _electron as electron, type Page } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

/** Record the Electron desktop app instead of the web build (AI storyboards). */
export const electronMode = process.env.STORYBOARD_ELECTRON === "1";

/** Settings the in-app assistant reads, for AI storyboards. */
function assistantScript(baseURL: string | undefined) {
  const models = process.env.STORYBOARD_MODEL_HOST ?? `${baseURL}/models/`;
  const device = process.env.STORYBOARD_AI_DEVICE ?? "webgpu";
  return `(() => {
    localStorage.setItem("suiteleaf.ai.modelHost", ${JSON.stringify(models)});
    if (${JSON.stringify(device)} === "auto") localStorage.removeItem("suiteleaf.ai.device");
    else localStorage.setItem("suiteleaf.ai.device", ${JSON.stringify(device)});
  })();`;
}

function encode(webm: string, mp4: string) {
  mkdirSync(dirname(mp4), { recursive: true });
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error", "-i", webm,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-r", "20",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    mp4,
  ]);
}

/**
 * Each storyboard is one test whose title is its slug (for example
 * "08-sort-data"). A passing run saves storyboards/videos/<slug>.mp4. AI
 * storyboards ("…-ai") also keep failed runs, in test-results/ai-videos, so
 * the model's mistakes can be watched.
 */
export const test = base.extend<{ page: Page }>({
  page: async ({ browser, baseURL }, provide, info) => {
    const ai = info.title.endsWith("-ai");
    const dir = mkdtempSync(join(tmpdir(), "storyboard-video-"));
    let page: Page;
    let close: () => Promise<void>;
    if (electronMode) {
      const data = mkdtempSync(join(tmpdir(), "storyboard-electron-"));
      const app = await electron.launch({
        args: [join(root, "apps/desktop/out/main/index.js")],
        env: {
          ...process.env,
          SUITELEAF_TEST_DATA: join(data, "library"),
          SUITELEAF_SETTINGS: join(data, "settings.json"),
          SUITELEAF_HIDE_WINDOWS: process.env.SUITELEAF_HIDE_WINDOWS ?? "1",
          SUITELEAF_MODEL_PATH:
            process.env.SUITELEAF_MODEL_PATH ??
            join(homedir(), ".cache/suiteleaf-models/gguf/gemma-4-E4B-it-Q4_0.gguf"),
        },
        recordVideo: { dir, size },
      });
      page = await app.firstWindow();
      await page.setViewportSize(size);
      await page.context().addInitScript(cursorScript);
      await page.reload();
      page.context().setDefaultTimeout(15000);
      close = async () => {
        await app.close();
        rmSync(data, { recursive: true, force: true });
      };
    } else {
      const context = await browser.newContext({
        baseURL,
        viewport: size,
        recordVideo: { dir, size },
        acceptDownloads: true,
      });
      context.setDefaultTimeout(15000);
      await context.addInitScript(cursorScript);
      if (ai) await context.addInitScript(assistantScript(baseURL));
      page = await context.newPage();
      close = () => context.close();
    }
    await provide(page);
    const video = page.video();
    await close();
    const passed = info.status === info.expectedStatus;
    if (video && (passed || ai)) {
      const name = `${info.title}.mp4`;
      encode(
        await video.path(),
        passed
          ? join(videos, electronMode ? "electron" : "", name)
          : join(root, "test-results/ai-videos", electronMode ? "electron" : "", name),
      );
    }
    rmSync(dir, { recursive: true, force: true });
  },
});

/** Go to the app's home screen (the web build's start page, or the desktop window). */
export async function openApp(page: Page) {
  if (electronMode) await page.evaluate(() => (location.hash = "#/"));
  else await page.goto("/");
}

const agentRuns = new Map<string, unknown[]>();

export interface AgentRun {
  state: string;
  metrics: Record<string, unknown> & { toolCalls: number; tools: string[] };
  items: { kind: string; name?: string; args?: unknown; status?: string; result?: string; text?: string }[];
  seconds: number;
}

/**
 * Ask the assistant to do something, the way a person would: open the AI
 * panel, type the request, and wait for Gemma to finish. Files the agent asks
 * for are chosen from `files` (the person picks them). The run's transcript
 * and metrics are saved to test-results/ai-metrics/<title>.json.
 */
export async function askAgent(
  page: Page,
  prompt: string,
  options: { files?: { name: string; mimeType: string; buffer: Buffer }[]; timeoutMs?: number } = {},
): Promise<AgentRun> {
  const panel = page.locator(".agent-sidebar");
  if (!(await panel.isVisible())) {
    await page.getByRole("button", { name: "AI assistant" }).first().click();
    await panel.waitFor();
  }
  const box = page.getByRole("textbox", { name: "Ask the assistant" });
  await box.click();
  await typeSlowly(page, prompt, 18);
  await beat(page, 300);
  await box.press("Enter");
  const started = Date.now();
  const timeout = options.timeoutMs ?? 15 * 60_000;
  const files = [...(options.files ?? [])];
  for (;;) {
    const state = await panel.getAttribute("data-agent-state");
    if (state === "done" || state === "error") break;
    if (Date.now() - started > timeout) break;
    const choose = page.getByRole("button", { name: "Choose file…" });
    if (files.length && (await choose.isVisible().catch(() => false))) {
      const chooser = page.waitForEvent("filechooser");
      await choose.click();
      await (await chooser).setFiles(files.shift()!);
    }
    await page.waitForTimeout(500);
  }
  const run = (await page.evaluate(() => {
    const agent = (window as unknown as { __suiteleafAgent: Record<string, () => unknown> }).__suiteleafAgent;
    return { state: agent.state(), metrics: agent.metrics(), items: agent.items() };
  })) as Omit<AgentRun, "seconds">;
  const result = { ...run, seconds: Math.round((Date.now() - started) / 1000) };
  const info = base.info();
  const out = join(root, "test-results/ai-metrics", electronMode ? "electron" : "", `${info.title}.json`);
  const runs = (agentRuns.get(info.testId) ?? []).concat({ prompt, ...result });
  agentRuns.set(info.testId, runs);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ title: info.title, retry: info.retry, runs }, null, 2));
  await info.attach(`agent: ${prompt.slice(0, 40)}`, { body: JSON.stringify(result, null, 2), contentType: "application/json" });
  return result;
}

/** Fail with the agent's transcript, so a failed AI storyboard explains itself. */
export function describeRun(run: AgentRun) {
  return run.items
    .map((i) =>
      i.kind === "tool" ? `→ ${i.name} ${JSON.stringify(i.args)} [${i.status}] ${(i.result ?? "").split("\n")[0]}` : `${i.kind}: ${i.text}`,
    )
    .join("\n");
}
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
