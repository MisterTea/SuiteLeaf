import { expect, it } from "vitest";
import * as Y from "yjs";
import { connectDocs } from "../packages/core/src/collab";
import { projectSheetFilters, watchRemoteFilters } from "../apps/web/src/collab/sheet-filter";
import { mirrorSheetCells } from "../apps/web/src/collab/sheet-cells";

const range = { startRow: 0, endRow: 3, startColumn: 0, endColumn: 1 };

it("shares a filter, the values it keeps, and a later row insert", () => {
  const added = projectSheetFilters(new Map(), {
    mutations: [{
      id: "sheet.mutation.set-filter-range",
      params: { subUnitId: "fees", range, filteredOutRows: [2, "secret-value\n"] },
    }],
  });
  const first = JSON.parse(added.get("fees")!) as { hiddenRows: number[]; range: { endRow: number } };
  expect(first.range.endRow).toBe(3);
  expect(first.hiddenRows).toEqual([2]);
  const kept = projectSheetFilters(added, {
    mutations: [{
      id: "sheet.mutation.set-filter-criteria",
      params: {
        subUnitId: "fees",
        col: 0,
        criteria: { colId: 0, filters: { filters: ["North", "secret-value\n"] } },
      },
    }],
  });
  const criteria = JSON.parse(kept.get("fees")!).criteria["0"].filters.filters as string[];
  expect(criteria).toEqual(["North"]);
  expect(JSON.stringify(kept.get("fees"))).not.toContain("secret-value");
  const shifted = projectSheetFilters(kept, {
    mutations: [{
      id: "sheet.mutation.insert-row",
      params: { subUnitId: "fees", range: { startRow: 1, endRow: 1 } },
    }],
  });
  const next = JSON.parse(shifted.get("fees")!) as { range: { endRow: number }; hiddenRows: number[] };
  expect(next.range.endRow).toBe(4);
  expect(next.hiddenRows).toEqual([3]);
  const cleared = projectSheetFilters(shifted, {
    role: "commenter",
    mutations: [{ id: "sheet.mutation.remove-filter", params: { subUnitId: "fees" } }],
  });
  expect(cleared.get("fees")).toBe(shifted.get("fees"));
  const removed = projectSheetFilters(shifted, {
    mutations: [{ id: "sheet.mutation.remove-filter", params: { subUnitId: "fees" } }],
  });
  expect(removed.has("fees")).toBe(false);

  const local = new Y.Doc();
  const remote = new Y.Doc();
  connectDocs(local, remote);
  const seen: Array<string | null> = [];
  const stop = watchRemoteFilters(remote, (changes) => {
    for (const change of changes) seen.push(change.filter?.criteria["0"] ? "North" : null);
  });
  mirrorSheetCells(local, {
    mutations: [
      { id: "sheet.mutation.set-filter-range", params: { subUnitId: "fees", range } },
      {
        id: "sheet.mutation.set-filter-criteria",
        params: { subUnitId: "fees", col: 0, criteria: { colId: 0, filters: { filters: ["North"] } } },
      },
    ],
  });
  expect(JSON.parse(remote.getMap("sheetFilters").get("fees")!).criteria["0"].filters.filters).toEqual(["North"]);
  expect(seen.at(-1)).toBe("North");
  remote.transact(() => remote.getMap("sheetFilters").set("fees", JSON.stringify({ range, criteria: {}, hiddenRows: [] })), "sheet-local");
  remote.getMap("sheetFilters").set("secret-value\n", "{}");
  remote.getMap("sheetFilters").delete("fees");
  expect(seen.at(-1)).toBeNull();
  stop();
  const before = projectSheetFilters(new Map(), {
    mutations: [{
      id: "sheet.mutation.set-filter-criteria",
      params: { subUnitId: "fees", col: 0, criteria: { colId: 0, filters: { blank: true, filters: ["North"] } } },
    }],
  });
  expect(before.size).toBe(0);
  const blank = projectSheetFilters(added, {
    mutations: [{
      id: "sheet.mutation.set-filter-criteria",
      params: { subUnitId: "fees", col: 0, criteria: { colId: 0, filters: { blank: true, filters: ["North"] } } },
    }],
  });
  expect(JSON.parse(blank.get("fees")!).criteria["0"].filters.blank).toBe(true);
  const clearedColumn = projectSheetFilters(blank, {
    mutations: [{
      id: "sheet.mutation.set-filter-criteria",
      params: { subUnitId: "fees", col: 0, criteria: null },
    }],
  });
  expect(JSON.parse(clearedColumn.get("fees")!).criteria["0"]).toBeUndefined();
  const cut = projectSheetFilters(kept, {
    mutations: [{
      id: "sheet.mutation.remove-row",
      params: { subUnitId: "fees", range: { startRow: 2, endRow: 2 } },
    }],
  });
  expect(JSON.parse(cut.get("fees")!).hiddenRows).toEqual([]);
  expect(projectSheetFilters(added, {
    mutations: [{ id: "sheet.mutation.remove-sheet", params: { subUnitId: "fees" } }],
  }).has("fees")).toBe(false);
  expect(projectSheetFilters(added, {
    mutations: [{ id: "sheet.mutation.set-filter-range", params: { subUnitId: "fees", range: { startRow: 3, endRow: 1, startColumn: 0, endColumn: 0 } } }],
  }).get("fees")).toBe(added.get("fees"));
  const repaired = projectSheetFilters(new Map([["fees", "secret-value"]]), {
    mutations: [
      { id: "sheet.mutation.set-filter-criteria" },
      { id: "sheet.mutation.set-filter-range", params: { subUnitId: "fees\n", range } },
      { id: "sheet.mutation.set-filter-range", params: { subUnitId: "fees", range: { startRow: 0 } } },
      { id: "sheet.mutation.set-filter-criteria", params: { subUnitId: "fees", col: 1.5, criteria: "North" } },
      { id: "sheet.mutation.set-filter-range", params: { subUnitId: "fees", range } },
      { id: "sheet.mutation.set-filter-criteria", params: { subUnitId: "fees", col: 0, criteria: { filters: { filters: ["North"] } } } },
      { id: "sheet.mutation.insert-col", params: { subUnitId: "fees", range: { startColumn: 0, endColumn: 0 } } },
      { id: "sheet.mutation.insert-row", params: { subUnitId: "fees", range: { startRow: 0, endRow: 20_000 } } },
      { id: "sheet.mutation.insert-row", params: { subUnitId: "fees", range: { startRow: -1 } } },
    ],
  });
  expect(JSON.parse(repaired.get("fees")!).range.startColumn).toBe(1);
  const only = projectSheetFilters(new Map([["fees", JSON.stringify({ range: { startRow: 2, endRow: 2, startColumn: 0, endColumn: 0 }, criteria: {}, hiddenRows: [2] })]]), {
    mutations: [{ id: "sheet.mutation.remove-row", params: { subUnitId: "fees", range: { startRow: 2, endRow: 2 } } }],
  });
  expect(only.has("fees")).toBe(false);
  const trimmed = projectSheetFilters(new Map([["fees", JSON.stringify({ range: { startRow: 0, endRow: 2, startColumn: 0, endColumn: 0 }, criteria: {}, hiddenRows: [] })]]), {
    mutations: [{ id: "sheet.mutation.remove-row", params: { subUnitId: "fees", range: { startRow: 2, endRow: 2 } } }],
  });
  expect(JSON.parse(trimmed.get("fees")!).range.endRow).toBe(1);
  expect(JSON.stringify(repaired.get("fees"))).not.toContain("secret-value");
});
