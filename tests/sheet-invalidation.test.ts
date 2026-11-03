import { describe, expect, it } from "vitest";
import { cellsToRecalculate, recalculateDirty } from "../packages/core/src/sheet-invalidation";

describe("incremental formula invalidation", () => {
  it("recalculates the chain that reads the changed cell and leaves the other formula", () => {
    const sheet = {
      cellData: {
        "0": {
          "0": { v: "secret tomato" },
          "1": { f: "=A1" },
          "2": { f: "=B1" },
          "3": { f: "=E1" },
          "4": { v: 1 },
        },
      },
    };
    const dirty = cellsToRecalculate(sheet, "A1");
    expect(dirty).toEqual({ cells: ["B1", "C1"], unlisted: false });
    expect(JSON.stringify(dirty)).not.toContain("secret tomato");
    expect(sheet.cellData["0"]["0"].v).toBe("secret tomato");
    const stopped = cellsToRecalculate(sheet, "A1", undefined, () => true);
    expect(stopped).toEqual({ cells: [], unlisted: false, cancelled: true });
    expect(JSON.stringify(stopped)).not.toContain("secret");
    expect(JSON.stringify(stopped)).not.toContain("=A1");

    const cycle = cellsToRecalculate(
      {
        cellData: {
          "0": {
            "0": { f: "=B1" },
            "1": { f: "=A1" },
          },
        },
      },
      "A1",
    );
    expect(cycle.cells).toEqual(["A1", "B1"]);

    const wide = cellsToRecalculate(
      {
        cellData: {
          "0": { "0": { v: 1 } },
          "1": { "25": { f: "=SUM(A1:A80)" } },
        },
      },
      "A1",
    );
    expect(wide.cells).toEqual(["Z2"]);
    expect(wide.unlisted).toBe(true);
    const outside = cellsToRecalculate(
      {
        cellData: {
          "0": { "1": { v: 1 } },
          "1": { "25": { f: "=SUM(A1:A80)" } },
        },
      },
      "B1",
    );
    expect(outside.cells).toEqual(["Z2"]);
    expect(outside.unlisted).toBe(true);
  });

  it("copies a direct reference and leaves a sum and a cycle uncalculated", () => {
    const sheet = {
      cellData: {
        "0": {
          "0": { v: "secret tomato" },
          "1": { f: "=A1" },
          "2": { f: "=B1" },
          "3": { f: "=E1" },
          "4": { v: 1 },
        },
        "1": { "25": { f: "=SUM(A1:A80)", v: 4 } },
      },
    };
    const result = recalculateDirty(sheet, "A1");
    expect(result.calculated).toEqual(["B1", "C1"]);
    expect(result.left).toEqual(["Z2"]);
    expect(result.cellData["0"]["1"].v).toBe("secret tomato");
    expect(result.cellData["0"]["2"].v).toBe("secret tomato");
    expect(result.cellData["1"]["25"].v).toBe(4);
    expect(JSON.stringify({ calculated: result.calculated, left: result.left })).not.toContain(
      "secret tomato",
    );
    expect(sheet.cellData["0"]["1"].v).toBeUndefined();
    expect(sheet.cellData["0"]["0"].v).toBe("secret tomato");

    const cycle = recalculateDirty(
      {
        cellData: {
          "0": {
            "0": { f: "=B1", v: "North" },
            "1": { f: "=A1", v: "South" },
          },
        },
      },
      "A1",
    );
    expect(cycle.calculated).toEqual([]);
    expect(cycle.left).toEqual(["A1", "B1"]);
    expect(cycle.cellData["0"]["0"].v).toBe("North");
    expect(cycle.cellData["0"]["1"].v).toBe("South");
  });

  it("adds a small sum and leaves a sum that reads text", () => {
    const sheet = {
      cellData: {
        "0": {
          "0": { v: 10 },
          "1": { f: "=A1" },
          "2": { f: "=SUM(A1:B1)" },
        },
        "1": {
          "0": { v: 5 },
          "1": { f: "=SUM(A1:A2)", v: 0 },
        },
        "2": {
          "0": { v: "secret-value" },
          "1": { f: "=SUM(A1:A3)", v: 4 },
        },
        "3": { "0": { f: "=SUM(A1:A80)", v: 4 } },
      },
    };
    const result = recalculateDirty(sheet, "A1");
    expect(result.cellData["0"]["1"].v).toBe(10);
    expect(result.cellData["0"]["2"].v).toBe(20);
    expect(result.cellData["1"]["1"].v).toBe(15);
    expect(result.cellData["2"]["1"].v).toBe(4);
    expect(result.cellData["3"]["0"].v).toBe(4);
    expect(result.calculated).toEqual(["B1", "B2", "C1"]);
    expect(result.left).toEqual(["A4", "B3"]);
    expect(JSON.stringify({ calculated: result.calculated, left: result.left })).not.toContain(
      "secret-value",
    );
    expect(sheet.cellData["0"]["1"].v).toBeUndefined();
    expect(sheet.cellData["1"]["1"].v).toBe(0);
  });

  it("calculates a structured column sum and keeps the written formula", () => {
    const sheet = {
      cellData: {
        "0": {
          "0": { v: "Date" },
          "1": { v: "Team" },
          "2": { v: "Revenue" },
          "3": { f: "=SUM(Sales[Revenue])" },
        },
        "1": { "1": { v: "secret-value" }, "2": { v: 10 } },
        "2": { "2": { v: 20 } },
        "3": { "2": { v: 5 } },
      },
    };
    const structured = {
      tables: [
        {
          name: "Sales",
          sheetId: "s",
          headerRow: 0,
          startColumn: 0,
          endColumn: 2,
          endRow: 3,
        },
      ],
      headers: { Sales: ["Date", "Team", "Revenue"] },
      sheetId: "s",
    };
    expect(cellsToRecalculate(sheet, "C2", structured).cells).toEqual(["D1"]);
    expect(cellsToRecalculate(sheet, "A1", structured).cells).toEqual([]);
    const result = recalculateDirty(sheet, "C2", structured);
    expect(result.cellData["0"]["3"].v).toBe(35);
    expect(result.cellData["0"]["3"].f).toBe("=SUM(Sales[Revenue])");
    expect(result.calculated).toEqual(["D1"]);
    expect(result.left).toEqual([]);
    expect(JSON.stringify({ calculated: result.calculated, left: result.left })).not.toContain(
      "secret-value",
    );
    expect(JSON.stringify({ calculated: result.calculated, left: result.left })).not.toContain("35");
    expect(sheet.cellData["0"]["3"].f).toBe("=SUM(Sales[Revenue])");
    expect(sheet.cellData["0"]["3"].v).toBeUndefined();
  });

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

  it("chooses one cell when the condition is a number", () => {
    const sheet = {
      cellData: {
        "0": {
          "0": { v: 0 },
          "1": { v: "secret-value" },
          "2": { v: "Beds" },
          "3": { f: "=IF(A1, B1, C1)", v: 4 },
          "4": { f: "=D1" },
        },
        "1": {
          "0": { v: "secret-value" },
          "1": { f: "=IF(A2, B1, C1)", v: 4 },
        },
      },
    };
    const zero = recalculateDirty(sheet, "A1");
    expect(zero.cellData["0"]["3"].v).toBe("Beds");
    expect(zero.cellData["0"]["4"].v).toBe("Beds");
    expect(zero.cellData["0"]["1"].v).toBe("secret-value");
    expect(JSON.stringify({ calculated: zero.calculated, left: zero.left })).not.toContain("secret-value");
    expect(sheet.cellData["0"]["3"].v).toBe(4);
    const text = recalculateDirty(sheet, "A2");
    expect(text.cellData["1"]["1"].v).toBe(4);
    expect(text.left).toContain("B2");
    sheet.cellData["0"]["0"] = { v: 2 };
    const other = recalculateDirty(sheet, "A1");
    expect(other.cellData["0"]["3"].v).toBe("secret-value");
    expect(other.cellData["0"]["2"].v).toBe("Beds");
    expect(JSON.stringify({ calculated: other.calculated, left: other.left })).not.toContain("secret-value");
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

  it("turns a number into its opposite", () => {
    const sheet = {
      cellData: {
        "0": { "0": { v: -4 }, "1": { f: "=NOT(A1)", v: 1 }, "2": { f: "=B1" } },
        "1": { "0": { v: 0 }, "1": { f: "= NOT(A2)", v: 0 } },
        "2": { "0": { v: "secret-value" }, "1": { f: "=NOT(A3)", v: 1 } },
      },
    };
    const result = recalculateDirty(sheet, "A1");
    expect(result.cellData["0"]["1"].v).toBe(0);
    expect(result.cellData["0"]["2"].v).toBe(0);
    expect(result.calculated).toContain("B1");
    const zero = recalculateDirty(sheet, "A2");
    expect(zero.cellData["1"]["1"].v).toBe(1);
    const text = recalculateDirty(sheet, "A3");
    expect(text.cellData["2"]["1"].v).toBe(1);
    expect(text.left).toContain("B3");
    expect(JSON.stringify({ calculated: text.calculated, left: text.left })).not.toContain("secret-value");
    expect(JSON.stringify({ calculated: result.calculated, left: result.left })).not.toContain("NOT");
    expect(sheet.cellData["0"]["1"].v).toBe(1);
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

  it("requires both cells before the result is true", () => {
    const sheet = {
      cellData: {
        "0": { "0": { v: 2 }, "1": { v: 0 }, "2": { f: "=AND(A1,B1)", v: 1 }, "3": { f: "=C1" } },
        "1": { "0": { v: "secret-value" }, "1": { v: 4 }, "2": { f: "= AND(A2, B2)", v: 0 } },
      },
    };
    const result = recalculateDirty(sheet, "A1");
    expect(result.cellData["0"]["2"].v).toBe(0);
    expect(result.cellData["0"]["3"].v).toBe(0);
    expect(result.calculated).toContain("C1");
    const text = recalculateDirty(sheet, "A2");
    expect(text.cellData["1"]["2"].v).toBe(0);
    expect(text.left).toContain("C2");
    expect(JSON.stringify({ calculated: text.calculated, left: text.left })).not.toContain("secret-value");
    expect(JSON.stringify({ calculated: result.calculated, left: result.left })).not.toContain("AND");
    expect(sheet.cellData["0"]["2"].v).toBe(1);
    const yes = recalculateDirty(
      { cellData: { "0": { "0": { v: -4 }, "1": { v: 3 }, "2": { f: "=AND(A1,B1)", v: 0 } } } },
      "A1",
    );
    expect(yes.cellData["0"]["2"].v).toBe(1);
  });

  it("accepts either cell", () => {
    const sheet = {
      cellData: {
        "0": { "0": { v: 0 }, "1": { v: 3 }, "2": { f: "=OR(A1,B1)", v: 0 }, "3": { f: "=C1" } },
        "1": { "0": { v: 0 }, "1": { v: 0 }, "2": { f: "= OR(A2, B2)", v: 1 } },
        "2": { "0": { v: "secret-value" }, "1": { v: 4 }, "2": { f: "=OR(A3,B3)", v: 1 } },
      },
    };
    const result = recalculateDirty(sheet, "A1");
    expect(result.cellData["0"]["2"].v).toBe(1);
    expect(result.cellData["0"]["3"].v).toBe(1);
    const neither = recalculateDirty(sheet, "A2");
    expect(neither.cellData["1"]["2"].v).toBe(0);
    const text = recalculateDirty(sheet, "A3");
    expect(text.cellData["2"]["2"].v).toBe(1);
    expect(text.left).toContain("C3");
    expect(JSON.stringify({ calculated: text.calculated, left: text.left })).not.toContain("secret-value");
    expect(sheet.cellData["0"]["2"].v).toBe(0);
  });
});