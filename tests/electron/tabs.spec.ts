import { test, expect, _electron as electron } from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createFile, serializeFile } from "../../packages/core/src";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

test("command-click opens a document in a new tab and leaves the file list open", async () => {
  const dir = await mkdtemp(join(tmpdir(), "suiteleaf-electron-tabs-"));
  const docs = join(dir, "library", "SuiteLeaf");
  await mkdir(docs, { recursive: true });
  await writeFile(join(docs, "Plan.sldoc"), serializeFile({ ...createFile("doc"), title: "Plan" }));
  const app = await electron.launch({
    executablePath: process.env.SUITELEAF_PACKAGED_EXECUTABLE,
    args: process.env.SUITELEAF_PACKAGED_EXECUTABLE ? [] : [resolve("apps/desktop/out/main/index.js")],
    env: { ...process.env, SUITELEAF_TEST_DATA: join(dir, "library") },
  });
  let output = "";
  app.process().stdout?.on("data", (chunk) => {
    output += String(chunk);
  });
  try {
    await app.evaluate(({ dialog }) => {
      (dialog as any).showMessageBoxSync = () => {
        console.log("suiteleaf-test: tab prompt");
        return 1;
      };
    });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const fileLink = page.locator(".file-row:not(.folder-row) a").filter({ hasText: "Plan" });
    await expect(fileLink).toBeVisible();
    await fileLink.click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });

    await expect(page.getByRole("tab", { name: "Plan" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Files" })).toBeVisible();
    await expect.poll(() =>
      app.evaluate(async ({ webContents }) => {
        const titles: string[] = [];
        for (const contents of webContents.getAllWebContents()) {
          try {
            if (contents.isDestroyed() || !contents.getURL().includes("#/file/")) continue;
            const title = await contents.executeJavaScript(
              "document.querySelector(\"[aria-label='Document content']\") ? document.title : ''",
            );
            if (typeof title === "string" && title) titles.push(title);
          } catch {
            // The new page is still loading.
          }
        }
        return titles;
      }),
    ).toEqual(["Plan"]);
    expect(await page.evaluate(() => location.hash)).not.toContain("/file/");
    await expect(fileLink).toBeVisible();
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    expect(errors).toEqual([]);
    expect(output).not.toContain("suiteleaf-test: tab prompt");

    await page.getByRole("button", { name: "Close Plan" }).click();
    await expect(page.getByRole("tab", { name: "Plan" })).toHaveCount(0);
    await expect(fileLink).toBeVisible();
    await expect.poll(() =>
      app.evaluate(({ webContents }) =>
        webContents.getAllWebContents().some((contents) => contents.getURL().includes("#/file/")),
      ),
    ).toBe(false);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    expect(output).not.toContain("suiteleaf-test: tab prompt");
  } finally {
    await app
      .evaluate(({ BrowserWindow }) => {
        for (const win of BrowserWindow.getAllWindows()) win.destroy();
      })
      .catch(() => {});
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
