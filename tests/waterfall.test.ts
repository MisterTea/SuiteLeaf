import { describe, expect, it } from "vitest";
import { createFile, parseFile, serializeFile, type SheetFile } from "../packages/core/src";
import {
  excelChartElement,
  waterfallBarLabel,
  waterfallRows,
  waterfallSkipText,
  waterfallSteps,
} from "../packages/core/src/waterfall";

describe("waterfall chart", () => {
  it("adds the changes and names a total that does not match", () => {
    const rows = [
      { label: "Dues", change: 40 },
      { label: "Compost", change: -15 },
      { label: "Paths", change: 10 },
      { label: "Total", change: 99 },
    ];
    const before = JSON.stringify(rows);
    const result = waterfallSteps(rows);
    expect(JSON.stringify(rows)).toBe(before);
    expect(result.total).toBe(35);
    expect(result.mismatch).toBe("The stated total is 99. The changes add to 35.");
    expect(result.steps.map((step) => [step.label, step.kind, step.start, step.end])).toEqual([
      ["Dues", "rise", 0, 40],
      ["Compost", "fall", 40, 25],
      ["Paths", "rise", 25, 35],
      ["Total", "total", 0, 35],
    ]);
    expect(result.steps.map(waterfallBarLabel)).toEqual(["40", "-15", "10", "35"]);
    expect(waterfallBarLabel({ change: Number.NaN })).toBe("0");
    expect(waterfallBarLabel({ change: 4 })).not.toContain("secret-value");
    expect(excelChartElement("waterfall")).toBe("barChart");
    expect(excelChartElement("line")).toBe("lineChart");

    const file = createFile("sheet", "Beds") as SheetFile;
    const sheetId = file.content.workbook.sheetOrder[0];
    file.content.charts = [
      {
        id: "fees",
        title: "Plot fees",
        type: "waterfall",
        source: { sheetId, startRow: 0, endRow: 3, startColumn: 0, endColumn: 1 },
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
    expect(again.content.charts[0]?.type).toBe("waterfall");
  });

  it("leaves a text change out instead of adding zero", () => {
    const rows = [
      { label: "Dues", change: 40 },
      { label: "Compost", change: "secret-value" },
      { label: "Paths", change: 10 },
    ];
    const prepared = waterfallRows(rows);
    expect(prepared.skipped).toBe(1);
    expect(prepared.rows).toEqual([
      { label: "Dues", change: 40 },
      { label: "Paths", change: 10 },
    ]);
    expect(waterfallSkipText(prepared.skipped)).toBe("1 change was not a number.");
    expect(waterfallSteps(prepared.rows).total).toBe(50);
    expect(JSON.stringify(prepared)).not.toContain("secret-value");
    expect(rows[1].change).toBe("secret-value");
  });
});
