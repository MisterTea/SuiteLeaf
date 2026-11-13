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
  type DocFile,
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
  const dir = mkdtempSync(join(tmpdir(), "suiteleaf-doc-collab-"));
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
        SUITELEAF_AUTH_SECRET: "doc-collab-playwright-secret-0123456789abc",
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

function notes(): DocFile {
  const file = createFile("doc", "Notes") as DocFile;
  file.content = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "North" }] },
      { type: "paragraph", content: [{ type: "text", text: "Beds" }] },
    ],
  };
  return file;
}

function editorOf(page: Page) {
  return page.getByRole("textbox", { name: "Document content" });
}

async function typeAtEnd(page: Page, paragraph: string, extra: string) {
  await editorOf(page).evaluate((root, paragraph) => {
    const editor = (root as HTMLElement & { editor: import("@tiptap/core").Editor }).editor;
    let end = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isTextblock && node.textContent === paragraph) end = pos + 1 + node.content.size;
    });
    if (end < 0) throw new Error(`Missing paragraph: ${paragraph}`);
    editor.chain().focus().setTextSelection(end).run();
  }, paragraph);
  await expect(editorOf(page)).toBeFocused();
  await page.keyboard.type(extra);
}

test("two people type in different paragraphs and both texts stay", async ({ browser }) => {
  test.skip(!ready, "Build the node, auth bundle, and web app first.");
  test.setTimeout(120_000);
  const node = await startNode();
  const contexts: BrowserContext[] = [];
  try {
    const maya = await signup(node.url, "Maya Chen", "maya-doc@gardenclub.org");
    const sam = await signup(node.url, "Sam Ortiz", "sam-doc@gardenclub.org");
    const file = notes();
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
    await samPage.getByRole("button", { name: "Notes.sldoc", exact: true }).click();
    await expect(editorOf(samPage)).toContainText("Beds");

    const mayaContext = await browser.newContext();
    contexts.push(mayaContext);
    const mayaPage = await openAs(mayaContext, node.url, maya);
    await mayaPage.getByRole("button", { name: "Notes.sldoc", exact: true }).click();
    const shared = (page: Page) => page.locator("[data-shared=true]");
    await expect(shared(samPage)).toContainText("Beds");
    await expect(shared(mayaPage)).toContainText("North");

    for (const p of [samPage, mayaPage]) { const s = await p.context().newCDPSession(p); await s.send("Emulation.setCPUThrottlingRate", { rate: 6 }); }
    await typeAtEnd(samPage, "Beds", " stay");
    await typeAtEnd(mayaPage, "North", " plot");

    await expect(editorOf(samPage)).toContainText("North plot");
    await expect(editorOf(samPage)).toContainText("Beds stay");
    await expect(editorOf(mayaPage)).toContainText("North plot");
    await expect(editorOf(mayaPage)).toContainText("Beds stay");
    await editorOf(samPage).locator("p", { hasText: "Beds stay" }).click();
    for (let i = 0; i < " stay".length; i += 1) await samPage.keyboard.press("ControlOrMeta+z");
    await expect(editorOf(samPage)).toContainText("North plot");
    await expect(editorOf(samPage).locator("p", { hasText: /^Beds$/ })).toBeVisible();
    await expect(editorOf(mayaPage)).toContainText("North plot");
    await expect(editorOf(mayaPage).locator("p", { hasText: /^Beds$/ })).toBeVisible();
    await editorOf(samPage).locator("p", { hasText: /^Beds$/ }).click();
    for (let i = 0; i < " stay".length; i += 1) await samPage.keyboard.press("ControlOrMeta+Shift+z");
    await expect(editorOf(samPage)).toContainText("North plot");
    await expect(editorOf(samPage)).toContainText("Beds stay");
    await expect(editorOf(mayaPage)).toContainText("North plot");
    await expect(editorOf(mayaPage)).toContainText("Beds stay");
  } finally {
    for (const context of contexts) await context.close();
    node.child.kill();
  }
});

test("one person's caret and selection show on the other screen without changing the text", async ({ browser }) => {
  test.skip(!ready, "Build the node, auth bundle, and web app first.");
  test.setTimeout(120_000);
  const node = await startNode();
  const contexts: BrowserContext[] = [];
  try {
    const maya = await signup(node.url, "Maya Chen", "maya-caret@gardenclub.org");
    const sam = await signup(node.url, "Sam Ortiz", "sam-caret@gardenclub.org");
    const file = notes();
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
    await samPage.getByRole("button", { name: "Notes.sldoc", exact: true }).click();
    const mayaContext = await browser.newContext();
    contexts.push(mayaContext);
    const mayaPage = await openAs(mayaContext, node.url, maya);
    await mayaPage.getByRole("button", { name: "Notes.sldoc", exact: true }).click();
    await expect(samPage.locator("[data-shared=true]")).toContainText("Beds");
    await expect(mayaPage.locator("[data-shared=true]")).toContainText("North");

    const placed = await editorOf(samPage).evaluate((el: HTMLElement & { editor?: { state: { doc: { descendants: (f: (node: { isText?: boolean; text?: string }, pos: number) => void) => void } }; chain: () => { focus: () => { setTextSelection: (range: { from: number; to: number }) => { run: () => boolean } } } } }, phrase: string) => {
      const editor = el.editor;
      if (!editor) return false;
      let from = -1;
      editor.state.doc.descendants((node, pos) => {
        if (from >= 0 || !node.isText || !node.text) return;
        const at = node.text.indexOf(phrase);
        if (at >= 0) from = pos + at;
      });
      if (from < 0) return false;
      return editor.chain().focus().setTextSelection({ from, to: from + 2 }).run();
    }, "Beds");
    expect(placed).toBe(true);
    await samPage.keyboard.press("Shift+ArrowRight");

    const beds = editorOf(mayaPage).locator("p", { hasText: /^Beds$/ });
    const mark = beds.locator(".remote-caret[data-caret='Sam Ortiz']");
    await expect(mark).toBeVisible();
    const range = beds.locator(".remote-caret-range[data-caret='Sam Ortiz']");
    await expect(range).toBeVisible();
    const markBox = await mark.boundingBox();
    const editorBox = await editorOf(mayaPage).boundingBox();
    expect(markBox).toBeTruthy();
    expect(editorBox).toBeTruthy();
    expect(markBox!.y).toBeGreaterThanOrEqual(editorBox!.y);
    expect(markBox!.y).toBeLessThan(editorBox!.y + editorBox!.height);
    await expect(editorOf(mayaPage).locator("p", { hasText: /^North$/ })).toBeVisible();
    await expect(editorOf(mayaPage).locator("p", { hasText: /^Beds$/ })).toBeVisible();
    await expect(editorOf(samPage).locator("p", { hasText: /^North$/ })).toBeVisible();
    await expect(editorOf(samPage).locator("p", { hasText: /^Beds$/ })).toBeVisible();
  } finally {
    for (const context of contexts) await context.close();
    node.child.kill();
  }
});

test("a viewer sees the other person's typing and cannot change it", async ({ browser }) => {
  test.skip(!ready, "Build the node, auth bundle, and web app first.");
  test.setTimeout(120_000);
  const node = await startNode();
  const contexts: BrowserContext[] = [];
  try {
    const maya = await signup(node.url, "Maya Chen", "maya-view@gardenclub.org");
    const sam = await signup(node.url, "Sam Ortiz", "sam-view@gardenclub.org");
    const file = notes();
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
        role: "viewer",
      }),
    });

    const samContext = await browser.newContext();
    contexts.push(samContext);
    const samPage = await openAs(samContext, node.url, sam);
    await samPage.getByRole("tab", { name: "Shared with me" }).click();
    await samPage.getByRole("button", { name: "Notes.sldoc", exact: true }).click();
    await expect(editorOf(samPage)).toContainText("Beds");
    await expect(samPage.getByText("View only")).toBeVisible();

    const mayaContext = await browser.newContext();
    contexts.push(mayaContext);
    const mayaPage = await openAs(mayaContext, node.url, maya);
    await mayaPage.getByRole("button", { name: "Notes.sldoc", exact: true }).click();
    await expect(samPage.locator("[data-shared=true]")).toContainText("Beds");
    await expect(mayaPage.locator("[data-shared=true]")).toContainText("North");
    await expect(editorOf(samPage)).toHaveAttribute("contenteditable", "false");

    await typeAtEnd(mayaPage, "North", " plot");
    await expect(editorOf(samPage)).toContainText("North plot");
    await expect(editorOf(mayaPage)).toContainText("North plot");
    await expect(editorOf(samPage).locator("p", { hasText: /^Beds$/ })).toBeVisible();
    await editorOf(samPage).click({ force: true });
    await samPage.keyboard.type(" no");
    await expect(editorOf(samPage).locator("p", { hasText: /^Beds$/ })).toBeVisible();
    await expect(editorOf(mayaPage).locator("p", { hasText: /^Beds$/ })).toBeVisible();
  } finally {
    for (const context of contexts) await context.close();
    node.child.kill();
  }
});

test("a comment on one screen shows on the other and the paragraphs stay", async ({ browser }) => {
  test.skip(!ready, "Build the node, auth bundle, and web app first.");
  test.setTimeout(120_000);
  const node = await startNode();
  const contexts: BrowserContext[] = [];
  try {
    const maya = await signup(node.url, "Maya Chen", "maya-note@gardenclub.org");
    const sam = await signup(node.url, "Sam Ortiz", "sam-note@gardenclub.org");
    const file = notes();
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
    await samPage.getByRole("button", { name: "Notes.sldoc", exact: true }).click();
    const mayaContext = await browser.newContext();
    contexts.push(mayaContext);
    const mayaPage = await openAs(mayaContext, node.url, maya);
    await mayaPage.getByRole("button", { name: "Notes.sldoc", exact: true }).click();
    await expect(samPage.locator("[data-shared=true]")).toContainText("Beds");
    await expect(mayaPage.locator("[data-shared=true]")).toContainText("North");

    const placed = await editorOf(mayaPage).evaluate((el: HTMLElement & { editor?: { state: { doc: { descendants: (f: (node: { isText?: boolean; text?: string }, pos: number) => void) => void } }; chain: () => { focus: () => { setTextSelection: (range: { from: number; to: number }) => { run: () => boolean } } } } }, phrase: string) => {
      const editor = el.editor;
      if (!editor) return false;
      let from = -1;
      let to = -1;
      editor.state.doc.descendants((node, pos) => {
        if (from >= 0 || !node.isText || !node.text) return;
        const at = node.text.indexOf(phrase);
        if (at >= 0) {
          from = pos + at;
          to = from + phrase.length;
        }
      });
      if (from < 0) return false;
      return editor.chain().focus().setTextSelection({ from, to }).run();
    }, "Beds");
    expect(placed).toBe(true);
    await expect(editorOf(mayaPage)).toBeFocused();
    await mayaPage.keyboard.press("ControlOrMeta+Alt+KeyM");
    const comment = mayaPage.getByRole("textbox", { name: "Comment", exact: true });
    await expect(comment).toBeFocused();
    await comment.fill("Water the beds");
    await mayaPage.keyboard.press("ControlOrMeta+Enter");
    await expect(mayaPage.locator(".doc-comment-card")).toContainText("Water the beds");
    await expect(samPage.locator(".doc-comment-card")).toContainText("Water the beds");
    await expect(samPage.locator(".comment-anchor")).toHaveText("Beds");
    await expect(editorOf(samPage)).toContainText("North");
    await expect(editorOf(mayaPage)).toContainText("North");

    await samContext.close();
    await mayaContext.close();
    contexts.length = 0;
    await expect
      .poll(async () => {
        const response = await fetch(`${node.url}/api/drive/items/${item.id}/content`, {
          headers: { authorization: `Bearer ${maya.token}` },
        });
        return response.text();
      })
      .toContain("Water the beds");

    const again = await browser.newContext();
    contexts.push(again);
    const reopened = await openAs(again, node.url, sam);
    await reopened.getByRole("tab", { name: "Shared with me" }).click();
    await reopened.getByRole("button", { name: "Notes.sldoc", exact: true }).click();
    await expect(editorOf(reopened).locator(".comment-anchor")).toHaveText("Beds");
    await expect(editorOf(reopened)).toContainText("North");
    await reopened.getByRole("button", { name: "Comments", exact: true }).click();
    await expect(reopened.locator(".doc-comment-panel")).toContainText("Water the beds");
  } finally {
    for (const context of contexts) await context.close();
    node.child.kill();
  }
});

test("a commenter adds a note the editor can see without changing the wording", async ({ browser }) => {
  test.skip(!ready, "Build the node, auth bundle, and web app first.");
  test.setTimeout(120_000);
  const node = await startNode();
  const contexts: BrowserContext[] = [];
  try {
    const maya = await signup(node.url, "Maya Chen", "maya-file-note@gardenclub.org");
    const sam = await signup(node.url, "Sam Ortiz", "sam-file-note@gardenclub.org");
    const file = notes();
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
        role: "commenter",
      }),
    });

    const samContext = await browser.newContext();
    contexts.push(samContext);
    const samPage = await openAs(samContext, node.url, sam);
    await samPage.getByRole("tab", { name: "Shared with me" }).click();
    await samPage.getByRole("button", { name: "Notes.sldoc", exact: true }).click();
    await expect(samPage.getByText("You can comment. The wording of the file stays as it is.")).toBeVisible();
    await expect(editorOf(samPage)).toHaveAttribute("contenteditable", "false");

    const mayaContext = await browser.newContext();
    contexts.push(mayaContext);
    const mayaPage = await openAs(mayaContext, node.url, maya);
    await mayaPage.getByRole("button", { name: "Notes.sldoc", exact: true }).click();
    await expect(editorOf(mayaPage)).toContainText("North");

    await samPage.getByLabel("Add a comment").fill("Water the beds");
    await samPage.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(samPage.getByRole("region", { name: "Comments on this file" })).toContainText("Water the beds");
    await expect(mayaPage.getByRole("region", { name: "Comments on this file" })).toContainText("Water the beds");
    await expect(editorOf(samPage).locator("p", { hasText: /^Beds$/ })).toBeVisible();
    await expect(editorOf(mayaPage).locator("p", { hasText: /^North$/ })).toBeVisible();
    await editorOf(samPage).click({ force: true });
    await samPage.keyboard.type(" no");
    await expect(editorOf(samPage).locator("p", { hasText: /^Beds$/ })).toBeVisible();
    await expect(editorOf(mayaPage).locator("p", { hasText: /^North$/ })).toBeVisible();
  } finally {
    for (const context of contexts) await context.close();
    node.child.kill();
  }
});

test("a dropped connection says it is reconnecting and then shows the stored edit", async ({ browser }) => {
  test.skip(!ready, "Build the node, auth bundle, and web app first.");
  test.setTimeout(120_000);
  const node = await startNode();
  const contexts: BrowserContext[] = [];
  try {
    const maya = await signup(node.url, "Maya Chen", "maya-back@gardenclub.org");
    const sam = await signup(node.url, "Sam Ortiz", "sam-back@gardenclub.org");
    const file = notes();
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
    await samPage.getByRole("button", { name: "Notes.sldoc", exact: true }).click();
    const mayaContext = await browser.newContext();
    contexts.push(mayaContext);
    const mayaPage = await openAs(mayaContext, node.url, maya);
    await mayaPage.getByRole("button", { name: "Notes.sldoc", exact: true }).click();
    await expect(samPage.locator("[data-shared=true]")).toContainText("Beds");
    await expect(mayaPage.locator("[data-shared=true]")).toContainText("North");

    await samContext.setOffline(true);
    await expect(samPage.getByText("Reconnecting to the shared document.")).toBeVisible();
    await typeAtEnd(mayaPage, "North", " plot");
    await expect(editorOf(mayaPage)).toContainText("North plot");
    await samContext.setOffline(false);
    await expect(samPage.getByText("Reconnecting to the shared document.")).toBeHidden();
    await expect(editorOf(samPage)).toContainText("North plot");
    await expect(editorOf(samPage).locator("p", { hasText: /^Beds$/ })).toBeVisible();

    await samContext.setOffline(true);
    await expect(samPage.getByText("Reconnecting to the shared document.")).toBeVisible();
    await typeAtEnd(samPage, "Beds", "X");
    await expect(samPage.getByText(/still on this device/)).toBeVisible();
    await samContext.setOffline(false);
    await expect(editorOf(mayaPage)).toContainText("BedsX");
    await expect(editorOf(samPage)).toContainText("BedsX");
    await expect(editorOf(mayaPage)).toContainText("North plot");
  } finally {
    for (const context of contexts) await context.close();
    node.child.kill();
  }
});
