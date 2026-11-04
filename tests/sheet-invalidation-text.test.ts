import { describe, expect, it } from "vitest";
import { recalculateDirty } from "../packages/core/src/sheet-invalidation";

describe("incremental formula invalidation", () => {
  it("reads today's date and the current time", () => {
    const now = new Date("2026-11-03T15:04:05.000Z");
    const sheet = {
      cellData: {
        "0": { "0": { f: "=TODAY()", v: "" }, "1": { f: "=NOW()", v: "" }, "2": { v: "secret-value" } },
        "1": { "0": { f: "=TODAY(A1)", v: "kept" } },
      },
    };
    const result = recalculateDirty(sheet, "A1", undefined, now);
    expect(result.cellData["0"]["0"].v).toBe("2026-11-03");
    expect(result.cellData["0"]["1"].v).toBe("2026-11-03T15:04:05Z");
    expect(result.cellData["1"]["0"].v).toBe("kept");
    expect(JSON.stringify({ calculated: result.calculated, left: result.left })).not.toContain("secret-value");
    expect(sheet.cellData["0"]["2"].v).toBe("secret-value");
  });

  it("formats a number as text", () => {
    const sheet = {
      cellData: {
        "0": { "0": { v: 8.9 }, "1": { f: '=TEXT(A1, "0.00")', v: "" }, "2": { v: "0" }, "3": { f: "=TEXT(A1, C1)", v: "" } },
        "1": { "0": { v: "secret-value" }, "1": { f: '=TEXT(A2, "0.00")', v: "kept" } },
      },
    };
    const result = recalculateDirty(sheet, "A1");
    expect(result.cellData["0"]["1"].v).toBe("8.90");
    expect(result.cellData["0"]["3"].v).toBe("9");
    const text = recalculateDirty(sheet, "A2");
    expect(text.cellData["1"]["1"].v).toBe("kept");
    expect(text.left).toContain("B2");
    expect(JSON.stringify({ calculated: text.calculated, left: text.left })).not.toContain("secret-value");
    expect(sheet.cellData["1"]["0"].v).toBe("secret-value");
  });

  it("takes characters from text and joins cells", () => {
    const sheet = {
      cellData: {
        "0": {
          "0": { v: "Beds North" },
          "1": { f: "=LEFT(A1, 4)", v: "" },
          "2": { f: "=RIGHT(A1, 5)", v: "" },
          "3": { f: "=MID(A1, 6, 5)", v: "" },
        },
        "1": { "0": { v: "secret-value" }, "1": { f: "=LEFT(A2, -1)", v: "" }, "2": { f: "=LEFT(A2, 3)", v: 7 } },
        "2": { "0": { v: "Beds" }, "1": { v: "North" }, "2": { f: "=CONCATENATE(A3, B3)", v: "" } },
      },
    };
    const result = recalculateDirty(sheet, "A1");
    expect(result.cellData["0"]["1"].v).toBe("Beds");
    expect(result.cellData["0"]["2"].v).toBe("North");
    expect(result.cellData["0"]["3"].v).toBe("North");
    expect(recalculateDirty(sheet, "A3").cellData["2"]["2"].v).toBe("BedsNorth");
    const text = recalculateDirty(sheet, "A2");
    expect(text.cellData["1"]["1"].v).toBe("#VALUE!");
    expect(text.cellData["1"]["2"].v).toBe("sec");
    expect(JSON.stringify({ calculated: text.calculated, left: text.left })).not.toContain("secret-value");
    expect(sheet.cellData["1"]["0"].v).toBe("secret-value");
  });

  it("counts the characters in one cell", () => {
    const sheet = {
      cellData: {
        "0": { "0": { v: -4 }, "1": { f: "=LEN(A1)", v: 0 }, "2": { f: "=B1" } },
        "1": { "0": { v: "secret-value" }, "1": { f: "= LEN(A2)", v: 0 } },
        "2": { "0": { v: "#DIV/0!" }, "1": { f: "=LEN(A3)", v: 7 } },
      },
    };
    const result = recalculateDirty(sheet, "A1");
    expect(result.cellData["0"]["1"].v).toBe(2);
    expect(result.cellData["0"]["2"].v).toBe(2);
    expect(result.calculated).toContain("B1");
    const text = recalculateDirty(sheet, "A2");
    expect(text.cellData["1"]["1"].v).toBe(12);
    expect(JSON.stringify({ calculated: text.calculated, left: text.left })).not.toContain("secret-value");
    const error = recalculateDirty(sheet, "A3");
    expect(error.cellData["2"]["1"].v).toBe(7);
    expect(error.left).toContain("B3");
    expect(sheet.cellData["1"]["0"].v).toBe("secret-value");
    expect(sheet.cellData["0"]["1"].v).toBe(0);
  });

  it("removes extra spaces from one cell", () => {
    const sheet = {
      cellData: {
        "0": { "0": { v: "  Beds   North  " }, "1": { f: "=TRIM(A1)", v: "" }, "2": { f: "=B1" } },
        "1": { "0": { v: "  secret-value  " }, "1": { f: "= TRIM(A2)", v: "" } },
        "2": { "0": { v: "#DIV/0!" }, "1": { f: "=TRIM(A3)", v: "kept" } },
      },
    };
    const result = recalculateDirty(sheet, "A1");
    expect(result.cellData["0"]["1"].v).toBe("Beds North");
    expect(result.cellData["0"]["2"].v).toBe("Beds North");
    const text = recalculateDirty(sheet, "A2");
    expect(text.cellData["1"]["1"].v).toBe("secret-value");
    expect(JSON.stringify({ calculated: text.calculated, left: text.left })).not.toContain("secret-value");
    const error = recalculateDirty(sheet, "A3");
    expect(error.cellData["2"]["1"].v).toBe("kept");
    expect(error.left).toContain("B3");
    expect(sheet.cellData["0"]["0"].v).toBe("  Beds   North  ");
    expect(sheet.cellData["1"]["0"].v).toBe("  secret-value  ");
  });

  it("builds a date from three numbers", () => {
    const sheet = {
      cellData: {
        "0": { "0": { v: 2026 }, "1": { v: 1 }, "2": { v: 15 }, "3": { f: "=DATE(A1, B1, C1)", v: "" } },
        "1": { "0": { v: "secret-value" }, "1": { v: 1 }, "2": { v: 15 }, "3": { f: "=DATE(A2, B2, C2)", v: "kept" } },
        "2": { "0": { v: 2026 }, "1": { v: 2 }, "2": { v: 31 }, "3": { f: "=DATE(A3, B3, C3)", v: "kept" } },
      },
    };
    const result = recalculateDirty(sheet, "A1");
    expect(result.cellData["0"]["3"].v).toBe("2026-01-15");
    const text = recalculateDirty(sheet, "A2");
    expect(text.cellData["1"]["3"].v).toBe("kept");
    expect(text.left).toContain("D2");
    expect(JSON.stringify({ calculated: text.calculated, left: text.left })).not.toContain("secret-value");
    const impossible = recalculateDirty(sheet, "C3");
    expect(impossible.cellData["2"]["3"].v).toBe("kept");
    expect(impossible.left).toContain("D3");
    expect(sheet.cellData["0"]["0"].v).toBe(2026);
  });

  it("reads the year, month, and day of a date", () => {
    const sheet = {
      cellData: {
        "0": {
          "0": { v: " 2026-01-15 " },
          "1": { f: "=YEAR(A1)", v: "" },
          "2": { f: "=MONTH(A1)", v: "" },
          "3": { f: "=DAY(A1)", v: "" },
        },
        "1": { "0": { v: "secret-value" }, "1": { f: "=YEAR(A2)", v: "kept" } },
        "2": { "0": { v: "2026-02-31" }, "1": { f: "=DAY(A3)", v: "kept" } },
      },
    };
    const result = recalculateDirty(sheet, "A1");
    expect(result.cellData["0"]["1"].v).toBe(2026);
    expect(result.cellData["0"]["2"].v).toBe(1);
    expect(result.cellData["0"]["3"].v).toBe(15);
    const text = recalculateDirty(sheet, "A2");
    expect(text.cellData["1"]["1"].v).toBe("kept");
    expect(text.left).toContain("B2");
    expect(JSON.stringify({ calculated: text.calculated, left: text.left })).not.toContain("secret-value");
    const impossible = recalculateDirty(sheet, "A3");
    expect(impossible.cellData["2"]["1"].v).toBe("kept");
    expect(impossible.left).toContain("B3");
    expect(sheet.cellData["0"]["0"].v).toBe(" 2026-01-15 ");
  });

  it("changes the case of one cell", () => {
    const sheet = {
      cellData: {
        "0": { "0": { v: "Beds North" }, "1": { f: "=LOWER(A1)", v: "" }, "2": { f: "=B1" } },
        "1": { "0": { v: "Secret-Value" }, "1": { f: "= UPPER(A2)", v: "" } },
        "2": { "0": { v: "#DIV/0!" }, "1": { f: "=LOWER(A3)", v: "kept" } },
      },
    };
    const lower = recalculateDirty(sheet, "A1");
    expect(lower.cellData["0"]["1"].v).toBe("beds north");
    expect(lower.cellData["0"]["2"].v).toBe("beds north");
    const upper = recalculateDirty(sheet, "A2");
    expect(upper.cellData["1"]["1"].v).toBe("SECRET-VALUE");
    expect(JSON.stringify({ calculated: upper.calculated, left: upper.left })).not.toContain("Secret-Value");
    const error = recalculateDirty(sheet, "A3");
    expect(error.cellData["2"]["1"].v).toBe("kept");
    expect(error.left).toContain("B3");
    expect(sheet.cellData["0"]["0"].v).toBe("Beds North");
  });
});
