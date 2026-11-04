/** @vitest-environment jsdom */
import { Editor, Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { reviewFromRoom, syncReview } from "../../packages/core/src";
import { ReviewAttr, reviewSyncPlugin } from "../../apps/web/src/editors/collab-review-sync";

describe("review sync plugin", () => {
  it("copies a review onto the open document and back to the room", () => {
    const room = new Y.Doc();
    syncReview(room, {
      decisions: [{ block: 1, note: "Block 1 needs a choice. Maya and Sam both changed it." }],
      choices: [{ block: 1, side: "left" }],
      approvedVersion: "rev-1",
    });
    const editor = new Editor({
      extensions: [
        StarterKit,
        ReviewAttr,
        Extension.create({
          name: "reviewSyncTest",
          addProseMirrorPlugins() {
            return [reviewSyncPlugin(room)];
          },
        }),
      ],
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "North" }] }] },
    });
    const opened = editor.getJSON() as { attrs?: { review?: { approvedVersion?: string } }; content?: { content?: { text?: string }[] }[] };
    expect(opened.attrs?.review?.approvedVersion).toBe("rev-1");
    expect(opened.content?.[0]?.content?.[0]?.text).toBe("North");
    editor.view.dispatch(
      editor.state.tr.setDocAttribute("review", {
        decisions: [{ block: 1, note: "secret-value" }],
        choices: [],
        approvedVersion: "rev-2",
      }),
    );
    const stored = reviewFromRoom(room);
    expect(stored?.decisions[0]?.note).toBe("Block 1 needs a choice.");
    expect(stored?.approvedVersion).toBe("rev-2");
    expect(JSON.stringify(stored)).not.toContain("secret-value");
    expect(editor.getJSON().content?.[0]?.content?.[0]?.text).toBe("North");
    room.getMap("docAttrs").set("review", room.getMap("docAttrs").get("review"));
    expect(editor.getJSON().content?.[0]?.content?.[0]?.text).toBe("North");
    editor.destroy();
    const empty = new Y.Doc();
    const plain = new Editor({
      extensions: [
        StarterKit,
        ReviewAttr,
        Extension.create({
          name: "reviewSyncEmpty",
          addProseMirrorPlugins() {
            return [reviewSyncPlugin(empty)];
          },
        }),
      ],
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "North" }] }] },
    });
    expect(plain.getJSON().content?.[0]?.content?.[0]?.text).toBe("North");
    expect((plain.getJSON() as { attrs?: { review?: unknown } }).attrs?.review ?? null).toBeNull();
    plain.destroy();
  });
});
