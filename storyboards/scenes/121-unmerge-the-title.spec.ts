import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import type { Page } from "@playwright/test";
import { createFile, serializeFile } from "../../packages/core/src";
import { beat, caption, expect, selectCells, test, typeSlowly } from "./harness";

async function ready(page: Page) {
  await page.getByRole("button", { name: "Sheet tools", exact: true }).waitFor();
  await beat(page, 600);
}

async function openBudget(page: Page) {
  const file = createFile("sheet", "October budget");
  if (file.kind !== "sheet") throw new Error("Expected a workbook");
  const sheet = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
  sheet.cellData = {
    0: {
      0: { v: "October budget", t: 1 },
      3: { v: "Notes", t: 1 },
      5: { v: "Kept", t: 1 },
    },
    1: { 0: { v: "Rent", t: 1 } },
    2: { 0: { v: "Food", t: 1 } },
  };
  sheet.columnData = {
    0: { w: 180 },
    1: { w: 110 },
    2: { w: 110 },
    3: { w: 110 },
    4: { w: 90 },
    5: { w: 90 },
    6: { w: 90 },
  };
  sheet.custom = {
    suiteleafColumnGroups: [
      { id: "fg", startColumn: 5, endColumn: 6, collapsed: [] },
    ],
    suiteleafRowGroups: [{ id: "rows", startRow: 1, endRow: 2, collapsed: [] }],
  };
  await page.locator("input[type=file]").setInputFiles({
    name: "October budget.slsheet",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  await ready(page);
}

async function expectCell(page: Page, ref: string, value: string) {
  await selectCells(page, ref);
  await expect(page.locator(".sheet-host")).toHaveAttribute("data-active-value", value);
}

const mergeButton = (page: Page) => page.locator(".merge-btn");

async function showMergeButton(page: Page) {
  const button = mergeButton(page);
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 16 });
  await beat(page, 500);
  return button;
}

async function downloadXlsx(page: Page) {
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 400);
  const item = page.getByRole("menuitem", { name: "Export XLSX", exact: true });
  await expect(item).toBeEnabled();
  const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
  await item.click();
  const download = await downloadPromise;
  await page.keyboard.press("Escape");
  await beat(page, 400);
  return readFile(await download.path());
}

test("121-unmerge-the-title", async ({ page }) => {
  await page.goto("/");
  await caption(
    page,
    "Nia needs the title October budget back in A1, so she can put a note in B1.",
    1600,
  );
  await openBudget(page);
  await expect(page.locator(".column-group-controls")).toHaveAttribute("data-span", "5-6");
  await expect(page.locator(".row-group-controls")).toHaveAttribute("data-groups", "2-3");

  await caption(page, "She selects A1:C1. The button reads Merge cells.", 1000);
  await selectCells(page, "A1:C1");
  const merge = await showMergeButton(page);
  await expect(merge).toHaveAttribute("aria-label", "Merge cells");
  await expect(page.getByRole("button", { name: "Unmerge", exact: true })).toHaveCount(0);
  await beat(page, 900);
  await merge.click();
  await selectCells(page, "A1:C1");
  await expect(mergeButton(page)).toHaveAttribute("aria-label", "Unmerge");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await showMergeButton(page);
  await caption(
    page,
    "October budget spans the three cells. The same button now reads Unmerge. No menu, no dialog.",
    2000,
  );

  await mergeButton(page).click();
  await expect(mergeButton(page)).toHaveAttribute("aria-label", "Merge cells");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expectCell(page, "A1", "October budget");
  await expectCell(page, "B1", "");
  await expectCell(page, "C1", "");
  await caption(page, "Unmerge leaves the title in A1. B1 and C1 are empty.", 1200);

  await selectCells(page, "B1");
  await typeSlowly(page, "draft", 90);
  await page.keyboard.press("Enter");
  await beat(page, 500);
  await expectCell(page, "B1", "draft");
  await expectCell(page, "A1", "October budget");
  await expectCell(page, "A2", "Rent");
  await expectCell(page, "F1", "Kept");
  await expect(page.locator(".column-group-controls")).toHaveAttribute("data-span", "5-6");
  await expect(page.locator(".row-group-controls")).toHaveAttribute("data-groups", "2-3");
  await selectCells(page, "A1");
  await caption(
    page,
    "She types draft in B1. October budget stays in A1, and the groups are untouched.",
    2200,
  );

  await caption(page, "D1:E1 are not merged, so the button reads Merge cells again.", 1000);
  await selectCells(page, "D1:E1");
  await showMergeButton(page);
  await expect(mergeButton(page)).toHaveAttribute("aria-label", "Merge cells");
  await beat(page, 700);
  await mergeButton(page).click();
  await selectCells(page, "D1:E1");
  await expect(mergeButton(page)).toHaveAttribute("aria-label", "Unmerge");
  await showMergeButton(page);
  await caption(page, "Merging D1:E1 still joins those cells and keeps Notes.", 1800);
  await expectCell(page, "D1", "Notes");
  await selectCells(page, "A1");

  await expect(page.getByRole("status")).toContainText("Saved");
  await caption(page, "She saves, returns home, and reopens the budget.", 1000);
  await page.getByRole("button", { name: "Back to files" }).click();
  await beat(page, 800);
  await page.getByRole("link", { name: /October budget/ }).click();
  await ready(page);
  await expectCell(page, "A1", "October budget");
  await expectCell(page, "B1", "draft");
  await selectCells(page, "A1:C1");
  await expect(mergeButton(page)).toHaveAttribute("aria-label", "Merge cells");
  await expect(page.locator(".column-group-controls")).toHaveAttribute("data-span", "5-6");
  await expect(page.locator(".row-group-controls")).toHaveAttribute("data-groups", "2-3");
  await selectCells(page, "A1");
  await caption(
    page,
    "A1 is still October budget, B1 is still draft, and A1:C1 is not merged.",
    2000,
  );

  await caption(page, "She downloads Excel. A1:C1 is not a merged range.", 1000);
  const bytes = await downloadXlsx(page);
  const sheet = XLSX.read(bytes, { type: "buffer" }).Sheets.Sheet1;
  expect(sheet.A1.v).toBe("October budget");
  expect(sheet.B1.v).toBe("draft");
  expect(sheet.A2.v).toBe("Rent");
  expect(sheet.F1.v).toBe("Kept");
  expect(sheet.D1.v).toBe("Notes");
  const merges = (sheet["!merges"] ?? []) as { s: { r: number; c: number }; e: { r: number; c: number } }[];
  expect(merges.some((range) => range.s.r === 0 && range.s.c === 0 && range.e.c >= 2)).toBe(false);
  expect(merges).toContainEqual({ s: { r: 0, c: 3 }, e: { r: 0, c: 4 } });
  const xml = await JSZip.loadAsync(bytes).then((zip) => zip.file("xl/worksheets/sheet1.xml")!.async("string"));
  expect(xml).not.toContain("A1:C1");
  expect(xml).toContain('ref="D1:E1"');
  await caption(page, "The title is separate, the note is in B1, and Excel has no merge across A1:C1.", 1800);
});
