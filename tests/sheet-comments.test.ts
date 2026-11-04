import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { connectDocs } from "../packages/core/src/collab";
import { commentId, projectSheetComments, watchRemoteSheetComments } from "../apps/web/src/collab/sheet-comments";
import { mirrorSheetCells } from "../apps/web/src/collab/sheet-cells";

describe("shared sheet comments", () => {
  it("keeps a commenter's note and drops a viewer's note", () => {
    expect(commentId("secret-value\nnote")).toBeNull();
    const added = projectSheetComments(new Map(), {
      role: "commenter",
      mutations: [{
        id: "thread-comment.mutation.add-comment",
        params: {
          subUnitId: "fees",
          comment: { id: "note-1", text: "Water the beds", parentId: null },
        },
      }],
    });
    expect(JSON.parse(added.get("note-1")!).body.text).toBe("Water the beds");
    const moved = projectSheetComments(added, {
      role: "commenter",
      mutations: [{
        id: "thread-comment.mutation.update-comment-ref",
        params: { subUnitId: "fees", payload: { commentId: "note-1", ref: "A3" } },
      }],
    });
    expect(JSON.parse(moved.get("note-1")!).body).toMatchObject({
      text: "Water the beds",
      ref: "A3",
      row: 2,
      column: 0,
    });
    const anchored = projectSheetComments(moved, {
      role: "commenter",
      mutations: [{
        id: "thread-comment.mutation.update-comment-ref",
        params: { subUnitId: "fees", payload: { commentId: "note-1", ref: "secret-value\nA4" } },
      }],
    });
    expect(JSON.parse(anchored.get("note-1")!).body.ref).toBe("A3");
    expect(JSON.stringify(anchored.get("note-1"))).not.toContain("secret-value");
    const named = projectSheetComments(anchored, {
      role: "commenter",
      mutations: [
        {
          id: "thread-comment.mutation.update-comment-ref",
          params: { subUnitId: "fees", payload: { commentId: "note-1", ref: "Fees!B4:C5" } },
        },
        {
          id: "thread-comment.mutation.update-comment-ref",
          params: { subUnitId: "fees", payload: { commentId: "missing", ref: "A1" } },
        },
        {
          id: "thread-comment.mutation.update-comment-ref",
          params: { subUnitId: "fees", payload: { commentId: "note-1", ref: "A1048577" } },
        },
      ],
    });
    expect(JSON.parse(named.get("note-1")!).body).toMatchObject({ ref: "Fees!B4:C5", row: 3, column: 1 });
    const word = projectSheetComments(named, {
      role: "commenter",
      mutations: [{
        id: "thread-comment.mutation.update-comment-ref",
        params: { subUnitId: "fees", payload: { commentId: "note-1", ref: "Note" } },
      }],
    });
    expect(JSON.parse(word.get("note-1")!).body).toMatchObject({ ref: "Note", row: 3, column: 1 });
    const resolved = projectSheetComments(added, {
      role: "comment",
      mutations: [{
        id: "thread-comment.mutation.resolve-comment",
        params: { subUnitId: "fees", commentId: "note-1", resolved: true },
      }],
    });
    expect(JSON.parse(resolved.get("note-1")!).body.resolved).toBe(true);
    const refused = projectSheetComments(resolved, {
      role: "viewer",
      mutations: [{
        id: "thread-comment.mutation.update-comment",
        params: { subUnitId: "fees", payload: { id: "note-1", text: "secret-value" } },
      }],
    });
    expect(JSON.parse(refused.get("note-1")!).body.text).toBe("Water the beds");
    expect(JSON.stringify([...refused.values()])).not.toContain("secret-value");
    const removed = projectSheetComments(refused, {
      mutations: [{ id: "thread-comment.mutation.delete-comment", params: { subUnitId: "fees", commentId: "note-1" } }],
    });
    expect(removed.has("note-1")).toBe(false);
    const edited = projectSheetComments(added, {
      role: "commenter",
      mutations: [{
        id: "thread-comment.mutation.update-comment",
        params: { subUnitId: "fees", payload: { id: "note-1", text: "Stake the beans" } },
      }],
    });
    expect(JSON.parse(edited.get("note-1")!).body.text).toBe("Stake the beans");
    const dropped = projectSheetComments(edited, {
      mutations: [{ id: "sheet.mutation.remove-sheet", params: { subUnitId: "fees" } }],
    });
    expect(dropped.has("note-1")).toBe(false);
    const loop: { id: string; self?: unknown } = { id: "loop" };
    loop.self = loop;
    expect(projectSheetComments(new Map([["bad", "{"]]), {
      mutations: [
        null,
        { id: "thread-comment.mutation.add-comment", params: { subUnitId: "fees", comment: loop } },
        { id: "thread-comment.mutation.resolve-comment", params: { subUnitId: "fees", commentId: "missing", resolved: false } },
        { id: "thread-comment.mutation.resolve-comment", params: { subUnitId: "fees", commentId: "bad", resolved: true } },
        { id: "thread-comment.mutation.delete-comment", params: { commentId: "secret-value\nnote" } },
      ],
    }).has("bad")).toBe(true);
    expect(projectSheetComments(edited, {
      role: 3,
      mutations: "nope",
    })).toBeTruthy();
    expect(commentId(12)).toBeNull();
    expect(commentId("   ")).toBeNull();
    expect(commentId("n".repeat(81))).toBeNull();
    const kept = projectSheetComments(new Map([["other", JSON.stringify({ sheetId: "beds", body: { id: "other" } })]]), {
      mutations: [
        { id: "thread-comment.mutation.add-comment", params: { comment: ["not-an-object"] } },
        { id: "thread-comment.mutation.add-comment" },
        { id: "thread-comment.mutation.update-comment", params: { payload: ["nope"] } },
        { id: "thread-comment.mutation.update-comment", params: { payload: { id: "missing", text: "New" } } },
        { id: "thread-comment.mutation.update-comment", params: { payload: { text: "no id" } } },
        { id: "sheet.mutation.remove-sheet", params: { subUnitId: "fees" } },
        { id: "sheet.mutation.remove-sheet", params: {} },
      ],
    });
    expect(JSON.parse(kept.get("missing")!).body.text).toBe("New");
    expect(kept.has("other")).toBe(true);
    expect(projectSheetComments(new Map([["odd", JSON.stringify({ body: "text" })]]), {
      mutations: [{ id: "thread-comment.mutation.resolve-comment", params: { commentId: "odd", resolved: true } }],
    }).get("odd")).toContain("text");

    const local = new Y.Doc();
    const remote = new Y.Doc();
    connectDocs(local, remote);
    mirrorSheetCells(local, {
      role: "commenter",
      mutations: [{
        id: "thread-comment.mutation.add-comment",
        params: { subUnitId: "fees", comment: { id: "note-1", text: "Water the beds" } },
      }],
    });
    expect(JSON.parse(remote.getMap("sheetComments").get("note-1")!).body.text).toBe("Water the beds");
    mirrorSheetCells(remote, {
      role: "view",
      mutations: [{
        id: "thread-comment.mutation.delete-comment",
        params: { commentId: "note-1", subUnitId: "fees" },
      }],
    });
    expect(local.getMap("sheetComments").get("note-1")).toBeTruthy();
    const seen: string[] = [];
    const stop = watchRemoteSheetComments(remote, (changes) => {
      seen.push(changes.map((change) => change.body?.text ?? change.id).join(","));
    });
    local.getMap("sheetComments").set("note-2", JSON.stringify({ sheetId: "fees", body: { id: "note-2", text: "Stake the beans" } }));
    local.getMap("sheetComments").set("note-2", "{");
    local.getMap("sheetComments").delete("note-2");
    stop();
    local.getMap("sheetComments").set("note-3", JSON.stringify({ sheetId: "fees", body: { text: "later" } }));
    expect(seen).toEqual(["Stake the beans", "note-2"]);
  });
});
