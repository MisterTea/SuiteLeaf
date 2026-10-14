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
} from "../../packages/core/src";

const root = resolve(import.meta.dirname, "../..");
const binary =
  [process.env.SUITELEAF_NODE, "/tmp/sl-cargo-27/debug/suiteleaf-node", join(root, "target/debug/suiteleaf-node")].find(
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
  const dir = mkdtempSync(join(tmpdir(), "suiteleaf-share-"));
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  writeFileSync(join(dir, "node.toml"), `[auth]\ncommand = ${JSON.stringify(["node", sidecar])}\n`);
  const child = spawn(
    binary,
    [
      "run", "--init", "--config", join(dir, "node.toml"), "--data-dir", dir,
      "--http", `127.0.0.1:${port}`, "--public-url", url,
      "--listen", "/ip4/127.0.0.1/tcp/0", "--web-root", webRoot,
      "--cors-origin", new URL(test.info().project.use.baseURL!).origin,
    ],
    {
      env: { ...process.env, SUITELEAF_AUTH_SECRET: "share-playwright-secret-0123456789abcdef", RUST_LOG: "warn" },
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  await new Promise<void>((done, fail) => {
    child.once("exit", (code) => fail(new Error(`node exited (${code})`)));
    createInterface({ input: child.stdout! }).on("line", (line) => {
      if (line.startsWith("SUITELEAF_NODE_READY ")) done();
    });
  });
  await expect.poll(async () => (await (await fetch(`${url}/api/node/info`)).json()).auth.enabled).toBe(true);
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

test("sharing suggests accounts, enforces commenter and viewer, and updates Shared with me", async ({ browser }) => {
  test.skip(!ready, "Build the node, auth bundle, and web app first.");
  test.setTimeout(120_000);
  const node = await startNode();
  const contexts: BrowserContext[] = [];
  try {
    const rosa = await signup(node.url, "Rosa Diaz", "rosa@gardenclub.org");
    const sam = await signup(node.url, "Sam Okafor", "sam@gardenclub.org");
    const file = createFile("doc", "Watering rota");
    file.content = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Monday: Rosa." }] }],
    };
    const item = await (
      await authed(node.url, rosa.token, "/api/drive/items", {
        method: "POST",
        body: JSON.stringify({ name: nativeFilename(file), kind: "file", mime: mimeFor("doc") }),
      })
    ).json();
    await authed(node.url, rosa.token, `/api/drive/items/${item.id}/content`, {
      method: "PUT",
      headers: { "content-type": mimeFor("doc") },
      body: serializeFile(file),
    });

    const samContext = await browser.newContext();
    contexts.push(samContext);
    const samPage = await openAs(samContext, node.url, sam);
    await samPage.getByRole("heading", { name: "SuiteDrive" }).scrollIntoViewIfNeeded();
    await samPage.getByRole("tab", { name: "Shared with me" }).click();
    await expect(samPage.getByText("Nothing has been shared with you yet.")).toBeVisible();

    const rosaContext = await browser.newContext();
    contexts.push(rosaContext);
    const page = await openAs(rosaContext, node.url, rosa);
    await page.getByRole("button", { name: "Watering rota.sldoc", exact: true }).click();
    await page.getByRole("button", { name: "Share", exact: true }).click();
    const dialog = page.locator(".share-dialog");
    await dialog.getByLabel("Add people").fill("sa");
    await expect(dialog.getByRole("option", { name: /Sam Okafor/ })).toContainText("sam@gardenclub.org");
    await dialog.getByRole("option", { name: /Sam Okafor/ }).click();
    await expect(dialog.getByRole("button", { name: "Role for Sam Okafor" })).toContainText("Can change anything");
    await dialog.getByRole("button", { name: "Share", exact: true }).click();
    await expect(dialog.getByText("Sam can now edit")).toBeVisible();

    await dialog.getByLabel("Add people").fill("lee@example.com");
    await expect(dialog.getByText("No account on this server uses lee@example.com. Ask them to sign up first.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Share", exact: true })).toBeDisabled();
    await dialog.getByLabel("Add people").fill("");

    await dialog.getByRole("button", { name: "Role for Sam Okafor" }).click();
    await dialog.getByRole("option", { name: /Commenter/ }).click();
    await expect(dialog.getByText("Sam can now comment")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Save" })).toHaveCount(0);

    const denied = await authed(node.url, sam.token, `/api/drive/items/${item.id}/content`, {
      method: "PUT",
      headers: { "content-type": mimeFor("doc") },
      body: serializeFile(file),
    }).then(
      () => "allowed",
      (error: Error) => error.message,
    );
    expect(denied).toContain("403");
    const comment = await authed(node.url, sam.token, `/api/drive/items/${item.id}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: "Can I swap Tuesday?" }),
    });
    expect(comment.status).toBe(201);

    await dialog.getByRole("button", { name: "Role for Sam Okafor" }).click();
    await dialog.getByRole("button", { name: "Remove access" }).click();
    const undo = dialog.getByRole("button", { name: "Undo" });
    await expect(undo).toBeVisible();
    await page.waitForTimeout(5000);
    await expect(undo).toBeVisible();
    await undo.click();
    await expect(dialog.getByText("Sam Okafor", { exact: true })).toBeVisible();

    await expect(samPage.getByRole("button", { name: "Watering rota.sldoc" })).toContainText("Rosa Diaz", {
      timeout: 15000,
    });
    await expect(samPage.getByRole("button", { name: "Watering rota.sldoc" })).toContainText(/Can (edit|comment|view)/);
    expect(samPage.url()).not.toContain("reload");

    await dialog.getByRole("button", { name: "Role for Sam Okafor" }).click();
    await dialog.getByRole("option", { name: /^Viewer/ }).click();
    await dialog.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "Back to files" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();

    const viewer = await samContext.newPage();
    await viewer.addInitScript(
      (session) => localStorage.setItem("suiteleaf:node-session", JSON.stringify(session)),
      { url: node.url, token: sam.token, user: sam.user },
    );
    await viewer.goto(`${node.url}/#/`);
    await viewer.getByRole("heading", { name: "SuiteDrive" }).scrollIntoViewIfNeeded();
    await viewer.getByRole("tab", { name: "Shared with me" }).click();
    await viewer.getByRole("button", { name: "Watering rota.sldoc" }).click();
    await expect(viewer.getByText("View only")).toBeVisible();
    await expect(viewer.getByRole("button", { name: "Bold" })).toBeDisabled();
    const editor = viewer.getByRole("textbox", { name: "Document content" });
    await expect(editor).toContainText("Monday: Rosa.");
    let uploads = 0;
    viewer.on("request", (request) => {
      if (request.method() === "PUT" && request.url().includes("/content")) uploads += 1;
    });
    await editor.click();
    await viewer.keyboard.type("nope");
    await viewer.waitForTimeout(1000);
    await expect(editor).toContainText("Monday: Rosa.");
    await expect(editor).not.toContainText("nope");
    expect(uploads).toBe(0);
  } finally {
    for (const context of contexts) await context.close();
    node.child.kill();
  }
});

test("a group can be given read, comment, or write access", async ({ browser }) => {
  test.skip(!ready, "Build the node, auth bundle, and web app first.");
  test.setTimeout(120_000);
  const node = await startNode();
  const contexts: BrowserContext[] = [];
  try {
    const rosa = await signup(node.url, "Rosa Diaz", "rosa@gardenclub.org");
    const sam = await signup(node.url, "Sam Okafor", "sam@gardenclub.org");
    const group = await (
      await authed(node.url, rosa.token, "/api/admin/groups", {
        method: "POST",
        body: JSON.stringify({ name: "Volunteers" }),
      })
    ).json();
    await authed(node.url, rosa.token, `/api/admin/groups/${group.id}/members`, {
      method: "POST",
      body: JSON.stringify({ memberType: "user", memberId: sam.user.id }),
    });
    const file = createFile("doc", "Watering rota");
    file.content = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Monday: Rosa." }] }],
    };
    const item = await (
      await authed(node.url, rosa.token, "/api/drive/items", {
        method: "POST",
        body: JSON.stringify({ name: nativeFilename(file), kind: "file", mime: mimeFor("doc") }),
      })
    ).json();
    await authed(node.url, rosa.token, `/api/drive/items/${item.id}/content`, {
      method: "PUT",
      headers: { "content-type": mimeFor("doc") },
      body: serializeFile(file),
    });

    const rosaContext = await browser.newContext();
    contexts.push(rosaContext);
    const page = await openAs(rosaContext, node.url, rosa);
    await page.getByRole("button", { name: "Watering rota.sldoc", exact: true }).click();
    await page.getByRole("button", { name: "Share", exact: true }).click();
    const dialog = page.locator(".share-dialog");
    await dialog.getByLabel("Add people or groups").fill("Vol");
    await expect(dialog.getByRole("option", { name: /Volunteers/ })).toContainText("Group");
    await dialog.getByRole("option", { name: /Volunteers/ }).click();
    await dialog.getByRole("button", { name: "Role for Volunteers" }).click();
    await expect(dialog.getByRole("option", { name: /^Viewer/ })).toContainText("Can read");
    await expect(dialog.getByRole("option", { name: /Commenter/ })).toContainText("Can read and comment");
    await expect(dialog.getByRole("option", { name: /^Editor/ })).toContainText("Can change anything");
    await dialog.getByRole("option", { name: /Commenter/ }).click();
    await dialog.getByRole("button", { name: "Share", exact: true }).click();
    await expect(dialog.getByText("Volunteers can now comment")).toBeVisible();
    await expect(dialog.getByText("Group", { exact: true })).toBeVisible();

    const denied = await authed(node.url, sam.token, `/api/drive/items/${item.id}/content`, {
      method: "PUT",
      headers: { "content-type": mimeFor("doc") },
      body: serializeFile(file),
    }).then(
      () => "allowed",
      (error: Error) => error.message,
    );
    expect(denied).toContain("403");
    expect(
      (await authed(node.url, sam.token, `/api/drive/items/${item.id}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: "I can comment through the group." }),
      })).status,
    ).toBe(201);

    await dialog.getByRole("button", { name: "Role for Volunteers" }).click();
    await dialog.getByRole("option", { name: /^Viewer/ }).click();
    await expect(dialog.getByText("Volunteers can now view")).toBeVisible();
    const commentDenied = await authed(node.url, sam.token, `/api/drive/items/${item.id}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: "This should not stick." }),
    }).then(
      () => "allowed",
      (error: Error) => error.message,
    );
    expect(commentDenied).toContain("403");

    await dialog.getByRole("button", { name: "Role for Volunteers" }).click();
    await dialog.getByRole("option", { name: /^Editor/ }).click();
    const written = await authed(node.url, sam.token, `/api/drive/items/${item.id}/content`, {
      method: "PUT",
      headers: { "content-type": mimeFor("doc") },
      body: serializeFile(file),
    });
    expect(written.status).toBe(200);

    const samContext = await browser.newContext();
    contexts.push(samContext);
    const samPage = await openAs(samContext, node.url, sam);
    await samPage.getByRole("heading", { name: "SuiteDrive" }).scrollIntoViewIfNeeded();
    await samPage.getByRole("tab", { name: "Shared with me" }).click();
    await expect(samPage.getByRole("button", { name: "Watering rota.sldoc", exact: true })).toBeVisible();
  } finally {
    for (const context of contexts) await context.close();
    node.child.kill();
  }
});
