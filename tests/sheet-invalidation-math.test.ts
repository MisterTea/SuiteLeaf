import { describe, expect, it } from "vitest";
import { cellsToRecalculate, recalculateDirty } from "../packages/core/src/sheet-invalidation";

describe("incremental formula invalidation", () => {
  it("rounds a negative halfway value away from zero", () => {
    const sheet = {
      cellData: {
        "0": { "0": { v: -1.5 }, "1": { f: "=ROUND(A1, 0)", v: 0 } },
        "1": { "0": { v: -15 }, "1": { v: -1 }, "2": { f: "=ROUND(A2, B2)", v: 0 } },
        "2": { "0": { v: 1.5 }, "1": { f: "=ROUND(A3, 0)" } },
      },
    };
    const places = recalculateDirty(sheet, "A1");
    expect(places.cellData["0"]["1"].v).toBe(-2);
    const tens = recalculateDirty(sheet, "B2");
    expect(tens.cellData["1"]["2"].v).toBe(-20);
    const positive = recalculateDirty(sheet, "A3");
    expect(positive.cellData["2"]["1"].v).toBe(2);
    expect(sheet.cellData["0"]["1"].v).toBe(0);
  });

  it("rounds one cell and leaves text unrounded", () => {
    const sheet = {
      cellData: {
        "0": {
          "0": { v: 1.239 },
          "1": { f: "=ROUND(A1, 2)" },
          "2": { f: "=B1" },
        },
        "1": {
          "0": { v: "secret-value" },
          "1": { f: "=ROUND(A2, 2)", v: 4 },
        },
        "2": {
          "0": { v: 15 },
          "1": { v: 2 },
          "2": { f: "=ROUND(A3, B3)", v: 0 },
        },
      },
    };
    expect(cellsToRecalculate(sheet, "A1").cells).toContain("B1");
    const result = recalculateDirty(sheet, "A1");
    expect(result.cellData["0"]["1"].v).toBe(1.24);
    expect(result.cellData["0"]["2"].v).toBe(1.24);
    expect(result.calculated).toContain("B1");
    expect(result.calculated).toContain("C1");
    const text = recalculateDirty(sheet, "A2");
    expect(text.cellData["1"]["1"].v).toBe(4);
    expect(text.left).toContain("B2");
    expect(JSON.stringify({ calculated: text.calculated, left: text.left })).not.toContain("secret-value");
    expect(JSON.stringify({ calculated: result.calculated, left: result.left })).not.toContain("ROUND");
    expect(sheet.cellData["0"]["1"].v).toBeUndefined();
    const fromCell = recalculateDirty(sheet, "A3");
    expect(fromCell.cellData["2"]["2"].v).toBe(15);
    expect(sheet.cellData["2"]["2"].v).toBe(0);
  });

  it("draws a random number from the supplied sequence", () => {
    const sheet = {
      cellData: {
        "0": { "0": { f: "=RAND()", v: "" }, "1": { f: "=RANDBETWEEN(1, 3)", v: "" }, "2": { v: "secret-value" } },
        "1": { "0": { v: 4 }, "1": { v: 2 }, "2": { f: "=RANDBETWEEN(A2, B2)", v: "kept" } },
      },
    };
    const result = recalculateDirty(sheet, "A1", undefined, new Date("2026-11-03T00:00:00.000Z"), () => 0.5);
    expect(result.cellData["0"]["0"].v).toBe(0.5);
    expect(result.cellData["0"]["1"].v).toBe(2);
    const backwards = recalculateDirty(sheet, "A2", undefined, new Date("2026-11-03T00:00:00.000Z"), () => 0.2);
    expect(backwards.cellData["1"]["2"].v).toBe("#NUM!");
    expect(JSON.stringify({ calculated: result.calculated, left: result.left })).not.toContain("secret-value");
    expect(sheet.cellData["0"]["2"].v).toBe("secret-value");
  });

  it("rounds down, takes a root, a remainder, and a power", () => {
    const sheet = {
      cellData: {
        "0": { "0": { v: 8.9 }, "1": { f: "=INT(A1)", v: "" }, "2": { v: -1.2 }, "3": { f: "=INT(C1)", v: "" } },
        "1": { "0": { v: 9 }, "1": { f: "=SQRT(A2)", v: "" }, "2": { v: -1 }, "3": { f: "=SQRT(C2)", v: "" } },
        "2": { "0": { v: -10 }, "1": { v: 3 }, "2": { f: "=MOD(A3, B3)", v: "" }, "3": { v: 0 }, "4": { f: "=MOD(A3, D3)", v: "" } },
        "3": { "0": { v: 2 }, "1": { v: 3 }, "2": { f: "=POWER(A4, B4)", v: "" } },
        "4": { "0": { v: "secret-value" }, "1": { f: "=INT(A5)", v: 7 } },
      },
    };
    const result = recalculateDirty(sheet, "A1");
    expect(result.cellData["0"]["1"].v).toBe(8);
    expect(recalculateDirty(sheet, "C1").cellData["0"]["3"].v).toBe(-2);
    expect(recalculateDirty(sheet, "A2").cellData["1"]["1"].v).toBe(3);
    expect(recalculateDirty(sheet, "C2").cellData["1"]["3"].v).toBe("#NUM!");
    expect(recalculateDirty(sheet, "A3").cellData["2"]["2"].v).toBe(2);
    expect(recalculateDirty(sheet, "D3").cellData["2"]["4"].v).toBe("#DIV/0!");
    expect(recalculateDirty(sheet, "A4").cellData["3"]["2"].v).toBe(8);
    const text = recalculateDirty(sheet, "A5");
    expect(text.cellData["4"]["1"].v).toBe(7);
    expect(text.left).toContain("B5");
    expect(JSON.stringify({ calculated: text.calculated, left: text.left })).not.toContain("secret-value");
    expect(sheet.cellData["4"]["0"].v).toBe("secret-value");
  });

  it("multiplies numbers and counts filled cells", () => {
    const sheet = {
      cellData: {
        "0": {
          "0": { v: 10 },
          "1": { v: "secret-value" },
          "2": { v: 4 },
          "3": { f: "=PRODUCT(A1:C1)", v: "" },
          "4": { f: "=COUNTA(A1:C1)", v: "" },
        },
        "1": { "0": { v: "secret-value" }, "1": { f: "=PRODUCT(A2:A2)", v: 7 } },
      },
    };
    const result = recalculateDirty(sheet, "A1");
    expect(result.cellData["0"]["3"].v).toBe(40);
    expect(result.cellData["0"]["4"].v).toBe(3);
    const text = recalculateDirty(sheet, "A2");
    expect(text.cellData["1"]["1"].v).toBe(0);
    expect(JSON.stringify({ calculated: result.calculated, left: result.left })).not.toContain("secret-value");
    expect(sheet.cellData["0"]["1"].v).toBe("secret-value");
  });

  it("finds the median of a small range", () => {
    const sheet = {
      cellData: {
        "0": {
          "0": { v: 10 },
          "1": { v: "secret-value" },
          "2": { v: 4 },
          "3": { v: 30 },
          "4": { f: "=MEDIAN(A1:D1)", v: "" },
        },
        "1": { "0": { v: 10 }, "1": { v: 4 }, "2": { v: 30 }, "3": { v: 20 }, "4": { f: "=MEDIAN(A2:D2)", v: "" } },
        "2": { "0": { v: "secret-value" }, "1": { f: "=MEDIAN(A3:A3)", v: 7 } },
      },
    };
    const result = recalculateDirty(sheet, "A1");
    expect(result.cellData["0"]["4"].v).toBe(10);
    expect(recalculateDirty(sheet, "A2").cellData["1"]["4"].v).toBe(15);
    const text = recalculateDirty(sheet, "A3");
    expect(text.cellData["2"]["1"].v).toBe("#NUM!");
    expect(JSON.stringify({ calculated: result.calculated, left: result.left })).not.toContain("secret-value");
    expect(sheet.cellData["0"]["1"].v).toBe("secret-value");
  });

  it("averages, counts, and finds the smallest and largest number", () => {
    const sheet = {
      cellData: {
        "0": {
          "0": { v: 10 },
          "1": { v: 30 },
          "2": { f: "=AVERAGE(A1:B1)" },
          "3": { f: "=COUNT(A1:A2)" },
          "4": { f: "=MIN(A1:B1)" },
          "5": { f: "=MAX(A1:B1)" },
        },
        "1": { "0": { v: "" }, "1": { v: "secret-value" }, "2": { f: "=AVERAGE(A1:B2)", v: 4 } },
      },
    };
    const result = recalculateDirty(sheet, "A1");
    expect(result.cellData["0"]["2"].v).toBe(20);
    expect(result.cellData["0"]["3"].v).toBe(1);
    expect(result.cellData["0"]["4"].v).toBe(10);
    expect(result.cellData["0"]["5"].v).toBe(30);
    expect(result.cellData["1"]["2"].v).toBe(4);
    expect(result.left).toContain("C2");
    expect(JSON.stringify({ calculated: result.calculated, left: result.left })).not.toContain("secret-value");
    expect(sheet.cellData["0"]["2"].v).toBeUndefined();
  });

  it("takes the absolute value of one cell", () => {
    const sheet = {
      cellData: {
        "0": { "0": { v: -4 }, "1": { f: "=ABS(A1)", v: 0 }, "2": { f: "=B1" } },
        "1": { "0": { v: "secret-value" }, "1": { f: "= ABS(A2)", v: 4 } },
      },
    };
    const result = recalculateDirty(sheet, "A1");
    expect(result.cellData["0"]["1"].v).toBe(4);
    expect(result.cellData["0"]["2"].v).toBe(4);
    expect(result.calculated).toContain("B1");
    expect(result.calculated).toContain("C1");
    const text = recalculateDirty(sheet, "A2");
    expect(text.cellData["1"]["1"].v).toBe(4);
    expect(text.left).toContain("B2");
    expect(JSON.stringify({ calculated: text.calculated, left: text.left })).not.toContain("secret-value");
    expect(JSON.stringify({ calculated: result.calculated, left: result.left })).not.toContain("ABS");
    expect(sheet.cellData["0"]["1"].v).toBe(0);
  });
});
