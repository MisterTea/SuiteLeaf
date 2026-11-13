import { editSlideText } from "./slide-text-helpers";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import {
  createFile,
  mimeFor,
  nativeFilename,
  serializeFile,
  type SlideFile,
} from "../../packages/core/src";

const root = resolve(import.meta.dirname, "../..");
const binary =
  [
    process.env.SUITELEAF_NODE,
    join(root, "target/debug/suiteleaf-node"),
  ].find((path) => path && existsSync(path)) ?? "";
const sidecar = join(root, "services/auth/dist/server.mjs");
const webRoot = join(root, "apps/web/dist");
const ready = [binary, sidecar, join(webRoot, "index.html")].every((path) => path && existsSync(path));
const password = "garden-club";

interface Account {
  token: string;
  user: { id: string; name: string; email: string };
}

async function freePort() {
  return new Promise<number>((done) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => done(port));
    });
  });
}

async function startNode() {
  const dir = mkdtempSync(join(tmpdir(), "suiteleaf-slide-collab-"));
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  writeFileSync(
    join(dir, "node.toml"),
    `[auth]\ncommand = ${JSON.stringify(["node", sidecar])}\n`,
  );
  const child = spawn(
    binary,
    [
      "run",
      "--init",
      "--config",
      join(dir, "node.toml"),
      "--data-dir",
      dir,
      "--http",
      `127.0.0.1:${port}`,
      "--public-url",
      url,
      "--listen",
      "/ip4/127.0.0.1/tcp/0",
      "--web-root",
      webRoot,
      "--cors-origin",
      new URL(test.info().project.use.baseURL!).origin,
    ],
    {
      env: {
        ...process.env,
        SUITELEAF_AUTH_SECRET: "slide-collab-playwright-secret-0123456789",
        RUST_LOG: "warn",
      },
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  await new Promise<void>((done, fail) => {
    child.once("exit", (code) => fail(new Error(`node exited (${code})`)));
    createInterface({ input: child.stdout! }).on("line", (line) => {
      if (line.startsWith("SUITELEAF_NODE_READY ")) done();
    });
  });
  await expect
    .poll(async () => (await fetch(`${url}/api/auth/suiteleaf/providers`)).ok, {
      timeout: 20000,
    })
    .toBe(true);
  return { url, child };
}

async function signup(url: string, name: string, email: string): Promise<Account> {
  const response = await fetch(`${url}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: url },
    body: JSON.stringify({ name, email, password }),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function authed(url: string, token: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(`${url}${path}`, { ...init, headers });
  if (!response.ok) throw new Error(`${path} ${response.status} ${await response.text()}`);
  return response;
}

async function openAs(context: BrowserContext, url: string, account: Account) {
  const page = await context.newPage();
  await page.addInitScript(
    (session) => localStorage.setItem("suiteleaf:node-session", JSON.stringify(session)),
    { url, token: account.token, user: account.user },
  );
  await page.goto(url);
  return page;
}

function gardenDeck(): SlideFile {
  const deck = createFile("slide", "Garden") as SlideFile;
  const firstId = deck.content.slideOrder[0];
  const first = deck.content.slides[firstId];
  first.title = "North";
  first.elements[0].content = "North";
  first.elements[1].content = "Beds";
  const secondId = crypto.randomUUID();
  const second = structuredClone(first);
  second.id = secondId;
  second.title = "Beds";
  second.elements = [
    {
      ...second.elements[0],
      id: crypto.randomUUID(),
      content: "Keep",
    },
  ];
  deck.content.slideOrder.push(secondId);
  deck.content.slides[secondId] = second;
  return deck;
}

async function openDeck(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.locator(".slide-canvas")).toBeVisible();
}

test("another person's slide edit shows on the canvas and this slide stays put", async ({
  browser,
}) => {
  test.skip(!ready, "Build the node, auth bundle, and web app first.");
  test.setTimeout(120_000);
  const node = await startNode();
  const contexts: BrowserContext[] = [];
  try {
    const maya = await signup(node.url, "Maya Chen", "maya-slide@gardenclub.org");
    const sam = await signup(node.url, "Sam Ortiz", "sam-slide@gardenclub.org");
    const deck = gardenDeck();
    const item = await (
      await authed(node.url, maya.token, "/api/drive/items", {
        method: "POST",
        body: JSON.stringify({
          name: nativeFilename(deck),
          kind: "file",
          mime: mimeFor(deck.kind),
        }),
      })
    ).json();
    await authed(node.url, maya.token, `/api/drive/items/${item.id}/content`, {
      method: "PUT",
      headers: { "content-type": mimeFor(deck.kind) },
      body: serializeFile(deck),
    });
    await authed(node.url, maya.token, `/api/drive/items/${item.id}/acl`, {
      method: "PUT",
      body: JSON.stringify({
        principalType: "user",
        principalId: sam.user.id,
        role: "editor",
      }),
    });

    const samContext = await browser.newContext();
    contexts.push(samContext);
    const samPage = await openAs(samContext, node.url, sam);
    await samPage.getByRole("tab", { name: "Shared with me" }).click();
    await openDeck(samPage, "Garden.slslides");
    const samBeds = samPage.locator(".slide-canvas .slide-text").filter({ hasText: "Beds" });
    await samBeds.click();
    await expect(samBeds).toHaveClass(/selected/);

    const mayaContext = await browser.newContext();
    contexts.push(mayaContext);
    const mayaPage = await openAs(mayaContext, node.url, maya);
    await openDeck(mayaPage, "Garden.slslides");
    const mayaNorth = mayaPage.locator(".slide-canvas .slide-text").filter({ hasText: "North" });
    await editSlideText(mayaNorth);
    const editor = mayaNorth.locator(".element-editor");
    await expect(editor).toHaveAttribute("contenteditable", "true");
    await editor.press("ControlOrMeta+A");
    await editor.pressSequentially("West");

    await expect(samPage.locator(".slide-canvas")).toContainText("West");
    await expect(samBeds).toHaveClass(/selected/);
    await expect(samPage.locator(".slide-canvas .slide-text.selected")).toContainText("Beds");

    await mayaPage.getByRole("option", { name: "Slide 2: Keep" }).click();
    await expect(mayaPage.locator(".thumbnail-row.active")).toHaveAttribute("aria-label", /Slide 2:/);
    await expect(samPage.locator(".thumbnail-row.active")).toHaveAttribute("aria-label", /Slide 1:/);
    await expect(samPage.locator(".slide-canvas")).toContainText("West");
    await expect(samPage.locator(".slide-canvas")).toContainText("Beds");
  } finally {
    for (const context of contexts) await context.close();
    node.child.kill();
  }
});
