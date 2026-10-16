import type { Download, Page } from "@playwright/test";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { createFile, serializeFile } from "../../../packages/core/src";
import { ready } from "../fixtures";
import { askAgent, beat, caption, describeRun, electronApps, expect, openApp, selectCells, test } from "../harness";

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

const prompt = [
  "Rent budget is open. Columns B through M are already grouped, and the expense rows are already collapsed.",
  "January is the only month showing, and the year total sits beside it.",
  "Do not change any cell value. Do not delete the groups.",
  "Export the workbook as an Excel file so the month columns and the expense rows are an Excel outline.",
  'Call export_spreadsheet with format "xlsx". Do not use download_file. Stop.',
].join(" ");

function rentBudget() {
  const file = createFile("sheet", "Rent budget");
  if (file.kind !== "sheet") throw new Error("Expected a workbook");
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
    for (let column = 1; column <= 12; column++) record[column] = { v: values[1] as number, t: 2 };
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
    suiteleafRowGroups: [{ id: "rows-3-5", startRow: 2, endRow: 4, collapsed: [2, 3, 4] }],
  };
  return file;
}

async function collectExports(page: Page) {
  const dir = mkdtempSync(join(tmpdir(), "storyboard-80-ai-"));
  const downloads: Download[] = [];
  const app = electronApps.get(page);
  if (app)
    await app.evaluate(({ dialog }, folder) => {
      (dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = async (
        _window: unknown,
        options: { defaultPath?: string },
      ) => ({
        canceled: false,
        filePath: `${folder}/${(options.defaultPath ?? "export").split(/[\\/]/).pop()}`,
      });
    }, dir);
  else page.on("download", (download) => downloads.push(download));
  return async () => {
    if (app) return readdirSync(dir).map((name) => ({ name, data: readFileSync(join(dir, name)) }));
    return Promise.all(
      downloads.map(async (download) => ({
        name: download.suggestedFilename(),
        data: readFileSync((await download.path())!),
      })),
    );
  };
}

function attributes(source: string) {
  return Object.fromEntries([...source.matchAll(/([\w:.-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
}

function colMap(xml: string) {
  const columns = new Map<number, Record<string, string>>();
  const block = xml.match(/<cols\b[^>]*>[\s\S]*?<\/cols>/)?.[0] ?? "";
  for (const tag of block.matchAll(/<col\b([^>]*?)(?:\/>|>)/g)) {
    const attrs = attributes(tag[1]!);
    for (let column = Number(attrs.min); column <= Number(attrs.max); column++) columns.set(column, attrs);
  }
  return columns;
}

function rowMap(xml: string) {
  const rows = new Map<number, Record<string, string>>();
  for (const tag of xml.matchAll(/<row\b([^>]*?)(?:\/>|>)/g)) {
    const attrs = attributes(tag[1]!);
    rows.set(Number(attrs.r), attrs);
  }
  return rows;
}

function valueCount(xml: string, value: number) {
  return (xml.match(new RegExp(`<v>${value}(?:\\.0+)?</v>`, "g")) ?? []).length;
}

function savedCell(sheet: { cellData?: Record<number, Record<number, { v?: unknown; f?: string | null }>> }, row: number, column: number) {
  return sheet.cellData?.[row]?.[column];
}

test("80-send-an-outline-to-excel-ai", async ({ page }) => {
  await openApp(page);
  await caption(page, "Rosa’s rent budget already groups the months and collapses the expense rows.");
  await page.locator("input[type=file]").setInputFiles({
    name: "Rent budget.slsheet",
    mimeType: "application/json",
    buffer: Buffer.from(serializeFile(rentBudget())),
  });
  await expect(page.getByLabel("Spreadsheet grid")).toHaveAttribute("aria-busy", "false");
  await page.getByRole("button", { name: "Sheet tools", exact: true }).waitFor();
  await ready(page);
  await expect(page.locator(".column-group-controls")).toHaveAttribute("data-span", "1-12");
  await expect(page.locator(".column-group-controls")).toHaveAttribute("data-collapsed", hiddenMonths.join(","));
  await expect(page.locator(".row-group-controls")).toHaveAttribute("data-collapsed", "2,3,4");
  await selectCells(page, "B1");
  await expect(page.locator(".sheet-host")).toHaveAttribute("data-active-value", "January");
  await selectCells(page, "N1");
  await expect(page.locator(".sheet-host")).toHaveAttribute("data-active-value", "Year");
  await selectCells(page, "A1");
  await caption(
    page,
    "She asks SuiteLeaf's on-device assistant to send that outline to Excel, without changing the budget.",
    1600,
  );
  await caption(page, "", 0);

  const exported = await collectExports(page);
  const run = await askAgent(page, prompt);
  const why = describeRun(run);
  expect(run.state, why).toBe("done");
  const exportCall = run.items.find((item) => item.name === "export_spreadsheet" && item.status !== "error");
  expect(exportCall?.result ?? "", why).toMatch(/Exported every sheet as "Rent budget\.xlsx"/);

  const files = await exported();
  const xlsx = files.filter((file) => file.name.endsWith(".xlsx"));
  const workbook = xlsx.at(-1);
  expect(workbook?.name, `${why}\nExported: ${files.map((file) => file.name).join(", ") || "(none)"}`).toBe(
    "Rent budget.xlsx",
  );
  const zip = await JSZip.loadAsync(workbook!.data);
  const xml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  const shared = (await zip.file("xl/sharedStrings.xml")?.async("string")) ?? "";
  const text = `${xml}\n${shared}`;
  const detail = `${why}\n${xml}`;
  expect(xml, detail).toContain('outlineLevel="1"');
  expect(xml, detail).toContain('summaryBelow="0"');
  expect(xml, detail).toContain('summaryRight="0"');
  expect(xml, detail).toContain('outlineLevelRow="1"');
  expect(xml, detail).toContain('outlineLevelCol="1"');
  expect(xml, detail).not.toContain("suiteleafColumnGroups");
  expect(xml, detail).not.toContain("suiteleafRowGroups");
  const columns = colMap(xml);
  expect(columns.get(1)?.outlineLevel, detail).toBeUndefined();
  expect(columns.get(2)?.outlineLevel, detail).toBe("1");
  expect(columns.get(2)?.hidden, detail).toBeUndefined();
  for (let column = 3; column <= 13; column++) {
    expect(columns.get(column)?.outlineLevel, detail).toBe("1");
    expect(columns.get(column)?.hidden === "1" || columns.get(column)?.hidden === "true", detail).toBe(true);
  }
  expect(columns.get(14)?.outlineLevel, detail).toBeUndefined();
  const rows = rowMap(xml);
  expect(rows.get(2)?.collapsed === "1" || rows.get(2)?.collapsed === "true", detail).toBe(true);
  expect(rows.get(2)?.outlineLevel, detail).toBeUndefined();
  for (const row of [3, 4, 5]) {
    expect(rows.get(row)?.outlineLevel, detail).toBe("1");
    expect(rows.get(row)?.hidden === "1" || rows.get(row)?.hidden === "true", detail).toBe(true);
  }
  expect(rows.get(1)?.outlineLevel, detail).toBeUndefined();
  expect(valueCount(xml, 1800), detail).toBe(12);
  expect(valueCount(xml, 21600), detail).toBe(1);
  expect(valueCount(xml, 1200), detail).toBe(12);
  expect(valueCount(xml, 14400), detail).toBe(1);
  expect(valueCount(xml, 400), detail).toBe(12);
  expect(valueCount(xml, 4800), detail).toBe(1);
  expect(valueCount(xml, 200), detail).toBe(12);
  expect(valueCount(xml, 2400), detail).toBe(1);
  for (const word of ["Category", "January", "December", "Year", "Total", "Rent", "Food", "Utilities"])
    expect(text, detail).toContain(word);

  await page.getByRole("button", { name: "Close assistant" }).click();
  await beat(page, 400);
  await page.getByRole("button", { name: "Back to files" }).click();
  await page.getByRole("button", { name: "Open / import", exact: true }).waitFor();
  await caption(page, "She opens that Excel file again.", 1200);
  await page.locator("input[type=file]").setInputFiles({
    name: "Rent budget.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: workbook!.data,
  });
  await page.getByRole("button", { name: "Sheet tools", exact: true }).waitFor();
  await ready(page);
  await expect(page.getByText("Imported XLSX: Rent budget.xlsx")).toBeVisible();
  await expect(page.locator(".column-group-controls")).toHaveAttribute("data-span", "1-12");
  await expect(page.locator(".column-group-controls")).toHaveAttribute("data-collapsed", hiddenMonths.join(","));
  await expect(page.locator(".row-group-controls")).toHaveAttribute("data-collapsed", "2,3,4");
  await expect(page.getByRole("button", { name: "Collapse columns B to M" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand columns B to M" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand rows 3 to 5" })).toBeVisible();
  await selectCells(page, "B1");
  await expect(page.locator(".sheet-host")).toHaveAttribute("data-active-value", "January");
  await selectCells(page, "N1");
  await expect(page.locator(".sheet-host")).toHaveAttribute("data-active-value", "Year");
  await selectCells(page, "A2");
  await expect(page.locator(".sheet-host")).toHaveAttribute("data-active-value", "Total");
  await selectCells(page, "B2");
  await expect(page.locator(".sheet-host")).toHaveAttribute("data-active-value", "1800");
  await selectCells(page, "N2");
  await expect(page.locator(".sheet-host")).toHaveAttribute("data-active-value", "21600");
  await selectCells(page, "A1");
  await caption(page, "The plus and minus are back. January is still the only month showing.", 2000);

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const saved = JSON.parse(readFileSync((await (await download).path())!, "utf8"));
  const book = saved.content.workbook;
  const sheet = book.sheets[book.sheetOrder[0]];
  const savedDetail = `${why}\nGroups: ${JSON.stringify(sheet.custom)}\nA1: ${JSON.stringify(savedCell(sheet, 0, 0))}`;
  expect(sheet.custom?.suiteleafColumnGroups, savedDetail).toEqual([
    { id: "cols-B-M", startColumn: 1, endColumn: 12, collapsed: hiddenMonths },
  ]);
  expect(sheet.custom?.suiteleafRowGroups, savedDetail).toEqual([
    { id: "rows-3-5", startRow: 2, endRow: 4, collapsed: [2, 3, 4] },
  ]);
  expect(sheet.columnData?.[0]?.hd ?? 0, savedDetail).not.toBe(1);
  expect(sheet.columnData?.[1]?.hd ?? 0, savedDetail).not.toBe(1);
  for (let column = 2; column <= 12; column++) expect(sheet.columnData?.[column]?.hd, savedDetail).toBe(1);
  expect(sheet.columnData?.[13]?.hd ?? 0, savedDetail).not.toBe(1);
  expect(sheet.rowData?.[0]?.hd ?? 0, savedDetail).not.toBe(1);
  expect(sheet.rowData?.[1]?.hd ?? 0, savedDetail).not.toBe(1);
  for (const row of [2, 3, 4]) expect(sheet.rowData?.[row]?.hd, savedDetail).toBe(1);
  const labels = ["Category", ...months, "Year"];
  labels.forEach((name, column) => expect(savedCell(sheet, 0, column)?.v, savedDetail).toBe(name));
  expect(savedCell(sheet, 1, 0)?.v, savedDetail).toBe("Total");
  expect(savedCell(sheet, 2, 0)?.v, savedDetail).toBe("Rent");
  expect(savedCell(sheet, 3, 0)?.v, savedDetail).toBe("Food");
  expect(savedCell(sheet, 4, 0)?.v, savedDetail).toBe("Utilities");
  const amounts = [
    [1, 1800, 21600],
    [2, 1200, 14400],
    [3, 400, 4800],
    [4, 200, 2400],
  ] as const;
  for (const [row, month, year] of amounts) {
    for (let column = 1; column <= 12; column++) {
      expect(Number(savedCell(sheet, row, column)?.v), savedDetail).toBe(month);
      expect(savedCell(sheet, row, column)?.f ?? "", savedDetail).toBe("");
    }
    expect(Number(savedCell(sheet, row, 13)?.v), savedDetail).toBe(year);
    expect(savedCell(sheet, row, 13)?.f ?? "", savedDetail).toBe("");
  }
});
