/** @vitest-environment jsdom */
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextStyleKit } from "@tiptap/extension-text-style";
import { describe, expect, it } from "vitest";
import { normalText } from "../apps/web/src/editors/doc-normal-text";

function editorWith(content: Record<string, unknown>) {
  return new Editor({
    extensions: [StarterKit, TextStyleKit, normalText],
    content,
  });
}

describe("Normal text in the editor", () => {
  it("stores the selection font on the document", () => {
    const editor = editorWith({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Hello",
              marks: [{ type: "textStyle", attrs: { fontFamily: "Georgia", fontSize: "18pt" } }],
            },
          ],
        },
      ],
    });
    editor.commands.setTextSelection({ from: 1, to: 6 });
    expect(editor.commands.updateNormalTextToMatch()).toBe(true);
    expect(editor.getJSON().attrs).toMatchObject({
      normalText: { fontFamily: "Georgia", fontSize: "18pt" },
    });
    editor.destroy();
  });

  it("paints a new paragraph after a heading", () => {
    const editor = editorWith({
      type: "doc",
      attrs: { normalText: { fontFamily: "Georgia", fontSize: "18pt" } },
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Chapter" }] },
        { type: "paragraph" },
      ],
    });
    editor.commands.focus("end");
    editor.commands.insertContent("After");
    const json = editor.getJSON();
    expect(json.attrs?.normalText).toEqual({ fontFamily: "Georgia", fontSize: "18pt" });
    const paragraph = json.content?.find((node) => node.type === "paragraph");
    expect(paragraph?.content?.[0]?.marks).toEqual([
      expect.objectContaining({
        type: "textStyle",
        attrs: expect.objectContaining({ fontFamily: "Georgia", fontSize: "18pt" }),
      }),
    ]);
    editor.destroy();
  });
});
