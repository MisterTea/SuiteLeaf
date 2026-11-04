import { describe, expect, it } from "vitest";
import { recalculateDirty } from "../packages/core/src/sheet-invalidation";

describe("incremental formula invalidation", () => {
  it("averages the rows that match every condition", () => {
    const sheet = {
      cellData: {
        "0": {
          "0": { v: "Beds" },
          "1": { v: 10 },
          "2": { v: "North" },
          "3": { f: "=AVERAGEIFS(B1:B3, A1:A3, E1, C1:C3, F1)", v: "" },
          "4": { v: "Beds" },
          "5": { v: "North" },
        },
        "1": { "0": { v: "beds" }, "1": { v: 4 }, "2": { v: "North" } },
        "2": { "0": { v: "Beds" }, "1": { v: "secret-value" }, "2": { v: "North" } },
      },
    };
    const result = recalculateDirty(sheet, "E1");
    expect(result.cellData["0"]["3"].v).toBe(7);
    expect(JSON.stringify({ calculated: result.calculated, left: result.left })).not.toContain("secret-value");
    expect(sheet.cellData["2"]["1"].v).toBe("secret-value");
  });

  it("sums the rows that match every condition", () => {
    const sheet = {
      cellData: {
        "0": {
          "0": { v: "Beds" },
          "1": { v: 10 },
          "2": { v: "North" },
          "3": { f: "=SUMIFS(B1:B3, A1:A3, E1, C1:C3, F1)", v: "" },
          "4": { v: "Beds" },
          "5": { v: "North" },
        },
        "1": { "0": { v: "beds" }, "1": { v: 4 }, "2": { v: "North" } },
        "2": { "0": { v: "Beds" }, "1": { v: "secret-value" }, "2": { v: "North" } },
      },
    };
    const result = recalculateDirty(sheet, "E1");
    expect(result.cellData["0"]["3"].v).toBe(14);
    expect(JSON.stringify({ calculated: result.calculated, left: result.left })).not.toContain("secret-value");
    expect(sheet.cellData["2"]["1"].v).toBe("secret-value");
  });

  it("averages the rows that match one cell", () => {
    const sheet = {
      cellData: {
        "0": {
          "0": { v: "Beds" },
          "1": { v: 10 },
          "2": { f: "=AVERAGEIF(A1:A3, D1, B1:B3)", v: "" },
          "3": { v: "Beds" },
        },
        "1": { "0": { v: "beds" }, "1": { v: 4 } },
        "2": { "0": { v: "North" }, "1": { v: "secret-value" } },
        "3": { "0": { v: "West" }, "1": { f: "=AVERAGEIF(A1:A3, A4, B1:B3)", v: "kept" } },
      },
    };
    const result = recalculateDirty(sheet, "D1");
    expect(result.cellData["0"]["2"].v).toBe(7);
    expect(JSON.stringify({ calculated: result.calculated, left: result.left })).not.toContain("secret-value");
    const none = recalculateDirty(sheet, "A4");
    expect(none.cellData["3"]["1"].v).toBe("#DIV/0!");
    expect(sheet.cellData["2"]["1"].v).toBe("secret-value");
  });

  it("counts the rows that match every condition", () => {
    const sheet = {
      cellData: {
        "0": {
          "0": { v: "Beds" },
          "1": { v: "North" },
          "2": { f: "=COUNTIFS(A1:A3, D1, B1:B3, E1)", v: "" },
          "3": { v: "Beds" },
          "4": { v: "North" },
        },
        "1": { "0": { v: "beds" }, "1": { v: "North" } },
        "2": { "0": { v: "Beds" }, "1": { v: "secret-value" } },
      },
    };
    const result = recalculateDirty(sheet, "D1");
    expect(result.cellData["0"]["2"].v).toBe(2);
    expect(JSON.stringify({ calculated: result.calculated, left: result.left })).not.toContain("secret-value");
    expect(sheet.cellData["2"]["1"].v).toBe("secret-value");
  });

  it("counts a written comparison", () => {
    const sheet = {
      cellData: {
        "0": { "0": { v: 12 }, "1": { f: '=COUNTIFS(A1:A3, ">10")', v: "" } },
        "1": { "0": { v: 10 }, "1": { f: '=COUNTIF(A1:A3, ">10")', v: "" } },
        "2": { "0": { v: "secret-value" } },
      },
    };
    const result = recalculateDirty(sheet, "A1");
    expect(result.cellData["0"]["1"].v).toBe(1);
    expect(result.cellData["1"]["1"].v).toBe(1);
    expect(JSON.stringify({ calculated: result.calculated, left: result.left })).not.toContain("secret-value");
    expect(sheet.cellData["2"]["0"].v).toBe("secret-value");
  });

  it("adds and averages a written criterion", () => {
    const sheet = {
      cellData: {
        "0": { "0": { v: "Pass" }, "1": { v: 10 }, "2": { f: '=SUMIF(A1:A3, "Pass", B1:B3)', v: "" } },
        "1": { "0": { v: "pass" }, "1": { v: 4 }, "2": { f: '=AVERAGEIF(A1:A3, "Pass", B1:B3)', v: "" } },
        "2": { "0": { v: "secret-value" }, "1": { v: 9 } },
      },
    };
    const result = recalculateDirty(sheet, "A1");
    expect(result.cellData["0"]["2"].v).toBe(14);
    expect(result.cellData["1"]["2"].v).toBe(7);
    expect(JSON.stringify({ calculated: result.calculated, left: result.left })).not.toContain("secret-value");
    expect(sheet.cellData["2"]["0"].v).toBe("secret-value");
    expect(sheet.cellData["2"]["1"].v).toBe(9);
  });

  it("counts the rows that match one cell", () => {
    const sheet = {
      cellData: {
        "0": { "0": { v: "Beds" }, "1": { f: "=COUNTIF(A1:A3, D1)", v: "" }, "3": { v: "Beds" } },
        "1": { "0": { v: "beds" } },
        "2": { "0": { v: "secret-value" } },
        "3": { "0": { v: "West" }, "1": { f: "=COUNTIF(A1:A3, A4)", v: "" } },
      },
    };
    const result = recalculateDirty(sheet, "D1");
    expect(result.cellData["0"]["1"].v).toBe(2);
    expect(JSON.stringify({ calculated: result.calculated, left: result.left })).not.toContain("secret-value");
    const none = recalculateDirty(sheet, "A4");
    expect(none.cellData["3"]["1"].v).toBe(0);
    expect(sheet.cellData["2"]["0"].v).toBe("secret-value");
  });

  it("sums the rows that match one cell", () => {
    const sheet = {
      cellData: {
        "0": { "0": { v: "Beds" }, "1": { v: 10 }, "2": { f: "=SUMIF(A1:A3, D1, B1:B3)", v: "" }, "3": { v: "Beds" } },
        "1": { "0": { v: "beds" }, "1": { v: 4 } },
        "2": { "0": { v: "North" }, "1": { v: "secret-value" } },
        "3": { "0": { v: "West" }, "1": { f: "=SUMIF(A1:A3, A4, B1:B3)", v: "kept" } },
        "4": { "0": { v: "#DIV/0!" }, "1": { v: "#DIV/0!" }, "2": { f: "=SUMIF(A5:A5, A5, B5:B5)", v: "kept" } },
      },
    };
    const result = recalculateDirty(sheet, "D1");
    expect(result.cellData["0"]["2"].v).toBe(14);
    expect(JSON.stringify({ calculated: result.calculated, left: result.left })).not.toContain("secret-value");
    const none = recalculateDirty(sheet, "A4");
    expect(none.cellData["3"]["1"].v).toBe(0);
    const error = recalculateDirty(sheet, "A5");
    expect(error.cellData["4"]["2"].v).toBe("#DIV/0!");
    expect(sheet.cellData["2"]["1"].v).toBe("secret-value");
  });
});
