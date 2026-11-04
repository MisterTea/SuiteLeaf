import { describe, expect, it } from "vitest";
import { recalculateDirty } from "../packages/core/src/sheet-invalidation";

describe("incremental formula invalidation", () => {
  it("moves from a cell and reads an address stored as text", () => {
    const sheet = {
      cellData: {
        "0": {
          "0": { v: 10 },
          "1": { f: "=OFFSET(A1, 1, 0)", v: "" },
          "2": { v: "A1" },
          "3": { f: "=INDIRECT(C1)", v: "" },
          "4": { v: "secret-value" },
          "5": { f: "=INDIRECT(E1)", v: "kept" },
        },
        "1": { "0": { v: 4 } },
      },
    };
    const result = recalculateDirty(sheet, "A1");
    expect(result.cellData["0"]["1"].v).toBe(4);
    expect(result.cellData["0"]["3"].v).toBe(10);
    expect(result.cellData["0"]["5"].v).toBe("#REF!");
    expect(JSON.stringify({ calculated: result.calculated, left: result.left })).not.toContain("secret-value");
    expect(sheet.cellData["0"]["4"].v).toBe("secret-value");
  });

  it("picks a cell by position and finds where a value sits", () => {
    const sheet = {
      cellData: {
        "0": { "0": { v: "Beds" }, "1": { v: 4 }, "2": { f: "=INDEX(B1:B2, 2)", v: "" }, "3": { f: "=MATCH(A1, A1:A2, 0)", v: "" } },
        "1": { "0": { v: "secret-value" }, "1": { v: 9 } },
        "2": { "0": { f: "=INDEX(B1:B2, 4)", v: "kept" }, "1": { f: "=MATCH(C3, A1:A2)", v: "" }, "2": { v: "Missing" } },
      },
    };
    const result = recalculateDirty(sheet, "B2");
    expect(result.cellData["0"]["2"].v).toBe(9);
    expect(JSON.stringify({ calculated: result.calculated, left: result.left })).not.toContain("secret-value");
    const place = recalculateDirty(sheet, "A1");
    expect(place.cellData["0"]["3"].v).toBe(1);
    const missing = recalculateDirty(sheet, "C3");
    expect(missing.cellData["2"]["1"].v).toBe("#N/A");
    const outside = recalculateDirty(sheet, "B1");
    expect(outside.cellData["2"]["0"].v).toBe("#REF!");
    expect(sheet.cellData["1"]["0"].v).toBe("secret-value");
  });

  it("looks up an exact value in a small range", () => {
    const sheet = {
      cellData: {
        "0": { "0": { v: "Beds" }, "1": { v: "Beds" }, "2": { v: 4 }, "3": { f: "=VLOOKUP(A1, B1:C2, 2)", v: "" } },
        "1": { "0": { v: "West" }, "1": { v: "west" }, "2": { v: "secret-value" } },
        "2": { "0": { v: "Missing" }, "1": { f: "=VLOOKUP(A3, B1:C2, 2)", v: "kept" } },
        "3": { "0": { f: "=VLOOKUP(A1, B1:C2, 3)", v: "kept" } },
      },
    };
    const found = recalculateDirty(sheet, "A1");
    expect(found.cellData["0"]["3"].v).toBe(4);
    expect(found.cellData["3"]["0"].v).toBe("kept");
    expect(found.left).toContain("A4");
    const byText = recalculateDirty(
      {
        cellData: {
          "0": { "0": { v: "West" }, "1": { v: "Beds" }, "2": { v: 4 }, "3": { f: "=VLOOKUP(A1, B1:C2, 2)", v: "" } },
          "1": { "1": { v: "West" }, "2": { v: "secret-value" } },
        },
      },
      "A1",
    );
    expect(byText.cellData["0"]["3"].v).toBe("secret-value");
    expect(JSON.stringify({ calculated: byText.calculated, left: byText.left })).not.toContain("secret-value");
    const missing = recalculateDirty(sheet, "A3");
    expect(missing.cellData["2"]["1"].v).toBe("#N/A");
    expect(sheet.cellData["1"]["2"].v).toBe("secret-value");
  });

  it("looks up a value in a second range", () => {
    const sheet = {
      cellData: {
        "0": {
          "0": { v: "beds" },
          "1": { v: "Beds" },
          "2": { v: 10 },
          "3": { f: "=XLOOKUP(A1, B1:B2, C1:C2)", v: "" },
        },
        "1": { "1": { v: "North" }, "2": { v: "secret-value" } },
        "2": { "0": { v: "Missing" }, "1": { v: 4 }, "2": { f: "=XLOOKUP(A3, B1:B2, C1:C2, B3)", v: "" } },
      },
    };
    const found = recalculateDirty(sheet, "A1");
    expect(found.cellData["0"]["3"].v).toBe(10);
    const missing = recalculateDirty(sheet, "A3");
    expect(missing.cellData["2"]["2"].v).toBe(4);
    expect(JSON.stringify({ calculated: found.calculated, left: found.left })).not.toContain("secret-value");
    expect(sheet.cellData["1"]["2"].v).toBe("secret-value");
  });

  it("looks across the first row", () => {
    const sheet = {
      cellData: {
        "0": {
          "0": { v: "North" },
          "1": { v: "Beds" },
          "2": { v: "North" },
          "3": { f: "=HLOOKUP(A1, B1:C2, 2)", v: "" },
        },
        "1": { "1": { v: 10 }, "2": { v: "secret-value" } },
        "2": { "0": { v: "Missing" }, "1": { f: "=HLOOKUP(A3, B1:C2, 2)", v: "kept" } },
        "3": { "0": { f: "=HLOOKUP(A1, B1:C2, 3)", v: "kept" } },
      },
    };
    const found = recalculateDirty(sheet, "A1");
    expect(found.cellData["0"]["3"].v).toBe("secret-value");
    expect(JSON.stringify({ calculated: found.calculated, left: found.left })).not.toContain("secret-value");
    expect(found.cellData["3"]["0"].v).toBe("kept");
    expect(found.left).toContain("A4");
    const beds = recalculateDirty(
      {
        cellData: {
          "0": { "0": { v: "beds" }, "1": { v: "Beds" }, "2": { v: "North" }, "3": { f: "=HLOOKUP(A1, B1:C2, 2)", v: "" } },
          "1": { "1": { v: 10 }, "2": { v: 4 } },
        },
      },
      "A1",
    );
    expect(beds.cellData["0"]["3"].v).toBe(10);
    const missing = recalculateDirty(sheet, "A3");
    expect(missing.cellData["2"]["1"].v).toBe("#N/A");
    expect(sheet.cellData["1"]["2"].v).toBe("secret-value");
  });
});
