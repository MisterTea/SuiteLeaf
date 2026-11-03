import { describe, expect, it } from "vitest";
import { createFile, parseFile, serializeFile, type SheetFile } from "../packages/core/src";
import { histogramBins, histogramColumn, histogramSkipText } from "../packages/core/src/histogram";
import { excelChartElement } from "../packages/core/src/waterfall";

describe("histogram chart", () => {
  it("counts two equal bins and keeps the chart type", () => {
    const values = [1, 2, 3, 8, 9, 10, Number.NaN];
    const before = JSON.stringify(values);
    const result = histogramBins(values, 2);
    expect(JSON.stringify(values)).toBe(before);
    expect(result.skipped).toBe(1);
    expect(result.bins).toHaveLength(2);
    expect(result.bins[0]).toMatchObject({ count: 3, low: 1 });
    expect(result.bins[1]).toMatchObject({ count: 3, high: 10 });
    expect(result.bins[0].label).toBe("1–5.5");
    expect(result.bins[1].label).toBe("5.5–10");
    expect(histogramBins([4, 4], 4).bins).toEqual([
      { label: "4", count: 2, low: 4, high: 4 },
    ]);
    expect(excelChartElement("histogram")).toBe("barChart");

    const file = createFile("sheet", "Beds") as SheetFile;
    const sheetId = file.content.workbook.sheetOrder[0];
    file.content.charts = [
      {
        id: "fees",
        title: "Plot fees",
        type: "histogram",
        source: { sheetId, startRow: 0, endRow: 6, startColumn: 0, endColumn: 1 },
        sheetId,
        x: 10,
        y: 10,
        width: 400,
        height: 300,
      },
    ];
    const again = parseFile(serializeFile(file));
    expect(again.kind).toBe("sheet");
    if (again.kind !== "sheet") return;
    expect(again.content.charts[0]?.type).toBe("histogram");
  });

  it("counts a text cell as skipped and does not copy it", () => {
    const cells = [10, "secret-value", 20, "", null, "10", " 4 "];
    const column = histogramColumn(cells);
    expect(column).toEqual({ values: [10, 20, 10, 4], skipped: 1 });
    expect(histogramSkipText(column.skipped)).toBe("1 value was not a number.");
    expect(histogramSkipText(2)).toBe("2 values were not a number.");
    expect(JSON.stringify(column)).not.toContain("secret-value");
    expect(cells[1]).toBe("secret-value");
  });
});
