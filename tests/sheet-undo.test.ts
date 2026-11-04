import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { connectDocs } from "../packages/core/src/collab";
import { sheetCellKey } from "../apps/web/src/collab/sheet-cells";
import { noteSheetEdit, redoLocalSheet, sheetConflictText, undoLocalSheet } from "../apps/web/src/collab/sheet-undo";

describe("sheet undo", () => {
  it("takes back a local cell and leaves the other person's cell", () => {
    const local = new Y.Doc();
    const remote = new Y.Doc();
    connectDocs(local, remote);
    const fees = sheetCellKey("fees", 0, 0)!;
    const beds = sheetCellKey("beds", 0, 26)!;
    const before = new Map<string, string>();
    local.getMap<string>("cells").set(fees, JSON.stringify({ v: "North" }));
    noteSheetEdit(local, before, new Map(local.getMap<string>("cells").entries()));
    remote.getMap<string>("cells").set(beds, JSON.stringify({ v: "West" }));
    expect(undoLocalSheet(local)?.conflicts).toEqual([]);
    expect(local.getMap<string>("cells").get(fees)).toBeUndefined();
    expect(remote.getMap<string>("cells").get(fees)).toBeUndefined();
    expect(local.getMap<string>("cells").get(beds)).toContain("West");
    expect(redoLocalSheet(local)?.conflicts).toEqual([]);
    expect(local.getMap<string>("cells").get(fees)).toContain("North");
    expect(remote.getMap<string>("cells").get(fees)).toContain("North");

    remote.getMap<string>("cells").set(fees, JSON.stringify({ v: "West" }));
    const conflict = undoLocalSheet(local);
    expect(conflict?.conflicts).toEqual([fees]);
    expect(local.getMap<string>("cells").get(fees)).toContain("West");
    const notice = sheetConflictText(conflict?.conflicts ?? []);
    expect(notice).toBe("fees A1 was changed by someone else and was left as it is.");
    expect(notice).not.toContain("North");
    expect(sheetConflictText([fees, beds])).toBe(
      "fees A1, beds AA1 were changed by someone else and were left as they are.",
    );
    expect(sheetConflictText(["not-a-cell"])).toBe(
      "A cell was changed by someone else and was left as it is.",
    );
    expect(undoLocalSheet(local)).toBeNull();
    noteSheetEdit(local, new Map(local.getMap<string>("cells").entries()), new Map(local.getMap<string>("cells").entries()));
    expect(redoLocalSheet(new Y.Doc())).toBeNull();
  });
});
