import { expect, it } from "vitest";
import * as Y from "yjs";
import { connectDocs } from "../packages/core/src/collab";
import { projectPivots } from "../apps/web/src/collab/sheet-pivots";
import { mirrorSheetCells } from "../apps/web/src/collab/sheet-cells";

const sales = {
  id: "sales",
  title: "Sales",
  source: { sheetId: "fees", startRow: 0, endRow: 4, startColumn: 0, endColumn: 2 },
  targetSheetId: "fees",
  rows: [0],
  columns: [1],
  value: 2,
  aggregate: "SUM",
};

it("shares a pivot and moves its source with a row insert", () => {
  const stored = projectPivots(new Map(), { pivots: [sales, { title: "Missing" }, null] }, {});
  expect(JSON.parse(stored.get("sales")!).title).toBe("Sales");
  expect(stored.has("secret-value\nx")).toBe(false);
  const shifted = projectPivots(stored, {}, {
    mutations: [{
      id: "sheet.mutation.insert-row",
      params: { subUnitId: "fees", range: { startRow: 1, endRow: 1 } },
    }],
  });
  expect(JSON.parse(shifted.get("sales")!).source).toMatchObject({ startRow: 0, endRow: 5 });
  const columns = projectPivots(stored, {}, {
    mutations: [{
      id: "sheet.mutation.insert-col",
      params: { subUnitId: "fees", range: { startColumn: 1, endColumn: 1 } },
    }],
  });
  const moved = JSON.parse(columns.get("sales")!) as { columns: number[]; value: number; source: { endColumn: number } };
  expect(moved.columns).toEqual([2]);
  expect(moved.value).toBe(3);
  expect(moved.source.endColumn).toBe(3);
  const other = projectPivots(new Map([["beds", JSON.stringify({ ...sales, id: "beds", source: { ...sales.source, sheetId: "beds" } })]]), {}, {
    mutations: [{ id: "sheet.mutation.insert-row", params: { subUnitId: "fees", range: { startRow: 0, endRow: 0 } } }],
  });
  expect(JSON.parse(other.get("beds")!).source.startRow).toBe(0);
  const cut = projectPivots(new Map([["sales", JSON.stringify({ ...sales, value: 1 })]]), {}, {
    mutations: [{ id: "sheet.mutation.remove-col", params: { subUnitId: "fees", range: { startColumn: 1, endColumn: 1 } } }],
  });
  expect(JSON.parse(cut.get("sales")!).invalid).toBe(true);
  expect(JSON.stringify(cut.get("sales"))).not.toContain("secret-value");

  const local = new Y.Doc();
  const remote = new Y.Doc();
  connectDocs(local, remote);
  mirrorSheetCells(local, {}, { pivots: [sales] });
  expect(JSON.parse(remote.getMap("pivots").get("sales")!).title).toBe("Sales");
});
