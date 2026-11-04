import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { connectDocs } from "../packages/core/src/collab";
import { mirrorSheetCells } from "../apps/web/src/collab/sheet-cells";
import { projectMerges, watchRemoteMerges } from "../apps/web/src/collab/sheet-merges";

const area = { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 };

describe("shared merged cells", () => {
  it("keeps a merge with its worksheet and drops a commenter's merge", () => {
    const added = projectMerges(new Map(), {
      mutations: [{
        id: "sheet.mutation.add-worksheet-merge",
        params: { subUnitId: "fees", ranges: [area, { startRow: 1, endRow: 0, startColumn: 0, endColumn: 0 }] },
      }],
    });
    expect(JSON.parse(added.get("fees")!)).toEqual([area]);
    const again = projectMerges(added, {
      mutations: [{ id: "sheet.mutation.add-worksheet-merge", params: { subUnitId: "fees", ranges: [area] } }],
    });
    expect(JSON.parse(again.get("fees")!)).toHaveLength(1);
    const grown = projectMerges(again, {
      mutations: [{
        id: "sheet.mutation.insert-row",
        params: { subUnitId: "fees", range: { startRow: 1, endRow: 1 } },
      }],
    });
    expect(JSON.parse(grown.get("fees")!)[0].endRow).toBe(2);
    const shrunk = projectMerges(grown, {
      mutations: [{
        id: "sheet.mutation.remove-row",
        params: { subUnitId: "fees", range: { startRow: 0, endRow: 0 } },
      }],
    });
    expect(JSON.parse(shrunk.get("fees")!)[0]).toMatchObject({ startRow: 0, endRow: 1 });
    const cleared = projectMerges(shrunk, {
      role: "commenter",
      mutations: [{
        id: "sheet.mutation.remove-worksheet-merge",
        params: { subUnitId: "fees", ranges: [area] },
      }],
    });
    expect(cleared.get("fees")).toBeTruthy();
    const removed = projectMerges(shrunk, {
      mutations: [{
        id: "sheet.mutation.remove-worksheet-merge",
        params: { subUnitId: "fees", ranges: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }] },
      }],
    });
    expect(removed.has("fees")).toBe(false);
    const refused = projectMerges(new Map(), {
      mutations: [{
        id: "sheet.mutation.add-worksheet-merge",
        params: { subUnitId: "secret-value\nfees", ranges: [area] },
      }],
    });
    expect([...refused.keys()]).toEqual([]);
    expect(JSON.stringify([...refused.values()])).not.toContain("secret-value");
    const dragged = projectMerges(new Map([["fees", JSON.stringify([{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }])]]), {
      mutations: [{
        id: "sheet.mutation.move-rows",
        params: {
          subUnitId: "fees",
          sourceRange: { startRow: 0, endRow: 0 },
          targetRange: { startRow: 2 },
        },
      }],
    });
    expect(JSON.parse(dragged.get("fees")!)[0].startRow).toBe(1);
    const local = new Y.Doc();
    const remote = new Y.Doc();
    connectDocs(local, remote);
    const seen: number[] = [];
    const stop = watchRemoteMerges(remote, (changes) => seen.push(changes[0]?.ranges.length ?? -1));
    mirrorSheetCells(local, {
      mutations: [{ id: "sheet.mutation.add-worksheet-merge", params: { subUnitId: "fees", ranges: [area] } }],
    });
    expect(JSON.parse(remote.getMap("merges").get("fees")!)).toEqual([area]);
    stop();
    mirrorSheetCells(local, {
      mutations: [{ id: "sheet.mutation.remove-sheet", params: { subUnitId: "fees" } }],
    });
    expect(seen).toEqual([1]);
    expect(remote.getMap("merges").has("fees")).toBe(false);
    const gone = projectMerges(new Map([["fees", JSON.stringify([area])], ["beds", "{"]]), {
      role: "view",
      mutations: [{
        id: "sheet.mutation.remove-row",
        params: { subUnitId: "fees", range: { startRow: 0, endRow: 1 } },
      }],
    });
    expect(gone.get("fees")).toBeTruthy();
    const deleted = projectMerges(new Map([["fees", JSON.stringify([area])], ["beds", "{"]]), {
      mutations: [{
        id: "sheet.mutation.remove-row",
        params: { subUnitId: "fees", range: { startRow: 0, endRow: 1 } },
      }, {
        id: "sheet.mutation.remove-row",
        params: { subUnitId: "beds", range: { startRow: 0, endRow: 0 } },
      }, {
        id: "sheet.mutation.insert-col",
        params: { subUnitId: "plots", range: { startColumn: 0, endColumn: 0 } },
      }, {
        id: "sheet.mutation.move-columns",
        params: { subUnitId: "plots", sourceRange: { startColumn: "no" }, targetRange: { startColumn: 2 } },
      }],
    });
    expect(deleted.has("fees")).toBe(false);
    const wider = projectMerges(new Map([["fees", JSON.stringify([{ startRow: 0, endRow: 2, startColumn: 0, endColumn: 2 }])]]), {
      mutations: [{
        id: "sheet.mutation.remove-col",
        params: { subUnitId: "fees", range: { startColumn: 3, endColumn: 3 } },
      }, {
        id: "sheet.mutation.remove-worksheet-merge",
        params: { subUnitId: "fees", ranges: [{ startRow: 9, endRow: 9, startColumn: 9, endColumn: 9 }] },
      }, {
        id: "sheet.mutation.move-rows",
        params: { subUnitId: "plots", sourceRange: { startRow: 0, endRow: 0 }, targetRange: { startRow: 2 } },
      }],
    });
    expect(JSON.parse(wider.get("fees")!)[0].endColumn).toBe(2);
    const kept = projectMerges(new Map([["fees", JSON.stringify([area])]]), {
      mutations: [
        null,
        { id: "sheet.mutation.add-worksheet-merge", params: { subUnitId: "fees", ranges: "no" } },
        { id: "sheet.mutation.insert-row", params: { subUnitId: "fees" } },
        { id: "sheet.mutation.insert-row", params: { subUnitId: "fees", range: { startRow: "x" } } },
        { id: "sheet.mutation.insert-row", params: { subUnitId: "fees", range: { startRow: 0, endRow: 10_001 } } },
        { id: "sheet.mutation.move-rows", params: { subUnitId: "fees", sourceRange: { startRow: 0, endRow: 1 }, targetRange: { startRow: 1 } } },
        { id: "sheet.mutation.remove-sheet" },
        { id: "sheet.mutation.move-columns", params: { subUnitId: "fees", sourceRange: { startColumn: 0, endColumn: 0 }, targetRange: { startColumn: 2 } } },
      ],
    });
    expect(JSON.parse(kept.get("fees")!)[0].endColumn).toBe(1);
    const quiet: unknown[] = [];
    const solo = new Y.Doc();
    const stopQuiet = watchRemoteMerges(solo, (changes) => quiet.push(changes));
    solo.transact(() => solo.getMap("merges").set("fees", "[]"), "sheet-local");
    solo.getMap("merges").set("secret-value\nfees", "[]");
    stopQuiet();
    expect(quiet).toEqual([]);
  });
});
