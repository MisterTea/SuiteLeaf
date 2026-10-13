import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import {
  applyCopiedTextFormat,
  copyTextFormat,
} from "../apps/web/src/editors/doc-paint-format";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "inline*",
      group: "block",
      attrs: {
        spaceBefore: { default: null },
        lineSpacing: { default: null },
        indent: { default: null },
      },
    },
    heading: {
      content: "inline*",
      group: "block",
      attrs: {
        level: { default: 1 },
        spaceBefore: { default: null },
        lineSpacing: { default: null },
      },
    },
    text: { group: "inline" },
  },
  marks: {
    bold: {},
    italic: {},
    textStyle: {
      attrs: {
        color: { default: null },
        fontSize: { default: null },
        fontFamily: { default: null },
      },
    },
  },
});

const sentence = "Apples were 4 dollars.";
const tail = " The stall closed.";

function marketDoc() {
  const styled = [
    schema.mark("bold"),
    schema.mark("italic"),
    schema.mark("textStyle", {
      fontSize: "18pt",
      color: "#1a73e8",
      fontFamily: "Georgia",
    }),
  ];
  return schema.node("doc", null, [
    schema.node("heading", { level: 1, spaceBefore: 24, lineSpacing: "double" }, [
      schema.text("Market", styled),
    ]),
    schema.node("paragraph", { indent: 0.5 }, [schema.text(sentence + tail)]),
  ]);
}

function stateAt(doc: ReturnType<typeof marketDoc>, from: number, to: number) {
  return EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, from, to),
  });
}

describe("copied text format", () => {
  it("paints bold, 18 pt, and a color onto a plain string and leaves the rest alone", () => {
    const doc = marketDoc();
    const source = stateAt(doc, 1, 7);
    const format = copyTextFormat(source);
    expect(format).toEqual({ bold: true, fontSize: "18pt", color: "#1a73e8" });

    const sentenceStart = 9;
    const sentenceEnd = sentenceStart + sentence.length;
    const target = stateAt(doc, sentenceStart, sentenceEnd);
    const next = target.apply(applyCopiedTextFormat(target, format)).doc;

    expect(next.textContent).toBe(doc.textContent);
    expect(next.textBetween(sentenceStart, sentenceEnd)).toBe(sentence);
    const painted = next.nodeAt(sentenceStart);
    expect(painted?.isText).toBe(true);
    expect(painted?.text).toBe(sentence);
    expect(painted?.marks.map((mark) => mark.type.name).sort()).toEqual([
      "bold",
      "textStyle",
    ]);
    const style = painted?.marks.find((mark) => mark.type.name === "textStyle");
    expect(style?.attrs.fontSize).toBe("18pt");
    expect(style?.attrs.color).toBe("#1a73e8");
    expect(style?.attrs.fontFamily).toBeNull();

    const outside = next.nodeAt(sentenceEnd);
    expect(outside?.text).toBe(tail);
    expect(outside?.marks).toEqual([]);

    const market = next.nodeAt(1);
    expect(market?.text).toBe("Market");
    expect(market?.marks.map((mark) => mark.type.name).sort()).toEqual([
      "bold",
      "italic",
      "textStyle",
    ]);
    expect(
      market?.marks.find((mark) => mark.type.name === "textStyle")?.attrs,
    ).toMatchObject({ fontSize: "18pt", color: "#1a73e8", fontFamily: "Georgia" });

    expect(next.child(0).type.name).toBe("heading");
    expect(next.child(0).attrs).toEqual({
      level: 1,
      spaceBefore: 24,
      lineSpacing: "double",
    });
    expect(next.child(1).type.name).toBe("paragraph");
    expect(next.child(1).attrs).toEqual({
      spaceBefore: null,
      lineSpacing: null,
      indent: 0.5,
    });
  });

  it("an empty copy adds nothing", () => {
    const doc = marketDoc();
    const sentenceStart = 9;
    const sentenceEnd = sentenceStart + sentence.length;
    const plain = stateAt(doc, sentenceEnd, sentenceEnd + tail.length);
    expect(copyTextFormat(plain)).toEqual({
      bold: false,
      fontSize: null,
      color: null,
    });
    const target = stateAt(doc, sentenceStart, sentenceEnd);
    const next = target.apply(applyCopiedTextFormat(target, copyTextFormat(plain)));
    expect(next.doc.toJSON()).toEqual(doc.toJSON());
    expect(next.doc.textBetween(sentenceStart, sentenceEnd)).toBe(sentence);
    expect(next.doc.nodeAt(sentenceEnd)?.marks).toEqual([]);
  });
});
