import { Schema } from "@tiptap/pm/model";
import { history, undo } from "@tiptap/pm/history";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createFile } from "../packages/core/src";
import { exportDocx } from "../packages/core/src/docx-export";
import { importOffice } from "../packages/core/src/office";
import {
  acceptSuggestions,
  listSuggestions,
  rejectSuggestions,
  resolveSuggestions,
} from "../packages/core/src/suggestions";
import type { JsonNode } from "../packages/core/src";
import {
  replaceDocument,
  suggestionKey,
  suggestionPlugin,
} from "../apps/web/src/editors/doc-suggestions";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "inline*",
      group: "block",
      attrs: { suggestionHeading: { default: null } },
    },
    heading: {
      content: "inline*",
      group: "block",
      attrs: {
        level: { default: 1 },
        suggestionHeading: { default: null },
      },
    },
    text: { group: "inline" },
  },
  marks: {
    bold: {},
    italic: {},
    underline: {},
    suggestion: {
      attrs: {
        id: { default: "" },
        kind: { default: "insert" },
        author: { default: "" },
        time: { default: "" },
        property: { default: null },
        before: { default: null },
        after: { default: null },
      },
      excludes: "",
      inclusive: false,
    },
  },
});

function suggesting(text = "We now serve very 40 customers and the project is on budget.") {
  let state = EditorState.create({
    schema,
    plugins: [history(), suggestionPlugin()],
    doc: schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text(text)]),
    ]),
  });
  state = apply(
    state,
    state.tr.setMeta(suggestionKey, { mode: "suggesting", author: "Jordan" }),
  );
  return state;
}
function apply(state: EditorState, tr: Transaction) {
  return state.apply(tr);
}
function find(state: EditorState, text: string) {
  let pos = -1;
  state.doc.descendants((node, at) => {
    if (pos >= 0 || !node.isText || !node.text) return;
    const index = node.text.indexOf(text);
    if (index >= 0) pos = at + index;
  });
  if (pos < 0) throw new Error(`missing ${text}`);
  return pos;
}
function json(state: EditorState): JsonNode {
  return state.doc.toJSON() as JsonNode;
}
function suggestionText(state: EditorState, kind: string) {
  return listSuggestions(json(state))
    .filter((suggestion) => suggestion.kind === kind)
    .map((suggestion) => suggestion.text);
}

describe("suggesting mode", () => {
  it("records an insertion, a deletion, and a formatting change as separate suggestions", () => {
    let state = suggesting();
    const forty = find(state, "40");
    state = apply(state, state.tr.insertText("approximately ", forty));
    const very = find(state, "very");
    state = apply(state, state.tr.delete(very, very + 5));
    const budget = find(state, "on budget");
    state = apply(
      state,
      state.tr.addMark(budget, budget + "on budget".length, schema.marks.bold.create()),
    );
    const suggestions = listSuggestions(json(state));
    expect(suggestions.map((item) => item.kind).sort()).toEqual([
      "delete",
      "format",
      "insert",
    ]);
    expect(suggestionText(state, "insert")).toEqual(["approximately "]);
    expect(suggestionText(state, "delete")).toEqual(["very "]);
    expect(suggestions.find((item) => item.kind === "format")).toMatchObject({
      property: "bold",
      author: "Jordan",
      before: "false",
      after: "true",
    });
    expect(suggestions.every((item) => item.author === "Jordan" && item.time)).toBe(true);
    const end = find(state, "approximately") + "approximately".length;
    state = apply(state, state.tr.insertText(" more", end));
    expect(suggestionText(state, "insert")).toEqual(["approximately more "]);
  });

  it("records a heading change and restores it when the level is changed back", () => {
    let state = suggesting("Quarterly Report");
    const pos = find(state, "Quarterly") - 1;
    state = apply(
      state,
      state.tr.setNodeMarkup(pos, schema.nodes.heading, { level: 1 }),
    );
    const heading = listSuggestions(json(state)).find((item) => item.kind === "heading");
    expect(heading).toMatchObject({ before: "0", after: "1", author: "Jordan" });
    state = apply(
      state,
      state.tr.setNodeMarkup(pos, schema.nodes.paragraph, { suggestionHeading: null }),
    );
    expect(listSuggestions(json(state)).some((item) => item.kind === "heading")).toBe(false);
    expect(state.doc.firstChild?.type.name).toBe("paragraph");
  });

  it("accepts or rejects one suggestion, and undo restores an accept-all", () => {
    let state = suggesting();
    state = apply(state, state.tr.insertText("approximately ", find(state, "40")));
    state = apply(state, state.tr.delete(find(state, "very"), find(state, "very") + 5));
    const before = json(state);
    const insertion = listSuggestions(before).find((item) => item.kind === "insert")!;
    state = apply(state, replaceDocument(state, acceptSuggestions(before, [insertion.id])));
    expect(suggestionText(state, "insert")).toEqual([]);
    expect(state.doc.textContent).toContain("approximately ");
    const deletion = listSuggestions(json(state)).find((item) => item.kind === "delete")!;
    state = apply(state, replaceDocument(state, rejectSuggestions(json(state), [deletion.id])));
    expect(state.doc.textContent).toContain("very");
    expect(listSuggestions(json(state))).toEqual([]);
    state = suggesting();
    state = apply(state, state.tr.insertText("approximately ", find(state, "40")));
    state = apply(state, state.tr.delete(find(state, "very"), find(state, "very") + 5));
    state = apply(state, replaceDocument(state, acceptSuggestions(json(state), "all")));
    expect(listSuggestions(json(state))).toEqual([]);
    expect(state.doc.textContent).toContain("approximately ");
    expect(state.doc.textContent).not.toContain("very");
    let undone = false;
    undo(state, (tr) => {
      state = apply(state, tr);
      undone = true;
    });
    expect(undone).toBe(true);
    expect(listSuggestions(json(state)).map((item) => item.kind).sort()).toEqual([
      "delete",
      "insert",
    ]);
  });

  it("keeps suggestions through a JSON save and chooses text for plain export", () => {
    let state = suggesting();
    state = apply(state, state.tr.insertText("approximately ", find(state, "40")));
    const saved = JSON.parse(JSON.stringify(json(state))) as JsonNode;
    expect(listSuggestions(saved)).toHaveLength(1);
    const accepted = resolveSuggestions(saved, "accepted");
    const plain = (node: JsonNode): string =>
      (node.text ?? "") + (node.content ?? []).map(plain).join("");
    expect(plain(accepted)).toContain("approximately ");
    expect(JSON.stringify(accepted)).not.toContain('"kind":"insert"');
    const original = resolveSuggestions(saved, "original");
    const text = JSON.stringify(original);
    expect(text).not.toContain("approximately");
    expect(text).toContain("very");
  });
});

describe("Word tracked changes", () => {
  it("writes revisions and imports them with their authors", async () => {
    const file = createFile("doc", "Quarterly Report");
    if (file.kind !== "doc") throw new Error("expected a document");
    file.content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "We now serve " },
            {
              type: "text",
              text: "very ",
              marks: [
                {
                  type: "suggestion",
                  attrs: {
                    id: "del-1",
                    kind: "delete",
                    author: "Jordan",
                    time: "2026-10-12T15:00:00.000Z",
                  },
                },
              ],
            },
            {
              type: "text",
              text: "approximately ",
              marks: [
                {
                  type: "suggestion",
                  attrs: {
                    id: "ins-1",
                    kind: "insert",
                    author: "Jordan",
                    time: "2026-10-12T15:01:00.000Z",
                  },
                },
              ],
            },
            { type: "text", text: "40 customers and the project is " },
            {
              type: "text",
              text: "on budget",
              marks: [
                { type: "bold" },
                {
                  type: "suggestion",
                  attrs: {
                    id: "fmt-1",
                    kind: "format",
                    author: "Jordan",
                    time: "2026-10-12T15:02:00.000Z",
                    property: "bold",
                    before: "false",
                    after: "true",
                  },
                },
              ],
            },
            { type: "text", text: "." },
          ],
        },
      ],
    };
    const bytes = await exportDocx(file);
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("<w:ins ");
    expect(xml).toContain("<w:del ");
    expect(xml).toContain("<w:rPrChange ");
    expect(xml).toContain('w:author="Jordan"');
    expect(xml).not.toContain("\uE000");
    const acceptedXml = xml
      .replace(/<w:del\b[\s\S]*?<\/w:del>/g, "")
      .replace(/<\/?w:ins\b[^>]*>/g, "")
      .replace(/<w:rPrChange\b[\s\S]*?<\/w:rPrChange>/g, "");
    const acceptedText = [...acceptedXml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
      .map((match) => match[1])
      .join("");
    const suiteleaf = resolveSuggestions(file.content, "accepted");
    const suiteleafText = (node: JsonNode): string =>
      (node.text ?? "") + (node.content ?? []).map(suiteleafText).join("");
    expect(acceptedText).toBe(suiteleafText(suiteleaf));
    expect(acceptedXml).toMatch(/<w:b\/>[\s\S]*on budget|on budget/);
    const bold = /<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*<w:b\/>[\s\S]*?<w:t[^>]*>on budget<\/w:t>/.test(
      acceptedXml,
    );
    expect(bold).toBe(true);

    const imported = await importOffice(bytes, "docx", "Quarterly Report.docx");
    if (imported.file.kind !== "doc") throw new Error("expected a document");
    const suggestions = listSuggestions(imported.file.content);
    expect(imported.report.warnings).toContain("3 suggestions imported");
    expect(suggestions).toHaveLength(3);
    expect(suggestions.map((item) => item.author)).toEqual(["Jordan", "Jordan", "Jordan"]);
    expect(suggestions.map((item) => item.kind).sort()).toEqual(["delete", "format", "insert"]);
  });
});
