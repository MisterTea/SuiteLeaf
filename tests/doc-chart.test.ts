import { describe, expect, it } from "vitest";
import {
  createFile,
  parseFile,
  serializeFile,
  type SheetFile,
} from "../packages/core/src";
import { documentPlainText } from "../apps/web/src/editors/doc-text";
import {
  applyChartUpdate,
  barWidthPercent,
  chartCaption,
  chartFromSheet,
  missingSpreadsheetText,
  noDataRowsText,
  sheetFromLibrary,
  updateChartName,
  type LinkedChartAttrs,
} from "../apps/web/src/editors/doc-chart";

type Cell = { v: string | number | boolean; t?: number; f?: string; p?: unknown };

function sheet(title: string, rows: (Cell | null)[][]): SheetFile {
  const file = createFile("sheet", title);
  if (file.kind !== "sheet") throw new Error("Expected a spreadsheet");
  const id = file.content.workbook.sheetOrder[0];
  file.content.workbook.sheets[id].cellData = Object.fromEntries(
    rows.map((row, index) => [
      index,
      Object.fromEntries(
        row.flatMap((cell, column) => (cell ? [[column, cell]] : [])),
      ),
    ]),
  );
  return file;
}

const text = (value: string, type = 1): Cell => ({ v: value, t: type });
const num = (value: number): Cell => ({ v: value, t: 2 });

const fees = () =>
  sheet("Plot fees", [
    [text("Fee"), text("Amount")],
    [text("Dues"), num(40)],
    [text("Compost"), num(15)],
  ]);

const saved: LinkedChartAttrs = {
  sourceId: "plot-fees",
  sourceTitle: "Plot fees",
  labels: ["Dues", "Compost"],
  values: [40, 15],
  missing: false,
};

describe("chart a spreadsheet from a document", () => {
  it("reads the first sheet without a chart object", () => {
    const file = fees();
    expect(file.content.charts).toEqual([]);
    expect(chartFromSheet(file)).toEqual({
      ok: true,
      labels: ["Dues", "Compost"],
      values: [40, 15],
    });
    expect(chartCaption("Plot fees")).toBe("From Plot fees");
    expect(updateChartName("Plot fees")).toBe("Update chart from Plot fees");
    expect(barWidthPercent(40, [40, 15])).toBe(100);
    expect(barWidthPercent(15, [40, 15])).toBe(37.5);
  });

  it("skips a blank leading row and does not chart the header", () => {
    const file = fees();
    const id = file.content.workbook.sheetOrder[0];
    file.content.workbook.sheets[id].cellData = {
      0: { 0: { v: "", t: 1 } },
      2: { 0: { v: "Fee", t: 1 }, 1: { v: 1, t: 2 } },
      4: { 0: { v: "Dues", t: 1 }, 1: { v: 40, t: 2 } },
      5: { 0: { v: "Compost", t: 1 }, 1: { v: 15, t: 2 } },
    };
    expect(chartFromSheet(file)).toEqual({
      ok: true,
      labels: ["Dues", "Compost"],
      values: [40, 15],
    });
  });

  it("uses only the first worksheet", () => {
    const file = fees();
    const first = file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
    const extra = crypto.randomUUID();
    file.content.workbook.sheetOrder.push(extra);
    file.content.workbook.sheets[extra] = {
      ...structuredClone(first),
      id: extra,
      name: "Other",
      cellData: {
        0: { 0: { v: "Fee", t: 1 }, 1: { v: "Amount", t: 1 } },
        1: { 0: { v: "Nope", t: 1 }, 1: { v: 99, t: 2 } },
      },
    };
    expect(chartFromSheet(file)).toEqual({
      ok: true,
      labels: ["Dues", "Compost"],
      values: [40, 15],
    });
  });

  it("skips a row with no label or no number, and keeps zero", () => {
    const file = sheet("Notes", [
      [text("Fee"), text("Amount")],
      [text("Bring cash"), null],
      [null, num(8)],
      [text("Guest"), num(0)],
      [text("Dues"), text("15")],
      [text("Compost"), num(15), num(7)],
    ]);
    expect(chartFromSheet(file)).toEqual({
      ok: true,
      labels: ["Guest", "Compost"],
      values: [0, 15],
    });
    expect(barWidthPercent(0, [0, 15])).toBe(0);
  });

  it("takes the first text cell as the label, or the first column", () => {
    const swapped = sheet("Swapped", [
      [text("Amount"), text("Fee")],
      [num(40), text("Dues")],
    ]);
    expect(chartFromSheet(swapped)).toEqual({
      ok: true,
      labels: ["Dues"],
      values: [40],
    });
    const lone = sheet("Lone", [[text("Amount")], [num(40)]]);
    expect(chartFromSheet(lone)).toEqual({
      ok: true,
      labels: ["40"],
      values: [40],
    });
  });

  it("reads a rich-text label and a calculated number", () => {
    const file = sheet("Rich", [
      [text("Fee"), text("Amount")],
      [
        { v: "", t: 1, p: { body: { dataStream: "Compost\r\n" } } },
        { v: 15, t: 2, f: "=10+5" },
      ],
    ]);
    expect(chartFromSheet(file)).toEqual({
      ok: true,
      labels: ["Compost"],
      values: [15],
    });
  });

  it("returns an error when there are no data rows and does not change the file", () => {
    const file = sheet("Empty", [[text("Fee"), text("Amount")]]);
    const snapshot = structuredClone(file);
    expect(chartFromSheet(file)).toEqual({ ok: false, error: noDataRowsText });
    expect(file).toEqual(snapshot);
    const blank = createFile("sheet", "Blank");
    if (blank.kind !== "sheet") throw new Error("Expected a spreadsheet");
    expect(chartFromSheet(blank)).toEqual({ ok: false, error: noDataRowsText });
  });

  it("keeps the last bars when the spreadsheet is missing", () => {
    const next = applyChartUpdate(saved, null);
    expect(next.attrs).toEqual({ ...saved, missing: true });
    expect(next.attrs.labels).not.toBe(saved.labels);
    expect(next.error).toBeUndefined();
  });

  it("replaces the bars when the spreadsheet is still there", () => {
    const file = fees();
    const id = file.content.workbook.sheetOrder[0];
    file.content.workbook.sheets[id].cellData = {
      0: { 0: { v: "Fee", t: 1 }, 1: { v: "Amount", t: 1 } },
      1: { 0: { v: "Dues", t: 1 }, 1: { v: 40, t: 2 } },
      2: { 0: { v: "Compost", t: 1 }, 1: { v: 25, t: 2 } },
    };
    file.title = "Plot fees renamed";
    const next = applyChartUpdate({ ...saved, missing: true }, file);
    expect(next).toEqual({
      attrs: {
        sourceId: "plot-fees",
        sourceTitle: "Plot fees renamed",
        labels: ["Dues", "Compost"],
        values: [40, 25],
        missing: false,
      },
    });
    expect(barWidthPercent(25, [40, 25])).toBe(62.5);
  });

  it("keeps the last bars when the sheet has no data rows", () => {
    const file = sheet("Plot fees", [[text("Fee"), text("Amount")]]);
    const next = applyChartUpdate(saved, file);
    expect(next.attrs).toEqual(saved);
    expect(next.error).toBe(noDataRowsText);
  });

  it("treats trash and other kinds as missing", () => {
    const file = fees();
    expect(sheetFromLibrary({ file })).toBe(file);
    expect(sheetFromLibrary({ file, trashedAt: "2026-10-14T00:00:00.000Z" })).toBeNull();
    expect(sheetFromLibrary(undefined)).toBeNull();
    const doc = createFile("doc", "October meeting");
    expect(sheetFromLibrary({ file: doc })).toBeNull();
  });

  it("round-trips the chart in the document", () => {
    const doc = createFile("doc", "October meeting");
    if (doc.kind !== "doc") throw new Error("Expected a document");
    doc.content = {
      type: "doc",
      content: [
        {
          type: "linkedChart",
          attrs: {
            sourceId: "plot-fees",
            sourceTitle: "Plot fees",
            labels: ["Dues", "Compost"],
            values: [40, 25],
            missing: true,
          },
        },
      ],
    };
    const again = parseFile(serializeFile(doc));
    expect(again.kind).toBe("doc");
    if (again.kind !== "doc") return;
    expect(again.content.content?.[0]).toEqual(doc.content.content?.[0]);
    expect(again.version).toBe(1);
    const plain = documentPlainText(again.content);
    expect(plain).toContain("Dues\t40");
    expect(plain).toContain("Compost\t25");
    expect(plain).toContain("From Plot fees");
    expect(plain).toContain(missingSpreadsheetText);
  });
});
