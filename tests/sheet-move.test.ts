import { describe, expect, it } from "vitest";
import { projectSheetCells, sheetCellKey } from "../apps/web/src/collab/sheet-cells";

describe("dragging shared rows and columns", () => {
  it("moves a row and the formula that points at it", () => {
    const a1 = sheetCellKey("fees", 0, 0)!;
    const a2 = sheetCellKey("fees", 1, 0)!;
    const a3 = sheetCellKey("fees", 2, 0)!;
    const beds = sheetCellKey("beds", 1, 0)!;
    const before = new Map([
      [a1, JSON.stringify({ v: "North" })],
      [a2, JSON.stringify({ f: '=A1&" A1"' })],
      [a3, JSON.stringify({ v: "West" })],
      [beds, JSON.stringify({ f: "=Fees!A1" })],
    ]);
    const dragged = projectSheetCells(before, {
      mutations: [{
        id: "sheet.mutation.move-rows",
        params: {
          subUnitId: "fees",
          sourceRange: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
          targetRange: { startRow: 2, startColumn: 0 },
        },
      }],
    });
    expect(JSON.parse(dragged.get(a1)!).f).toBe('=A2&" A1"');
    expect(JSON.parse(dragged.get(a2)!).v).toBe("North");
    expect(JSON.parse(dragged.get(a3)!).v).toBe("West");
    expect(JSON.parse(dragged.get(beds)!).f).toBe("=Fees!A1");
    const stuck = projectSheetCells(before, {
      mutations: [{
        id: "sheet.mutation.move-rows",
        params: {
          subUnitId: "secret-value\nfees",
          sourceRange: { startRow: 0, endRow: 0 },
          targetRange: { startRow: 2 },
        },
      }],
    });
    expect(JSON.parse(stuck.get(a1)!).v).toBe("North");
    expect(JSON.stringify([...stuck.values()])).not.toContain("secret-value");
    const overlap = projectSheetCells(before, {
      mutations: [{
        id: "sheet.mutation.move-columns",
        params: {
          subUnitId: "fees",
          sourceRange: { startColumn: 0, endColumn: 1 },
          targetRange: { startColumn: 1 },
        },
      }],
    });
    expect(JSON.parse(overlap.get(a1)!).v).toBe("North");
    const b1 = sheetCellKey("fees", 0, 1)!;
    const columns = projectSheetCells(new Map([
      [a1, JSON.stringify("=AA1")],
      [b1, JSON.stringify({ v: "West" })],
      [sheetCellKey("fees", 0, 26)!, "{"],
    ]), {
      mutations: [{
        id: "sheet.mutation.move-columns",
        params: {
          subUnitId: "fees",
          sourceRange: { startColumn: 26, endColumn: 26 },
          targetRange: { startColumn: 28 },
        },
      }],
    });
    expect(JSON.parse(columns.get(a1)!)).toBe("=AB1");
    expect(JSON.parse(columns.get(b1)!).v).toBe("West");
    const backward = projectSheetCells(before, {
      mutations: [{
        id: "sheet.mutation.move-rows",
        params: {
          subUnitId: "fees",
          sourceRange: { startRow: 2, endRow: 2 },
          targetRange: { startRow: 0 },
        },
      }],
    });
    expect(JSON.parse(backward.get(a1)!).v).toBe("West");
    const lost = projectSheetCells(new Map([[a1, JSON.stringify({ v: "North" })]]), {
      mutations: [{
        id: "sheet.mutation.move-rows",
        params: {
          subUnitId: "fees",
          sourceRange: { startRow: 0, endRow: 0 },
          targetRange: { startRow: 1_048_577 },
        },
      }],
    });
    expect(lost.has(a1)).toBe(false);
    const plain = projectSheetCells(new Map([
      ["nope", "1"],
      [a2, JSON.stringify([1])],
      [a3, JSON.stringify({ f: 1 })],
    ]), {
      mutations: [{
        id: "sheet.mutation.move-rows",
        params: {
          subUnitId: "fees",
          sourceRange: { startRow: 1, endRow: 1 },
          targetRange: { startRow: 3 },
        },
      }],
    });
    expect(plain.get("nope")).toBe("1");
    expect(plain.get(a3)).toBe(JSON.stringify([1]));
  });
});
