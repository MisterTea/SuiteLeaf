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
  type SuiteFile,
} from "../../packages/core/src";

const root = resolve(import.meta.dirname, "../..");
const binary =
  [
    process.env.SUITELEAF_NODE,
    "/tmp/sl-cargo-42/debug/suiteleaf-node",
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
  const dir = mkdtempSync(join(tmpdir(), "suiteleaf-notice-"));
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  writeFileSync(
    join(dir, "node.toml"),
    `[auth]\ncommand = ${JSON.stringify(["node", sidecar])}\n`,
  );
  const child = spawn(
    binary,
    [
      "run", "--init", "--config", join(dir, "node.toml"), "--data-dir", dir,
      "--http", `127.0.0.1:${port}`, "--public-url", url,
      "--listen", "/ip4/127.0.0.1/tcp/0", "--web-root", webRoot,
    ],
    {
      env: {
        ...process.env,
        SUITELEAF_AUTH_SECRET: "notice-playwright-secret-0123456789abcdef",
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
    .poll(async () => (await (await fetch(`${url}/api/node/info`)).json()).auth.enabled)
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
  return fetch(`${url}${path}`, { ...init, headers });
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

async function showDrive(page: Page) {
  await page
    .getByRole("heading", { name: "SuiteDrive" })
    .evaluate((el) => el.scrollIntoView({ block: "start" }));
}

test("a shared file notifies the recipient and can be kept as an owned copy", async ({
  browser,
}) => {
  test.skip(!ready, "Build the node, auth bundle, and web app first.");
  test.setTimeout(120_000);
  const node = await startNode();
  const contexts: BrowserContext[] = [];
  try {
    const rosa = await signup(node.url, "Rosa Diaz", "rosa@gardenclub.org");
    const sam = await signup(node.url, "Sam Okafor", "sam@gardenclub.org");
    const doc = createFile("doc", "Watering rota");
    doc.content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Monday: Rosa. Tuesday: Sam." }],
        },
      ],
    };
    const sheet = createFile("sheet", "Plot assignments");
    if (sheet.kind !== "sheet") throw new Error("expected a sheet");
    const grid = sheet.content.workbook.sheets[sheet.content.workbook.sheetOrder[0]];
    grid.cellData = {
      0: { 0: { v: "Plot", t: 1 }, 1: { v: "Notes", t: 1 } },
      1: { 0: { v: "North bed", t: 1 }, 1: { v: "Water Monday", t: 1 } },
    };
    const upload = async (file: SuiteFile) => {
      const created = await authed(node.url, rosa.token, "/api/drive/items", {
        method: "POST",
        body: JSON.stringify({
          name: nativeFilename(file),
          kind: "file",
          mime: mimeFor(file.kind),
        }),
      });
      if (!created.ok) throw new Error(await created.text());
      const item = (await created.json()) as { id: string };
      const put = await authed(node.url, rosa.token, `/api/drive/items/${item.id}/content`, {
        method: "PUT",
        headers: { "content-type": mimeFor(file.kind) },
        body: serializeFile(file),
      });
      if (!put.ok) throw new Error(await put.text());
      return item;
    };
    const rota = await upload(doc);
    const plot = await upload(sheet);

    const samContext = await browser.newContext();
    contexts.push(samContext);
    const samPage = await openAs(samContext, node.url, sam);
    await showDrive(samPage);
    await expect(samPage.getByRole("tab", { name: "My Drive" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(samPage.getByLabel("Files shared with you")).toHaveCount(0);

    const rosaContext = await browser.newContext();
    contexts.push(rosaContext);
    const rosaPage = await openAs(rosaContext, node.url, rosa);
    await showDrive(rosaPage);
    await rosaPage.getByRole("button", { name: "Watering rota.sldoc", exact: true }).click();
    await rosaPage.getByRole("button", { name: "Share", exact: true }).click();
    const dialog = rosaPage.locator(".share-dialog");
    await dialog.getByLabel("Add people").fill("sam");
    await dialog.getByRole("option", { name: /Sam Okafor/ }).click();
    await expect(dialog.getByText("Notify people")).toHaveCount(0);
    await expect(dialog.getByRole("checkbox")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: /send/i })).toHaveCount(0);
    const mailed: string[] = [];
    rosaPage.on("request", (request) => {
      if (/\/mail|smtp|notify/i.test(request.url())) mailed.push(request.url());
    });
    await dialog.getByRole("button", { name: "Share", exact: true }).click();
    await expect(dialog.getByText("Sam can now edit")).toBeVisible();
    expect(mailed).toEqual([]);

    const arrival = samPage.getByText(
      "Rosa Diaz shared “Watering rota” with you · Can edit",
    );
    await expect(arrival).toBeVisible({ timeout: 5000 });
    await samPage.getByRole("button", { name: "Open Watering rota" }).click();
    await expect(samPage.getByRole("textbox", { name: "Document content" })).toContainText(
      "Monday: Rosa",
    );
    const rotaAddress = samPage.url();
    await samPage.getByRole("button", { name: "Back to files" }).click();
    await showDrive(samPage);
    await samPage.getByRole("tab", { name: "Shared with me" }).click();
    await expect(
      samPage.getByRole("button", { name: "Watering rota.sldoc", exact: true }),
    ).toContainText("Can edit");
    await expect(arrival).toHaveCount(0);

    const sharedPlot = await authed(node.url, rosa.token, `/api/drive/items/${plot.id}/acl`, {
      method: "PUT",
      body: JSON.stringify({
        principalType: "user",
        principalId: sam.user.id,
        role: "viewer",
      }),
    });
    if (!sharedPlot.ok) throw new Error(await sharedPlot.text());
    const plotNotice = samPage.getByText(
      "Rosa Diaz shared “Plot assignments” with you · Can view",
    );
    await expect(plotNotice).toBeVisible({ timeout: 5000 });
    await samPage.getByRole("button", { name: "Dismiss" }).click();
    await expect(plotNotice).toHaveCount(0);
    const plotRow = samPage.getByRole("listitem").filter({ hasText: "Plot assignments.slsheet" });
    await expect(plotRow).toContainText("Can view");
    await plotRow.getByRole("button", { name: "Keep a copy", exact: true }).click();
    await expect(
      samPage.getByText("Kept a copy of Plot assignments.slsheet in My Drive. This copy is yours."),
    ).toBeVisible();
    await expect(plotRow).toBeVisible();

    await samPage.getByRole("tab", { name: "My Drive" }).click();
    await expect(
      samPage.getByRole("button", { name: "Plot assignments.slsheet", exact: true }),
    ).toBeVisible();
    const mine = (await (await authed(node.url, sam.token, "/api/drive/items")).json()) as {
      items: { id: string; name: string; ownerId: string; role: string }[];
    };
    const copy = mine.items.find((item) => item.name === "Plot assignments.slsheet");
    expect(copy?.ownerId).toBe(sam.user.id);
    expect(copy?.role).toBe("owner");
    const copyBody = await (
      await authed(node.url, sam.token, `/api/drive/items/${copy!.id}/content`)
    ).text();
    expect(copyBody).toContain("Water Monday");
    const write = await authed(node.url, sam.token, `/api/drive/items/${copy!.id}/content`, {
      method: "PUT",
      headers: { "content-type": mimeFor("sheet") },
      body: copyBody.replace("Water Monday", "Sam's notes"),
    });
    expect(write.ok).toBe(true);
    const original = await (
      await authed(node.url, rosa.token, `/api/drive/items/${plot.id}/content`)
    ).text();
    expect(original).toContain("Water Monday");
    expect(original).not.toContain("Sam's notes");

    for (const id of [rota.id, plot.id]) {
      const removed = await authed(node.url, rosa.token, `/api/drive/items/${id}/acl`, {
        method: "PUT",
        body: JSON.stringify({
          principalType: "user",
          principalId: sam.user.id,
          role: null,
        }),
      });
      expect(removed.ok).toBe(true);
    }
    await samPage.getByRole("tab", { name: "Shared with me" }).click();
    await expect(samPage.getByRole("button", { name: "Watering rota.sldoc" })).toHaveCount(0);
    await expect(samPage.getByRole("button", { name: "Plot assignments.slsheet" })).toHaveCount(0);
    expect((await authed(node.url, sam.token, `/api/drive/items/${rota.id}`)).status).toBe(403);
    expect(
      await (await authed(node.url, sam.token, `/api/drive/items/${copy!.id}/content`)).text(),
    ).toContain("Sam's notes");

    await samPage.evaluate((hash) => {
      location.hash = hash;
    }, new URL(rotaAddress).hash);
    await expect(samPage.getByText("You no longer have access to this file.")).toBeVisible();
  } finally {
    for (const context of contexts) await context.close();
    node.child.kill();
  }
});
