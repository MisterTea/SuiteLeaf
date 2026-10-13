import { Schema } from "@tiptap/pm/model";
import type { Decoration } from "@tiptap/pm/view";
import { describe, expect, it } from "vitest";
import { gutterDecorations } from "../apps/web/src/editors/doc-gutter";
import { defaultPageSettings } from "../packages/core/src/document-layout";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "text*", group: "block" },
    pageBreak: { group: "block", atom: true },
    text: {},
  },
});

const side = (deco: Decoration) =>
  (deco.type as unknown as { attrs: { "data-bind": string } }).attrs["data-bind"];

describe("binding gutter decorations", () => {
  it("puts the gutter on the left of odd pages and the right of even pages", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("Cover")]),
      schema.node("pageBreak"),
      schema.node("paragraph", null, [schema.text("Even")]),
      schema.node("pageBreak"),
      schema.node("paragraph", null, [schema.text("Odd")]),
    ]);
    const starts: number[] = [];
    doc.forEach((_node, offset) => starts.push(offset));
    const decos = gutterDecorations(
      doc,
      starts.map((pos) => ({ pos })),
      [starts[1], starts[3]],
      { ...defaultPageSettings, gutter: 48 },
    );
    expect(decos.map(side)).toEqual(["odd", "even", "even", "odd", "odd"]);
    expect(decos[0].from).toBe(starts[0]);
    expect(decos[2].from).toBe(starts[2]);
    expect(decos[4].from).toBe(starts[4]);
  });

  it("adds nothing when the gutter is zero", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("Cover")]),
    ]);
    expect(
      gutterDecorations(doc, [{ pos: 0 }], [], defaultPageSettings),
    ).toEqual([]);
  });

  it("does not assign one side to a paragraph that crosses a page", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("abcdefghij")]),
    ]);
    expect(
      gutterDecorations(
        doc,
        [{ pos: 1 }, { pos: 6 }],
        [6],
        { ...defaultPageSettings, gutter: 48 },
      ),
    ).toEqual([]);
  });
});
