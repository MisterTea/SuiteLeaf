import { test, expect, type Browser, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { createFile, serializeFile } from "../../packages/core/src";

const root = resolve(import.meta.dirname, "../..");
const binary = join(root, "target/debug/suiteleaf-node");
const sidecar = join(root, "services/auth/dist/server.mjs");
const webRoot = join(root, "apps/web/dist");
const ready = [binary, sidecar, join(webRoot, "index.html")].every(existsSync);

interface Node {
  url: string;
  p2p: string;
  dir: string;
  process: ChildProcess;
  /** Accounts created on this node in this run. */
  signUps: number;
}
const processes: ChildProcess[] = [];

async function freePort() {
  return new Promise<number>((done) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => done(port));
    });
  });
}

async function run(args: string[]) {
  await new Promise<void>((done, fail) =>
    spawn(binary, args, { stdio: "ignore" }).once("exit", (code) =>
      code ? fail(new Error(`${args[0]} failed`)) : done(),
    ),
  );
}

async function startNode(
  dataDir: string,
  bootstrap?: string,
  port?: number,
): Promise<Node> {
  port ??= await freePort();
  const url = `http://127.0.0.1:${port}`;
  const config = join(dataDir, "node.toml");
  writeFileSync(
    config,
    `[auth]\ncommand = ${JSON.stringify(["node", sidecar])}\n`,
  );
  const args = [
    "run",
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
    // Lets the web app served by the Playwright web server connect too.
    "--cors-origin",
    new URL(test.info().project.use.baseURL!).origin,
    "--sync-interval",
    "1",
    ...(bootstrap ? ["--bootstrap", bootstrap] : []),
  ];
  const child = spawn(binary, args, {
    env: {
      ...process.env,
      SUITELEAF_AUTH_SECRET: "suitedrive-playwright-secret-0123456789abcdef",
      RUST_LOG: "warn",
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  processes.push(child);
  const p2p = await new Promise<string>((done, fail) => {
    child.once("exit", (code) => fail(new Error(`node exited (${code})`)));
    createInterface({ input: child.stdout! }).on("line", (line) => {
      if (line.startsWith("SUITELEAF_NODE_READY "))
        done(JSON.parse(line.slice(21)).p2p[0]);
    });
  });
  await expect
    .poll(
      async () =>
        (await (await fetch(`${url}/api/node/info`)).json()).auth.enabled,
      {
        timeout: 15000,
      },
    )
    .toBe(true);
  return { url, p2p, dir: dataDir, process: child, signUps: 0 };
}

test.describe("SuiteDrive across two nodes", () => {
  test.skip(
    !ready,
    "Build first: cargo build -p suiteleaf-node, npm run build:auth, npm run build:web",
  );
  test.skip(
    ({ browserName, isMobile }) => browserName !== "chromium" || isMobile,
    "One desktop browser covers the node protocol.",
  );

  const nodes: Node[] = [];
  /** Start a node in the same cluster as the first one. */
  async function addNode() {
    const dir = mkdtempSync(join(tmpdir(), "suitedrive-e2e-"));
    const first = nodes[0];
    await run([
      "init",
      "--data-dir",
      dir,
      ...(first ? ["--swarm-key", join(first.dir, "swarm.key")] : []),
    ]);
    const node = await startNode(dir, first?.p2p);
    nodes.push(node);
    return node;
  }
  test.beforeAll(async () => {
    nodes.length = 0;
    await addNode();
    await addNode();
  });
  // A test's background uploads must not reach the next test or outlive the nodes.
  test.afterEach(async ({ browser }) => {
    for (const context of browser.contexts()) {
      for (const page of context.pages())
        await page.unrouteAll({ behavior: "ignoreErrors" });
      await context.close();
    }
  });
  test.afterAll(() => {
    for (const child of processes) child.kill();
  });

  /** A web app served by a server is in cluster mode and starts at sign-in. */
  async function signIn(
    page: Page,
    create: boolean,
    email = "ann@example.com",
  ) {
    const card = page.getByLabel("Sign in to SuiteLeaf");
    await expect(card).toBeVisible();
    await expect(
      card.getByText("Work on this computer without a server"),
    ).toHaveCount(0);
    if (create) {
      await card.getByRole("button", { name: "Create an account" }).click();
      await card.getByLabel("Name", { exact: true }).fill("Ann Example");
      await card.getByLabel("Email", { exact: true }).fill(email);
      await card
        .getByLabel("Password", { exact: true })
        .fill("correct-horse-battery");
      await page.screenshot({ path: "test-results/cluster-sign-up.png" });
      await card.getByRole("button", { name: "Create account" }).click();
    } else {
      await card.getByLabel("Email or username", { exact: true }).fill(email);
      await card
        .getByLabel("Password", { exact: true })
        .fill("correct-horse-battery");
      await card.getByRole("button", { name: "Sign in", exact: true }).click();
    }
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  }

  /** Create an account on a node that can take another. better-auth allows a
   * client address three sign-ups per node until ten seconds pass without
   * one, and every page reaches its node from 127.0.0.1, so no node gets a
   * fourth however quickly the tests run. */
  async function signUp(page: Page, email: string) {
    const node = nodes.find((n) => n.signUps < 3) ?? (await addNode());
    node.signUps++;
    await page.goto(node.url);
    await signIn(page, true, email);
    return node;
  }

  /** The signed-in user's top-level SuiteDrive items. */
  const driveItems = (page: Page) =>
    page.evaluate(async () => {
      const s = JSON.parse(localStorage.getItem("suiteleaf:node-session")!);
      const r = await fetch(`${s.url}/api/drive/items`, {
        headers: { authorization: `Bearer ${s.token}` },
      });
      return (await r.json()).items as {
        id: string;
        name: string;
        size: number;
      }[];
    });

  /** Save a new version of `name` as another client would, replacing `from` with `to`. */
  const saveElsewhere = (page: Page, name: string, from: string, to: string) =>
    page.evaluate(
      async ([name, from, to]) => {
        const s = JSON.parse(localStorage.getItem("suiteleaf:node-session")!);
        const headers = { authorization: `Bearer ${s.token}` };
        const { items } = await (
          await fetch(`${s.url}/api/drive/items`, { headers })
        ).json();
        const id = items.find((i: { name: string }) => i.name === name).id;
        const url = `${s.url}/api/drive/items/${id}/content`;
        const text = await (await fetch(url, { headers })).text();
        const r = await fetch(url, {
          method: "PUT",
          headers: { ...headers, "content-type": "application/json" },
          body: text.replace(from, to),
        });
        if (!r.ok) throw new Error(`upload failed: ${r.status}`);
      },
      [name, from, to],
    );

  test("save on one node, open on another, and detect a conflicting edit", async ({
    browser,
  }) => {
    const pageA = await (await browser.newContext()).newPage();
    const a = await signUp(pageA, "ann@example.com");
    const b = nodes.find((n) => n !== a)!;

    await expect(
      pageA.getByRole("heading", { name: "SuiteDrive" }),
    ).toBeVisible();
    await expect(pageA.getByText("Connect to a server")).toHaveCount(0);
    await pageA.getByRole("button", { name: "New document" }).click();
    await pageA.getByLabel("File title").fill("Field report");
    const editorA = pageA.getByRole("textbox", { name: "Document content" });
    await editorA.fill("Written on node A");
    await expect(pageA.getByRole("status")).toHaveText("Saved to SuiteDrive", {
      timeout: 20000,
    });
    await pageA.getByRole("button", { name: "File", exact: true }).click();
    await expect(
      pageA.getByRole("menuitem", { name: "Save as…" }),
    ).toBeVisible();
    await pageA.keyboard.press("Escape");

    const pageB = await (await browser.newContext()).newPage();
    await pageB.goto(b.url);
    await expect
      .poll(
        async () =>
          (await (await fetch(`${b.url}/api/node/info`)).json()).suitedrive
            .replicating,
        {
          timeout: 15000,
        },
      )
      .toBe(0);
    await signIn(pageB, false);
    await pageB.screenshot({ path: "test-results/cluster-home.png" });
    await pageB
      .getByRole("button", { name: "Field report.sldoc", exact: true })
      .click();
    const editorB = pageB.getByRole("textbox", { name: "Document content" });
    await expect(editorB).toContainText("Written on node A");

    await editorB.fill("Rewritten on node B");
    await expect(pageB.getByRole("status")).toHaveText("Saved to SuiteDrive", {
      timeout: 20000,
    });

    // Once node A has node B's bytes, the open file picks them up while Ann
    // is idle. A later unsent line still raises the conflict banner.
    await expect
      .poll(
        async () =>
          (await driveItems(pageA)).find((i) => i.name === "Field report.sldoc")
            ?.size,
        { timeout: 15000 },
      )
      .not.toBeUndefined();
    await expect
      .poll(
        async () =>
          (
            await (await fetch(`${a.url}/api/node/info`)).json()
          ).suitedb.heads.join(),
        { timeout: 15000 },
      )
      .toBe(
        (
          await (await fetch(`${b.url}/api/node/info`)).json()
        ).suitedb.heads.join(),
      );
    await expect(editorA).toContainText("Rewritten on node B", {
      timeout: 8000,
    });
    await expect(pageA.locator(".save-status")).toContainText(
      "Ann Example updated this.",
    );
    await editorA.press("End");
    await pageA.keyboard.type(" — still drafting");
    await saveElsewhere(
      pageA,
      "Field report.sldoc",
      "Rewritten on node B",
      "Rewritten on node B, final",
    );
    await expect(
      pageA.getByText("This file was changed in SuiteDrive"),
    ).toBeVisible({
      timeout: 20000,
    });
    await expect(editorA).toContainText("still drafting");
    pageA.once("dialog", (d) => void d.accept());
    await pageA.getByRole("button", { name: "Reload from SuiteDrive" }).click();
    await expect(
      pageA.getByRole("textbox", { name: "Document content" }),
    ).toContainText("Rewritten on node B, final");
    await expect(editorA).not.toContainText("still drafting");
    await pageA.screenshot({
      path: "test-results/suitedrive.png",
      fullPage: true,
    });
  });

  test("reopening a file from SuiteDrive keeps edits that were never uploaded", async ({
    browser,
  }) => {
    const page = await (await browser.newContext()).newPage();
    await signUp(page, "reopen@example.com");
    await page.getByRole("button", { name: "New document" }).click();
    await page.getByLabel("File title").fill("Offline notes");
    const editor = page.getByRole("textbox", { name: "Document content" });
    await editor.fill("First draft");
    const status = page.getByRole("status");
    await expect(status).toHaveText("Saved to SuiteDrive", { timeout: 20000 });

    const reopen = async () => {
      await page.getByRole("button", { name: "Back to files" }).click();
      await page
        .getByRole("button", { name: "Offline notes.sldoc", exact: true })
        .click();
    };
    const banner = page.getByText("This file was changed in SuiteDrive");

    await editor.fill("Edits only on this device");
    await saveElsewhere(
      page,
      "Offline notes.sldoc",
      "First draft",
      "Saved elsewhere",
    );
    await expect(banner).toBeVisible({ timeout: 20000 });

    await reopen();
    await expect(editor).toContainText("Edits only on this device");
    await expect(banner).toBeVisible({ timeout: 20000 });
    await page.reload();
    await reopen();
    await expect(editor).toContainText("Edits only on this device");
    await expect(banner).toBeVisible({ timeout: 20000 });

    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "Reload from SuiteDrive" }).click();
    await expect(editor).toContainText("Saved elsewhere");

    // With nothing left to upload, the local copy follows newer versions.
    await saveElsewhere(
      page,
      "Offline notes.sldoc",
      "Saved elsewhere",
      "Saved again elsewhere",
    );
    await reopen();
    await expect(editor).toContainText("Saved again elsewhere");
    await expect(status).toHaveText("Saved to SuiteDrive");
    await expect(banner).toHaveCount(0);
  });

  type Held = Window & { holdWrites?: boolean; heldWrites: (() => void)[] };
  /** A page whose local IndexedDB writes stay in flight until the test releases them. */
  async function pageHoldingWrites(browser: Browser) {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      const w = window as Held;
      w.heldWrites = [];
      const oncomplete = Object.getOwnPropertyDescriptor(
        IDBTransaction.prototype,
        "oncomplete",
      )!;
      Object.defineProperty(IDBTransaction.prototype, "oncomplete", {
        configurable: true,
        get() {
          return oncomplete.get!.call(this);
        },
        set(fn: ((e: Event) => void) | null) {
          oncomplete.set!.call(
            this,
            fn &&
              function (this: IDBTransaction, e: Event) {
                if (w.holdWrites && this.mode === "readwrite")
                  w.heldWrites.push(() => fn.call(this, e));
                else fn.call(this, e);
              },
          );
        },
      });
    });
    return context.newPage();
  }

  test("an edit saved locally during an upload keeps the uploaded version", async ({
    browser,
  }) => {
    const page = await pageHoldingWrites(browser);
    await signUp(page, "inflight@example.com");
    await page.getByRole("button", { name: "New document" }).click();
    await page.getByLabel("File title").fill("Busy notes");
    const editor = page.getByRole("textbox", { name: "Document content" });
    await editor.fill("First");
    const status = page.getByRole("status");
    await expect(status).toHaveText("Saved to SuiteDrive", { timeout: 20000 });

    const ifMatch: (string | undefined)[] = [];
    let uploaded: string | undefined;
    let releaseUpload!: () => void;
    const uploading = new Promise<void>((started) => {
      void page.route("**/api/drive/items/*/content", async (route) => {
        if (route.request().method() !== "PUT") return route.continue();
        ifMatch.push(route.request().headers()["if-match"]);
        if (ifMatch.length > 1) return route.continue();
        await new Promise<void>((release) => {
          releaseUpload = release;
          started();
        });
        const response = await route.fetch();
        uploaded = (await response.json()).headVersionId;
        await route.fulfill({ response });
      });
    });
    const heldWrites = () =>
      page.evaluate(() => (window as Held).heldWrites.length);

    await editor.press("End");
    await page.keyboard.type(" during upload");
    await uploading;
    await page.evaluate(() => ((window as Held).holdWrites = true));
    await page.keyboard.type(" and more");
    await expect.poll(heldWrites).toBe(1);
    releaseUpload();
    // The finished upload records its version locally behind the autosave.
    await expect.poll(heldWrites).toBe(2);
    await page.evaluate(() => {
      const w = window as Held;
      w.holdWrites = false;
      for (const release of w.heldWrites.splice(0)) release();
    });

    await expect.poll(() => ifMatch.length, { timeout: 20000 }).toBe(2);
    expect(ifMatch[1]).toBe(`"${uploaded}"`);
    await expect(status).toHaveText("Saved to SuiteDrive", { timeout: 20000 });
    await expect(
      page.getByText("This file was changed in SuiteDrive"),
    ).toHaveCount(0);
  });

  test("reopening a file while its upload is in flight does not conflict", async ({
    browser,
  }) => {
    const page = await (await browser.newContext()).newPage();
    await signUp(page, "reopen-inflight@example.com");
    await page.getByRole("button", { name: "New document" }).click();
    await page.getByLabel("File title").fill("Quick notes");
    const editor = page.getByRole("textbox", { name: "Document content" });
    await editor.fill("First");
    const status = page.getByRole("status");
    await expect(status).toHaveText("Saved to SuiteDrive", { timeout: 20000 });

    const uploads: { ifMatch?: string; release: () => void }[] = [];
    const responses: number[] = [];
    let uploaded: string | undefined;
    let holding = true;
    await page.route("**/api/drive/items/*/content", async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      const ifMatch = route.request().headers()["if-match"];
      if (holding)
        await new Promise<void>((release) =>
          uploads.push({ ifMatch, release }),
        );
      else uploads.push({ ifMatch, release: () => {} });
      const response = await route.fetch();
      responses.push(response.status());
      if (response.ok()) uploaded ??= (await response.json()).headVersionId;
      await route.fulfill({ response });
    });

    await editor.press("End");
    await page.keyboard.type(" and a quick edit");
    await page.getByRole("button", { name: "Back to files" }).click();
    await expect.poll(() => uploads.length, { timeout: 20000 }).toBe(1);
    await page
      .getByRole("button", { name: "Quick notes.sldoc", exact: true })
      .click();
    // Gives the reopened editor time to start its own upload if it would.
    await page.waitForTimeout(1000);
    holding = false;
    for (const [i, upload] of uploads.entries()) {
      upload.release();
      await expect.poll(() => responses.length).toBe(i + 1);
    }

    await expect(editor).toContainText("First and a quick edit");
    await expect(status).toHaveText("Saved to SuiteDrive", { timeout: 20000 });
    await expect(
      page.getByText("This file was changed in SuiteDrive"),
    ).toHaveCount(0);
    expect(responses).not.toContain(409);
    for (const upload of uploads.slice(1))
      expect(upload.ifMatch).toBe(`"${uploaded}"`);
  });

  test("leaving a file while it saves locally does not upload it again", async ({
    browser,
  }) => {
    const page = await pageHoldingWrites(browser);
    await signUp(page, "leave-saving@example.com");
    const status = page.getByRole("status");
    const editor = page.getByRole("textbox", { name: "Document content" });
    const uploads: {
      ifMatch?: string;
      body: string;
      status: number;
      version?: string;
    }[] = [];
    await page.route("**/api/drive/items/*/content", async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      const response = await route.fetch();
      uploads.push({
        ifMatch: route.request().headers()["if-match"],
        body: route.request().postData() ?? "",
        status: response.status(),
        version: response.ok()
          ? (await response.json()).headVersionId
          : undefined,
      });
      await route.fulfill({ response });
    });
    const heldWrites = () =>
      page.evaluate(() => (window as Held).heldWrites.length);

    for (const name of ["Autosaved notes", "Shortcut notes"]) {
      await page.getByRole("button", { name: "New document" }).click();
      await page.getByLabel("File title").fill(name);
      await editor.fill("First");
      await expect(status).toHaveText("Saved to SuiteDrive", {
        timeout: 20000,
      });
      uploads.length = 0;

      await editor.press("End");
      await page.evaluate(() => ((window as Held).holdWrites = true));
      await page.keyboard.type(" and an edit");
      if (name === "Shortcut notes")
        await page.keyboard.press("ControlOrMeta+s");
      await expect.poll(heldWrites).toBe(1);
      await expect(status).toHaveText("Saving…");
      // Unlike "Back to files", a route change does not wait for the save.
      await page.evaluate(() => history.back());
      await expect.poll(() => uploads.length, { timeout: 20000 }).toBe(1);
      // Keep only the edit's local write in flight while the file is reopened.
      await expect.poll(heldWrites).toBe(2);
      await page.evaluate(() => {
        const w = window as Held;
        w.holdWrites = false;
        for (const release of w.heldWrites.splice(1)) release();
      });
      await page
        .getByRole("button", { name: `${name}.sldoc`, exact: true })
        .click();
      await expect(editor).toContainText("First and an edit");
      await expect(status).toHaveText("Saved to SuiteDrive");
      await page.evaluate(() => {
        for (const release of (window as Held).heldWrites.splice(0)) release();
      });
      // Gives the closed editor time to upload again if it would.
      await page.waitForTimeout(2500);

      await editor.press("End");
      await page.keyboard.type(" after reopening");
      await expect
        .poll(() => uploads.some((u) => u.body.includes("after reopening")), {
          timeout: 20000,
        })
        .toBe(true);
      expect(uploads.map((u) => u.status)).toEqual([200, 200]);
      expect(uploads[1].ifMatch).toBe(`"${uploads[0].version}"`);
      await expect(status).toHaveText("Saved to SuiteDrive", {
        timeout: 20000,
      });
      await expect(
        page.getByText("This file was changed in SuiteDrive"),
      ).toHaveCount(0);
      await page.getByRole("button", { name: "Back to files" }).click();
    }
  });

  test("saving a conflicting edit as a copy keeps the copy's own name", async ({
    browser,
  }) => {
    const page = await (await browser.newContext()).newPage();
    await signUp(page, "copy@example.com");
    await page.getByRole("button", { name: "New document" }).click();
    const title = page.getByLabel("File title");
    await title.fill("Draft plan");
    const editor = page.getByRole("textbox", { name: "Document content" });
    await editor.fill("First draft");
    const status = page.getByRole("status");
    await expect(status).toHaveText("Saved to SuiteDrive", { timeout: 20000 });

    await editor.fill("My version");
    await saveElsewhere(
      page,
      "Draft plan.sldoc",
      "First draft",
      "Saved elsewhere",
    );
    await expect(
      page.getByText("This file was changed in SuiteDrive"),
    ).toBeVisible({ timeout: 20000 });
    await page.getByRole("button", { name: "Save as copy" }).click();
    await expect(status).toHaveText("Saved a copy to SuiteDrive", {
      timeout: 20000,
    });
    // Each upload names the SuiteDrive file after the document's title.
    await editor.press("End");
    await page.keyboard.type(" and more");
    await expect(status).toHaveText("Saved to SuiteDrive", { timeout: 20000 });

    expect((await driveItems(page)).map((i) => i.name).sort()).toEqual([
      "Draft plan (copy).sldoc",
      "Draft plan.sldoc",
    ]);
    await expect(title).toHaveValue("Draft plan (copy)");
  });

  test("signing out removes cached SuiteDrive files once their edits are uploaded", async ({
    browser,
  }) => {
    const page = await (await browser.newContext()).newPage();
    await signUp(page, "sign-out@example.com");
    const status = page.getByRole("status");
    const editor = page.getByRole("textbox", { name: "Document content" });
    await page.getByRole("button", { name: "New document" }).click();
    await page.getByLabel("File title").fill("Private notes");
    await editor.fill("Secret draft");
    await expect(status).toHaveText("Saved to SuiteDrive", { timeout: 20000 });

    // A single-node file this browser kept before it was used with a server.
    const local = createFile("doc");
    local.title = "Kept locally";
    await page.evaluate(
      (row) =>
        new Promise<void>((done, fail) => {
          const open = indexedDB.open("SuiteLeaf");
          open.onsuccess = () => {
            const tx = open.result.transaction("encoded", "readwrite");
            tx.objectStore("encoded").put(row);
            tx.oncomplete = () => done(open.result.close());
            tx.onerror = () => fail(tx.error);
          };
        }),
      {
        id: local.id,
        title: local.title,
        updatedAt: local.updatedAt,
        native: serializeFile(local),
      },
    );
    const cached = () =>
      page.evaluate(
        () =>
          new Promise<string[]>((done) => {
            const open = indexedDB.open("SuiteLeaf");
            open.onsuccess = () => {
              const all = open.result
                .transaction("encoded")
                .objectStore("encoded")
                .getAll();
              all.onsuccess = () => {
                open.result.close();
                done(
                  (all.result as { title: string; drive?: unknown }[])
                    .map((r) => `${r.title}${r.drive ? " (SuiteDrive)" : ""}`)
                    .sort(),
                );
              };
            };
          }),
      );
    const dialogs: string[] = [];
    page.on("dialog", (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    const signOut = page.getByRole("button", { name: "Sign out" });

    await page.route("**/api/drive/items/*/content", (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({ status: 503, json: { error: "Unavailable" } })
        : route.continue(),
    );
    await editor.press("End");
    await page.keyboard.type(" not uploaded yet");
    await expect(status).toHaveText("Saved on this device · Unavailable", {
      timeout: 20000,
    });
    await page.getByRole("button", { name: "Back to files" }).click();
    await signOut.click();
    await expect.poll(() => dialogs.length).toBe(1);
    expect(dialogs[0]).toContain("haven't reached SuiteDrive");
    await expect(signOut).toBeVisible();
    expect(await cached()).toEqual([
      "Kept locally",
      "Private notes (SuiteDrive)",
    ]);

    // Reopening uploads the edits; signing out waits for that upload.
    await page.unroute("**/api/drive/items/*/content");
    const bodies: string[] = [];
    let release!: () => void;
    const uploading = new Promise<void>((started) => {
      void page.route("**/api/drive/items/*/content", async (route) => {
        if (route.request().method() !== "PUT") return route.continue();
        bodies.push(route.request().postData() ?? "");
        if (bodies.length === 1)
          await new Promise<void>((resume) => {
            release = resume;
            started();
          });
        await route.continue();
      });
    });
    await page
      .getByRole("button", { name: "Private notes.sldoc", exact: true })
      .click();
    await expect(editor).toContainText("Secret draft not uploaded yet");
    await uploading;
    await page.getByRole("button", { name: "Back to files" }).click();
    await signOut.click();
    await page.waitForTimeout(500);
    await expect(signOut).toBeVisible();
    expect(await cached()).toContain("Private notes (SuiteDrive)");
    release();

    await expect(page.getByLabel("Sign in to SuiteLeaf")).toBeVisible();
    expect(await cached()).toEqual(["Kept locally"]);
    expect(dialogs).toHaveLength(1);
    expect(bodies[0]).toContain("not uploaded yet");
  });

  test("disconnecting signs out, so reconnecting asks for a password", async ({
    browser,
  }) => {
    const email = "disconnect@example.com";
    const onNode = await (await browser.newContext()).newPage();
    const node = await signUp(onNode, email);
    // Served elsewhere, the web app can switch between modes.
    const page = await (await browser.newContext()).newPage();
    await page.goto("/");
    const connect = async () => {
      await page.getByRole("button", { name: "Connect to a server" }).click();
      const dialog = page.getByRole("dialog", {
        name: "Connect to a SuiteLeaf server",
      });
      await dialog.getByLabel("Server address").fill(node.url);
      await dialog
        .getByRole("button", { name: "Connect", exact: true })
        .click();
    };
    const stored = () =>
      page.evaluate(() => localStorage.getItem("suiteleaf:node-session"));
    const me = async (token: string) =>
      (
        await fetch(`${node.url}/api/me`, {
          headers: { authorization: `Bearer ${token}` },
        })
      ).status;
    const card = page.getByLabel("Sign in to SuiteLeaf");
    const suiteDrive = page.getByRole("heading", { name: "SuiteDrive" });
    const local = page.getByText("Your workspace, in this browser.");
    const disconnect = page.getByRole("button", {
      name: "Disconnect from server",
    });

    await connect();
    await card.getByLabel("Email or username", { exact: true }).fill(email);
    await card
      .getByLabel("Password", { exact: true })
      .fill("correct-horse-battery");
    await card.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(suiteDrive).toBeVisible();
    const { token } = JSON.parse((await stored())!);
    expect(await me(token)).toBe(200);

    await disconnect.click();
    await expect(local).toBeVisible();
    expect(await stored()).toBeNull();
    expect(await me(token)).toBe(401);
    await connect();
    await expect(card).toBeVisible();
    await expect(suiteDrive).toHaveCount(0);

    // A server that doesn't answer keeps the session, but this browser forgets it.
    const session = await onNode.evaluate(() =>
      localStorage.getItem("suiteleaf:node-session")!,
    );
    const restore = () =>
      page.evaluate(
        (s) => localStorage.setItem("suiteleaf:node-session", s),
        session,
      );
    await restore();
    await page.reload();
    await expect(suiteDrive).toBeVisible();
    let revoking = false;
    await page.route(`${node.url}/api/auth/sign-out`, () => {
      revoking = true;
    });
    await disconnect.click();
    await expect(local).toBeVisible();
    expect(revoking).toBe(true);
    expect(await stored()).toBeNull();
    expect(await me(JSON.parse(session).token)).toBe(200);

    // A disconnect closed before the server answered signs out at the next start.
    await restore();
    await connect();
    await expect(suiteDrive).toBeVisible();
    revoking = false;
    await disconnect.click();
    await expect.poll(() => revoking).toBe(true);
    await page.close();
    const reopened = await page.context().newPage();
    await reopened.goto("/");
    await expect(reopened.getByLabel("Sign in to SuiteLeaf")).toBeVisible();
    await expect.poll(() => me(JSON.parse(session).token)).toBe(401);
    expect(
      await reopened.evaluate(() => [
        localStorage.getItem("suiteleaf:node-session"),
        localStorage.getItem("suiteleaf:signing-out"),
      ]),
    ).toEqual([null, null]);
  });

  test("a server that is down when its web app opens keeps the user signed in", async ({
    browser,
  }) => {
    // Its own node, since stopping it would fail the other tests' uploads.
    const dir = mkdtempSync(join(tmpdir(), "suitedrive-e2e-"));
    await run(["init", "--data-dir", dir]);
    const node = await startNode(dir);
    const page = await (await browser.newContext()).newPage();
    await page.goto(node.url);
    await signIn(page, true, "outage@example.com");
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller)
        await new Promise<void>((done) =>
          navigator.serviceWorker.addEventListener(
            "controllerchange",
            () => done(),
            { once: true },
          ),
        );
    });
    const stored = () =>
      page.evaluate(() => localStorage.getItem("suiteleaf:node-session"));
    const session = (await stored())!;

    await new Promise<void>((done) => {
      node.process.once("exit", () => done());
      node.process.kill();
    });
    await page.reload();
    // The cached app can't reach its server, so it falls back to this browser.
    await expect(
      page.getByText("Your workspace, in this browser."),
    ).toBeVisible();
    expect(await stored()).toBe(session);

    await startNode(dir, undefined, Number(new URL(node.url).port));
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "SuiteDrive" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    expect(await stored()).toBe(session);
    const me = await fetch(`${node.url}/api/me`, {
      headers: { authorization: `Bearer ${JSON.parse(session).token}` },
    });
    expect(me.status).toBe(200);
  });

  test("folders use in-app dialogs, and leaving a file returns to its folder", async ({
    browser,
  }) => {
    const page = await (await browser.newContext()).newPage();
    const native: string[] = [];
    page.on("dialog", (d) => {
      native.push(d.message());
      void d.dismiss();
    });
    await signUp(page, "folders@example.com");
    const item = (name: string) =>
      page.getByRole("button", { name, exact: true });
    const crumbs = page.getByLabel("Folder path");

    await page.getByRole("button", { name: "New folder" }).click();
    const create = page.getByRole("dialog", { name: "New folder" });
    await expect(create.getByLabel("Name")).toBeFocused();
    await page.keyboard.type("Club");
    await create.getByRole("button", { name: "Create" }).click();
    await item("Club").click();
    await expect(crumbs).toContainText("Club");
    const newDocument = page.getByRole("button", { name: /New document/ });
    await expect(newDocument).toContainText("In Club");

    await newDocument.click();
    await page.getByLabel("File title").fill("Rota");
    await page
      .getByRole("textbox", { name: "Document content" })
      .fill("Mon Rosa");
    await expect(page.getByRole("status")).toHaveText("Saved to SuiteDrive", {
      timeout: 20000,
    });
    await page.getByRole("button", { name: "Back to files" }).click();
    await expect(crumbs).toContainText("Club");
    await expect(item("Rota.sldoc")).toBeVisible();
    await page.reload();
    await expect(crumbs).toContainText("Club");
    await expect(item("Rota.sldoc")).toBeVisible();

    await page.getByRole("button", { name: "Rename Rota.sldoc" }).click();
    const rename = page.getByRole("dialog", { name: "Rename" });
    await expect(rename.getByLabel("Name")).toBeFocused();
    await page.keyboard.type("Watering rota");
    await rename.getByRole("button", { name: "OK" }).click();
    await expect(item("Watering rota.sldoc")).toBeVisible();

    const trash = page.getByRole("button", {
      name: "Move Watering rota.sldoc to trash",
    });
    await trash.click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(item("Watering rota.sldoc")).toHaveCount(0);
    const notice = page
      .getByRole("status")
      .filter({ hasText: "Watering rota.sldoc" });
    await expect(notice).toContainText("Trash");
    await page.waitForTimeout(3000);
    await expect(notice).toBeVisible();
    await notice.getByRole("button", { name: "Undo" }).click();
    await expect(item("Watering rota.sldoc")).toBeVisible();
    await expect(notice).toHaveCount(0);
    expect(native).toEqual([]);
  });
});
