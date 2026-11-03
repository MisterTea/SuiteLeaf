import { describe, expect, it } from "vitest";
import { createFile, parseFile, serializeFile, type SheetFile } from "../packages/core/src";
import { comboChartXml, comboSplit } from "../packages/core/src/combo-chart";
import { chartXml } from "../packages/core/src/xlsx-drawings";

describe("combo chart", () => {
  it("draws the last series as a line on its own axis", () => {
    expect(comboSplit([{ name: "Dues" }, { name: "Rate" }])).toEqual({
      columns: [{ name: "Dues" }],
      line: [{ name: "Rate" }],
    });
    expect(comboSplit([{ name: "Rate", axis: 2 }, { name: "Dues" }])).toEqual({
      columns: [{ name: "Dues" }],
      line: [{ name: "Rate", axis: 2 }],
    });
    const xml = comboChartXml("<c:ser>Dues</c:ser>", "<c:ser>Rate</c:ser>");
    expect(xml).toContain("<c:barChart>");
    expect(xml).toContain("<c:lineChart>");
    expect(xml).toContain('axId val="300"');

    const file = createFile("sheet", "Beds") as SheetFile;
    const sheetId = file.content.workbook.sheetOrder[0];
    const sheet = file.content.workbook.sheets[sheetId];
    sheet.cellData = {
      0: { 0: { v: "Bed" }, 1: { v: "Dues" }, 2: { v: "Rate" } },
      1: { 0: { v: "North" }, 1: { v: 40 }, 2: { v: 0.4 } },
    };
    file.content.charts = [
      {
        id: "fees",
        title: "Plot fees",
        type: "combo",
        source: { sheetId, startRow: 0, endRow: 1, startColumn: 0, endColumn: 2 },
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
    expect(again.content.charts[0]?.type).toBe("combo");
    const exported = chartXml(file, file.content.charts[0]);
    expect(exported).toContain("<c:barChart>");
    expect(exported).toContain("<c:lineChart>");
    expect(exported).toContain("Dues");
    expect(exported).toContain("Rate");
    expect(exported.indexOf("<c:barChart>")).toBeLessThan(exported.indexOf("<c:lineChart>"));
    expect(exported.indexOf("Dues")).toBeLessThan(exported.indexOf("</c:barChart>"));
    expect(exported.indexOf("Rate")).toBeGreaterThan(exported.indexOf("<c:lineChart>"));
  });
});
