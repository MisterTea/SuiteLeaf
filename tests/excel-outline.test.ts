import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createFile } from "../packages/core/src";
import {
  applyWorksheetOutline,
  readWorksheetOutline,
} from "../packages/core/src/excel-outline";
import { importOffice } from "../packages/core/src/office";
import { exportXlsx } from "../packages/core/src/xlsx-export";

const months = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function rentBudget() {
  const file = createFile("sheet", "Rent budget");
  if (file.kind !== "sheet") throw new Error("Expected a workbook");
  const sheet = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
  sheet.name = "2026";
  const header = ["Category", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December", "Year"];
  const rows = [
    ["Total", 3600, 3300, 3400, 3200, 3500, 3300, 3600, 3100, 3700, 3400, 3500, 3800, 41400],
    ["Rent", 1200, 1200, 1200, 1200, 1200, 1200, 1200, 1200, 1200, 1200, 1200, 1200, 14400],
    ["Food", 400, 410, 420, 430, 440, 450, 460, 470, 480, 490, 500, 510, 5460],
    ["Utilities", 200, 180, 190, 170, 210, 160, 220, 150, 230, 200, 190, 240, 2540],
  ];
  sheet.cellData = {
    0: Object.fromEntries(header.map((name, column) => [column, { v: name, t: 1 }])),
    ...Object.fromEntries(
      rows.map((row, index) => [
        index + 1,
        Object.fromEntries(row.map((value, column) => [column, { v: value, t: column === 0 ? 1 : 2 }])),
      ]),
    ),
  };
  const columnData: Record<number, { w: number; hd?: number }> = {
    0: { w: 148 },
    1: { w: 104 },
    13: { w: 120 },
  };
  for (const column of months) columnData[column] = { w: 104, hd: 1 };
  sheet.columnData = columnData;
  sheet.rowData = { 2: { hd: 1 }, 3: { hd: 1 }, 4: { hd: 1 } };
  sheet.custom = {
    suiteleafColumnGroups: [
      {
        id: "cols-B-M",
        startColumn: 1,
        endColumn: 12,
        collapsed: months,
      },
    ],
    suiteleafRowGroups: [
      { id: "rows-3-5", startRow: 2, endRow: 4, collapsed: [2, 3, 4] },
    ],
  };
  return file;
}

async function sheetXml(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  return zip.file("xl/worksheets/sheet1.xml")!.async("string");
}

function colMap(xml: string) {
  const columns = new Map<number, Record<string, string>>();
  const block = xml.match(/<cols\b[^>]*>[\s\S]*?<\/cols>/)?.[0] ?? "";
  for (const tag of block.matchAll(/<col\b([^>]*?)(?:\/>|>)/g)) {
    const attributes = Object.fromEntries(
      [...tag[1]!.matchAll(/([\w:.-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]),
    );
    for (let column = Number(attributes.min); column <= Number(attributes.max); column++)
      columns.set(column, attributes);
  }
  return columns;
}

function rowMap(xml: string) {
  const rows = new Map<number, Record<string, string>>();
  for (const tag of xml.matchAll(/<row\b([^>]*?)(?:\/>|>)/g)) {
    const attributes = Object.fromEntries(
      [...tag[1]!.matchAll(/([\w:.-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]),
    );
    rows.set(Number(attributes.r), attributes);
  }
  return rows;
}

describe("Excel outline export and import", () => {
  it("writes SuiteLeaf groups as outline levels and keeps a partial collapse", async () => {
    const xml = await sheetXml(await exportXlsx(rentBudget()));
    expect(xml).not.toContain("suiteleafColumnGroups");
    expect(xml).toContain('summaryBelow="0"');
    expect(xml).toContain('summaryRight="0"');
    expect(xml).toContain('outlineLevelRow="1"');
    expect(xml).toContain('outlineLevelCol="1"');
    const columns = colMap(xml);
    expect(columns.get(1)?.outlineLevel).toBeUndefined();
    expect(columns.get(2)?.outlineLevel).toBe("1");
    expect(columns.get(2)?.hidden).toBeUndefined();
    for (let column = 3; column <= 13; column++) {
      expect(columns.get(column)?.outlineLevel).toBe("1");
      expect(columns.get(column)?.hidden === "1" || columns.get(column)?.hidden === "true").toBe(true);
    }
    expect(columns.get(14)?.outlineLevel).toBeUndefined();
    expect(columns.get(1)?.collapsed).toBeUndefined();
    const rows = rowMap(xml);
    expect(rows.get(2)?.collapsed === "1" || rows.get(2)?.collapsed === "true").toBe(true);
    expect(rows.get(2)?.outlineLevel).toBeUndefined();
    for (const row of [3, 4, 5]) {
      expect(rows.get(row)?.outlineLevel).toBe("1");
      expect(rows.get(row)?.hidden === "1" || rows.get(row)?.hidden === "true").toBe(true);
    }
    expect(columns.get(2)?.width ?? columns.get(2)?.wpx).toBeTruthy();
  });

  it("restores both groups, including which rows and columns stay hidden", async () => {
    const imported = await importOffice(await exportXlsx(rentBudget()), "xlsx", "Rent budget.xlsx");
    if (imported.file.kind !== "sheet") throw new Error("Expected a workbook");
    const sheet = imported.file.content.workbook.sheets[imported.file.content.workbook.sheetOrder[0]];
    expect(sheet.custom?.suiteleafColumnGroups).toEqual([
      { id: "cols-B-M", startColumn: 1, endColumn: 12, collapsed: months },
    ]);
    expect(sheet.custom?.suiteleafRowGroups).toEqual([
      { id: "rows-3-5", startRow: 2, endRow: 4, collapsed: [2, 3, 4] },
    ]);
    expect(sheet.columnData?.[1]?.hd).toBeUndefined();
    expect(sheet.columnData?.[2]?.hd).toBe(1);
    expect(sheet.columnData?.[12]?.hd).toBe(1);
    expect(sheet.rowData?.[1]?.hd).toBeUndefined();
    expect(sheet.rowData?.[2]?.hd).toBe(1);
    expect(sheet.rowData?.[4]?.hd).toBe(1);
    expect(imported.report.warnings.join("\n")).not.toMatch(/nested/i);
  });

  it("downloads a sheet with no groups without outline levels", async () => {
    const file = createFile("sheet", "Grocery list");
    if (file.kind !== "sheet") throw new Error("Expected a workbook");
    const sheet = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
    sheet.cellData = { 0: { 0: { v: "Milk", t: 1 } } };
    sheet.columnData = { 2: { hd: 1, w: 80 } };
    const xml = await sheetXml(await exportXlsx(file));
    expect(xml).not.toContain("outlineLevel");
    expect(xml).not.toContain("outlinePr");
    expect(xml).not.toContain("collapsed=");
    const imported = await importOffice(
      await exportXlsx(file),
      "xlsx",
      "Grocery list.xlsx",
    );
    if (imported.file.kind !== "sheet") throw new Error("Expected a workbook");
    const next = imported.file.content.workbook.sheets[imported.file.content.workbook.sheetOrder[0]];
    expect(next.custom?.suiteleafColumnGroups).toBeUndefined();
    expect(next.custom?.suiteleafRowGroups).toBeUndefined();
    expect(next.columnData?.[2]?.hd).toBe(1);
  });

  it("reads an Excel outline that puts the summary after the detail", async () => {
    const file = createFile("sheet", "Quarter");
    if (file.kind !== "sheet") throw new Error("Expected a workbook");
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
          Object.fromEntries(row.map((value, column) => [column, { v: value, t: column === 0 ? 1 : 2 }])),
        ]),
      ),
    };
    for (const column of [0, 1, 2, 3, 4])
      (sheet.columnData ??= {})[column] = { w: 110 };
    let xml = await sheetXml(await exportXlsx(file));
    xml = xml.replace(
      /<col\b([^>]*?)\bmin="([2-4])"([^>]*?)(\/>|>)/g,
      `<col$1min="$2"$3 outlineLevel="1"$4`,
    );
    xml = xml.replace(/<row\b([^>]*?)\br="([345])"([^>]*?)(\/>|>)/g, `<row$1r="$2"$3 outlineLevel="1"$4`);
    xml = xml.replace(
      /<sheetFormatPr\b([^>]*)\/>/,
      `<sheetFormatPr$1 outlineLevelRow="1" outlineLevelCol="1"/>`,
    );
    const outline = readWorksheetOutline(xml);
    expect(outline.nested).toBe(false);
    expect(outline.columnGroups).toEqual([
      { id: "cols-B-D", startColumn: 1, endColumn: 3, collapsed: [] },
    ]);
    expect(outline.rowGroups).toEqual([
      { id: "rows-3-5", startRow: 2, endRow: 4, collapsed: [] },
    ]);
    const zip = await JSZip.loadAsync(await exportXlsx(file));
    zip.file("xl/worksheets/sheet1.xml", xml);
    const imported = await importOffice(
      await zip.generateAsync({ type: "uint8array" }),
      "xlsx",
      "Quarter.xlsx",
    );
    if (imported.file.kind !== "sheet") throw new Error("Expected a workbook");
    const next = imported.file.content.workbook.sheets[imported.file.content.workbook.sheetOrder[0]];
    expect(next.custom?.suiteleafColumnGroups).toEqual(outline.columnGroups);
    expect(next.custom?.suiteleafRowGroups).toEqual(outline.rowGroups);
    expect(next.columnData?.[1]?.hd).toBeUndefined();
    expect(next.rowData?.[2]?.hd).toBeUndefined();
  });

  it("collapses a whole Excel group from the summary flag and flattens a second level", () => {
    const expanded = `<worksheet><sheetFormatPr outlineLevelCol="2" outlineLevelRow="1"/>
      <cols>
        <col min="2" max="3" outlineLevel="2" hidden="1"/>
        <col min="4" max="4" outlineLevel="1" collapsed="1"/>
        <col min="5" max="6" outlineLevel="1"/>
      </cols>
      <sheetData>
        <row r="2" outlineLevel="1" hidden="1"/>
        <row r="3" outlineLevel="1" hidden="1"/>
        <row r="4" collapsed="1"/>
      </sheetData></worksheet>`;
    const outline = readWorksheetOutline(expanded);
    expect(outline.columnGroups).toEqual([
      { id: "cols-B-F", startColumn: 1, endColumn: 5, collapsed: [1, 2] },
    ]);
    expect(outline.rowGroups).toEqual([
      { id: "rows-2-3", startRow: 1, endRow: 2, collapsed: [1, 2] },
    ]);
    expect(outline.nested).toBe(true);
    const roundTrip = readWorksheetOutline(
      applyWorksheetOutline(`<worksheet><sheetData/></worksheet>`, {
        suiteleafColumnGroups: outline.columnGroups,
        suiteleafRowGroups: outline.rowGroups,
      }),
    );
    expect(roundTrip.columnGroups[0]?.collapsed).toEqual([1, 2]);
    expect(roundTrip.rowGroups[0]?.collapsed).toEqual([1, 2]);
    expect(roundTrip.nested).toBe(false);
  });
});
