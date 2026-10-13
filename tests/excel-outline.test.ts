import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createFile } from "../packages/core/src";
import {
  applyWorksheetOutline,
  readWorksheetOutline,
} from "../packages/core/src/excel-outline";
import { importOffice } from "../packages/core/src/office";
import { exportXlsx } from "../packages/core/src/xlsx-export";
import {
  collapseAllColumns,
  collapsedColumns,
  expandAllColumns,
  makeColumnGroup,
  shiftColumnGroups,
  shrinkColumnGroups,
} from "../apps/web/src/editors/sheet-column-groups";
import {
  collapseAll,
  collapsedRows,
  expandAll,
  makeGroup,
  shrinkRowGroups,
} from "../apps/web/src/editors/sheet-row-groups";

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

  it("keeps a collapsed inner column group when the summary column carries the flag", () => {
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
      { id: "cols-B-F", startColumn: 1, endColumn: 5, collapsed: [] },
      { id: "cols-B-C", startColumn: 1, endColumn: 2, collapsed: [1, 2] },
    ]);
    expect(outline.rowGroups).toEqual([
      { id: "rows-2-3", startRow: 1, endRow: 2, collapsed: [1, 2] },
    ]);
    expect(outline.nested).toBe(false);
    const roundTrip = readWorksheetOutline(
      applyWorksheetOutline(`<worksheet><sheetData/></worksheet>`, {
        suiteleafColumnGroups: outline.columnGroups,
        suiteleafRowGroups: outline.rowGroups,
      }),
    );
    expect(roundTrip.columnGroups).toEqual(outline.columnGroups);
    expect(roundTrip.rowGroups[0]?.collapsed).toEqual([1, 2]);
    expect(roundTrip.nested).toBe(false);
  });

  it("keeps a level-2 week inside a level-1 month, and export writes both levels", async () => {
    const file = createFile("sheet", "Household budget");
    if (file.kind !== "sheet") throw new Error("Expected a workbook");
    const sheet = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
    const rows: [string, number][] = [
      ["October total", 420],
      ["Oct 1 groceries", 40],
      ["Oct 2 transit", 55],
      ["Oct 6 groceries", 30],
      ["Oct 7 cafe", 45],
      ["Oct 8 transit", 25],
      ["Oct 9 utilities", 80],
      ["Oct 10 rent", 145],
    ];
    sheet.cellData = Object.fromEntries(
      rows.map((row, index) => [
        index,
        {
          0: { v: row[0], t: 1 },
          1: { v: row[1], t: 2 },
        },
      ]),
    );
    const zip = await JSZip.loadAsync(await exportXlsx(file));
    const plain = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    const levels: Record<number, number> = { 2: 1, 3: 1, 4: 2, 5: 2, 6: 2, 7: 1, 8: 1 };
    const seen = new Set<number>();
    const outlined = plain.replace(
      /<row\b([^>]*?)\br="(\d+)"([^>]*?)(\/>|>)/g,
      (full, before: string, row: string, after: string, end: string) => {
        const number = Number(row);
        const level = levels[number];
        if (!level) return full;
        seen.add(number);
        return `<row${before}r="${row}"${after} outlineLevel="${level}"${end}`;
      },
    );
    for (const row of Object.keys(levels))
      if (!seen.has(Number(row))) throw new Error(`Row ${row} was not in the worksheet`);
    const outline = readWorksheetOutline(outlined);
    expect(outline.nested).toBe(false);
    expect(outline.rowGroups).toEqual([
      { id: "rows-2-8", startRow: 1, endRow: 7, collapsed: [] },
      { id: "rows-4-6", startRow: 3, endRow: 5, collapsed: [] },
    ]);
    const weekClosed = outline.rowGroups.map((group) =>
      group.id === "rows-4-6" ? collapseAll(group) : group,
    );
    expect(collapsedRows(weekClosed)).toEqual([3, 4, 5]);
    const bothClosed = weekClosed.map((group) =>
      group.id === "rows-2-8" ? collapseAll(group) : group,
    );
    expect(collapsedRows(bothClosed)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(collapsedRows(bothClosed.map((group) => (group.id === "rows-2-8" ? expandAll(group) : group)))).toEqual([
      3, 4, 5,
    ]);

    zip.file("xl/worksheets/sheet1.xml", outlined);
    const imported = await importOffice(
      await zip.generateAsync({ type: "uint8array" }),
      "xlsx",
      "Household budget.xlsx",
    );
    if (imported.file.kind !== "sheet") throw new Error("Expected a workbook");
    const opened = imported.file.content.workbook.sheets[imported.file.content.workbook.sheetOrder[0]];
    expect(opened.custom?.suiteleafRowGroups).toEqual(outline.rowGroups);
    expect(opened.rowData?.[0]?.hd).toBeUndefined();
    expect(imported.report.warnings.join("\n")).not.toMatch(/not kept separate|flattened/i);

    sheet.custom = { suiteleafRowGroups: weekClosed };
    const xml = await sheetXml(await exportXlsx(file));
    const written = rowMap(xml);
    expect(written.get(1)?.outlineLevel).toBeUndefined();
    for (const row of [2, 3, 7, 8]) {
      expect(written.get(row)?.outlineLevel).toBe("1");
      expect(written.get(row)?.hidden).toBeUndefined();
    }
    for (const row of [4, 5, 6]) {
      expect(written.get(row)?.outlineLevel).toBe("2");
      expect(written.get(row)?.hidden === "1" || written.get(row)?.hidden === "true").toBe(true);
    }
    expect(xml).toContain('outlineLevelRow="2"');
    const roundTrip = await importOffice(await exportXlsx(file), "xlsx", "Household budget.xlsx");
    if (roundTrip.file.kind !== "sheet") throw new Error("Expected a workbook");
    const again = roundTrip.file.content.workbook.sheets[roundTrip.file.content.workbook.sheetOrder[0]];
    expect(again.custom?.suiteleafRowGroups).toEqual(weekClosed);
    expect(again.rowData?.[1]?.hd).toBeUndefined();
    expect(again.rowData?.[2]?.hd).toBeUndefined();
    expect(again.rowData?.[3]?.hd).toBe(1);
    expect(again.rowData?.[5]?.hd).toBe(1);
    expect(again.rowData?.[6]?.hd).toBeUndefined();
    expect(again.rowData?.[0]?.hd).toBeUndefined();
  });

  it("writes outline level 2 only on the week that remains after deletes", async () => {
    const file = createFile("sheet", "Household budget");
    if (file.kind !== "sheet") throw new Error("Expected a workbook");
    const sheet = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
    const labels = [
      "October total",
      "Oct 1 groceries",
      "Oct 2 transit",
      "Oct 6 groceries",
      "Oct 8 transit",
      "Oct 9 utilities",
      "Oct 10 rent",
    ];
    sheet.cellData = Object.fromEntries(
      labels.map((label, index) => [index, { 0: { v: label, t: 1 } }]),
    );
    const inside = shrinkRowGroups([makeGroup(1, 7), makeGroup(3, 5)], 4);
    const closed = inside.map((group) =>
      group.startRow === 3 ? collapseAll(group) : group,
    );
    sheet.custom = { suiteleafRowGroups: shrinkRowGroups(closed, 1) };
    const written = rowMap(await sheetXml(await exportXlsx(file)));
    expect(written.get(1)?.outlineLevel).toBeUndefined();
    for (const row of [2, 5, 6]) {
      expect(written.get(row)?.outlineLevel).toBe("1");
      expect(written.get(row)?.hidden).toBeUndefined();
    }
    for (const row of [3, 4]) {
      expect(written.get(row)?.outlineLevel).toBe("2");
      expect(written.get(row)?.hidden === "1" || written.get(row)?.hidden === "true").toBe(true);
    }
    for (const row of [7, 8]) expect(written.get(row)?.outlineLevel).toBeUndefined();
  });

  it("keeps a level-2 week of columns inside a level-1 quarter", async () => {
    const file = createFile("sheet", "Quarterly budget");
    if (file.kind !== "sheet") throw new Error("Expected a workbook");
    const sheet = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
    const headers = ["Category", "Oct 1", "Oct 2", "Oct 6", "Oct 7", "Oct 8", "Oct 9", "Oct 10"];
    const body = [
      ["Rent", 120, 120, 40, 40, 40, 80, 145],
      ["Food", 30, 25, 18, 22, 15, 35, 20],
    ];
    sheet.cellData = {
      0: Object.fromEntries(headers.map((name, column) => [column, { v: name, t: 1 }])),
      ...Object.fromEntries(
        body.map((row, index) => [
          index + 1,
          Object.fromEntries(row.map((value, column) => [column, { v: value, t: column === 0 ? 1 : 2 }])),
        ]),
      ),
    };
    sheet.columnData = Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 7].map((column) => [column, { w: 120 }]));
    const zip = await JSZip.loadAsync(await exportXlsx(file));
    const plain = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    const levels: Record<number, number> = { 2: 1, 3: 1, 4: 2, 5: 2, 6: 2, 7: 1, 8: 1 };
    const seen = new Set<number>();
    const outlined = plain.replace(/<col\b([^>]*?)(\/>|>)/g, (full, body: string, end: string) => {
      const min = Number(/\bmin="(\d+)"/.exec(body)?.[1]);
      const max = Number(/\bmax="(\d+)"/.exec(body)?.[1] ?? min);
      if (!Number.isInteger(min) || max !== min) return full;
      const level = levels[min];
      if (!level) return full;
      seen.add(min);
      return `<col${body} outlineLevel="${level}"${end}`;
    });
    for (const column of Object.keys(levels))
      if (!seen.has(Number(column))) throw new Error(`Column ${column} was not in the worksheet`);
    const outline = readWorksheetOutline(outlined);
    expect(outline.nested).toBe(false);
    expect(outline.columnGroups).toEqual([
      { id: "cols-B-H", startColumn: 1, endColumn: 7, collapsed: [] },
      { id: "cols-D-F", startColumn: 3, endColumn: 5, collapsed: [] },
    ]);
    expect(outline.columnGroups.every((group) => group.startColumn >= 1)).toBe(true);
    const weekClosed = outline.columnGroups.map((group) =>
      group.id === "cols-D-F" ? collapseAllColumns(group) : group,
    );
    expect(collapsedColumns(weekClosed)).toEqual([3, 4, 5]);
    const bothClosed = weekClosed.map((group) =>
      group.id === "cols-B-H" ? collapseAllColumns(group) : group,
    );
    expect(collapsedColumns(bothClosed)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(
      collapsedColumns(bothClosed.map((group) => (group.id === "cols-B-H" ? expandAllColumns(group) : group))),
    ).toEqual([3, 4, 5]);

    zip.file("xl/worksheets/sheet1.xml", outlined);
    const imported = await importOffice(
      await zip.generateAsync({ type: "uint8array" }),
      "xlsx",
      "Quarterly budget.xlsx",
    );
    if (imported.file.kind !== "sheet") throw new Error("Expected a workbook");
    const opened = imported.file.content.workbook.sheets[imported.file.content.workbook.sheetOrder[0]];
    expect(opened.custom?.suiteleafColumnGroups).toEqual(outline.columnGroups);
    expect(opened.columnData?.[0]?.hd).toBeUndefined();
    expect(imported.report.warnings.join("\n")).not.toMatch(/not kept separate|flattened/i);

    sheet.custom = { suiteleafColumnGroups: weekClosed };
    const xml = await sheetXml(await exportXlsx(file));
    const written = colMap(xml);
    expect(written.get(1)?.outlineLevel).toBeUndefined();
    for (const column of [2, 3, 7, 8]) {
      expect(written.get(column)?.outlineLevel).toBe("1");
      expect(written.get(column)?.hidden).toBeUndefined();
    }
    for (const column of [4, 5, 6]) {
      expect(written.get(column)?.outlineLevel).toBe("2");
      expect(written.get(column)?.hidden === "1" || written.get(column)?.hidden === "true").toBe(true);
    }
    expect(xml).toContain('outlineLevelCol="2"');
    const roundTrip = await importOffice(await exportXlsx(file), "xlsx", "Quarterly budget.xlsx");
    if (roundTrip.file.kind !== "sheet") throw new Error("Expected a workbook");
    const again = roundTrip.file.content.workbook.sheets[roundTrip.file.content.workbook.sheetOrder[0]];
    expect(again.custom?.suiteleafColumnGroups).toEqual(weekClosed);
    expect(again.columnData?.[0]?.hd).toBeUndefined();
    expect(again.columnData?.[1]?.hd).toBeUndefined();
    expect(again.columnData?.[3]?.hd).toBe(1);
    expect(again.columnData?.[5]?.hd).toBe(1);
    expect(again.columnData?.[6]?.hd).toBeUndefined();
  });

  it("writes outline level 2 only on the week columns that remain after deletes", async () => {
    const file = createFile("sheet", "Quarterly budget");
    if (file.kind !== "sheet") throw new Error("Expected a workbook");
    const sheet = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
    const headers = ["Category", "Oct 2", "Oct 6", "Oct 8", "Oct 9", "Oct 10"];
    sheet.cellData = {
      0: Object.fromEntries(headers.map((name, column) => [column, { v: name, t: 1 }])),
    };
    const inside = shrinkColumnGroups([makeColumnGroup(1, 7), makeColumnGroup(3, 5)], 4);
    const closed = inside.map((group) =>
      group.startColumn === 3 ? collapseAllColumns(group) : group,
    );
    sheet.custom = { suiteleafColumnGroups: shrinkColumnGroups(closed, 1) };
    const written = colMap(await sheetXml(await exportXlsx(file)));
    expect(written.get(1)?.outlineLevel).toBeUndefined();
    expect(written.get(2)?.outlineLevel).toBe("1");
    expect(written.get(2)?.hidden).toBeUndefined();
    for (const column of [3, 4]) {
      expect(written.get(column)?.outlineLevel).toBe("2");
      expect(written.get(column)?.hidden === "1" || written.get(column)?.hidden === "true").toBe(true);
    }
    for (const column of [5, 6]) {
      expect(written.get(column)?.outlineLevel).toBe("1");
      expect(written.get(column)?.hidden).toBeUndefined();
    }
    expect(written.get(7)?.outlineLevel).toBeUndefined();
  });

  it("writes outline level 2 on a week that grew around an inserted column", async () => {
    const file = createFile("sheet", "Quarterly budget");
    if (file.kind !== "sheet") throw new Error("Expected a workbook");
    const sheet = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
    const headers = ["Category", "Oct 1", "Oct 2", "Oct 6", "Oct 7", "Oct 8", "Oct 9", "Oct 10"];
    sheet.cellData = {
      0: Object.fromEntries(headers.map((name, column) => [column, { v: name, t: 1 }])),
    };
    const grown = shiftColumnGroups([makeColumnGroup(1, 7), makeColumnGroup(3, 5)], 4);
    const closed = grown.map((group) =>
      group.startColumn === 3 ? collapseAllColumns(group) : group,
    );
    sheet.custom = { suiteleafColumnGroups: shiftColumnGroups(closed, 1) };
    const written = colMap(await sheetXml(await exportXlsx(file)));
    expect(written.get(1)?.outlineLevel).toBeUndefined();
    expect(written.get(2)?.outlineLevel).toBeUndefined();
    for (const column of [3, 4, 9, 10]) {
      expect(written.get(column)?.outlineLevel).toBe("1");
      expect(written.get(column)?.hidden).toBeUndefined();
    }
    for (const column of [5, 6, 7, 8]) {
      expect(written.get(column)?.outlineLevel).toBe("2");
      expect(written.get(column)?.hidden === "1" || written.get(column)?.hidden === "true").toBe(true);
    }
  });
});
