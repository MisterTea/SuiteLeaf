import { describe, expect, it } from "vitest";
import { projectSheetCells, sheetCellKey, sheetCellRecords } from "../apps/web/src/collab/sheet-cells";
import { canonicalCellData, canonicalRow, sharedSortRequested, sortView, viewOrderOf, visualRow } from "../apps/web/src/collab/sheet-sort";

const reorder = {
  id: "sheet.mutation.reorder-range",
  params: {
    subUnitId: "fees",
    range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 },
    order: { 0: 1, 1: 0 },
  },
};

describe("shared and personal sheet sorts", () => {
  it("keeps a formula without its calculated result", () => {
    const records = sheetCellRecords({
      mutations: [{
        id: "sheet.mutation.set-range-values",
        params: {
          subUnitId: "fees",
          range: { startRow: 0, startColumn: 0 },
          value: { f: "=A2", v: 10, p: { body: "ten" }, s: "bold" },
        },
      }],
    });
    const stored = JSON.parse(records[0].json);
    expect(stored).toEqual({ f: "=A2", s: "bold" });
    expect(records[0].json).not.toContain("ten");
    const sharedFormula = sheetCellRecords({
      mutations: [{
        params: {
          subUnitId: "fees",
          range: { startRow: 1, startColumn: 0 },
          cellValue: { 1: { 0: { si: "group", v: 4 } } },
        },
      }],
    });
    expect(JSON.parse(sharedFormula[0].json)).toEqual({ si: "group" });
    expect(sortView({ id: "nope" })).toBeNull();
    expect(sortView({
      id: "sheet.mutation.reorder-range",
      params: { subUnitId: "fees", range: { startRow: 2, endRow: 1, startColumn: 0, endColumn: 0 }, order: { 0: 1 } },
    })).toBeNull();
    expect(sortView({
      id: "sheet.mutation.reorder-range",
      params: { subUnitId: "fees", range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 }, order: { 5: 9, 0: "no" } },
    })).toBeNull();
    expect(sharedSortRequested(null)).toBe(false);
    expect(sharedSortRequested({ sharedSort: true })).toBe(true);
    expect(viewOrderOf({})).toBeNull();
  });

  it("moves cells only when the sort is for everyone", () => {
    const north = sheetCellKey("fees", 0, 0)!;
    const west = sheetCellKey("fees", 1, 0)!;
    const before = new Map([
      [north, JSON.stringify({ v: "North" })],
      [west, JSON.stringify({ v: "West" })],
    ]);
    expect(sortView({ id: "sheet.mutation.reorder-range", params: { subUnitId: "secret-value\nfees" } })).toBeNull();
    const personal = projectSheetCells(before, { mutations: [reorder] });
    expect(personal.get(north)).toContain("North");
    expect(personal.get(west)).toContain("West");
    const shared = projectSheetCells(before, { sharedSort: true, mutations: [reorder] });
    expect(shared.get(north)).toContain("West");
    expect(shared.get(west)).toContain("North");
    const view = sortView(reorder)!;
    const edited = projectSheetCells(before, {
      viewOrder: view,
      mutations: [{
        id: "sheet.mutation.set-range-values",
        params: { subUnitId: "fees", range: { startRow: 0, startColumn: 0 }, value: { v: "East" } },
      }],
    });
    expect(edited.get(west)).toContain("East");
    expect(edited.get(north)).toContain("North");
    expect(visualRow(view, "fees", 1, 0)).toBe(0);
    expect(visualRow(null, "fees", 1, 0)).toBe(1);
    expect(visualRow(view, "fees", 4, 0)).toBe(4);
    expect(canonicalRow(null, "fees", 0, 0)).toBe(0);
    expect(canonicalRow(view, "beds", 0, 0)).toBe(0);
    expect(canonicalRow(view, "fees", 0, 3)).toBe(0);
    const restored = canonicalCellData(
      { 0: { 0: { v: "West" } }, 1: { 0: { v: "North" } } },
      view,
    );
    expect(restored[0][0]).toEqual({ v: "North" });
    expect(restored[1][0]).toEqual({ v: "West" });
    const cleared = canonicalCellData({ 0: { 0: { v: "West" } } }, view);
    expect(cleared[0][0]).toBeUndefined();
    expect(cleared[1][0]).toEqual({ v: "West" });
  });
});
