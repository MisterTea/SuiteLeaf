import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { DocumentRoom, createFile, editParagraph } from "../packages/core/src";

describe("a viewer in the document room", () => {
  it("joins and sees the text without applying an edit", () => {
    const file = createFile("doc", "Beds");
    file.content = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Tomatoes are in" }] },
      ],
    };
    const room = new DocumentRoom(file);
    const maya = room.join({ id: "maya", name: "Maya", role: "editor" }, 1);
    const lars = room.join({ id: "lars", name: "Lars", role: "viewer" }, 2);
    expect(maya.joined).toBe(true);
    expect(lars.joined).toBe(true);
    expect(lars.mode).toBe("multiuser");
    const local = new Y.Doc();
    editParagraph(local, 0, "VIEWER SHOULD NOT LAND");
    const update = Y.encodeStateAsUpdate(local);
    expect(room.applyUpdate("lars", update, null, 3)).toBe(false);
    editParagraph(room.doc, 0, "Tomatoes are picked");
    const editorUpdate = Y.encodeStateAsUpdate(room.doc);
    expect(room.applyUpdate("maya", editorUpdate, null, 4)).toBe(true);
    expect(room.present().sort()).toEqual(["lars", "maya"]);
  });
});
