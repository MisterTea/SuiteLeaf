import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { connectDocs } from "../packages/core/src/collab";
import { mirrorSheetCells } from "../apps/web/src/collab/sheet-cells";
import { projectSheetSizes, watchRemoteSheetSizes } from "../apps/web/src/collab/sheet-sizes";

const column = "fees\u001fcolumn\u001f0";
const row = "fees\u001frow\u001f1";

describe("shared row and column sizes", () => {
  it("stores a width and leaves a hidden row alone", () => {
    const widths = projectSheetSizes(new Map(), {
      mutations: [{
        id: "sheet.mutation.set-col-data",
        params: {
          subUnitId: "fees",
          columnData: { 0: { w: 120.4, hd: 1, custom: "secret-value" }, 1: { hd: 1 } },
        },
      }],
    });
    expect(JSON.parse(widths.get(column)!)).toBe(120);
    expect(widths.has("fees\u001fcolumn\u001f1")).toBe(false);
    expect(JSON.stringify([...widths.values()])).not.toContain("secret-value");
    const refused = projectSheetSizes(widths, {
      role: "commenter",
      mutations: [{
        id: "sheet.mutation.set-col-data",
        params: { subUnitId: "fees", columnData: { 0: { w: 40 } } },
      }, {
        id: "sheet.mutation.set-col-data",
        params: { subUnitId: "secret-value\nfees", columnData: { 0: { w: 40 } } },
      }],
    });
    expect(JSON.parse(refused.get(column)!)).toBe(120);
    const heights = projectSheetSizes(new Map([[row, "30"]]), {
      mutations: [{
        id: "sheet.mutation.insert-row",
        params: { subUnitId: "fees", range: { startRow: 0, endRow: 0 } },
      }],
    });
    expect(heights.get("fees\u001frow\u001f2")).toBe("30");
    expect(heights.has(row)).toBe(false);
    const cleared = projectSheetSizes(widths, {
      mutations: [{
        id: "sheet.mutation.set-col-data",
        params: { subUnitId: "fees", columnData: { 0: null } },
      }],
    });
    expect(cleared.has(column)).toBe(false);
    const local = new Y.Doc();
    const remote = new Y.Doc();
    connectDocs(local, remote);
    const seen: Array<number | null> = [];
    const stop = watchRemoteSheetSizes(remote, (changes) => seen.push(changes[0]?.size ?? null));
    mirrorSheetCells(local, {
      mutations: [{
        id: "sheet.mutation.set-row-data",
        params: { subUnitId: "fees", rowData: { 1: { h: 30 } } },
      }],
    });
    expect(remote.getMap("sheetSizes").get(row)).toBe("30");
    stop();
    local.transact(() => local.getMap("sheetSizes").set(row, "40"), "sheet-local");
    expect(seen).toEqual([30]);
    const dropped = projectSheetSizes(new Map([[row, "30"], ["fees\u001frow\u001f4", "18"]]), {
      mutations: [{
        id: "sheet.mutation.remove-row",
        params: { subUnitId: "fees", range: { startRow: 1, endRow: 1 } },
      }, {
        id: "sheet.mutation.remove-sheet",
        params: { subUnitId: "beds" },
      }, {
        id: "sheet.mutation.move-rows",
        params: { subUnitId: "fees", sourceRange: { startRow: 0, endRow: 0 }, targetRange: { startRow: 2 } },
      }, {
        id: "sheet.mutation.set-row-data",
        params: { subUnitId: "fees", rowData: { 8: { h: -1 }, 9: "tall" } },
      }],
    });
    expect(dropped.has(row)).toBe(false);
    expect(dropped.get("fees\u001frow\u001f3")).toBe("18");
    expect(projectSheetSizes(new Map(), { mutations: "nope" }).size).toBe(0);
    const shifted = projectSheetSizes(new Map([
      [row, "30"],
      ["fees\u001fcolumn\u001f0", "80"],
      ["bad", "1"],
    ]), {
      mutations: [{
        id: "sheet.mutation.move-rows",
        params: { subUnitId: "fees", sourceRange: { startRow: 0, endRow: 1 }, targetRange: { startRow: 1 } },
      }, {
        id: "sheet.mutation.insert-col",
        params: { subUnitId: "fees", range: { startColumn: 0, endColumn: 0 } },
      }, {
        id: "sheet.mutation.set-row-data",
        params: { subUnitId: "fees", rowData: { 2: { h: 3000 }, x: { h: 10 } } },
      }, {
        id: "sheet.mutation.insert-row",
        params: { subUnitId: "fees", range: { startRow: 0, endRow: 20_000 } },
      }],
    });
    expect(shifted.get("fees\u001fcolumn\u001f1")).toBe("80");
    expect(shifted.get(row)).toBe("30");
    const direct = new Y.Doc();
    const directSeen: Array<number | null> = [];
    const stopDirect = watchRemoteSheetSizes(direct, (changes) => {
      directSeen.push(changes[0]?.size ?? null);
    });
    direct.getMap("sheetSizes").set(row, "30");
    direct.getMap("sheetSizes").set(row, "nope");
    direct.getMap("sheetSizes").delete(row);
    direct.getMap("sheetSizes").set("bad", "1");
    direct.transact(() => direct.getMap("sheetSizes").set(row, "11"), "sheet-local");
    stopDirect();
    expect(directSeen).toEqual([30, null]);
    const movedColumn = projectSheetSizes(new Map([["fees\u001fcolumn\u001f0", "80"]]), {
      mutations: [{
        id: "sheet.mutation.move-columns",
        params: { subUnitId: "fees", sourceRange: { startColumn: 0, endColumn: 0 }, targetRange: { startColumn: 2 } },
      }, {
        id: "sheet.mutation.insert-row",
        params: { subUnitId: "fees", range: { startRow: -1, endRow: 1 } },
      }, {
        id: "sheet.mutation.remove-sheet",
        params: { subUnitId: "fees" },
      }],
    });
    expect(movedColumn.size).toBe(0);
  });
});
