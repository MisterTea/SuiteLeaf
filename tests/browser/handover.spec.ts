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
  [
    process.env.SUITELEAF_NODE,
    "/tmp/sl-cargo-51/debug/suiteleaf-node",
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
  const dir = mkdtempSync(join(tmpdir(), "suiteleaf-handover-"));
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
      env: { ...process.env, SUITELEAF_AUTH_SECRET: "handover-playwright-secret-0123456789abcdef", RUST_LOG: "warn" },
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

test("an owner hands a file over immediately and a share can expire", async ({ browser }) => {
  test.skip(!ready, "Build the node, auth bundle, and web app first.");
  test.setTimeout(120_000);
  const node = await startNode();
  const contexts: BrowserContext[] = [];
  try {
    const rosa = await signup(node.url, "Rosa Diaz", "rosa@gardenclub.org");
    const sam = await signup(node.url, "Sam Okafor", "sam@gardenclub.org");
    const priya = await signup(node.url, "Priya Shah", "priya@gardenclub.org");
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
    for (const [person, role] of [
      [sam, "editor"],
      [priya, "commenter"],
    ] as const) {
      await authed(node.url, rosa.token, `/api/drive/items/${item.id}/acl`, {
        method: "PUT",
        body: JSON.stringify({ principalType: "user", principalId: person.user.id, role }),
      });
    }

    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    await page.addInitScript(
      (session) => localStorage.setItem("suiteleaf:node-session", JSON.stringify(session)),
      { url: node.url, token: rosa.token, user: rosa.user },
    );
    await page.goto(node.url);
    await page.getByRole("button", { name: "Watering rota.sldoc", exact: true }).click();
    await page.getByRole("button", { name: "Share", exact: true }).click();
    const dialog = page.locator(".share-dialog");
    await dialog.getByRole("button", { name: "Role for Priya Shah" }).click();
    await dialog.getByRole("button", { name: "Access expires" }).click();
    await expect(dialog.getByRole("button", { name: "Save" })).toHaveCount(0);
    await dialog.getByRole("button", { name: /^Saturday,/, disabled: false }).first().click();
    await expect(dialog.getByText("Commenter · until Saturday")).toBeVisible();

    await dialog.getByRole("button", { name: "Role for Sam Okafor" }).click();
    await dialog.getByRole("button", { name: "Make owner" }).click();
    await expect(dialog.getByText("Make Sam Okafor the owner? You will become an editor.")).toBeVisible();
    await dialog.getByRole("button", { name: "Make owner", exact: true }).click();
    await expect(dialog.getByText("You can edit this file.")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Make owner" })).toHaveCount(0);
    await expect(dialog.getByText("Commenter · until Saturday")).toBeVisible();

    const access = await (await authed(node.url, sam.token, `/api/drive/items/${item.id}/access`)).json();
    expect(access.yourRole).toBe("owner");
    const priyaGrant = access.grants.find((g: { principalId: string }) => g.principalId === priya.user.id);
    expect(priyaGrant.role).toBe("commenter");
    expect(priyaGrant.expiresAt).toBeTruthy();
    expect(priyaGrant.expired).toBe(false);
    const rosaGrant = access.grants.find((g: { principalId: string }) => g.principalId === rosa.user.id);
    expect(rosaGrant.role).toBe("editor");

    const editorDenied = await fetch(`${node.url}/api/drive/items/${item.id}/owner`, {
      method: "POST",
      headers: { authorization: `Bearer ${rosa.token}`, "content-type": "application/json" },
      body: JSON.stringify({ userId: priya.user.id }),
    });
    expect(editorDenied.status).toBe(403);

    await authed(node.url, sam.token, `/api/drive/items/${item.id}/expiry`, {
      method: "PUT",
      body: JSON.stringify({ principalId: priya.user.id, expiresAt: "2000-01-01T00:00:00.000Z" }),
    });
    const gone = await fetch(`${node.url}/api/drive/items/${item.id}`, {
      headers: { authorization: `Bearer ${priya.token}` },
    });
    expect(gone.status).toBe(403);
    const shared = await (await authed(node.url, priya.token, "/api/drive/items?shared=1")).json();
    expect(shared.items).toEqual([]);
    const ended = await (await authed(node.url, sam.token, `/api/drive/items/${item.id}/access`)).json();
    expect(ended.grants.find((g: { principalId: string }) => g.principalId === priya.user.id).expired).toBe(true);
  } finally {
    for (const context of contexts) await context.close();
    node.child.kill();
  }
});
