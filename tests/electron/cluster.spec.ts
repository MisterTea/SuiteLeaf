import { test, expect, _electron as electron } from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { createFile, type FileRecord } from "../../packages/core/src";

const binary = resolve("target/debug/suiteleaf-node");
const sidecar = resolve("services/auth/dist/server.mjs");

async function freePort() {
  return new Promise<number>((done) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => done(port));
    });
  });
}

test("the desktop app works as a cluster client and can switch back", async () => {
  test.skip(
    !existsSync(binary) || !existsSync(sidecar),
    "Build first: cargo build -p suiteleaf-node && npm run build:auth",
  );
  const dir = await mkdtemp(join(tmpdir(), "suiteleaf-electron-cluster-"));
  const port = await freePort();
  const serverUrl = `http://127.0.0.1:${port}`;
  const config = join(dir, "server.toml");
  await writeFile(
    config,
    `[auth]\ncommand = ${JSON.stringify(["node", sidecar])}\n`,
  );
  const server = spawn(
    binary,
    [
      "run",
      "--init",
      "--config",
      config,
      "--data-dir",
      join(dir, "server"),
      "--http",
      `127.0.0.1:${port}`,
      "--public-url",
      serverUrl,
      "--listen",
      "/ip4/127.0.0.1/tcp/0",
    ],
    {
      env: {
        ...process.env,
        SUITELEAF_AUTH_SECRET: "electron-cluster-secret-0123456789abcdef",
        RUST_LOG: "warn",
      },
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  try {
    await new Promise<void>((done, fail) => {
      server.once("exit", (code) => fail(new Error(`server exited (${code})`)));
      createInterface({ input: server.stdout! }).on("line", (line) => {
        if (line.startsWith("SUITELEAF_NODE_READY")) done();
      });
    });
    await expect
      .poll(
        async () =>
          (await (await fetch(`${serverUrl}/api/node/info`)).json()).auth
            .enabled,
        {
          timeout: 15000,
        },
      )
      .toBe(true);
    const settings = join(dir, "settings.json");
    await writeFile(
      settings,
      JSON.stringify({ mode: { kind: "cluster", serverUrl } }),
    );
    const library = join(dir, "library");
    const local = createFile("doc");
    local.title = "Kept locally";
    await mkdir(library);
    await writeFile(
      join(library, "library.json"),
      JSON.stringify([{ file: local, recovery: false }]),
    );
    const cachedFromDrive = async () =>
      (
        JSON.parse(
          await readFile(join(library, "library.json"), "utf8"),
        ) as FileRecord[]
      )
        .filter((r) => r.drive)
        .map((r) => r.file.title);
    const app = await electron.launch({
      args: [resolve("apps/desktop/out/main/index.js")],
      env: {
        ...process.env,
        SUITELEAF_TEST_DATA: library,
        SUITELEAF_SETTINGS: settings,
      },
    });
    try {
      const page = await app.firstWindow();
      const card = page.getByLabel("Sign in to SuiteLeaf");
      const stored = () =>
        page.evaluate(() => localStorage.getItem("suiteleaf:node-session"));
      const me = async (token: string) =>
        (
          await fetch(`${serverUrl}/api/me`, {
            headers: { authorization: `Bearer ${token}` },
          })
        ).status;
      const reconnect = async () => {
        await page.getByRole("button", { name: "Connect to a server" }).click();
        const connect = page.getByRole("dialog", {
          name: "Connect to a SuiteLeaf server",
        });
        await connect.getByLabel("Server address").fill(serverUrl);
        await connect
          .getByRole("button", { name: "Connect", exact: true })
          .click();
        await card
          .getByLabel("Email or username", { exact: true })
          .fill("desk@example.com");
        await card
          .getByLabel("Password", { exact: true })
          .fill("correct-horse-battery");
        await card
          .getByRole("button", { name: "Sign in", exact: true })
          .click();
      };
      await card.getByRole("button", { name: "Create an account" }).click();
      await card.getByLabel("Email", { exact: true }).fill("desk@example.com");
      await card
        .getByLabel("Password", { exact: true })
        .fill("correct-horse-battery");
      await card.getByRole("button", { name: "Create account" }).click();
      await expect(
        page.getByRole("button", { name: "Sign out" }),
      ).toBeVisible();

      await page.getByRole("button", { name: "New spreadsheet" }).click();
      await page.getByLabel("File title").fill("Team budget");
      await expect(page.getByRole("status")).toHaveText("Saved to SuiteDrive", {
        timeout: 20000,
      });
      await page.getByRole("button", { name: "Back to files" }).click();
      await expect(
        page.getByRole("button", { name: "Team budget.slsheet", exact: true }),
      ).toBeVisible();

      const first = JSON.parse((await stored())!).token;
      expect(await me(first)).toBe(200);
      await page
        .getByRole("button", { name: "Disconnect from server" })
        .click();
      await expect(
        page.getByText("Your files, on this computer."),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Connect to a server" }),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: /Team budget/ })).toHaveCount(
        0,
      );
      await expect(
        page.getByRole("link", { name: /Kept locally/ }),
      ).toBeVisible();
      expect(await cachedFromDrive()).toEqual([]);
      // Disconnecting signs out, so the next connection asks for a password.
      expect(await stored()).toBeNull();
      expect(await me(first)).toBe(401);

      // Disconnecting from the Server menu saves the open file first.
      await reconnect();
      await page
        .getByRole("button", { name: "Team budget.slsheet", exact: true })
        .click();
      await expect(page.getByRole("status")).toHaveText("Saved to SuiteDrive");
      await page.getByLabel("File title").fill("Team budget 2027");
      const second = JSON.parse((await stored())!).token;
      await app.evaluate(({ Menu }) => {
        const server = Menu.getApplicationMenu()!.items.find(
          (i) => i.label === "Server",
        )!;
        server
          .submenu!.items.find((i) => i.label.startsWith("Disconnect"))!
          .click();
      });
      await expect(
        page.getByText("Your files, on this computer."),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: /Kept locally/ }),
      ).toBeVisible();
      expect(await cachedFromDrive()).toEqual([]);
      expect(await stored()).toBeNull();
      expect(await me(second)).toBe(401);
      await reconnect();
      await expect(
        page.getByRole("button", {
          name: "Team budget 2027.slsheet",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Team budget.slsheet", exact: true }),
      ).toHaveCount(0);
    } finally {
      await app.close();
    }
  } finally {
    server.kill();
  }
});
