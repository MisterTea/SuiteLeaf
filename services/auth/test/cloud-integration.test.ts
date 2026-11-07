// Real Postgres + private testing Blob store, through two independent Rust servers.
// Never accepts a non-loopback database. Build auth and the Rust binary first.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { mkdirSync } from "node:fs";

const enabled = process.env.SUITELEAF_CLOUD_INTEGRATION === "1";
describe.skipIf(!enabled)("cloud backend integration", () => {
  const binary = resolve(
    `target/debug/suiteleaf-node${process.platform === "win32" ? ".exe" : ""}`,
  );
  const nodes: ChildProcess[] = [];
  const bases = ["http://127.0.0.1:18781", "http://127.0.0.1:18782"];
  let env: NodeJS.ProcessEnv, bootstrap: string;
  const logs: string[] = [];
  let owner = "",
    guest = "",
    guestId = "";
  let ownerId = "";
  const testSchema = `cloud_test_${randomBytes(8).toString("hex")}`;
  let pgEnv: NodeJS.ProcessEnv;
  async function waitFor(check: () => Promise<boolean>, timeout = 20_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        if (await check()) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(
      `Cloud server check timed out. ${logs.join("").slice(-3000)}`,
    );
  }
  async function start(index: number) {
    const child = spawn(
      binary,
      [
        "run",
        "--data-dir",
        resolve(`test-results/cloud-node-${index}`),
        "--web-root",
        resolve("apps/web/dist"),
      ],
      {
        env: {
          ...env,
          PORT: String(18781 + index),
          SUITELEAF_CLOUD_BRIDGE_PORT: String(41235 + index),
          SUITELEAF_PUBLIC_URL: bases[index],
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    nodes[index] = child;
    child.stdout?.on("data", (value) => logs.push(String(value)));
    child.stderr?.on("data", (value) => logs.push(String(value)));
    await waitFor(
      async () =>
        (await fetch(`${bases[index]}/api/auth/suiteleaf/providers`)).ok,
    );
  }
  async function request(
    index: number,
    path: string,
    method = "GET",
    token = owner,
    body?: unknown,
    extra: Record<string, string> = {},
  ) {
    return fetch(`${bases[index]}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined
          ? {}
          : {
              "content-type":
                typeof body === "string"
                  ? "application/json"
                  : "application/json",
            }),
        ...extra,
      },
      body:
        body === undefined
          ? undefined
          : typeof body === "string" || body instanceof Uint8Array
            ? body
            : JSON.stringify(body),
    });
  }
  async function json<T>(response: Response): Promise<T> {
    const text = await response.text();
    if (!response.ok) throw new Error(`Cloud API ${response.status}: ${text}`);
    return JSON.parse(text) as T;
  }
  beforeAll(async () => {
    process.loadEnvFile(".env.local");
    const inputUrl = process.env.SUITELEAF_TEST_POSTGRES_URL;
    if (!inputUrl || new URL(inputUrl).hostname !== "127.0.0.1")
      throw new Error(
        "An isolated loopback SUITELEAF_TEST_POSTGRES_URL is required",
      );
    const parsed = new URL(inputUrl);
    pgEnv = {
      ...process.env,
      PGHOST: parsed.hostname,
      PGPORT: parsed.port,
      PGUSER: decodeURIComponent(parsed.username),
      PGPASSWORD: decodeURIComponent(parsed.password),
      PGDATABASE: parsed.pathname.slice(1),
    };
    const created = spawnSync(
      "psql",
      ["-X", "-v", "ON_ERROR_STOP=1", "-c", `CREATE SCHEMA ${testSchema}`],
      { env: pgEnv, encoding: "utf8" },
    );
    expect(created.status, created.stderr).toBe(0);
    parsed.searchParams.set("options", `-csearch_path=${testSchema}`);
    const url = parsed.toString();
    const setup = JSON.parse(
      spawnSync(binary, ["setup-token"], { encoding: "utf8" }).stdout,
    );
    bootstrap = setup.token;
    env = {
      ...process.env,
      DATABASE_URL: url,
      DATABASE_URL_UNPOOLED: url,
      SUITELEAF_CLOUD: "1",
      SUITELEAF_AUTH_SECRET: randomBytes(32).toString("hex"),
      SUITELEAF_BOOTSTRAP_TOKEN_HASH: setup.hash,
      SUITELEAF_KICK_EVERY_MS: "500",
      RUST_LOG: "warn",
    };
    const migration = spawnSync(binary, ["migrate-cloud"], {
      env,
      encoding: "utf8",
    });
    expect(migration.status, migration.stderr).toBe(0);
    await start(0);
    await start(1);
  }, 60_000);
  afterAll(async () => {
    for (const child of nodes) child?.kill();
    await Promise.all(
      nodes.map((child) =>
        child?.exitCode === null
          ? new Promise<void>((resolve) => child.once("exit", () => resolve()))
          : Promise.resolve(),
      ),
    );
    if (pgEnv)
      spawnSync("psql", ["-X", "-c", `DROP SCHEMA ${testSchema} CASCADE`], {
        env: pgEnv,
        stdio: "ignore",
      });
  });

  it("enforces invitations and saves, versions, shares, and resumes across instances and restart", async () => {
    const suffix = randomBytes(5).toString("hex");
    const signup = {
      email: `owner-${suffix}@suiteleaf.test`,
      name: "Cloud owner",
      password: randomBytes(24).toString("hex"),
    };
    expect(
      (await request(0, "/api/auth/sign-up/email", "POST", "", signup)).status,
    ).toBe(403);
    expect(
      (
        await request(0, "/api/auth/sign-up/email", "POST", "", signup, {
          "x-suiteleaf-registration": bootstrap,
        })
      ).status,
    ).toBe(403);
    const account = await json<{
      token: string;
      user: { role: string; id: string };
    }>(
      await request(0, "/api/auth/sign-up/email", "POST", "", signup, {
        "x-suiteleaf-invite": bootstrap,
      }),
    );
    owner = account.token;
    ownerId = account.user.id;
    expect(account.user.role).toBe("admin");
    const email = `guest-${suffix}@suiteleaf.test`;
    const invitation = await json<{ url: string }>(
      await request(0, "/api/admin/invitations", "POST", owner, { email }),
    );
    const token = new URLSearchParams(
      new URL(invitation.url).hash.split("?")[1],
    ).get("invite")!;
    const guestBody = {
      email,
      name: "Cloud guest",
      password: randomBytes(24).toString("hex"),
    };
    const guestAccount = await json<{ token: string; user: { id: string } }>(
      await request(1, "/api/auth/sign-up/email", "POST", "", guestBody, {
        "x-suiteleaf-invite": token,
      }),
    );
    guest = guestAccount.token;
    guestId = guestAccount.user.id;
    expect(
      (
        await request(1, "/api/auth/sign-up/email", "POST", "", guestBody, {
          "x-suiteleaf-invite": token,
        })
      ).status,
    ).toBe(403);
    type Item = { id: string; headVersionId: string };
    const item = await json<Item>(
      await request(0, "/api/drive/items", "POST", owner, {
        name: `cloud-${suffix}.sldoc`,
        kind: "file",
        mime: "application/json",
      }),
    );
    const path = `/api/drive/items/${item.id}`;
    const first = await json<Item>(
      await request(0, `${path}/content`, "PUT", owner, "first version"),
    );
    expect(await (await request(1, `${path}/content`)).text()).toBe(
      "first version",
    );
    expect((await request(1, `${path}/content`, "GET", guest)).status).toBe(
      403,
    );
    await json(
      await request(0, `${path}/acl`, "PUT", owner, {
        principalType: "user",
        principalId: guestId,
        role: "editor",
      }),
    );
    expect(
      await (await request(1, `${path}/content`, "GET", guest)).text(),
    ).toBe("first version");
    const next = await json<Item>(
      await request(1, `${path}/content`, "PUT", guest, "second version", {
        "if-match": `"${first.headVersionId}"`,
      }),
    );
    expect(
      (
        await request(0, `${path}/content`, "PUT", owner, "stale", {
          "if-match": `"${first.headVersionId}"`,
        })
      ).status,
    ).toBe(409);
    const range = await request(
      0,
      `${path}/content`,
      "PUT",
      owner,
      "resumed ",
      {
        "content-range": "bytes 0-7/16",
        "if-match": `"${next.headVersionId}"`,
      },
    );
    expect(range.ok).toBe(true);
    nodes[0].kill();
    await new Promise((r) => setTimeout(r, 500));
    const finished = await request(
      1,
      `${path}/content`,
      "PUT",
      owner,
      "document",
      {
        "content-range": "bytes 8-15/16",
        "if-match": `"${next.headVersionId}"`,
      },
    );
    expect(finished.ok, await finished.text()).toBe(true);
    await start(0);
    expect(await (await request(0, `${path}/content`)).text()).toBe(
      "resumed document",
    );
    expect(
      await (
        await request(0, `${path}/content?version=${first.headVersionId}`)
      ).text(),
    ).toBe("first version");
    const versions = await json<{ versions: unknown[] }>(
      await request(0, `${path}/versions`),
    );
    expect(versions.versions.length).toBeGreaterThanOrEqual(3);
    await json(await request(0, path, "PATCH", owner, { trashed: true }));
    expect((await request(0, path, "DELETE")).ok).toBe(true);
  }, 90_000);

  it("streams large cloud downloads after resumable binary uploads", async () => {
    const item = await json<{ id: string }>(
      await request(0, "/api/drive/items", "POST", owner, {
        name: "streamed.bin",
        kind: "file",
        mime: "application/octet-stream",
      }),
    );
    const path = `/api/drive/items/${item.id}`;
    const bytes = randomBytes(6 * 1024 * 1024 + 37);
    for (let start = 0; start < bytes.length; start += 1024 * 1024) {
      const end = Math.min(start + 1024 * 1024, bytes.length);
      expect(
        (
          await request(
            0,
            `${path}/content`,
            "PUT",
            owner,
            bytes.subarray(start, end),
            {
              "content-type": "application/octet-stream",
              "content-range": `bytes ${start}-${end - 1}/${bytes.length}`,
            },
          )
        ).ok,
      ).toBe(true);
    }
    const response = await request(1, `${path}/content`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBeNull();
    expect(Buffer.from(await response.arrayBuffer()).equals(bytes)).toBe(true);
    await json(await request(0, path, "PATCH", owner, { trashed: true }));
    expect((await request(0, path, "DELETE")).ok).toBe(true);
  }, 90_000);

  it("keeps acknowledged live edits across instances and restart, and enforces revoked access", async () => {
    type Frame = {
      type?: string;
      mode?: string;
      seed?: boolean;
      generation?: number;
      state?: string;
      update?: string;
      id?: string;
    };
    async function connect(index: number, id: string, token: string) {
      const socket = new WebSocket(
        `${bases[index].replace("http", "ws")}/api/drive/items/${id}/session`,
      );
      const frames: Frame[] = [];
      socket.addEventListener("message", (event) => {
        frames.push(JSON.parse(String(event.data)));
      });
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), { once: true });
        socket.addEventListener(
          "error",
          () => reject(new Error("WebSocket failed")),
          { once: true },
        );
      });
      socket.send(
        JSON.stringify({ type: "auth", accessToken: token, protocol: 1 }),
      );
      const take = async (predicate: (frame: Frame) => boolean) => {
        await waitFor(async () => frames.some(predicate));
        return frames.splice(frames.findIndex(predicate), 1)[0];
      };
      return {
        socket,
        frames,
        take,
        send: (value: unknown) => socket.send(JSON.stringify(value)),
      };
    }
    const item = await json<{ id: string }>(
      await request(0, "/api/drive/items", "POST", owner, {
        name: "collaboration.sldoc",
        kind: "file",
        mime: "application/json",
      }),
    );
    const path = `/api/drive/items/${item.id}`;
    const at = new Date().toISOString();
    const native = {
      format: "suiteleaf",
      version: 1,
      id: item.id,
      kind: "doc",
      title: "Collaboration",
      createdAt: at,
      updatedAt: at,
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "seed" }] },
        ],
      },
    };
    await json(await request(0, `${path}/content`, "PUT", owner, native));
    await json(
      await request(0, `${path}/acl`, "PUT", owner, {
        principalType: "user",
        principalId: guestId,
        role: "editor",
      }),
    );
    const a = await connect(0, item.id, owner);
    expect((await a.take((f) => f.type === "joined")).mode).toBe("solo");
    const b = await connect(1, item.id, guest);
    expect((await b.take((f) => f.type === "joined")).mode).toBe("multiuser");
    const shared = await a.take(
      (f) => f.type === "joined" && f.mode === "multiuser",
    );
    expect(shared.seed).toBe(true);
    const docA = new Y.Doc(),
      docB = new Y.Doc();
    const seed = new Y.Text("seed");
    docA.getArray<Y.Text>("paragraphs").insert(0, [seed]);
    const update = (id: string, bytes: Uint8Array, type = "update") => ({
      type,
      id,
      generation: shared.generation,
      update: Buffer.from(bytes).toString("base64"),
      unit: type === "seed" ? "seed" : "paragraph",
      key: "0",
      at: new Date().toISOString(),
    });
    a.send(update("seed", Y.encodeStateAsUpdate(docA), "seed"));
    await a.take((f) => f.type === "ack" && f.id === "seed");
    const initial = await b.take((f) => f.type === "update");
    Y.applyUpdate(docB, Buffer.from(initial.update!, "base64"));
    const beforeA = Y.encodeStateVector(docA),
      beforeB = Y.encodeStateVector(docB);
    docA.getArray<Y.Text>("paragraphs").get(0).insert(0, "owner ");
    docB.getArray<Y.Text>("paragraphs").get(0).insert(0, "guest ");
    const ownerEdit = update(
      "owner-edit",
      Y.encodeStateAsUpdate(docA, beforeA),
    );
    a.send(ownerEdit);
    b.send(update("guest-edit", Y.encodeStateAsUpdate(docB, beforeB)));
    await a.take((f) => f.type === "ack" && f.id === "owner-edit");
    await b.take((f) => f.type === "ack" && f.id === "guest-edit");
    a.send(ownerEdit);
    await a.take((f) => f.type === "ack" && f.id === "owner-edit");
    const text = (doc: Y.Doc) =>
      doc.getArray<Y.Text>("paragraphs").get(0).toString();
    const integrate = (client: typeof a, doc: Y.Doc) => {
      for (const frame of client.frames.splice(0))
        if (frame.type === "update" && frame.update)
          Y.applyUpdate(doc, Buffer.from(frame.update, "base64"));
    };
    await waitFor(async () => {
      integrate(a, docA);
      integrate(b, docB);
      return (
        text(docA) === text(docB) &&
        text(docA).includes("owner") &&
        text(docA).includes("guest")
      );
    });
    nodes[0].kill();
    await new Promise((r) => setTimeout(r, 500));
    const before = Y.encodeStateVector(docB);
    docB.getArray<Y.Text>("paragraphs").get(0).insert(0, "durable ");
    b.send(update("after-restart", Y.encodeStateAsUpdate(docB, before)));
    await b.take((f) => f.type === "ack" && f.id === "after-restart");
    await start(0);
    const reconnected = await connect(0, item.id, owner);
    const restored = await reconnected.take((f) => f.type === "joined");
    const replay = new Y.Doc();
    Y.applyUpdate(replay, Buffer.from(restored.state!, "base64"));
    expect(text(replay)).toBe(text(docB));
    await json(
      await request(0, `${path}/acl`, "PUT", owner, {
        principalType: "user",
        principalId: guestId,
        role: null,
      }),
    );
    const deniedBefore = Y.encodeStateVector(docB);
    docB.getArray<Y.Text>("paragraphs").get(0).insert(0, "DENIED ");
    b.send(update("revoked", Y.encodeStateAsUpdate(docB, deniedBefore)));
    await b.take((f) => f.type === "error");
    expect(b.frames.some((f) => f.type === "ack" && f.id === "revoked")).toBe(
      false,
    );
    b.socket.close();
    reconnected.socket.close();
    a.socket.close();
    await waitFor(async () => {
      const saved = await (await request(0, `${path}/content`)).text();
      return (
        saved.includes("durable") &&
        saved.includes("owner") &&
        saved.includes("guest") &&
        !saved.includes("DENIED")
      );
    });
    await json(await request(0, path, "PATCH", owner, { trashed: true }));
    expect((await request(0, path, "DELETE")).ok).toBe(true);
  }, 90_000);

  it.skipIf(process.env.SUITELEAF_TEST_GATEWAY !== "1")(
    "streams and cancels authenticated AI Gateway requests",
    async () => {
      expect(
        (
          await request(0, "/api/ai/v1/completions", "POST", "invalid", {
            prompt: "Do not run",
          })
        ).status,
      ).toBe(401);
      const prepared = await json<{ model: string }>(
        await request(0, "/api/ai/v1/load", "POST", owner, {}),
      );
      expect(prepared.model).toBe("openai/gpt-5-mini");
      const response = await request(
        0,
        "/api/ai/v1/completions",
        "POST",
        owner,
        { prompt: "Reply with exactly: cloud-ready", stream: true },
      );
      if (!response.ok)
        throw new Error(
          `Gateway request failed: ${response.status} ${await response.text()}`,
        );
      const chunks = await response.text();
      expect(chunks).toContain("[DONE]");
      const content = chunks
        .split("\n")
        .filter((line) => line.startsWith("data: {"))
        .map((line) => JSON.parse(line.slice(6)).choices[0].text)
        .join("");
      expect(content).toContain("cloud-ready");
      const controller = new AbortController();
      const long = await fetch(`${bases[0]}/api/ai/v1/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${owner}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          prompt:
            "Write a very long essay about spreadsheets, at least ten thousand words.",
          stream: true,
        }),
        signal: controller.signal,
      });
      const reader = long.body!.getReader();
      await reader.read();
      controller.abort();
      await expect(reader.read()).rejects.toThrow();
      expect((await fetch(`${bases[0]}/healthz`)).ok).toBe(true);
    },
    90_000,
  );

  it("serializes concurrent requests without starving the data connection pool", async () => {
    const items = await Promise.all(
      Array.from({ length: 20 }, async (_, i) =>
        json<{ id: string }>(
          await request(i % 2, "/api/drive/items", "POST", owner, {
            name: `parallel-${i}`,
            kind: "folder",
          }),
        ),
      ),
    );
    expect(new Set(items.map((i) => i.id)).size).toBe(20);
    for (const item of items) {
      await json(
        await request(0, `/api/drive/items/${item.id}`, "PATCH", owner, {
          trashed: true,
        }),
      );
      expect(
        (await request(0, `/api/drive/items/${item.id}`, "DELETE")).ok,
      ).toBe(true);
    }
  }, 60_000);

  it.skipIf(process.env.SUITELEAF_TEST_BROWSER !== "1")(
    "types real documents and renders the sheet grid and slide canvas in Chromium",
    async () => {
      const { chromium } = await import("@playwright/test");
      const browser = await chromium.launch({ headless: true });
      try {
        const context = await browser.newContext({
          viewport: { width: 1600, height: 1000 },
        });
        await context.addInitScript(
          ({ url, token, id }) => {
            localStorage.setItem(
              "suiteleaf:node-session",
              JSON.stringify({
                url,
                token,
                user: { id, name: "Cloud owner", role: "admin" },
              }),
            );
          },
          { url: bases[0], token: owner, id: ownerId },
        );
        const page = await context.newPage();
        page.setDefaultTimeout(30_000);
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const saved = () =>
          waitFor(
            async () =>
              (
                (await page.getByRole("status").first().textContent()) ?? ""
              ).includes("Saved to SuiteDrive"),
            30_000,
          );
        mkdirSync(resolve("test-results/cloud-browser"), { recursive: true });
        await page.goto(bases[0]);
        try {
          await page.getByRole("button", { name: "New document" }).click();
        } catch (error) {
          await page.screenshot({
            path: resolve("test-results/cloud-browser/start-failure.png"),
          });
          throw new Error(
            `${String(error)}\nPage: ${(await page.locator("body").innerText()).slice(0, 2000)}\nErrors: ${errors.join("; ")}`,
          );
        }
        const editor = page.getByRole("textbox", { name: "Document content" });
        await editor.click();
        await page.keyboard.type("A document typed in the hosted workspace.");
        await saved();
        await page.reload();
        await editor.waitFor({ state: "visible" });
        await waitFor(async () =>
          (await editor.textContent())!.includes(
            "A document typed in the hosted workspace.",
          ),
        );
        await page.screenshot({
          path: resolve("test-results/cloud-browser/document.png"),
        });
        await page.goto(bases[0]);
        await page.getByRole("button", { name: "New spreadsheet" }).click();
        await page.locator("[data-sheet-ready='true']").waitFor();
        const grid = page.locator(".sheet-host");
        const bounds = await grid.boundingBox();
        expect(bounds?.width).toBeGreaterThan(500);
        expect(bounds?.height).toBeGreaterThan(300);
        expect(await grid.locator("canvas").count()).toBeGreaterThan(0);
        const address = page.locator(".sheet-host input.univer-size-full");
        await address.fill("B1");
        await address.press("Enter");
        await page.keyboard.type("14");
        await page.keyboard.press("Enter");
        await saved();
        await page.screenshot({
          path: resolve("test-results/cloud-browser/spreadsheet.png"),
        });
        await page.goto(bases[0]);
        await page.getByRole("button", { name: "New presentation" }).click();
        const canvas = page.locator(".slide-canvas");
        await canvas.waitFor({ state: "visible" });
        const slideBounds = await canvas.boundingBox();
        expect(slideBounds?.width).toBeGreaterThan(300);
        expect(slideBounds?.height).toBeGreaterThan(150);
        await canvas.locator(".slide-text").first().dblclick();
        const slideEditor = page
          .locator('.element-editor[contenteditable="true"]')
          .first();
        await slideEditor.waitFor();
        await slideEditor.press("Control+A");
        await page.keyboard.type("A hosted presentation");
        await page.keyboard.press("Escape");
        await saved();
        await page.screenshot({
          path: resolve("test-results/cloud-browser/presentation.png"),
        });
        expect(errors).toEqual([]);
        await context.close();
      } finally {
        await browser.close();
      }
    },
    180_000,
  );
});
