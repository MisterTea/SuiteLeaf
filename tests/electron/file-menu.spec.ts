import { test, expect, _electron as electron } from "@playwright/test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createFile, serializeFile } from "../../packages/core/src";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

test("the file menu opens, downloads, renames, moves, copies, and shares", async () => {
  test.setTimeout(90_000);
  const dir = await mkdtemp(join(tmpdir(), "suiteleaf-electron-menu-"));
  const docs = join(dir, "library", "SuiteLeaf");
  const downloaded = join(dir, "Plan-download.sldoc");
  await mkdir(join(docs, "Garden"), { recursive: true });
  await writeFile(join(docs, "Plan.sldoc"), serializeFile({ ...createFile("doc"), title: "Plan" }));
  const there = (path: string) => stat(path).then(() => true, () => false);
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
    await app.evaluate(({ dialog }, downloaded) => {
      (dialog as any).showMessageBoxSync = () => {
        console.log("suiteleaf-test: menu prompt");
        return 1;
      };
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: downloaded });
    }, downloaded);
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const fileLink = (name: string) =>
      page.getByRole("link", { name, exact: true });
    const menuFor = (name: string) => page.getByRole("menu", { name: `Actions for ${name}` });
    await expect(fileLink("Plan")).toBeVisible();

    await fileLink("Plan").click({ button: "right" });
    const menu = menuFor("Plan");
    await expect(menu).toBeVisible();
    for (const name of [
      "Open Plan",
      "Open Plan in a new tab",
      "Download Plan",
      "Rename Plan",
      "Move Plan",
      "Copy Plan",
      "Share Plan",
    ]) {
      await expect(menu.getByRole("button", { name, exact: true })).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);

    await fileLink("Plan").click({ button: "right" });
    await menuFor("Plan").getByRole("button", { name: "Download Plan", exact: true }).click();
    await expect.poll(async () => {
      try {
        return await readFile(downloaded, "utf8");
      } catch {
        return "";
      }
    }).toContain('"title":"Plan"');

    await page.evaluate(() => {
      navigator.share = async () => {
        throw new DOMException("No share sheet", "NotAllowedError");
      };
    });
    await fileLink("Plan").click({ button: "right" });
    await menuFor("Plan").getByRole("button", { name: "Share Plan", exact: true }).click();
    await expect(page.getByText("Link copied for “Plan”.")).toBeVisible();

    await fileLink("Plan").click({ button: "right" });
    await menuFor("Plan").getByRole("button", { name: "Copy Plan", exact: true }).click();
    await expect(fileLink("Plan copy")).toBeVisible();

    await fileLink("Plan").click({ button: "right" });
    await menuFor("Plan").getByRole("button", { name: "Open Plan in a new tab", exact: true }).click();
    await expect(page.getByRole("tab", { name: "Plan" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Files" })).toBeVisible();
    await expect(fileLink("Plan")).toBeVisible();
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    await page.getByRole("button", { name: "Close Plan" }).click();
    await expect(page.getByRole("tab", { name: "Plan" })).toHaveCount(0);

    await fileLink("Plan").click({ button: "right" });
    await menuFor("Plan").getByRole("button", { name: "Rename Plan", exact: true }).click();
    const rename = page.getByRole("dialog", { name: "Rename" });
    await rename.getByRole("textbox").fill("Sketch");
    await rename.getByRole("button", { name: "OK" }).click();
    await expect(fileLink("Sketch")).toBeVisible();
    await expect(fileLink("Plan")).toHaveCount(0);

    await fileLink("Sketch").click({ button: "right" });
    await menuFor("Sketch").getByRole("button", { name: "Move Sketch", exact: true }).click();
    const move = page.getByRole("dialog", { name: "Move" });
    await move.getByRole("button", { name: "Garden" }).click();
    await move.getByRole("button", { name: "Move here" }).click();
    await expect(fileLink("Sketch")).toHaveCount(0);
    expect(await there(join(docs, "Garden", "Plan.sldoc"))).toBe(true);

    await page.locator(".folder-row").filter({ hasText: "Garden" }).locator(".folder-open").click();
    await expect(fileLink("Sketch")).toBeVisible();
    await fileLink("Sketch").click({ button: "right" });
    await menuFor("Sketch").getByRole("button", { name: "Open Sketch", exact: true }).click();
    await expect(page.locator("[aria-label='Document content']")).toBeVisible();
    expect(await page.evaluate(() => location.hash)).toContain("/file/");
    expect(errors).toEqual([]);
    expect(output).not.toContain("suiteleaf-test: menu prompt");
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
