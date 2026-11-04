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
});
