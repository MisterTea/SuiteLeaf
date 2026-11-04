// @vitest-environment jsdom
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../apps/web/src/ai/tools/sheet-cells", async (original) => ({
  ...(await original<typeof import("../apps/web/src/ai/tools/sheet-cells")>()),
  wait: () => Promise.resolve(),
}));
vi.mock("../apps/web/src/ai/cursor", () => ({ moveCursor: async () => {} }));

import type { ChartDefinition, PivotDefinition } from "@suiteleaf/core";
import { FRange, FWorksheet } from "@univerjs/sheets/facade";
import { startRequest } from "../apps/web/src/ai/guard";
import { sheetToolKit } from "../apps/web/src/ai/tools/sheet-tool-kit";
import { chartCells, sheetChartTools } from "../apps/web/src/ai/tools/sheet-chart-tools";
import { makeHarness, runTool, type Harness } from "./ai-sheet-harness";

// The rendered grid: columns 100px wide and rows 20px tall, after a 46×20px header.
const rangeProto = FRange.prototype as unknown as Record<string, unknown>;
const sheetProto = FWorksheet.prototype as unknown as Record<string, unknown>;
beforeAll(() => {
  rangeProto.getCellRect = function (this: FRange) {
    const r = this.getRange();
    const data = { left: 46 + r.startColumn * 100, top: 20 + r.startRow * 20, right: 146 + r.startColumn * 100, bottom: 40 + r.startRow * 20 };
    return { ...data, toJSON: () => JSON.stringify(data) };
  };
  sheetProto.removeFloatDom = vi.fn();
});
afterAll(() => {
  delete rangeProto.getCellRect;
  delete sheetProto.removeFloatDom;
});

const budget = () =>
  makeHarness([
    {
      name: "Sheet1",
      rows: [
        ["Team", "Budget", "Actual", "Paid by"],
        ["Design", 100, 90, "Ana"],
        ["Build", 200, 260, "Bo"],
        ["Test", 50, 40, "Ana"],
        ["Total", "=SUM(B2:B4)", "=SUM(C2:C4)", null],
      ],
    },
  ]);

let h: Harness;
const run = (name: string, args: Record<string, unknown> = {}) => runTool(sheetChartTools(h.ctx, sheetToolKit(h.ctx)), name, args);

/** Insert chart's panel adds a chart for what it was given; Update changes it. */
function chartPanel() {
  let editing: string | undefined;
  let values: Record<string, unknown> = {};
  vi.mocked(h.ctx.openPanel).mockImplementation((_type, v, id) => {
    values = v as never;
    editing = id;
  });
  vi.mocked(h.ctx.submitPanel).mockImplementation(async () => {
    const r = h.sheet().getRange(String(values.range)).getRange();
    const source = { sheetId: "s1", startRow: r.startRow, endRow: r.endRow, startColumn: r.startColumn, endColumn: r.endColumn };
    const found = h.content.charts.find((c) => c.id === editing);
    if (found) Object.assign(found, { source, title: values.title, type: values.chartType });
    else
      h.content.charts.push({
        id: `c${h.content.charts.length + 1}`,
        title: String(values.title || "Chart"),
        type: values.chartType as ChartDefinition["type"],
        source,
        sheetId: "s1",
        x: 46,
        y: 140,
        width: 480,
        height: 300,
      });
  });
}

beforeEach(() => {
  startRequest("");
  h = budget();
  chartPanel();
});

describe("insert_chart", () => {
  it("fills in the panel, creates the chart and says what it plots and where it sits", async () => {
    const text = await run("insert_chart", { range: "A1:C4", type: "line", title: "Spend" });
    expect(h.ctx.openPanel).toHaveBeenCalledWith("chart", { range: "A1:C4", sheetId: "s1", title: "Spend", chartType: "line" });
    expect(text).toBe(
      'Inserted a line chart "Spend" from A1:C4 (480×300px), below the table: it covers A7:E21. The table is A1:D5. It shows Budget, Actual (from the header row) for Design, Build, Test (from column A). If that is more than the user asked for, narrow the range with edit_chart.',
    );
  });

  it("starts the range at the header row and points out a total row", async () => {
    await h.ctx.settle();
    const text = await run("insert_chart", { range: "A2:C5" });
    expect(h.content.charts[0]).toMatchObject({ type: "bar", source: { startRow: 0, endRow: 4 } });
    expect(text).toContain("A2:C5 starts below the header row, so the chart uses A1:C5 and takes its series names from row 1.");
    expect(text).toContain("Row 5 (Total) adds up the rows above, so it dwarfs the others; charts usually leave totals out.");
  });

  it("refuses a range with no header row, and says when no chart appeared", async () => {
    h.sheet().getRange("A1:C1").setValues([["x", 1, 2]]);
    await expect(run("insert_chart", { range: "A1:C3" })).rejects.toThrow(
      "The first row of A1:C3 holds numbers (x, 1, 2), so the chart would have no series names. Include the header row.",
    );
    vi.mocked(h.ctx.submitPanel).mockResolvedValue();
    await expect(run("insert_chart", { range: "B2:C3" })).rejects.toThrow("The first row of B2:C3 holds numbers (100, 90)");
    await expect(run("insert_chart", { range: "A2:A3" })).rejects.toThrow("The chart was not created.");
  });

  it("names the cells a chart covers, or its position when the grid has none", () => {
    const chart = { x: 0, y: 0, width: 100, height: 40, excel: { series: [] } } as unknown as ChartDefinition;
    expect(chartCells(h.sheet(), chart)).toBe("A1:A2");
    expect(chartCells({ getRange: () => ({}) }, chart)).toBe("x=0, y=0");
  });
});

describe("edit_chart", () => {
  it("needs a chart on the sheet", async () => {
    await expect(run("edit_chart", { title: "x" })).rejects.toThrow("There is no chart on this sheet yet.");
  });

  it("moves and resizes the chart without reopening the panel", async () => {
    await run("insert_chart", { range: "A1:C4", title: "Spend" });
    vi.mocked(h.ctx.openPanel).mockClear();
    const text = await run("edit_chart", { chart: "spe", move_to: "F1", width: 100, height: 400 });
    expect(text).toBe(
      'Chart "Spend": moved to F1, resized to 200×400 (from 480×300, so smaller). It is 200×400px and covers F1:G20; the table is A1:D5.',
    );
    expect(h.content.charts[0]).toMatchObject({ x: 546, y: 20 });
    expect(h.ctx.openPanel).not.toHaveBeenCalled();
    expect(h.ctx.refreshCharts).toHaveBeenCalled();
    expect(await run("edit_chart", { width: 200 })).toContain("so the same size");
    expect(await run("edit_chart", { height: 900 })).toContain("so larger");
  });

  it("places an Excel chart from A1 rather than the canvas corner", async () => {
    await run("insert_chart", { range: "A1:C4" });
    h.content.charts[0].excel = { series: [], legend: "r", markers: false, anchor: {} as never };
    await run("edit_chart", { move_to: "B3" });
    expect(h.content.charts[0]).toMatchObject({ x: 100, y: 40 });
  });

  it("reopens the panel to change range, type or title", async () => {
    await run("insert_chart", { range: "A1:C4", title: "Spend" });
    const text = await run("edit_chart", { range: "A1:B4", type: "pie", title: "Budget only" });
    expect(h.ctx.openPanel).toHaveBeenLastCalledWith("chart", { range: "A1:B4", sheetId: "s1", title: "Budget only", chartType: "pie" }, "c1");
    expect(text).toContain('Chart "Budget only": updated its settings.');
    expect(text).toContain("It shows Budget (from the header row)");
    expect(await run("edit_chart", { type: "pie" })).toContain(": no change.");
    await run("edit_chart", { type: "column" });
    expect(h.content.charts[0].type).toBe("bar");
  });

  it("checks a new position before changing anything", async () => {
    await run("insert_chart", { range: "A1:C4" });
    await expect(run("edit_chart", { move_to: "top left", width: 300 })).rejects.toThrow('"top left" is not a cell address like B2.');
    expect(h.content.charts[0].width).toBe(480);
  });
});

describe("pivot tables", () => {
  const pivot = (over: Partial<PivotDefinition> = {}): PivotDefinition => ({
    id: "p1",
    title: "By payer",
    source: { sheetId: "s1", startRow: 0, endRow: 3, startColumn: 0, endColumn: 3 },
    targetSheetId: "p1-sheet",
    rows: [3],
    columns: [],
    value: 1,
    aggregate: "SUM",
    ...over,
  });

  function pivotPanel() {
    let values: Record<string, unknown> = {};
    vi.mocked(h.ctx.openPanel).mockImplementation((_type, v) => {
      values = v as never;
    });
    vi.mocked(h.ctx.submitPanel).mockImplementation(async () => {
      const target = h.book.create("Pivot", 20, 5);
      target.getRange("A1:B3").setValues([["Paid by", "Budget"], ["Ana", 150], ["Bo", 200]]);
      h.content.pivots.push(pivot({ id: "p-new", title: String(values.title), targetSheetId: target.getSheetId() }));
    });
  }

  it("summarizes a table on a new sheet, with the fields the user named", async () => {
    pivotPanel();
    await h.ctx.settle();
    const text = await run("create_pivot", { range: "A1:D4", rows: ["Paid by"], value: "Budget", summarize: "SUM", filter_column: "Team", filter_value: " design " });
    expect(h.ctx.openPanel).toHaveBeenCalledWith("pivot", {
      range: "A1:D4",
      sheetId: "s1",
      title: "Pivot table",
      rows: [3],
      columns: [],
      value: 1,
      aggregate: "SUM",
      filterColumn: 0,
      filterValue: "Design",
    });
    expect(text).toContain('Created pivot table "Pivot table" on sheet "Pivot" (read-only; it follows the source):');
    expect(text).toContain("3\tBo\t200");
    expect(text).toContain('Numbers are shown as plain numbers, like the source cells B2:B4 on sheet "Sheet1".');
  });

  it("formats the source numbers when a number format is asked for", async () => {
    pivotPanel();
    const text = await run("create_pivot", { rows: ["Team"], columns: ["Paid by"], value: "Actual", summarize: "AVERAGE", number_format: "currency", title: "Spend" });
    expect(h.book.getSheetByName("Sheet1")!.getRange("C2").getDisplayValue()).toBe("$90.00");
    expect(text).toContain('Numbers are shown as currency ("$"#,##0.00): the source cells C2:C5 on sheet "Sheet1" were formatted that way');
  });

  it("keeps the source's own number format and ignores a filter column without a value", async () => {
    pivotPanel();
    h.sheet().getRange("B2:B5").setNumberFormat("0.0");
    const text = await run("create_pivot", { rows: ["Team"], value: "Budget", summarize: "MAX", filter_column: "Team", filter_value: " " });
    expect(vi.mocked(h.ctx.openPanel).mock.calls[0][1]).toMatchObject({ filterColumn: -1, filterValue: " " });
    expect(text).toContain("Numbers are shown in the source's number format (0.0).");
  });

  it("explains a filter value no row has, an unknown format, and a pivot that did not appear", async () => {
    await expect(run("create_pivot", { rows: ["Team"], value: "Budget", summarize: "SUM", filter_column: "Team", filter_value: "Ops" })).rejects.toThrow(
      'No row has Team equal to "Ops"; its values are Design, Build, Test, Total.',
    );
    await expect(run("create_pivot", { rows: ["Team"], value: "Budget", summarize: "SUM", number_format: "fancy" })).rejects.toThrow(
      "Unknown number format fancy.",
    );
    await expect(run("create_pivot", { rows: ["Team"], value: "Budget", summarize: "SUM" })).rejects.toThrow("The pivot table was not created.");
  });

  it("copies the pivot on the active sheet, the one named, or the only one", async () => {
    await expect(run("copy_pivot")).rejects.toThrow("There is no pivot table in this workbook.");
    h.content.pivots.push(pivot(), pivot({ id: "p2", title: "By team", targetSheetId: "s1" }));
    vi.mocked(h.ctx.copyPivot).mockImplementation((p) => {
      const copy = h.book.create(`${p.title} copy`, 20, 5);
      copy.getRange("A1").setValue(p.title);
      h.book.setActiveSheet(copy.getSheetId());
    });
    expect(await run("copy_pivot", { pivot: " by payer " })).toContain('Made an editable copy of "By payer" on the new sheet "By payer copy", now the active sheet:');
    h.book.setActiveSheet("s1");
    await run("copy_pivot");
    expect(vi.mocked(h.ctx.copyPivot).mock.calls[1][0].title).toBe("By team");
    h.content.pivots.splice(1, 1);
    await run("copy_pivot", { pivot: "missing" });
    expect(vi.mocked(h.ctx.copyPivot).mock.calls[2][0].title).toBe("By payer");
    h.content.pivots.push(pivot({ id: "p3", title: "Other", targetSheetId: "elsewhere" }));
    await expect(run("copy_pivot")).rejects.toThrow('Say which pivot table to copy: "By payer", "Other".');
  });
});
