import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
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
