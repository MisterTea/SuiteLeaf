import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { createFile, serializeFile } from "../../packages/core/src";
import { exportXlsx } from "../../packages/core/src/xlsx-export";
import { beat, caption, expect, selectCells, test } from "./harness";

const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const hiddenMonths = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function sheetFile(title: string) {
  const file = createFile("sheet", title);
  if (file.kind !== "sheet") throw new Error("Expected a workbook");
  return file;
}

function rentBudget() {
  const file = sheetFile("Rent budget");
  const sheet = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
  sheet.name = "2026";
  const header = ["Category", ...months, "Year"];
  const expenses: [string, number, number][] = [
    ["Rent", 1200, 14400],
    ["Food", 400, 4800],
    ["Utilities", 200, 2400],
  ];
  const rows: (string | number)[][] = [
    ["Total", 1800, 21600],
    ...expenses.map(([name, month, year]) => [name, month, year]),
  ];
  const cells = (values: (string | number)[], yearly: boolean) => {
    const record: Record<number, { v: string | number; t: number }> = {
      0: { v: values[0], t: 1 },
    };
    for (let column = 1; column <= 12; column++)
      record[column] = { v: values[1] as number, t: 2 };
    record[13] = { v: yearly ? (values[2] as number) : (values[1] as number), t: 2 };
    return record;
  };
  sheet.cellData = {
    0: Object.fromEntries(header.map((name, column) => [column, { v: name, t: 1 }])),
    1: cells(rows[0], true),
    2: cells(rows[1], true),
    3: cells(rows[2], true),
    4: cells(rows[3], true),
  };
  const columnData: Record<number, { w: number; hd?: number }> = {
    0: { w: 148 },
    1: { w: 110 },
    13: { w: 120 },
  };
  for (const column of hiddenMonths) columnData[column] = { w: 110, hd: 1 };
  sheet.columnData = columnData;
  sheet.rowData = { 2: { hd: 1 }, 3: { hd: 1 }, 4: { hd: 1 } };
  sheet.custom = {
    suiteleafColumnGroups: [
      { id: "cols-B-M", startColumn: 1, endColumn: 12, collapsed: hiddenMonths },
    ],
    suiteleafRowGroups: [
      { id: "rows-3-5", startRow: 2, endRow: 4, collapsed: [2, 3, 4] },
    ],
  };
  return file;
}

function upload(name: string, buffer: Buffer, mimeType: string) {
  return { name, mimeType, buffer };
}

async function showLibrary(page: import("@playwright/test").Page) {
  await page.keyboard.press("Escape");
  const back = page.getByRole("button", { name: "Back to files" });
  if (await back.count()) {
    await back.click();
    await page.getByRole("button", { name: "Open / import", exact: true }).waitFor();
  }
  const choose = page.getByRole("button", { name: "Open / import", exact: true });
  await choose.scrollIntoViewIfNeeded();
  await beat(page, 300);
}

async function chooseFile(
  page: import("@playwright/test").Page,
  file: { name: string; mimeType: string; buffer: Buffer },
) {
  const choose = page.getByRole("button", { name: "Open / import", exact: true });
  const chooserPromise = page.waitForEvent("filechooser");
  await choose.click();
  await (await chooserPromise).setFiles(file);
  await page.getByRole("toolbar", { name: "Spreadsheet formatting" }).waitFor();
  await beat(page, 900);
}

async function exportXlsxDownload(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "File", exact: true }).click();
  await beat(page, 400);
  const item = page.getByRole("menuitem", { name: "Export XLSX", exact: true });
  await expect(item).toBeEnabled();
  const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
  await item.click();
  const download = await downloadPromise;
  await page.keyboard.press("Escape");
  await beat(page, 600);
  return readFile(await download.path());
}

async function quarterWorkbook() {
  const file = sheetFile("Quarter");
  const sheet = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
  const header = ["Category", "Jan", "Feb", "Mar", "Total"];
  const body = [
    ["All", 16, 27, 38, 81],
    ["Rent", 10, 20, 30, 60],
    ["Food", 5, 5, 5, 15],
    ["Transit", 1, 2, 3, 6],
  ];
  sheet.cellData = {
    0: Object.fromEntries(header.map((name, column) => [column, { v: name, t: 1 }])),
    ...Object.fromEntries(
      body.map((row, index) => [
        index + 1,
        Object.fromEntries(
          row.map((value, column) => [column, { v: value, t: column === 0 ? 1 : 2 }]),
        ),
      ]),
    ),
  };
  sheet.columnData = Object.fromEntries([0, 1, 2, 3, 4].map((column) => [column, { w: 120 }]));
  let xml = await JSZip.loadAsync(await exportXlsx(file)).then((zip) =>
    zip.file("xl/worksheets/sheet1.xml")!.async("string"),
  );
  xml = xml.replace(
    /<col\b([^>]*?)\bmin="([2-4])"([^>]*?)(\/>|>)/g,
    `<col$1min="$2"$3 outlineLevel="1"$4`,
  );
  xml = xml.replace(
    /<row\b([^>]*?)\br="([345])"([^>]*?)(\/>|>)/g,
    `<row$1r="$2"$3 outlineLevel="1"$4`,
  );
  xml = xml.replace(
    /<sheetFormatPr\b([^>]*)\/>/,
    `<sheetFormatPr$1 outlineLevelRow="1" outlineLevelCol="1"/>`,
  );
  const zip = await JSZip.loadAsync(await exportXlsx(file));
  zip.file("xl/worksheets/sheet1.xml", xml);
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

test("80-send-an-outline-to-excel", async ({ page }) => {
  const quarter = await quarterWorkbook();
  await page.goto("/");
  await showLibrary(page);
  await caption(page, "Rosa opens the rent budget.", 900);
  await chooseFile(
    page,
    upload(
      "Rent budget.slsheet",
      Buffer.from(serializeFile(rentBudget())),
      "application/json",
    ),
  );
  await expect(page.locator(".column-group-controls")).toHaveAttribute("data-span", "1-12");
  await expect(page.locator(".column-group-controls")).toHaveAttribute(
    "data-collapsed",
    hiddenMonths.join(","),
  );
  await expect(page.getByRole("button", { name: "Collapse columns B to M" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand columns B to M" })).toBeVisible();
  await expect(page.locator(".row-group-controls")).toHaveAttribute("data-collapsed", "2,3,4");
  await expect(page.getByRole("button", { name: "Expand rows 3 to 5" })).toBeVisible();
  await selectCells(page, "B1");
  await expect(page.locator(".sheet-host")).toHaveAttribute("data-active-value", "January");
  await selectCells(page, "N1");
  await expect(page.locator(".sheet-host")).toHaveAttribute("data-active-value", "Year");
  await selectCells(page, "A1");
  await caption(page, "January through December are grouped, and the expense rows are collapsed. January is the only month on screen.", 2600);

  await caption(page, "She downloads the Excel file for the treasurer.", 1400);
  const rentXlsx = await exportXlsxDownload(page);
  const rentXml = await JSZip.loadAsync(rentXlsx).then((zip) =>
    zip.file("xl/worksheets/sheet1.xml")!.async("string"),
  );
  expect(rentXml).toContain('outlineLevel="1"');
  expect(rentXml).toContain('summaryBelow="0"');
  expect(rentXml).toContain('summaryRight="0"');
  expect(rentXml).not.toContain("suiteleafColumnGroups");
  await caption(page, "Excel receives an outline for the same months and the same expense rows.", 2000);

  await showLibrary(page);
  await caption(page, "She opens that same file with Open / import.", 1600);
  await chooseFile(
    page,
    upload(
      "Rent budget.xlsx",
      rentXlsx,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ),
  );
  await expect(page.getByText("Imported XLSX: Rent budget.xlsx")).toBeVisible();
  await expect(page.locator(".column-group-controls")).toHaveAttribute("data-span", "1-12");
  await expect(page.locator(".column-group-controls")).toHaveAttribute(
    "data-collapsed",
    hiddenMonths.join(","),
  );
  await expect(page.locator(".row-group-controls")).toHaveAttribute("data-collapsed", "2,3,4");
  await expect(page.getByRole("button", { name: "Collapse columns B to M" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand columns B to M" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand rows 3 to 5" })).toBeVisible();
  await selectCells(page, "B1");
  await expect(page.locator(".sheet-host")).toHaveAttribute("data-active-value", "January");
  await selectCells(page, "A1");
  await caption(page, "The plus and minus are back. January is still the only month showing.", 2600);

  await showLibrary(page);
  await caption(page, "This workbook started in Excel, with a column outline and a row outline.", 1600);
  await chooseFile(
    page,
    upload(
      "Quarter.xlsx",
      quarter,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ),
  );
  await expect(page.getByText("Imported XLSX: Quarter.xlsx")).toBeVisible();
  const collapseColumns = page.getByRole("button", { name: "Collapse columns B to D" });
  const collapseRows = page.getByRole("button", { name: "Collapse rows 3 to 5" });
  await expect(collapseColumns).toBeVisible();
  await expect(collapseRows).toBeVisible();
  await selectCells(page, "B1");
  await expect(page.locator(".sheet-host")).toHaveAttribute("data-active-value", "Jan");
  await selectCells(page, "A3");
  await expect(page.locator(".sheet-host")).toHaveAttribute("data-active-value", "Rent");
  await selectCells(page, "A1");
  await caption(page, "Jan, Feb, and Mar are open, and so are Rent, Food, and Transit.", 2200);

  await collapseColumns.click();
  await expect(page.locator(".column-group-controls")).toHaveAttribute("data-collapsed", "1,2,3");
  await selectCells(page, "E2");
  await expect(page.locator(".sheet-host")).toHaveAttribute("data-active-value", "81");
  await selectCells(page, "A1");
  await caption(page, "Collapsing the column outline hides those months. The total stays.", 2400);

  await page.getByRole("button", { name: "Expand columns B to D" }).click();
  await expect(page.locator(".column-group-controls")).toHaveAttribute("data-collapsed", "");
  await collapseRows.click();
  await expect(page.locator(".row-group-controls")).toHaveAttribute("data-collapsed", "2,3,4");
  await selectCells(page, "A2");
  await expect(page.locator(".sheet-host")).toHaveAttribute("data-active-value", "All");
  await selectCells(page, "E2");
  await expect(page.locator(".sheet-host")).toHaveAttribute("data-active-value", "81");
  await selectCells(page, "A1");
  await caption(page, "Collapsing the row outline hides Rent, Food, and Transit. The total stays on All.", 2400);

  const grocery = sheetFile("Grocery list");
  const grocerySheet = grocery.content.workbook.sheets[grocery.content.workbook.sheetOrder[0]];
  grocerySheet.cellData = {
    0: { 0: { v: "Milk", t: 1 } },
    1: { 0: { v: "Bread", t: 1 } },
  };
  grocerySheet.columnData = { 0: { w: 160 } };
  await showLibrary(page);
  await caption(page, "A grocery list has no groups.", 1400);
  await chooseFile(
    page,
    upload("Grocery list.slsheet", Buffer.from(serializeFile(grocery)), "application/json"),
  );
  await expect(page.locator(".column-group-controls")).toHaveAttribute("data-span", "");
  await expect(page.locator(".column-group-controls")).toHaveAttribute("data-collapsed", "");
  await expect(page.locator(".row-group-controls")).toHaveAttribute("data-collapsed", "");
  await expect(page.getByRole("button", { name: /Collapse columns|Expand columns|Collapse rows|Expand rows/ })).toHaveCount(0);
  await caption(page, "She downloads it. SuiteLeaf does not add an outline.", 1600);
  const plain = await exportXlsxDownload(page);
  const plainXml = await JSZip.loadAsync(plain).then((zip) =>
    zip.file("xl/worksheets/sheet1.xml")!.async("string"),
  );
  expect(plainXml).not.toContain("outlineLevel");
  expect(plainXml).not.toContain("outlinePr");
  expect(plainXml).not.toContain("collapsed=");
  await caption(page, "A sheet with no groups downloads with no outline levels.", 2200);
});
