import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import { createFile, serializeFile } from "../../packages/core/src";

const money = { n: { pattern: '"$"#,##0' } };

async function open(
  page: Page,
  options?: { rowGroup?: boolean },
) {
  const file = createFile("sheet", "Rent budget");
  if (file.kind !== "sheet") throw new Error("Expected spreadsheet");
  const sheet = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
  const headers = ["Category", "January", "February", "March", "Year"];
  const rows = [
    ["Rent", 10, 20, 30, 60, "=SUM(B2:D2)"],
    ["Food", 5, 6, 7, 18, "=SUM(B3:D3)"],
  ];
  sheet.cellData = {
    0: Object.fromEntries(
      headers.map((header, column) => [column, { v: header, t: 1, s: { bl: 1 } }]),
    ),
    ...Object.fromEntries(
      rows.map((row, index) => [
        index + 1,
        {
          0: { v: row[0], t: 1 },
          1: { v: row[1], t: 2, s: money },
          2: { v: row[2], t: 2, s: money },
          3: { v: row[3], t: 2, s: money },
          4: { f: row[5], v: row[4], t: 2, s: { ...money, bl: 1 } },
        },
      ]),
    ),
  };
  (sheet as { columnData: Record<number, { w: number }> }).columnData = {
    0: { w: 120 },
    1: { w: 110 },
    2: { w: 110 },
    3: { w: 110 },
    4: { w: 120 },
  };
  if (options?.rowGroup) {
    (sheet as { custom: unknown }).custom = {
      suiteleafRowGroups: [
        { id: "rows-2-3", startRow: 1, endRow: 2, collapsed: [] },
      ],
    };
  }
  await page.goto("/");
  await page.locator("input[type=file]:not([webkitdirectory])").setInputFiles({
    name: "Rent budget.slsheet",
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

function hiddenColumn(sheet: any, column: number) {
  return sheet.columnData?.[column]?.hd === 1;
}

function hiddenRow(sheet: any, row: number) {
  return sheet.rowData?.[row]?.hd === 1;
}

async function select(page: Page, ref: string) {
  const box = page.locator(".sheet-host input.univer-size-full");
  await box.fill(ref);
  await box.press("Enter");
}

async function groupColumns(page: Page) {
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Group columns", exact: true })
    .first()
    .click();
}

test("Data › Group columns collapses months, keeps the year total, and undoes in one step", async ({
  page,
}) => {
  await open(page);
  await select(page, "A1");
  await groupColumns(page);
  const dialog = page.getByRole("dialog", { name: "Nothing to group" });
  await expect(dialog).toContainText("leaves the category on screen");
  await dialog.getByRole("button", { name: "OK", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: /Collapse columns/ })).toHaveCount(0);

  await select(page, "B1:D2");
  await groupColumns(page);
  const collapse = page.getByRole("button", { name: "Collapse columns B to D" });
  await expect(collapse).toBeVisible();
  await expect(page.locator(".column-group-controls")).toHaveAttribute("data-span", "1-3");
  await collapse.click();
  const expand = page.getByRole("button", { name: "Expand columns B to D" });
  await expect(expand).toBeVisible();
  await expect(collapse).toBeHidden();
  await expect(page.locator(".column-group-controls")).toHaveAttribute("data-collapsed", "1,2,3");

  await select(page, "E2");
  let file = await native(page);
  let sheet = sheetOf(file);
  expect(sheet.cellData[1][4]).toMatchObject({ f: "=SUM(B2:D2)", v: 60 });
  expect(sheet.cellData[1][1].v).toBe(10);
  expect(hiddenColumn(sheet, 0)).toBe(false);
  expect(hiddenColumn(sheet, 1)).toBe(true);
  expect(hiddenColumn(sheet, 2)).toBe(true);
  expect(hiddenColumn(sheet, 3)).toBe(true);
  expect(hiddenColumn(sheet, 4)).toBe(false);
  expect(sheet.custom.suiteleafColumnGroups).toMatchObject([
    { startColumn: 1, endColumn: 3, collapsed: [1, 2, 3] },
  ]);

  await expand.click();
  await expect(collapse).toBeVisible();
  await select(page, "B1");
  await page.getByRole("button", { name: "Show only January" }).click();
  await expect(page.locator(".column-group-controls")).toHaveAttribute("data-collapsed", "2,3");
  await expect(page.getByRole("button", { name: "Expand columns B to D" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Collapse columns B to D" })).toBeVisible();

  file = await native(page);
  sheet = sheetOf(file);
  expect(sheet.cellData[1][4]).toMatchObject({ f: "=SUM(B2:D2)", v: 60 });
  expect(hiddenColumn(sheet, 1)).toBe(false);
  expect(hiddenColumn(sheet, 2)).toBe(true);
  expect(sheet.custom.suiteleafColumnGroups[0].collapsed).toEqual([2, 3]);

  await page.getByRole("button", { name: "Undo (Cmd+Z)" }).click();
  await expect(page.getByRole("button", { name: /Collapse columns|Expand columns|Show only/ })).toHaveCount(0);
  await expect(page.locator(".column-group-controls")).toHaveAttribute("data-collapsed", "");
  file = await native(page);
  sheet = sheetOf(file);
  expect(sheet.custom?.suiteleafColumnGroups).toBeUndefined();
  expect(hiddenColumn(sheet, 1)).toBe(false);
  expect(hiddenColumn(sheet, 2)).toBe(false);
  expect(hiddenColumn(sheet, 3)).toBe(false);
  expect(sheet.cellData[1][4].f).toBe("=SUM(B2:D2)");

  await page.getByRole("button", { name: "Redo (Cmd+Y)" }).click();
  await expect(page.locator(".column-group-controls")).toHaveAttribute("data-collapsed", "2,3");
  await expect(page.getByRole("button", { name: "Expand columns B to D" })).toBeVisible();

  // A download sets the status to “Downloaded” and can land after the save.
  // Leaving the editor flushes whatever redo has not written yet.
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("link", { name: "Rent budget" }).click();
  await page.getByRole("toolbar", { name: "Spreadsheet formatting" }).waitFor();
  await expect(page.locator(".column-group-controls")).toHaveAttribute("data-collapsed", "2,3");
  await expect(page.getByRole("button", { name: "Expand columns B to D" })).toBeVisible();
  await select(page, "E2");
  file = await native(page);
  sheet = sheetOf(file);
  expect(hiddenColumn(sheet, 1)).toBe(false);
  expect(hiddenColumn(sheet, 2)).toBe(true);
  expect(hiddenColumn(sheet, 4)).toBe(false);
  expect(sheet.cellData[1][4]).toMatchObject({ f: "=SUM(B2:D2)", v: 60 });
});

test("grouping a selection that includes the category and the year leaves both visible", async ({
  page,
}) => {
  await open(page);
  await select(page, "A1:E2");
  await groupColumns(page);
  await expect(page.getByRole("button", { name: "Collapse columns B to D" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Collapse columns A to E" })).toHaveCount(0);
  await expect(page.locator(".column-group-controls")).toHaveAttribute("data-span", "1-3");
  const file = await native(page);
  const sheet = sheetOf(file);
  expect(sheet.custom.suiteleafColumnGroups).toMatchObject([
    { startColumn: 1, endColumn: 3, collapsed: [] },
  ]);
  expect(hiddenColumn(sheet, 0)).toBe(false);
  expect(hiddenColumn(sheet, 4)).toBe(false);
});

test("an existing row group still collapses after columns are grouped", async ({ page }) => {
  await open(page, { rowGroup: true });
  const collapseRows = page.getByRole("button", { name: "Collapse rows 2 to 3" });
  await expect(collapseRows).toBeVisible();
  await select(page, "B1:D2");
  await groupColumns(page);
  await page.getByRole("button", { name: "Collapse columns B to D" }).click();
  await expect(page.locator(".column-group-controls")).toHaveAttribute("data-collapsed", "1,2,3");
  await expect(collapseRows).toBeVisible();
  await collapseRows.click();
  await expect(page.locator(".row-group-controls")).toHaveAttribute("data-collapsed", "1,2");
  await expect(page.locator(".column-group-controls")).toHaveAttribute("data-collapsed", "1,2,3");

  let file = await native(page);
  let sheet = sheetOf(file);
  expect(sheet.custom.suiteleafRowGroups).toMatchObject([
    { startRow: 1, endRow: 2, collapsed: [1, 2] },
  ]);
  expect(sheet.custom.suiteleafColumnGroups).toMatchObject([
    { startColumn: 1, endColumn: 3, collapsed: [1, 2, 3] },
  ]);
  expect(hiddenRow(sheet, 1)).toBe(true);
  expect(hiddenRow(sheet, 2)).toBe(true);
  expect(hiddenColumn(sheet, 1)).toBe(true);
  expect(hiddenColumn(sheet, 0)).toBe(false);

  await page.getByRole("button", { name: "Undo (Cmd+Z)" }).click();
  await expect(page.locator(".column-group-controls")).toHaveAttribute("data-collapsed", "");
  await expect(page.locator(".row-group-controls")).toHaveAttribute("data-collapsed", "1,2");
  file = await native(page);
  sheet = sheetOf(file);
  expect(sheet.custom?.suiteleafColumnGroups).toBeUndefined();
  expect(sheet.custom.suiteleafRowGroups[0].collapsed).toEqual([1, 2]);
  expect(hiddenColumn(sheet, 1)).toBe(false);
  expect(hiddenRow(sheet, 1)).toBe(true);
});
