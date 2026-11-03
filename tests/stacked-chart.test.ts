import { describe, expect, it } from "vitest";
import { createFile, parseFile, serializeFile, type SheetFile } from "../packages/core/src";
import { chartXml } from "../packages/core/src/xlsx-drawings";
import { stackTotals } from "../packages/core/src/stacked-chart";
import { stackedNote } from "../apps/web/src/editors/stacked-chart";

describe("stacked chart", () => {
  it("adds every series in a column and keeps the chart type", () => {
    const rows = [
      { dues: 40, compost: 15 },
      { dues: 10 },
    ];
    const before = JSON.stringify(rows);
    expect(stackTotals(rows, ["dues", "compost"])).toEqual([55, 10]);
    expect(JSON.stringify(rows)).toBe(before);
    const uneven = [{ dues: 40, compost: Number.NaN }, { dues: Number.POSITIVE_INFINITY, compost: 10 }];
    expect(stackTotals(uneven, ["dues", "compost"])).toEqual([40, 10]);
    expect(JSON.stringify(stackTotals(uneven, ["dues", "compost"]))).not.toContain("NaN");
    expect(Number.isNaN(uneven[0]?.compost)).toBe(true);

    const file = createFile("sheet", "Beds") as SheetFile;
    const sheetId = file.content.workbook.sheetOrder[0];
    file.content.charts = [
      {
        id: "fees",
        title: "Plot fees",
        type: "stacked",
        source: { sheetId, startRow: 0, endRow: 2, startColumn: 0, endColumn: 2 },
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
    expect(again.content.charts[0]?.type).toBe("stacked");
    const xml = chartXml(file, file.content.charts[0]);
    expect(xml).toContain("<c:barChart>");
    expect(xml).toContain('<c:grouping val="stacked"/>');
    expect(xml).not.toContain("<c:lineChart>");
  });

  it("counts a text series cell and does not copy it", () => {
    const cells = [10, "secret-value", "", null, 4];
    expect(stackedNote(cells)).toBe("1 value was not a number.");
    expect(stackedNote([10, 4])).toBe("");
    expect(stackedNote(["secret-value", "other"])).toBe("2 values were not a number.");
    expect(cells[1]).toBe("secret-value");
  });
});
