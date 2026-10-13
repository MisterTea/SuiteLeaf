import { Schema } from "@tiptap/pm/model";
import { history, redo, undo } from "@tiptap/pm/history";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import {
  changeAllTransaction,
  checkOccurrence,
  copiesOf,
  ignoreOccurrence,
  previewCopies,
  suggestionCase,
} from "../apps/web/src/editors/doc-change-all";
import { misspelledWords, SPELLING_IGNORE_MARK } from "../apps/web/src/editors/doc-spelling";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
  },
  marks: {
    bold: {},
    spellingIgnore: { excludes: "", inclusive: false },
  },
});

const none = { added: [] as string[], flagged: [] as string[] };

function docOf(paragraphs: { text: string; bold?: string }[]) {
  return schema.node(
    "doc",
    null,
    paragraphs.map((paragraph) => {
      if (!paragraph.bold) return schema.node("paragraph", null, [schema.text(paragraph.text)]);
      const at = paragraph.text.indexOf(paragraph.bold);
      const before = paragraph.text.slice(0, at);
      const after = paragraph.text.slice(at + paragraph.bold.length);
      return schema.node("paragraph", null, [
        ...(before ? [schema.text(before)] : []),
        schema.text(paragraph.bold, [schema.marks.bold.create()]),
        ...(after ? [schema.text(after)] : []),
      ]);
    }),
  );
}

function stateOf(paragraphs: { text: string; bold?: string }[]) {
  return EditorState.create({
    schema,
    plugins: [history()],
    doc: docOf(paragraphs),
  });
}

function apply(state: EditorState, tr: Transaction) {
  return state.apply(tr);
}

const notes = [
  { text: "We will recieve the keys on Monday.", bold: "recieve" },
  { text: "The team will recieve a note." },
  { text: "Please recieve the guest at noon." },
  { text: "Ask them to seperate the name tags." },
  { text: "Then recieve the signed form." },
];

describe("change every copy of a typo", () => {
  it("matches the same misspelling and keeps a different typo off the list", () => {
    const state = stateOf(notes);
    const copies = copiesOf(state.doc, "recieve", none, []);
    expect(copies.map((copy) => copy.word)).toEqual(["recieve", "recieve", "recieve", "recieve"]);
    expect(previewCopies(state.doc, copies, "receive").map((copy) => copy.replacement)).toEqual([
      "receive",
      "receive",
      "receive",
      "receive",
    ]);
    expect(copiesOf(state.doc, "seperate", none, []).map((copy) => copy.word)).toEqual(["seperate"]);
    expect(suggestionCase("Recieve", "receive")).toBe("Receive");
    expect(suggestionCase("RECIEVE", "receive")).toBe("RECEIVE");
  });

  it("replaces every copy in one undo step and keeps bold", () => {
    let state = stateOf(notes);
    const copies = copiesOf(state.doc, "recieve", none, []);
    state = apply(state, changeAllTransaction(state, copies, "receive"));
    expect(state.doc.textContent).not.toContain("recieve");
    expect(state.doc.textContent).toContain("seperate");
    expect(state.doc.textContent.match(/receive/g)).toHaveLength(4);
    let bold = "";
    state.doc.descendants((node) => {
      if (node.isText && node.marks.some((mark) => mark.type.name === "bold")) bold += node.text;
    });
    expect(bold).toBe("receive");
    state = apply(state, undo(state)!);
    expect(state.doc.textContent.match(/recieve/g)).toHaveLength(4);
    state = apply(state, redo(state)!);
    expect(state.doc.textContent.match(/receive/g)).toHaveLength(4);
  });

  it("leaves an ignored copy out of a later change all", () => {
    let state = stateOf(notes);
    const copies = copiesOf(state.doc, "recieve", none, []);
    const kept = copies[3]!;
    state = apply(state, ignoreOccurrence(state, kept.from, kept.to));
    const again = copiesOf(state.doc, "recieve", none, []);
    expect(again).toHaveLength(3);
    expect(again.some((copy) => copy.from === kept.from)).toBe(false);
    expect(misspelledWords(state.doc.toJSON(), none).filter((word) => word === "recieve")).toHaveLength(3);
    const json = JSON.stringify(state.doc.toJSON());
    expect(json).toContain(SPELLING_IGNORE_MARK);
    state = apply(state, changeAllTransaction(state, again, "receive"));
    expect(state.doc.textContent.match(/recieve/g)).toHaveLength(1);
    expect(state.doc.textContent.match(/receive/g)).toHaveLength(3);
    state = apply(state, undo(state)!);
    expect(state.doc.textContent.match(/recieve/g)).toHaveLength(4);
    state = apply(state, checkOccurrence(state, kept.from, kept.to));
    expect(copiesOf(state.doc, "recieve", none, [])).toHaveLength(4);
  });
});
