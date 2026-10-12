import { test, expect, type Browser, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

const root = resolve(import.meta.dirname, "../..");
const binary = join(root, "target/debug/suiteleaf-node");
const sidecar = join(root, "services/auth/dist/server.mjs");
const webRoot = join(root, "apps/web/dist");
const ready = [binary, sidecar, join(webRoot, "index.html")].every(existsSync);

interface Node {
  url: string;
  p2p: string;
  process: ChildProcess;
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

async function startNode(dataDir: string, bootstrap?: string): Promise<Node> {
  const port = await freePort();
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
  return { url, p2p, process: child };
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

  let a: Node, b: Node;
  test.beforeAll(async () => {
    const dirs = [0, 1].map(() =>
      mkdtempSync(join(tmpdir(), "suitedrive-e2e-")),
    );
    await run(["init", "--data-dir", dirs[0]]);
    await run([
      "init",
      "--data-dir",
      dirs[1],
      "--swarm-key",
      join(dirs[0], "swarm.key"),
    ]);
    a = await startNode(dirs[0]);
    b = await startNode(dirs[1], a.p2p);
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

  test("save on one node, open on another, and detect a conflicting edit", async ({
    browser,
  }) => {
    const pageA = await (await browser.newContext()).newPage();
    await pageA.goto(a.url);
    await signIn(pageA, true);

    await expect(
      pageA.getByRole("heading", { name: "SuiteDrive" }),
    ).toBeVisible();
    await expect(pageA.getByText("Connect to a server")).toHaveCount(0);
    await expect(pageA.getByText("Connected to 1 other server")).toBeVisible({
      timeout: 15000,
    });
    await pageA.getByRole("button", { name: "New document" }).click();
    await expect(
      pageA.getByTitle(`Saving to SuiteDrive on ${new URL(a.url).host}`),
    ).toBeVisible();
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
    await expect(pageB.getByLabel("Sign in to SuiteLeaf")).toContainText(
      "An account made on any of them works here.",
    );
    await signIn(pageB, false);
    await pageB.screenshot({ path: "test-results/cluster-home.png" });
    await pageB
      .getByRole("button", { name: "Field report.sldoc", exact: true })
      .click();
    const editorB = pageB.getByRole("textbox", { name: "Document content" });
    await expect(editorB).toContainText("Written on node A");
    await expect(
      pageB.getByTitle(`Saving to SuiteDrive on ${new URL(b.url).host}`),
    ).toBeVisible();

    await editorB.fill("Rewritten on node B");
    await expect(pageB.getByRole("status")).toHaveText("Saved to SuiteDrive", {
      timeout: 20000,
    });

    // Node A still holds the old version, so its next upload conflicts.
    await expect
      .poll(
        async () => {
          const items = await pageA.evaluate(async () => {
            const s = JSON.parse(
              localStorage.getItem("suiteleaf:node-session")!,
            );
            const r = await fetch(`${s.url}/api/drive/items`, {
              headers: { authorization: `Bearer ${s.token}` },
            });
            return (await r.json()).items as { name: string; size: number }[];
          });
          return items.find((i) => i.name === "Field report.sldoc")?.size;
        },
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
    await editorA.fill("A stale edit from node A");
    await expect(
      pageA.getByText("This file was changed in SuiteDrive"),
    ).toBeVisible({
      timeout: 20000,
    });
    pageA.once("dialog", (d) => void d.accept());
    await pageA.getByRole("button", { name: "Reload from SuiteDrive" }).click();
    await expect(
      pageA.getByRole("textbox", { name: "Document content" }),
    ).toContainText("Rewritten on node B");
    await pageA.screenshot({
      path: "test-results/suitedrive.png",
      fullPage: true,
    });

    // Node B's file list picks up a file made on node A without a reload.
    await pageB.getByRole("button", { name: "Back to files" }).click();
    await expect(
      pageB.getByRole("button", { name: "Field report.sldoc", exact: true }),
    ).toBeVisible();
    await pageA.evaluate(async () => {
      const s = JSON.parse(localStorage.getItem("suiteleaf:node-session")!);
      const r = await fetch(`${s.url}/api/drive/items`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${s.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: "Made on A.sldoc", kind: "file" }),
      });
      if (!r.ok) throw new Error(`create failed: ${r.status}`);
    });
    await expect(
      pageB.getByRole("button", { name: "Made on A.sldoc", exact: true }),
    ).toBeVisible({ timeout: 20000 });
  });

  test("reopening a file from SuiteDrive keeps edits that were never uploaded", async ({
    browser,
  }) => {
    const page = await (await browser.newContext()).newPage();
    await page.goto(a.url);
    await signIn(page, true, "reopen@example.com");
    await page.getByRole("button", { name: "New document" }).click();
    await page.getByLabel("File title").fill("Offline notes");
    const editor = page.getByRole("textbox", { name: "Document content" });
    await editor.fill("First draft");
    const status = page.getByRole("status");
    await expect(status).toHaveText("Saved to SuiteDrive", { timeout: 20000 });

    /** Save a new version as another client would, replacing `from` with `to`. */
    const saveElsewhere = (from: string, to: string) =>
      page.evaluate(
        async ([from, to]) => {
          const s = JSON.parse(localStorage.getItem("suiteleaf:node-session")!);
          const headers = { authorization: `Bearer ${s.token}` };
          const { items } = await (
            await fetch(`${s.url}/api/drive/items`, { headers })
          ).json();
          const id = items.find(
            (i: { name: string }) => i.name === "Offline notes.sldoc",
          ).id;
          const url = `${s.url}/api/drive/items/${id}/content`;
          const text = await (await fetch(url, { headers })).text();
          const r = await fetch(url, {
            method: "PUT",
            headers: { ...headers, "content-type": "application/json" },
            body: text.replace(from, to),
          });
          if (!r.ok) throw new Error(`upload failed: ${r.status}`);
        },
        [from, to],
      );
    const reopen = async () => {
      await page.getByRole("button", { name: "Back to files" }).click();
      await page
        .getByRole("button", { name: "Offline notes.sldoc", exact: true })
        .click();
    };
    const banner = page.getByText("This file was changed in SuiteDrive");

    await saveElsewhere("First draft", "Saved elsewhere");
    await editor.fill("Edits only on this device");
    await expect(banner).toBeVisible({ timeout: 20000 });

    await reopen();
    await expect(editor).toContainText("Edits only on this device");
    await expect(banner).toBeVisible({ timeout: 20000 });
    await page.reload();
    await reopen();
    await expect(editor).toContainText("Edits only on this device");
    await expect(banner).toBeVisible({ timeout: 20000 });

    // The banner says when the newer version was saved and what each choice does.
    const alert = page.getByRole("alert").filter({ has: banner });
    await expect(alert).toContainText(/A newer version was saved at \d/);
    await expect(alert).toContainText("Save them as a copy to keep both");
    await expect(alert.getByRole("button")).toHaveText([
      "Save as copy",
      "Reload from SuiteDrive",
    ]);

    let asked = "";
    page.once("dialog", (d) => {
      asked = d.message();
      void d.accept();
    });
    await page.getByRole("button", { name: "Reload from SuiteDrive" }).click();
    await expect(editor).toContainText("Saved elsewhere");
    expect(asked).toContain("Your edits will be lost");

    // With nothing left to upload, the local copy follows newer versions.
    await saveElsewhere("Saved elsewhere", "Saved again elsewhere");
    await reopen();
    await expect(editor).toContainText("Saved again elsewhere");
    await expect(status).toHaveText("Saved to SuiteDrive");
    await expect(banner).toHaveCount(0);
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
    await page.goto(b.url);
    await signIn(page, true, "folders@example.com");
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

    // Typing replaces the title and keeps the extension.
    await page.getByRole("button", { name: "Rename Rota.sldoc" }).click();
    const rename = page.getByRole("dialog", { name: "Rename" });
    await expect(rename.getByLabel("Name")).toBeFocused();
    await page.keyboard.type("Watering rota");
    await rename.getByRole("button", { name: "OK" }).click();
    await expect(item("Watering rota.sldoc")).toBeVisible();

    const trash = page.getByRole("button", {
      name: "Move Watering rota.sldoc to trash",
    });
    const confirm = page.getByRole("dialog", { name: "Move to trash?" });
    await trash.click();
    await page.keyboard.press("Escape");
    await expect(confirm).toHaveCount(0);
    await expect(item("Watering rota.sldoc")).toBeVisible();
    await trash.click();
    await confirm.getByRole("button", { name: "Move to trash" }).click();
    await expect(page.getByText("This folder is empty.")).toBeVisible();
    expect(native).toEqual([]);
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
    await page.goto(a.url);
    await signIn(page, true, "inflight@example.com");
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
    await page.goto(a.url);
    await signIn(page, true, "reopen-inflight@example.com");
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
    // Node A's sign-up rate limit is spent by the tests above.
    await page.goto(b.url);
    await signIn(page, true, "leave-saving@example.com");
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
});
