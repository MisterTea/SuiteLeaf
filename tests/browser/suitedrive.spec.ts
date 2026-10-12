import { test, expect, type Page } from "@playwright/test";
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
  async function signIn(page: Page, create: boolean) {
    const card = page.getByLabel("Sign in to SuiteLeaf");
    await expect(card).toBeVisible();
    await expect(
      card.getByText("Work on this computer without a server"),
    ).toHaveCount(0);
    if (create) {
      await card.getByRole("button", { name: "Create an account" }).click();
      await card.getByLabel("Name", { exact: true }).fill("Ann Example");
      await card.getByLabel("Email", { exact: true }).fill("ann@example.com");
      await card
        .getByLabel("Password", { exact: true })
        .fill("correct-horse-battery");
      await page.screenshot({ path: "test-results/cluster-sign-up.png" });
      await card.getByRole("button", { name: "Create account" }).click();
    } else {
      await card
        .getByLabel("Email or username", { exact: true })
        .fill("ann@example.com");
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
  });
});
