import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
for (const format of ["DOCX", "XLSX"] as const)
  test(`native binary ${format} export`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "suiteleaf-export-"));
    const output = join(dir, `export.${format.toLowerCase()}`);
    const app = await electron.launch({
      args: [resolve("apps/desktop/out/main/index.js")],
      env: { ...process.env, SUITELEAF_TEST_DATA: join(dir, "library") },
    });
    try {
      await app.evaluate(({ dialog }, output) => {
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath: output,
        });
      }, output);
      const page = await app.firstWindow();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      if (format === "DOCX") {
        await page.getByRole("button", { name: "New document" }).click();
        await page
          .getByRole("textbox", { name: "Document content" })
          .fill("Binary document export");
      } else {
        await page.getByRole("button", { name: "Sample budget" }).click();
        await page
          .getByRole("button", { name: "Sheet tools", exact: true })
          .waitFor();
      }
      await page.getByRole("button", { name: "File", exact: true }).click();
      await page
        .getByRole("menuitem", { name: `Export ${format}`, exact: true })
        .click();
      await expect
        .poll(async () => {
          try {
            return (await readFile(output)).subarray(0, 2).toString();
          } catch {
            return "";
          }
        })
        .toBe("PK");
      expect(errors).toEqual([]);
    } finally {
      await app
        .evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().forEach((w) => w.destroy()),
        )
        .catch(() => {});
      await app.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
