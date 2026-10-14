import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import * as XLSX from "xlsx";
import { createFile, serializeFile } from "../../packages/core/src";

function budgetFile() {
  const file = createFile("sheet", "Rent budget");
  if (file.kind !== "sheet") throw new Error("Expected a spreadsheet");
  const sheet = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
  sheet.name = "Budget";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const cellData: Record<string, Record<string, { v?: string | number; t?: number; f?: string }>> = {
    0: { 0: { v: "Month", t: 1 }, 2: { v: "Rent", t: 1 } },
  };
  months.forEach((month, index) => {
    cellData[index + 1] = { 0: { v: month, t: 1 }, 2: { v: 1200, t: 2 } };
  });
  cellData[13] = { 1: { v: "Total", t: 1 }, 2: { f: "=SUM(C2:C13)", v: 14400 } };
  sheet.cellData = cellData;
  return file;
}

async function openSheet(page: Page) {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Rent budget.slsheet",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(budgetFile())),
  });
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute("aria-busy", "false");
}

async function selectCells(page: Page, ref: string) {
  const box = page.locator('.sheet-host [data-u-comp="defined-name"] input');
  await box.fill(ref);
  await box.press("Enter");
}

async function openNamedRanges(page: Page) {
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await page.getByRole("menuitem", { name: "Named ranges", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Named ranges" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function saved(page: Page) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  return JSON.parse(await readFile((await (await download).path())!, "utf8"));
}

function namesOf(file: { content: { workbook: { resources?: { name: string; data: string }[] } } }) {
  const raw = file.content.workbook.resources?.find((item) => item.name === "SHEET_DEFINED_NAME_PLUGIN")?.data;
  return raw ? Object.values(JSON.parse(raw) as Record<string, { name: string }>) : [];
}

test("Data › Named ranges creates, jumps, refuses, and renames in one undo", async ({ page }) => {
  await openSheet(page);
  await selectCells(page, "C2:C13");
  const dialog = await openNamedRanges(page);
  await expect(dialog).toContainText("Selection C2:C13");
  await dialog.getByLabel("Range name").fill("Rent");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Go to Rent, C2:C13" })).toBeVisible();
  const box = page.locator('.sheet-host [data-u-comp="defined-name"] input');
  await expect(box).toHaveValue("Rent");

  await dialog.getByRole("button", { name: "Close named ranges" }).click();
  await selectCells(page, "C14");
  await page.keyboard.type("=SUM(Rent)");
  await page.keyboard.press("Enter");
  await expect(box).toHaveValue("C15");

  await selectCells(page, "A1");
  await expect(box).toHaveValue("A1");
  const again = await openNamedRanges(page);
  await again.getByRole("button", { name: "Go to Rent, C2:C13" }).click();
  await expect(box).toHaveValue("Rent");
  await expect(again).toContainText("This selection is Rent");

  await again.getByLabel("Range name").fill("C14");
  await expect(again.getByRole("alert")).toContainText("C14 is a cell reference");
  await expect(again.getByRole("button", { name: "Add", exact: true })).toBeDisabled();
  await again.getByLabel("Range name").fill("Rent payments");
  await expect(again.getByRole("alert")).toContainText("includes a space");
  await expect(again.getByRole("alert")).toContainText("RentPayments");
  await expect(again.getByRole("button", { name: "Go to Rent, C2:C13" })).toBeVisible();

  await again.getByRole("button", { name: "Rename Rent" }).click();
  await again.getByLabel("Range name").fill("MonthlyRent");
  await again.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(again).toContainText("now use MonthlyRent");
  await selectCells(page, "C14");
  let file = await saved(page);
  let book = file.content.workbook;
  let cells = book.sheets[book.sheetOrder[0]].cellData;
  expect(cells[13][2].f).toBe("=SUM(MonthlyRent)");
  expect(cells[13][2].v).toBe(14400);
  expect(namesOf(file).map((item) => item.name)).toEqual(["MonthlyRent"]);

  await page.getByRole("button", { name: "Undo (Cmd+Z)", exact: true }).click();
  file = await saved(page);
  book = file.content.workbook;
  cells = book.sheets[book.sheetOrder[0]].cellData;
  expect(cells[13][2].f).toBe("=SUM(Rent)");
  expect(cells[13][2].v).toBe(14400);
  expect(namesOf(file).map((item) => item.name)).toEqual(["Rent"]);
});

function excelRent() {
  const rows: (string | number)[][] = [["Month", "Amount"]];
  for (let month = 1; month <= 12; month++) rows.push([`M${month}`, 100]);
  rows.push(["Total", 0]);
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet.B14 = { t: "n", f: "SUM(Rent)", v: 0 };
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Budget");
  book.Workbook = { Names: [{ Name: "Rent", Ref: "Budget!$B$2:$B$13" }] };
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

test("an Excel defined name calculates and survives a SuiteLeaf download and an xlsx export", async ({ page }) => {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Rent from Excel.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: excelRent(),
  });
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute("aria-busy", "false");
  const dialog = await openNamedRanges(page);
  await expect(dialog.getByRole("button", { name: /Go to Rent/ })).toBeVisible();
  await dialog.getByRole("button", { name: /Go to Rent/ }).click();
  await expect(page.locator('.sheet-host [data-u-comp="defined-name"] input')).toHaveValue("Rent");

  const file = await saved(page);
  const book = file.content.workbook;
  const cells = book.sheets[book.sheetOrder[0]].cellData;
  expect(namesOf(file).map((item) => item.name)).toContain("Rent");
  expect(String(cells[13][1].f)).toContain("Rent");
  expect(cells[13][1].v).toBe(1200);

  await page.getByRole("button", { name: "File", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export XLSX", exact: true }).click();
  const xlsx = XLSX.read(await readFile((await (await download).path())!));
  const defined = xlsx.Workbook?.Names?.find((item) => item.Name === "Rent");
  expect(defined?.Ref).toBe("Budget!$B$2:$B$13");
});
