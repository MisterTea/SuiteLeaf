// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { acceptUndoExtension } from "../apps/web/src/ai/accept-undo";
import { acceptHeldEdits, clearHeldEdits, holdToolEdit } from "../apps/web/src/ai/tool-review";

describe("accepted edits", () => {
  it("puts both edits back with one undo and leaves the earlier text", async () => {
    clearHeldEdits();
    const editor = new Editor({
      extensions: [StarterKit, acceptUndoExtension],
      content: "<p>Beds</p>",
    });
    editor.commands.insertContentAt(1, "Keep ");
    expect(editor.getText()).toBe("Keep Beds");
    holdToolEdit(() => {
      editor.commands.insertContentAt(1, "Hello ");
    });
    holdToolEdit(() => {
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, " end");
    });
    expect(await acceptHeldEdits()).toBe("Accepted the waiting edits.");
    expect(editor.getText()).toBe("Hello Keep Beds end");
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getText()).toBe("Keep Beds");
    editor.destroy();
  });
});
