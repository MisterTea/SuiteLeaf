import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { wordFixture, excelFixture } from "../office-fixtures";
for (const kind of ["docx", "xlsx"] as const)
  test(`native ${kind} Open → worker conversion → Save As → recovery`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "suiteleaf-office-"));
    const original = join(dir, `Source.${kind}`),
      save = join(dir, "Imported.suiteleaf");
    const bytes = Buffer.from(
      await (kind === "docx" ? wordFixture() : excelFixture()),
    );
    await writeFile(original, bytes);
    const app = await electron.launch({
      executablePath: process.env.SUITELEAF_PACKAGED_EXECUTABLE,
      args: process.env.SUITELEAF_PACKAGED_EXECUTABLE
        ? []
        : [resolve("apps/desktop/out/main/index.js")],
      env: {
        ...process.env,
        SUITELEAF_TEST_DATA: join(dir, "library"),
        SUITELEAF_OFFICE_TEST_ORIGINAL: original,
        SUITELEAF_OFFICE_TEST_SAVE: save,
      },
    });
    try {
      await app.evaluate(({ dialog }) => {
        (dialog as any).showOpenDialog = async () => ({
          canceled: false,
          filePaths: [process.env.SUITELEAF_OFFICE_TEST_ORIGINAL!],
        });
        (dialog as any).showSaveDialog = async () => ({
          canceled: false,
          filePath: process.env.SUITELEAF_OFFICE_TEST_SAVE!,
        });
      });
      const page = await app.firstWindow();
      await page.getByRole("button", { name: "Open / import" }).click();
      if (kind === "docx")
        await expect(
          page.getByRole("textbox", { name: "Document content" }),
        ).toContainText("Hello 世界");
      else await page.getByText("Budget", { exact: true }).first().waitFor();
      await expect(page.locator(".import-notes")).toContainText(
        kind.toUpperCase(),
      );
      await page.getByRole("button", { name: "Save As", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("Saved to file");
      const native = JSON.parse(await readFile(save, "utf8"));
      expect(native.kind).toBe(kind === "docx" ? "doc" : "sheet");
      expect(native.importInfo.sourceFormat).toBe(kind);
      expect(await readFile(original)).toEqual(bytes);
      await page.getByRole("button", { name: "Back to files" }).click();
      await page.getByRole("link", { name: /Source/ }).click();
      if (kind === "docx")
        await expect(
          page.getByRole("textbox", { name: "Document content" }),
        ).toContainText("Hello 世界");
      else await page.getByText("Budget", { exact: true }).first().waitFor();
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
