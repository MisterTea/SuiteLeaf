import { test, expect, _electron as electron } from "@playwright/test";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createFile, serializeFile } from "../../packages/core/src";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
test("native Save As → autosave → external conflict → recovery → reopening", async () => {
  const dir = await mkdtemp(join(tmpdir(), "suiteleaf-electron-"));
  const path = join(dir, "notes.suiteleaf");
  let app = await electron.launch({
    executablePath: process.env.SUITELEAF_PACKAGED_EXECUTABLE,
    args: process.env.SUITELEAF_PACKAGED_EXECUTABLE
      ? []
      : [resolve("apps/desktop/out/main/index.js")],
    env: { ...process.env, SUITELEAF_TEST_DATA: join(dir, "library") },
  });
  try {
    await app.evaluate(({ dialog }) => {
      (dialog as any).showSaveDialog = async () => ({
        canceled: false,
        filePath: process.env.SUITELEAF_TEST_DATA!.replace(
          /library$/,
          "notes.suiteleaf",
        ),
      });
    });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.getByRole("button", { name: "New document" }).click();
    await page
      .getByRole("textbox", { name: "Document content" })
      .fill("Desktop draft");
    await page.getByRole("button", { name: "Save As", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Saved to file");
    expect(
      JSON.parse(await readFile(path, "utf8")).content.content[0].content[0]
        .text,
    ).toBe("Desktop draft");
    await page
      .getByRole("textbox", { name: "Document content" })
      .fill("Autosaved edit");
    await expect(page.getByRole("status")).toContainText("Saved to file");
    expect(
      JSON.parse(await readFile(path, "utf8")).content.content[0].content[0]
        .text,
    ).toBe("Autosaved edit");
    const external = JSON.parse(await readFile(path, "utf8"));
    external.title = "Outside change";
    await writeFile(path, JSON.stringify(external));
    await page
      .getByRole("textbox", { name: "Document content" })
      .fill("Recovery edit");
    await expect(page.getByRole("alert")).toContainText("outside");
    expect(JSON.parse(await readFile(path, "utf8")).title).toBe(
      "Outside change",
    );
    expect(errors).toEqual([]);
    await app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) w.destroy();
    });
    await app.close();
    app = await electron.launch({
      executablePath: process.env.SUITELEAF_PACKAGED_EXECUTABLE,
      args: process.env.SUITELEAF_PACKAGED_EXECUTABLE
        ? []
        : [resolve("apps/desktop/out/main/index.js")],
      env: { ...process.env, SUITELEAF_TEST_DATA: join(dir, "library") },
    });
    const reopened = await app.firstWindow();
    await reopened
      .getByRole("link", { name: "Untitled document Recovery draft available" })
      .click();
    await expect(
      reopened.getByRole("textbox", { name: "Document content" }),
    ).toContainText("Recovery edit");
    await expect(reopened.getByRole("status")).toContainText("Recovered draft");
    const security = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
    );
    expect(security?.nodeIntegration).toBe(false);
    expect(security?.contextIsolation).toBe(true);
    expect(security?.sandbox).toBe(true);
  } finally {
    await app
      .evaluate(({ BrowserWindow }) => {
        for (const w of BrowserWindow.getAllWindows()) w.destroy();
      })
      .catch(() => {});
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("choosing Close in the unsaved prompt closes the window while saves keep failing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "suiteleaf-electron-close-"));
  const app = await electron.launch({
    executablePath: process.env.SUITELEAF_PACKAGED_EXECUTABLE,
    args: process.env.SUITELEAF_PACKAGED_EXECUTABLE
      ? []
      : [resolve("apps/desktop/out/main/index.js")],
    env: { ...process.env, SUITELEAF_TEST_DATA: join(dir, "library") },
  });
  try {
    const page = await app.firstWindow();
    // A listener stops Playwright from answering the page's beforeunload dialog itself.
    page.on("dialog", () => {});
    await page.getByRole("button", { name: "New document" }).click();
    await page.evaluate(async () => {
      const bridge = (window as unknown as { suiteleaf: { setDirty(d: boolean): void; list(): Promise<unknown> } }).suiteleaf;
      bridge.setDirty(true);
      addEventListener("beforeunload", (event) => event.preventDefault());
      await bridge.list();
    });
    await app.evaluate(({ dialog, BrowserWindow }) => {
      (globalThis as { prompts?: number }).prompts = 0;
      (dialog as any).showMessageBoxSync = () => {
        (globalThis as { prompts?: number }).prompts! += 1;
        return 1;
      };
      BrowserWindow.getAllWindows()[0].close();
    });
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
      .toBe(0);
    expect(await app.evaluate(() => (globalThis as { prompts?: number }).prompts)).toBe(1);
  } finally {
    await app
      .evaluate(({ BrowserWindow }) => {
        for (const w of BrowserWindow.getAllWindows()) w.destroy();
      })
      .catch(() => {});
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("folders on the home screen are the documents folder's folders, both ways", async () => {
  const dir = await mkdtemp(join(tmpdir(), "suiteleaf-electron-folders-"));
  const docs = join(dir, "library", "SuiteLeaf");
  await mkdir(join(docs, "Garden"), { recursive: true });
  await writeFile(join(docs, "Plan.sldoc"), serializeFile({ ...createFile("doc"), title: "Plan" }));
  const there = (path: string) => stat(path).then(() => true, () => false);
  const app = await electron.launch({
    executablePath: process.env.SUITELEAF_PACKAGED_EXECUTABLE,
    args: process.env.SUITELEAF_PACKAGED_EXECUTABLE ? [] : [resolve("apps/desktop/out/main/index.js")],
    env: { ...process.env, SUITELEAF_TEST_DATA: join(dir, "library") },
  });
  try {
    const page = await app.firstWindow();
    const folderRow = (name: string) => page.locator(".folder-row").filter({ hasText: name });
    const fileLink = (name: string) => page.locator(".file-row:not(.folder-row) a").filter({ hasText: name });
    await expect(folderRow("Garden")).toBeVisible();
    await expect(fileLink("Plan")).toBeVisible();

    await page.getByRole("button", { name: "New folder" }).click();
    await page.getByRole("dialog", { name: "New folder" }).getByRole("textbox").fill("Recipes");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(folderRow("Recipes")).toBeVisible();
    expect(await there(join(docs, "Recipes"))).toBe(true);

    await page.getByRole("button", { name: "Move Plan to a folder" }).click();
    const move = page.getByRole("dialog", { name: "Move" });
    await move.getByRole("button", { name: "Garden" }).click();
    await move.getByRole("button", { name: "Move here" }).click();
    await expect(fileLink("Plan")).toHaveCount(0);
    expect(await there(join(docs, "Garden", "Plan.sldoc"))).toBe(true);
    expect(await there(join(docs, "Plan.sldoc"))).toBe(false);

    await folderRow("Garden").locator(".folder-open").click();
    await expect(page.getByRole("navigation", { name: "Folder path" })).toContainText("Garden");
    await expect(fileLink("Plan")).toBeVisible();
    await page.getByRole("button", { name: /New document/ }).click();
    await expect(page.locator(".slides-editor, .doc-editor, [aria-label='Document content']").first()).toBeVisible();
    await expect.poll(async () => (await readdir(join(docs, "Garden"))).sort()).toEqual([
      "Plan.sldoc",
      "Untitled document.sldoc",
    ]);
    await page.getByRole("button", { name: "Back to files" }).click();

    await mkdir(join(docs, "Garden", "Seeds"));
    await writeFile(join(docs, "Garden", "Seeds", "List.slsheet"), serializeFile({ ...createFile("sheet"), title: "Seed list" }));
    await expect(folderRow("Seeds")).toBeVisible({ timeout: 20_000 });
    await folderRow("Seeds").locator(".folder-open").click();
    await expect(fileLink("Seed list")).toBeVisible();

    await rename(join(docs, "Garden"), join(docs, "Yard"));
    await expect(page.getByRole("navigation", { name: "Folder path" })).toHaveText("All files", { timeout: 20_000 });
    await expect(folderRow("Yard")).toBeVisible();
    await expect(folderRow("Garden")).toHaveCount(0);
    await folderRow("Yard").locator(".folder-open").click();
    await expect(fileLink("Plan")).toBeVisible();

    const top = page.getByRole("navigation", { name: "Folder path" }).getByRole("button", { name: "All files" });
    await page.locator(".file-row").filter({ hasText: "Plan" }).dragTo(top);
    await expect.poll(() => there(join(docs, "Plan.sldoc"))).toBe(true);
    expect(await there(join(docs, "Yard", "Plan.sldoc"))).toBe(false);
    await expect(fileLink("Plan")).toHaveCount(0);
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy())).catch(() => {});
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
