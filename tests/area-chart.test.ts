import { describe, expect, it } from "vitest";
import { createFile, parseFile, serializeFile, type SheetFile } from "../packages/core/src";
import { excelChartElement } from "../packages/core/src/waterfall";

describe("area chart", () => {
  it("keeps the area type and exports an area chart element", () => {
    expect(excelChartElement("area")).toBe("areaChart");
    const file = createFile("sheet", "Beds") as SheetFile;
    const sheetId = file.content.workbook.sheetOrder[0];
    file.content.charts = [
      {
        id: "fees",
        title: "Plot fees",
        type: "area",
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
    expect(again.content.charts[0]?.type).toBe("area");
  });
});
