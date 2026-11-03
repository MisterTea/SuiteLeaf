import { describe, expect, it } from "vitest";
import { inspectSheetCost } from "../packages/core/src/sheet-cost";

describe("sheet cost scan", () => {
  it("names volatile formulas as the largest cost and does not keep cell text", () => {
    const sheet = {
      name: "Beds",
      cellData: {
        0: {
          0: { v: "secret tomato count", f: null },
          1: { f: "=NOW()" },
          2: { f: "=A1*2" },
        },
      },
      conditionalFormats: [{}],
    };
    const before = JSON.stringify(sheet);
    const report = inspectSheetCost([sheet]);
    expect(report.cancelled).toBe(false);
    if (report.cancelled) return;
    expect(report.dominant.kind).toBe("volatile formulas");
    expect(report.formulas).toBe(2);
    expect(report.volatileFormulas).toBe(1);
    expect(JSON.stringify(report)).not.toContain("secret tomato");
    expect(JSON.stringify(sheet)).toBe(before);
  });

  it("stops when asked and does not change the workbook", () => {
    const sheet = {
      name: "Beds",
      cellData: {
        0: { 0: { v: 1 }, 1: { v: 2 }, 2: { f: "=A1" } },
      },
    };
    const before = JSON.stringify(sheet);
    let seen = 0;
    const report = inspectSheetCost([sheet], () => {
      seen += 1;
      return seen > 1;
    });
    expect(report).toMatchObject({ cancelled: true });
    expect(JSON.stringify(sheet)).toBe(before);
  });
});
