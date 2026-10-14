import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import JSZip from "jszip";
import { createFile, serializeFile } from "../../packages/core/src";

async function groupedBudget() {
  const file = createFile("sheet", "Rent budget");
  if (file.kind !== "sheet") throw new Error("Expected a workbook");
  const sheet = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
  sheet.cellData = {
    0: {
      0: { v: "Category", t: 1 },
      1: { v: "January", t: 1 },
      2: { v: "February", t: 1 },
      3: { v: "Year", t: 1 },
    },
    1: {
      0: { v: "Rent", t: 1 },
      1: { v: 1200, t: 2 },
      2: { v: 1300, t: 2 },
      3: { v: 2500, t: 2 },
    },
    2: {
      0: { v: "Food", t: 1 },
      1: { v: 400, t: 2 },
      2: { v: 450, t: 2 },
      3: { v: 850, t: 2 },
    },
  };
  (sheet as { columnData: Record<number, { w: number; hd?: number }> }).columnData = {
    0: { w: 120 },
    1: { w: 110 },
    2: { w: 110, hd: 1 },
    3: { w: 110 },
  };
  (sheet as { custom: unknown }).custom = {
    suiteleafColumnGroups: [
      { id: "cols-B-C", startColumn: 1, endColumn: 2, collapsed: [2] },
    ],
    suiteleafRowGroups: [{ id: "rows-2-3", startRow: 1, endRow: 2, collapsed: [2] }],
  };
  return Buffer.from(serializeFile(file));
}

async function open(page: Page, name: string, mimeType: string, buffer: Buffer) {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({ name, mimeType, buffer });
  await page.getByRole("button", { name: "Sheet tools", exact: true }).waitFor();
}

test("a sheet outline survives Excel export and import", async ({ page }) => {
  test.setTimeout(90000);
  await open(page, "Rent budget.slsheet", "application/json", await groupedBudget());
  await expect(page.locator(".column-group-controls")).toHaveAttribute("data-collapsed", "2");
  await expect(page.locator(".row-group-controls")).toHaveAttribute("data-collapsed", "2");

  await page.getByRole("button", { name: "File", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export XLSX", exact: true }).click();
  const xlsx = await readFile((await (await download).path())!);
  const xml = await (await JSZip.loadAsync(xlsx)).file("xl/worksheets/sheet1.xml")!.async("string");
  expect(xml).toContain('outlineLevel="1"');
  expect(xml).toContain('<outlinePr summaryBelow="0" summaryRight="0"/>');
  expect(xml).not.toMatch(/min="1"[^>]*outlineLevel/);
  expect(xml).not.toMatch(/min="4"[^>]*outlineLevel/);

  await page.getByRole("button", { name: "Back to files" }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "Rent budget.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: xlsx,
  });
  await page.getByRole("button", { name: "Sheet tools", exact: true }).waitFor();
  await expect(page.locator(".column-group-controls")).toHaveAttribute("data-span", "1-2");
  await expect(page.locator(".column-group-controls")).toHaveAttribute("data-collapsed", "2");
  await expect(page.locator(".row-group-controls")).toHaveAttribute("data-collapsed", "2");
  await expect(page.getByRole("button", { name: "Expand columns B to C" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand rows 2 to 3" })).toBeVisible();
});
