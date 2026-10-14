import { readFile } from "node:fs/promises";
import { type Page } from "@playwright/test";
import * as XLSX from "xlsx";
import { createFile, serializeFile } from "../../packages/core/src";
import { beat, caption, expect, selectCells, test, typeSlowly } from "./harness";

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function budgetFile() {
  const file = createFile("sheet", "Rent budget");
  if (file.kind !== "sheet") throw new Error("Expected a spreadsheet");
  const sheet = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
  sheet.name = "Budget";
  const cellData: Record<string, Record<string, { v?: string | number; t?: number; f?: string }>> = {
    0: { 0: { v: "Month", t: 1 }, 2: { v: "Rent", t: 1 } },
  };
  months.forEach((month, index) => {
    cellData[index + 1] = { 0: { v: month, t: 1 }, 2: { v: 1200, t: 2 } };
  });
  cellData[13] = { 1: { v: "Total", t: 1 }, 2: { f: "=SUM(C2:C13)", v: 14400 } };
  sheet.cellData = cellData;
  sheet.columnData = { 0: { w: 88 }, 1: { w: 80 }, 2: { w: 96 } };
  return file;
}

function excelRent() {
  const rows: (string | number)[][] = [["Month", "Amount"]];
  months.forEach((month) => rows.push([month, 100]));
  rows.push(["Total", 0]);
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet.B14 = { t: "n", f: "SUM(Rent)", v: 0 };
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Budget");
  book.Workbook = { Names: [{ Name: "Rent", Ref: "Budget!$B$2:$B$13" }] };
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const nameBox = (page: Page) =>
  page.locator('.sheet-host [data-u-comp="defined-name"] input');

test("55-name-a-range", async ({ page }) => {
  await page.goto("/");
  await caption(page, "Rosa's rent budget adds the same twelve cells in three places. She wants that range to have a name.", 2400);
  await page.locator("input[type=file]").setInputFiles({
    name: "Rent budget.slsheet",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(budgetFile())),
  });
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute("aria-busy", "false");
  await beat(page, 700);
  await selectCells(page, "C14");
  await beat(page, 400);
  await caption(page, "C14 is =SUM(C2:C13). The twelve months add up to 14,400.", 2200);

  await selectCells(page, "C2:C13");
  await beat(page, 500);
  await caption(page, "She selects the months and opens Data › Named ranges. The dialog names exactly that selection.", 2000);
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await beat(page, 350);
  await page.getByRole("menuitem", { name: "Named ranges", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Named ranges" });
  await expect(dialog).toContainText("Selection C2:C13");
  await beat(page, 600);
  await typeSlowly(page, "Rent", 80);
  await beat(page, 500);
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(nameBox(page)).toHaveValue("Rent");
  await expect(dialog.getByRole("button", { name: "Go to Rent, C2:C13" })).toBeVisible();
  await caption(page, "Rent is in the list, and the name box says Rent while those cells stay selected.", 2400);
  await dialog.getByRole("button", { name: "Close named ranges" }).click();
  await beat(page, 600);

  await caption(page, "She replaces the cell addresses with the name.", 1400);
  await selectCells(page, "C14");
  await beat(page, 300);
  await typeSlowly(page, "=SUM(Rent)", 55);
  await beat(page, 400);
  await page.keyboard.press("Enter");
  await selectCells(page, "C14");
  await beat(page, 500);
  await caption(page, "=SUM(Rent) is the same 14,400. The name and the cells are one range.", 2400);
  await selectCells(page, "A1");
  await expect(nameBox(page)).toHaveValue("A1");
  await caption(page, "She clicks away. The name box goes back to a cell address.", 1600);
  await beat(page, 700);
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await beat(page, 300);
  await page.getByRole("menuitem", { name: "Named ranges", exact: true }).click();
  await beat(page, 400);
  await dialog.getByRole("button", { name: "Go to Rent, C2:C13" }).click();
  await expect(nameBox(page)).toHaveValue("Rent");
  await expect(dialog).toContainText("This selection is Rent");
  await caption(page, "Choosing Rent from the list jumps back to the twelve months. The list stays open.", 2600);

  await caption(page, "C14 looks like a name, but it is a cell. The dialog says so, and Rent is unchanged.", 1800);
  await dialog.getByLabel("Range name").fill("");
  await typeSlowly(page, "C14", 90);
  await expect(dialog.getByRole("alert")).toContainText("C14 is a cell reference");
  await expect(dialog.getByRole("button", { name: "Add", exact: true })).toBeDisabled();
  await beat(page, 1800);
  await dialog.getByLabel("Range name").fill("");
  await typeSlowly(page, "Rent payments", 45);
  await expect(dialog.getByRole("alert")).toContainText("includes a space");
  await expect(dialog.getByRole("alert")).toContainText("RentPayments");
  await expect(dialog.getByRole("button", { name: "Go to Rent, C2:C13" })).toBeVisible();
  await caption(page, "\"Rent payments\" has a space. Names cannot include spaces. Try RentPayments. Rent is still there.", 2800);

  await caption(page, "She renames Rent. Formulas that used it change in the same step.", 1800);
  await dialog.getByRole("button", { name: "Rename Rent" }).click();
  await beat(page, 300);
  await page.keyboard.press("Meta+a");
  await typeSlowly(page, "MonthlyRent", 45);
  await beat(page, 400);
  await dialog.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(dialog).toContainText("now use MonthlyRent");
  await selectCells(page, "C14");
  await beat(page, 400);
  await caption(page, "C14 now reads =SUM(MonthlyRent). One undo puts the name and the formula back.", 2600);
  await page.getByRole("button", { name: "Undo (Cmd+Z)", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Go to Rent, C2:C13" })).toBeVisible();
  await selectCells(page, "C14");
  await beat(page, 500);
  await caption(page, "Undo restored Rent, and =SUM(Rent) with it.", 2000);

  await page.goto("/");
  await caption(page, "An Excel workbook already defines Rent. She opens it in SuiteLeaf.", 2000);
  await page.locator("input[type=file]").setInputFiles({
    name: "Rent from Excel.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: excelRent(),
  });
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute("aria-busy", "false");
  await beat(page, 800);
  await selectCells(page, "B14");
  await beat(page, 500);
  await caption(page, "=SUM(Rent) already calculates: twelve months of 100, total 1,200.", 2400);
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await beat(page, 300);
  await page.getByRole("menuitem", { name: "Named ranges", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Go to Rent, B2:B13" })).toBeVisible();
  await beat(page, 500);
  await dialog.getByRole("button", { name: "Go to Rent, B2:B13" }).click();
  await expect(nameBox(page)).toHaveValue("Rent");
  await caption(page, "Excel's Rent is in the list. Choosing it selects B2:B13, and the name box shows Rent.", 2600);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const saved = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  const book = saved.content.workbook;
  const raw = book.resources.find((item: { name: string }) => item.name === "SHEET_DEFINED_NAME_PLUGIN").data as string;
  expect(raw).toContain("Rent");
  const cells = book.sheets[book.sheetOrder[0]].cellData;
  expect(String(cells[13][1].f)).toContain("Rent");
  expect(cells[13][1].v).toBe(1200);
  await caption(page, "Downloading the sheet keeps the name. =SUM(Rent) is still 1,200.", 2400);
});
