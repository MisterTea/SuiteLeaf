import { test, expect, type BrowserContext } from "@playwright/test";
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
  type SlideFile,
} from "../../packages/core/src";

const root = resolve(import.meta.dirname, "../..");
const binary =
  [
    process.env.SUITELEAF_NODE,
    "/tmp/sl-cargo-41/debug/suiteleaf-node",
    join(root, "target/debug/suiteleaf-node"),
  ].find((path) => path && existsSync(path)) ?? "";
const sidecar = join(root, "services/auth/dist/server.mjs");
const webRoot = join(root, "apps/web/dist");
const ready = [binary, sidecar, join(webRoot, "index.html")].every(
  (path) => path && existsSync(path),
);
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
  const dir = mkdtempSync(join(tmpdir(), "suiteleaf-view-"));
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
        SUITELEAF_AUTH_SECRET: "view-playwright-secret-0123456789abcdef",
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
    .poll(async () => (await (await fetch(`${url}/api/node/info`)).json()).auth.enabled, {
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
  if (init.body && !headers.has("content-type"))
    headers.set("content-type", "application/json");
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

test("a viewer cannot edit a sheet or a deck, and a commenter can still reply", async ({
  browser,
}) => {
  test.skip(!ready, "Build the node, auth bundle, and web app first.");
  test.setTimeout(120_000);
  const node = await startNode();
  const contexts: BrowserContext[] = [];
  try {
    const rosa = await signup(node.url, "Rosa Diaz", "rosa@gardenclub.org");
    const alex = await signup(node.url, "Alex Rivera", "alex@gardenclub.org");
    const sheet = createFile("sheet", "Plot assignments") as SheetFile;
    const sheetId = sheet.content.workbook.sheetOrder[0];
    const grid = sheet.content.workbook.sheets[sheetId];
    const rows = [
      ["Plot", "Bed", "Gardener"],
      ["1", "North", "Rosa"],
      ["2", "South", "Alex"],
      ["3", "North", "Sam"],
    ];
    grid.cellData = Object.fromEntries(
      rows.map((row, r) => [
        r,
        Object.fromEntries(row.map((v, c) => [c, { v, t: 1 }])),
      ]),
    );
    const deck = createFile("slide", "Spring fair") as SlideFile;
    deck.content.slides[deck.content.slideOrder[0]].elements[0].content = "Spring fair";
    for (const file of [sheet, deck]) {
      const item = await (
        await authed(node.url, rosa.token, "/api/drive/items", {
          method: "POST",
          body: JSON.stringify({
            name: nativeFilename(file),
            kind: "file",
            mime: mimeFor(file.kind),
          }),
        })
      ).json();
      await authed(node.url, rosa.token, `/api/drive/items/${item.id}/content`, {
        method: "PUT",
        headers: { "content-type": mimeFor(file.kind) },
        body: serializeFile(file),
      });
      await authed(node.url, rosa.token, `/api/drive/items/${item.id}/acl`, {
        method: "PUT",
        body: JSON.stringify({
          principalType: "user",
          principalId: alex.user.id,
          role: "viewer",
        }),
      });
    }

    const alexContext = await browser.newContext();
    contexts.push(alexContext);
    const page = await openAs(alexContext, node.url, alex);
    await page.getByRole("heading", { name: "SuiteDrive" }).scrollIntoViewIfNeeded();
    await page.getByRole("tab", { name: "Shared with me" }).click();
    await page.getByRole("button", { name: "Plot assignments.slsheet" }).click();
    await expect(page.getByText("View only", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Bold (Cmd+B)" })).toBeDisabled();
    await expect(
      page.getByRole("toolbar", { name: "Spreadsheet formatting" }).getByLabel("Zoom"),
    ).toBeEnabled();
    await expect(page.getByRole("button", { name: "Print (Cmd+P)" })).toBeEnabled();
    await expect(page.locator("[data-u-comp='formula-bar'] [data-view-locked]").first()).toBeVisible();
    // The name box ignores Enter until the grid has finished starting.
    await expect(page.locator(".sheet-host")).toHaveAttribute("aria-busy", "false");
    const name = page.locator(".sheet-host input.univer-size-full");
    await name.fill("C4");
    await name.press("Enter");
    await expect(page.locator(".sheet-host")).toHaveAttribute("data-active-value", "Sam");
    let uploads = 0;
    page.on("request", (request) => {
      if (request.method() === "PUT" && request.url().includes("/content")) uploads += 1;
    });
    await page.keyboard.type("Alex");
    await expect(page.locator(".sheet-host")).toHaveAttribute("data-active-value", "Sam");
    await page.getByRole("button", { name: "Data", exact: true }).click();
    await page.getByRole("menuitem", { name: "Filter views" }).click();
    await expect(page.getByRole("menuitem", { name: "Bed: North" })).toBeVisible();
    await page.getByRole("menuitem", { name: "Bed: North" }).click();
    await expect(page.locator(".filter-view-bar")).toContainText("Showing Bed is North");
    await expect(page.locator(".filter-view-bar")).toContainText("only on this screen");
    expect(uploads).toBe(0);

    await page.getByRole("button", { name: "Back to files" }).click();
    await page.getByRole("tab", { name: "Shared with me" }).click();
    await page.getByRole("button", { name: "Spring fair.slslides" }).click();
    await expect(page.getByText("View only", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Theme" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "+ New slide" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Insert text box" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Slideshow", exact: true })).toBeEnabled();
    const title = page.locator(".slide-canvas .element-textarea").first();
    await title.click();
    await page.keyboard.type(" extra");
    await expect(title).toHaveValue("Spring fair");
    expect(uploads).toBe(0);

    const rosaContext = await browser.newContext();
    contexts.push(rosaContext);
    const editor = await openAs(rosaContext, node.url, rosa);
    await editor.getByRole("button", { name: "Plot assignments.slsheet", exact: true }).click();
    await expect(editor.getByRole("button", { name: "Bold (Cmd+B)" })).toBeEnabled();
    await expect(editor.getByText("View only", { exact: true })).toHaveCount(0);
  } finally {
    for (const context of contexts) await context.close();
    node.child.kill();
  }
});
