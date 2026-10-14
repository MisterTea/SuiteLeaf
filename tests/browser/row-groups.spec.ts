import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import { createFile, serializeFile } from "../../packages/core/src";

const money = { n: { pattern: '"$"#,##0' } };

const rows: { a: string; b: number | string; formula?: string; bold?: boolean }[] = [
  { a: "Total", b: 60, formula: "=SUM(B2:B4)", bold: true },
  { a: "January", b: 10 },
  { a: "February", b: 20 },
  { a: "March", b: 30 },
];

async function open(page: Page) {
  const file = createFile("sheet", "Donations");
  if (file.kind !== "sheet") throw new Error("Expected spreadsheet");
  const sheet = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
  sheet.cellData = Object.fromEntries(
    rows.map((row, index) => [
      index,
      {
        0: { v: row.a, t: 1, ...(row.bold ? { s: { bl: 1 } } : {}) },
        1: row.formula
          ? { f: row.formula, v: row.b, t: 2, s: { ...money, bl: 1 } }
          : { v: row.b, t: 2, s: money },
      },
    ]),
  );
  (sheet as { columnData: Record<number, { w: number }> }).columnData = {
    0: { w: 140 },
    1: { w: 110 },
  };
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Donations.slsheet",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(file)),
  });
  await page.locator("[data-sheet-ready='true']").waitFor();
}

async function native(page: Page) {
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  return JSON.parse(await readFile((await (await waiting).path())!, "utf8"));
}

function sheetOf(file: any) {
  return file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
}

function hidden(sheet: any, row: number) {
  return sheet.rowData?.[row]?.hd === 1;
}

async function select(page: Page, ref: string) {
  const box = page.locator(".sheet-host input.univer-size-full");
  await box.fill(ref);
  await box.press("Enter");
}

async function groupRows(page: Page) {
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await page.getByRole("menuitem", { name: "Group rows", exact: true }).click();
}

test("Data › Group rows collapses detail rows, keeps the total, and undoes in one step", async ({
  page,
}) => {
  await open(page);
  await select(page, "A1");
  await groupRows(page);
  const dialog = page.getByRole("dialog", { name: "Nothing to group" });
  await expect(dialog).toContainText("leaves the total on screen");
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: /Collapse rows/ })).toHaveCount(0);

  await select(page, "A2:B4");
  await groupRows(page);
  const collapse = page.getByRole("button", { name: "Collapse rows 2 to 4" });
  await expect(collapse).toBeVisible();
  await collapse.click();
  const expand = page.getByRole("button", { name: "Expand rows 2 to 4" });
  await expect(expand).toBeVisible();
  await expect(collapse).toBeHidden();
  await expect(page.locator(".row-group-controls")).toHaveAttribute("data-collapsed", "1,2,3");

  await select(page, "B1");
  let file = await native(page);
  let sheet = sheetOf(file);
  expect(sheet.cellData[0][1]).toMatchObject({ f: "=SUM(B2:B4)", v: 60 });
  expect(sheet.cellData[1][1].v).toBe(10);
  expect(sheet.cellData[2][1].v).toBe(20);
  expect(hidden(sheet, 0)).toBe(false);
  expect(hidden(sheet, 1)).toBe(true);
  expect(hidden(sheet, 2)).toBe(true);
  expect(hidden(sheet, 3)).toBe(true);
  expect(sheet.custom.suiteleafRowGroups).toMatchObject([
    { startRow: 1, endRow: 3, collapsed: [1, 2, 3] },
  ]);

  await expand.click();
  await expect(collapse).toBeVisible();
  await select(page, "A2");
  await page.getByRole("button", { name: "Show only January" }).click();
  await expect(page.locator(".row-group-controls")).toHaveAttribute("data-collapsed", "2,3");
  await expect(page.getByRole("button", { name: "Expand rows 2 to 4" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Collapse rows 2 to 4" })).toBeVisible();

  file = await native(page);
  sheet = sheetOf(file);
  expect(sheet.cellData[0][1]).toMatchObject({ f: "=SUM(B2:B4)", v: 60 });
  expect(hidden(sheet, 1)).toBe(false);
  expect(hidden(sheet, 2)).toBe(true);
  expect(sheet.custom.suiteleafRowGroups[0].collapsed).toEqual([2, 3]);

  await page.getByRole("button", { name: "Undo (Cmd+Z)" }).click();
  await expect(page.getByRole("button", { name: /Collapse rows|Expand rows|Show only/ })).toHaveCount(0);
  await expect(page.locator(".row-group-controls")).toHaveAttribute("data-collapsed", "");
  file = await native(page);
  sheet = sheetOf(file);
  expect(sheet.custom?.suiteleafRowGroups).toBeUndefined();
  expect(hidden(sheet, 1)).toBe(false);
  expect(hidden(sheet, 2)).toBe(false);
  expect(hidden(sheet, 3)).toBe(false);
  expect(sheet.cellData[0][1].f).toBe("=SUM(B2:B4)");

  await page.getByRole("button", { name: "Redo (Cmd+Y)" }).click();
  await expect(page.locator(".row-group-controls")).toHaveAttribute("data-collapsed", "2,3");
  await expect(page.getByRole("button", { name: "Expand rows 2 to 4" })).toBeVisible();

  await expect(page.locator(".save-status")).toContainText("Saved", { timeout: 8000 });
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Donations" }).click();
  await page.getByRole("toolbar", { name: "Spreadsheet formatting" }).waitFor();
  await expect(page.locator(".row-group-controls")).toHaveAttribute("data-collapsed", "2,3");
  await expect(page.getByRole("button", { name: "Expand rows 2 to 4" })).toBeVisible();
  await select(page, "B1");
  file = await native(page);
  sheet = sheetOf(file);
  expect(hidden(sheet, 1)).toBe(false);
  expect(hidden(sheet, 2)).toBe(true);
  expect(sheet.cellData[0][1]).toMatchObject({ f: "=SUM(B2:B4)", v: 60 });
});

test("grouping a selection that includes the total leaves the total visible", async ({
  page,
}) => {
  await open(page);
  await select(page, "A1:B4");
  await groupRows(page);
  await expect(page.getByRole("button", { name: "Collapse rows 2 to 4" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Collapse rows 1 to 4" })).toHaveCount(0);
  const file = await native(page);
  const sheet = sheetOf(file);
  expect(sheet.custom.suiteleafRowGroups).toMatchObject([{ startRow: 1, endRow: 3, collapsed: [] }]);
  expect(hidden(sheet, 0)).toBe(false);
});
