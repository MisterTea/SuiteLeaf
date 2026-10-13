import { test, expect, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { mimeFor, serializeFile, createFile } from "../../packages/core/src";

const root = resolve(import.meta.dirname, "../..");
const binary =
  process.env.SUITELEAF_NODE ?? join(root, "target/debug/suiteleaf-node");
const sidecar =
  process.env.STORYBOARD_AUTH ??
  process.env.SUITELEAF_AUTH ??
  join(root, "services/auth/dist/server.mjs");
const webRoot = join(root, "apps/web/dist");
const ready = [binary, sidecar, join(webRoot, "index.html")].every(existsSync);

const password = "garden-club-2026";

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
  const dataDir = mkdtempSync(join(tmpdir(), "last-edit-"));
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const config = join(dataDir, "node.toml");
  writeFileSync(config, `[auth]\ncommand = ${JSON.stringify(["node", sidecar])}\n`);
  const child = spawn(
    binary,
    [
      "run",
      "--init",
      "--config",
      config,
      "--data-dir",
      dataDir,
      "--http",
      `127.0.0.1:${port}`,
      "--public-url",
      url,
      "--listen",
      "/ip4/127.0.0.1/tcp/0",
      "--web-root",
      webRoot,
      "--sync-interval",
      "1",
    ],
    {
      env: {
        ...process.env,
        SUITELEAF_AUTH_SECRET: "last-edit-playwright-secret-0123456789abcdef",
        RUST_LOG: "warn",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const p2p = await new Promise<string>((done, fail) => {
    child.once("exit", (code) => fail(new Error(`server exited (${code})`)));
    createInterface({ input: child.stdout! }).on("line", (line) => {
      if (line.startsWith("SUITELEAF_NODE_READY "))
        done(JSON.parse(line.slice(21)).p2p[0]);
    });
  });
  await expect
    .poll(async () => (await (await fetch(`${url}/api/node/info`)).json()).auth.enabled, {
      timeout: 20000,
    })
    .toBe(true);
  return { url, p2p, child };
}

async function signup(url: string, name: string, email: string): Promise<Account> {
  const response = await fetch(`${url}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: url },
    body: JSON.stringify({ name, email, password }),
  });
  const body = (await response.json()) as Account & { message?: string };
  if (!response.ok || !body.token) throw new Error(body.message || `signup ${response.status}`);
  return body;
}

async function call(url: string, token: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${url}${path}`, { ...init, headers });
  if (!response.ok) throw new Error(`${path} ${response.status}: ${await response.text()}`);
  return response;
}

async function asUser(page: Page, url: string, who: Account) {
  await page.goto(url);
  await page.evaluate((session) => {
    localStorage.setItem("suiteleaf:node-session", JSON.stringify(session));
  }, { url, token: who.token, user: who.user });
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

test("the open list and the open file show the head author", async ({ browser }) => {
  test.skip(!ready, "Build suiteleaf-node, the auth bundle, and the web app first.");
  const node = await startNode();
  const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
  try {
    const rosa = await signup(node.url, "Rosa Diaz", "rosa@riverside-garden.org");
    const sam = await signup(node.url, "Sam Okafor", "sam@riverside-garden.org");
    const alex = await signup(node.url, "Alex Nguyen", "alex@riverside-garden.org");
    const folder = (await (
      await call(node.url, rosa.token, "/api/drive/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Garden club", kind: "folder" }),
      })
    ).json()) as { id: string };
    const file = createFile("doc", "Watering rota");
    file.content = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Monday — Rosa." }] },
      ],
    };
    const item = (await (
      await call(node.url, rosa.token, "/api/drive/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Watering rota.sldoc",
          kind: "file",
          parentId: folder.id,
          mime: mimeFor("doc"),
        }),
      })
    ).json()) as { id: string };
    await call(node.url, rosa.token, `/api/drive/items/${item.id}/content`, {
      method: "PUT",
      headers: { "content-type": mimeFor("doc") },
      body: serializeFile(file),
    });
    for (const [who, role] of [
      [sam, "editor"],
      [alex, "viewer"],
    ] as const) {
      await call(node.url, rosa.token, `/api/drive/items/${folder.id}/acl`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          principalType: "user",
          principalId: who.user.id,
          role,
        }),
      });
    }
    file.content = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Tuesday — Sam." }] },
      ],
    };
    await call(node.url, sam.token, `/api/drive/items/${item.id}/content`, {
      method: "PUT",
      headers: { "content-type": mimeFor("doc") },
      body: serializeFile(file),
    });

    const listed = (await (
      await call(node.url, alex.token, `/api/drive/items?parent=${folder.id}`)
    ).json()) as {
      items: { name: string; ownerId: string; lastAuthorName?: string; role?: string }[];
    };
    const row = listed.items.find((entry) => entry.name === "Watering rota.sldoc");
    expect(row?.ownerId).toBe(rosa.user.id);
    expect(row?.lastAuthorName).toBe("Sam Okafor");
    expect(row?.role).toBe("viewer");

    const samContext = await browser.newContext();
    contexts.push(samContext);
    const samList = await samContext.newPage();
    await asUser(samList, node.url, sam);
    await samList.getByRole("heading", { name: "SuiteDrive" }).scrollIntoViewIfNeeded();
    await samList.getByRole("tab", { name: "Shared with me" }).click();
    await samList.getByRole("button", { name: "Garden club", exact: true }).click();
    const samRow = samList.getByRole("button", { name: "Watering rota.sldoc", exact: true });
    await expect(samRow).toContainText("Sam Okafor");

    const fileContext = await browser.newContext();
    contexts.push(fileContext);
    const samFile = await fileContext.newPage();
    await asUser(samFile, node.url, sam);
    await samFile.getByRole("heading", { name: "SuiteDrive" }).scrollIntoViewIfNeeded();
    await samFile.getByRole("tab", { name: "Shared with me" }).click();
    await samFile.getByRole("button", { name: "Garden club", exact: true }).click();
    await samFile.getByRole("button", { name: "Watering rota.sldoc", exact: true }).click();
    await expect(samFile.locator(".last-edited")).toContainText("Last edited by Sam Okafor");
    await expect(samFile.getByRole("complementary", { name: "Version history" })).toHaveCount(0);

    file.content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Thursday: ask Alex to cover." }],
        },
      ],
    };
    await call(node.url, rosa.token, `/api/drive/items/${item.id}/content`, {
      method: "PUT",
      headers: { "content-type": mimeFor("doc") },
      body: serializeFile(file),
    });
    const savedAt = Date.now();
    await expect(samRow).toContainText("Rosa Diaz", { timeout: 5000 });
    await expect(samFile.locator(".last-edited")).toContainText("Last edited by Rosa Diaz", {
      timeout: 5000,
    });
    expect(Date.now() - savedAt).toBeLessThan(5000);
    await expect(samFile.getByRole("complementary", { name: "Version history" })).toHaveCount(0);
  } finally {
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    node.child.kill();
  }
});
