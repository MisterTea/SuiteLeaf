import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import type { JsonNode } from "@suiteleaf/core";
import {
  invertLocalParagraph,
  localParagraphRange,
  recordLocalParagraph,
  restoreLocalParagraph,
} from "../apps/web/src/editors/doc-local-undo";

function doc(paragraphs: JsonNode[]): JsonNode {
  return { type: "doc", content: paragraphs };
}

describe("local shared-document undo", () => {
  it("puts one paragraph back and leaves the other person's marks", () => {
    const north: JsonNode = {
      type: "paragraph",
      content: [{ type: "text", text: "North plot", marks: [{ type: "bold" }] }],
    };
    const picture: JsonNode = { type: "image", attrs: { src: "plot.png" } };
    const before = doc([picture, north, { type: "paragraph", content: [{ type: "text", text: "Beds" }] }]);
    const after = doc([picture, north, { type: "paragraph", content: [{ type: "text", text: "Beds stay" }] }]);
    const edit = recordLocalParagraph(before, after);
    expect(edit?.index).toBe(1);
    const restored = restoreLocalParagraph(after, edit!);
    expect(restored.content?.[0]).toEqual(picture);
    expect(restored.content?.[1]).toEqual(north);
    expect(restored.content?.[2]).toEqual({ type: "paragraph", content: [{ type: "text", text: "Beds" }] });
  });

  it("records a mark change on the same words", () => {
    const before = doc([{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Beds" }] }]);
    const after = doc([
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Beds", marks: [{ type: "bold" }] }],
      },
    ]);
    const edit = recordLocalParagraph(before, after);
    expect(edit?.before.type).toBe("heading");
    expect(restoreLocalParagraph(after, edit!).content?.[0]).toEqual(before.content?.[0]);
  });

  it("does not record an inserted or deleted paragraph", () => {
    const one = doc([{ type: "paragraph", content: [{ type: "text", text: "Beds" }] }]);
    const two = doc([
      { type: "paragraph", content: [{ type: "text", text: "Beds" }] },
      { type: "paragraph", content: [{ type: "text", text: "North" }] },
    ]);
    expect(recordLocalParagraph(one, two)).toBeNull();
    expect(recordLocalParagraph(two, one)).toBeNull();
    expect(recordLocalParagraph(one, one)).toBeNull();
    expect(recordLocalParagraph(null, null)).toBeNull();
  });

  it("finds the block to replace in the open document, counting as the record does", () => {
    const schema = new Schema({
      nodes: {
        doc: { content: "block+" },
        paragraph: { group: "block", content: "text*" },
        heading: { group: "block", content: "text*" },
        blockquote: { group: "block", content: "block+" },
        text: {},
      },
    });
    const open = schema.nodeFromJSON(
      doc([
        { type: "heading", content: [{ type: "text", text: "Plan" }] },
        { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "North plot" }] }] },
        { type: "paragraph", content: [{ type: "text", text: "Beds stay" }] },
      ]),
    );
    const edit = recordLocalParagraph(
      doc([
        { type: "heading", content: [{ type: "text", text: "Plan" }] },
        { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "North plot" }] }] },
        { type: "paragraph", content: [{ type: "text", text: "Beds" }] },
      ]),
      open.toJSON(),
    )!;
    const range = localParagraphRange(open, edit.index)!;
    expect(open.nodeAt(range.from)?.textContent).toBe("Beds stay");
    expect(range.to - range.from).toBe(open.nodeAt(range.from)!.nodeSize);
    expect(open.nodeAt(localParagraphRange(open, 1)!.from)?.textContent).toBe("North plot");
    expect(localParagraphRange(open, 3)).toBeNull();
  });

  it("redo puts the local paragraph back and a missing index changes nothing", () => {
    const before = doc([{ type: "paragraph", content: [{ type: "text", text: "Beds" }] }]);
    const after = doc([{ type: "paragraph", content: [{ type: "text", text: "Beds stay" }] }]);
    const edit = recordLocalParagraph(before, after);
    const undone = invertLocalParagraph(after, edit!);
    expect(undone?.doc.content?.[0]).toEqual(before.content?.[0]);
    const redone = invertLocalParagraph(undone!.doc, undone!.inverse);
    expect(redone?.doc).toEqual(after);
    const missing = { index: 3, before: { type: "paragraph" } };
    expect(invertLocalParagraph(after, missing)).toBeNull();
    expect(restoreLocalParagraph(after, missing)).toEqual(after);
  });
});
