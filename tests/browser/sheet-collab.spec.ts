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
  type SheetFile,
} from "../../packages/core/src";

const root = resolve(import.meta.dirname, "../..");
const binary =
  [process.env.SUITELEAF_NODE, join(root, "target/debug/suiteleaf-node")].find(
    (path) => path && existsSync(path),
  ) ?? "";
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
  const dir = mkdtempSync(join(tmpdir(), "suiteleaf-sheet-collab-"));
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  writeFileSync(join(dir, "node.toml"), `[auth]\ncommand = ${JSON.stringify(["node", sidecar])}\n`);
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
        SUITELEAF_AUTH_SECRET: "sheet-collab-playwright-secret-0123456789",
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

function plots(): SheetFile {
  const file = createFile("sheet", "Plots") as SheetFile;
  const feesId = file.content.workbook.sheetOrder[0];
  const fees = file.content.workbook.sheets[feesId];
  fees.name = "Fees";
  fees.cellData = { 0: { 1: { v: "Stay", t: 1 } } };
  const bedsId = crypto.randomUUID();
  file.content.workbook.sheetOrder.push(bedsId);
  file.content.workbook.sheets[bedsId] = {
    ...structuredClone(fees),
    id: bedsId,
    name: "Beds",
    cellData: { 0: { 0: { v: "West", t: 1 } } },
  };
  return file;
}

async function go(page: Page, ref: string) {
  const box = page.locator(".sheet-host input.univer-size-full");
  await box.fill(ref);
  await box.press("Enter");
}

test("an incoming cell appears in the grid and the other worksheet stays separate", async ({
  browser,
}) => {
  test.skip(!ready, "Build the node, auth bundle, and web app first.");
  test.setTimeout(120_000);
  const node = await startNode();
  const contexts: BrowserContext[] = [];
  try {
    const maya = await signup(node.url, "Maya Chen", "maya-sheet@gardenclub.org");
    const sam = await signup(node.url, "Sam Ortiz", "sam-sheet@gardenclub.org");
    const file = plots();
    const item = await (
      await authed(node.url, maya.token, "/api/drive/items", {
        method: "POST",
        body: JSON.stringify({
          name: nativeFilename(file),
          kind: "file",
          mime: mimeFor(file.kind),
        }),
      })
    ).json();
    await authed(node.url, maya.token, `/api/drive/items/${item.id}/content`, {
      method: "PUT",
      headers: { "content-type": mimeFor(file.kind) },
      body: serializeFile(file),
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
    await samPage.getByRole("button", { name: "Plots.slsheet", exact: true }).click();
    const samGrid = samPage.getByLabel("Spreadsheet grid");
    await expect(samGrid).toHaveAttribute("aria-busy", "false");
    await go(samPage, "B1");
    await expect(samGrid).toHaveAttribute("data-active-value", "Stay");

    const mayaContext = await browser.newContext();
    contexts.push(mayaContext);
    const mayaPage = await openAs(mayaContext, node.url, maya);
    await mayaPage.getByRole("button", { name: "Plots.slsheet", exact: true }).click();
    const mayaGrid = mayaPage.getByLabel("Spreadsheet grid");
    await expect(mayaGrid).toHaveAttribute("aria-busy", "false");
    await go(mayaPage, "A1");
    await expect(samPage.locator(".sheet-remote-selections")).toContainText("Maya Chen A1");
    const remoteRange = samPage.locator(".sheet-remote-range");
    await expect(remoteRange).toContainText("Maya Chen A1");
    const rangeBox = await remoteRange.boundingBox();
    const gridBox = await samGrid.boundingBox();
    expect(rangeBox).toBeTruthy();
    expect(gridBox).toBeTruthy();
    expect(rangeBox!.x).toBeGreaterThanOrEqual(gridBox!.x - 2);
    expect(rangeBox!.y).toBeGreaterThanOrEqual(gridBox!.y - 2);
    expect(rangeBox!.x).toBeLessThan(gridBox!.x + gridBox!.width);
    expect(rangeBox!.y).toBeLessThan(gridBox!.y + gridBox!.height);
    await expect(samGrid).toHaveAttribute("data-active-value", "Stay");
    await mayaPage.keyboard.type("North");
    await mayaPage.keyboard.press("Enter");
    await go(mayaPage, "A1");
    await expect(mayaGrid).toHaveAttribute("data-active-value", "North");

    await expect(samGrid).toHaveAttribute("data-active-value", "Stay");
    await go(samPage, "A1");
    await expect(samGrid).toHaveAttribute("data-active-value", "North");

    await samPage.getByRole("tab", { name: "Beds", exact: true }).click();
    await go(samPage, "A1");
    await expect(samGrid).toHaveAttribute("data-active-value", "West");
    await samPage.getByRole("tab", { name: "Fees", exact: true }).click();
    await go(samPage, "A1");
    await expect(samGrid).toHaveAttribute("data-active-value", "North");

    await go(mayaPage, "A1:B2");
    await mayaPage.getByRole("button", { name: "Insert chart", exact: true }).click();
    await mayaPage.getByRole("button", { name: "Create chart", exact: true }).click();
    await expect(mayaPage.getByLabel(/^Chart:/)).toBeVisible();
    await expect(samPage.getByLabel(/^Chart:/)).toBeVisible();
  } finally {
    for (const context of contexts) await context.close();
    node.child.kill();
  }
});
