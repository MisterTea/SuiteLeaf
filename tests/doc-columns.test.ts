import { getSchema } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { exportDocx } from "../packages/core/src/docx-export";
import {
  applyColumnLayout,
  columnLayout,
} from "../apps/web/src/editors/doc-columns";

const schema = getSchema([StarterKit, columnLayout]);

function newsletter() {
  return Node.fromJSON(schema, {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Garden club news" }],
      },
      { type: "paragraph", content: [{ type: "text", text: "Plant sale" }] },
      {
        type: "paragraph",
        content: [{ type: "text", text: "Compost workshop" }],
      },
      { type: "paragraph", content: [{ type: "text", text: "New officers" }] },
    ],
  });
}

function select(doc: Node, from: number, to: number) {
  return EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, from, to),
  });
}

function run(state: EditorState, columns: 1 | 2) {
  let next = state;
  const ok = applyColumnLayout(state, columns, (tr) => {
    next = state.apply(tr);
  });
  return { ok, doc: next.doc };
}

describe("column layout", () => {
  it("puts only the selected paragraphs in two columns", () => {
    const doc = newsletter();
    const start = doc.child(0).nodeSize + 1;
    const { ok, doc: next } = run(select(doc, start, doc.content.size - 1), 2);
    expect(ok).toBe(true);
    const json = next.toJSON();
    expect(json.content[0].type).toBe("heading");
    expect(json.content[0].content[0].text).toBe("Garden club news");
    expect(json.content[1].type).toBe("columnLayout");
    expect(json.content[1].attrs.columns).toBe(2);
    expect(json.content[1].content.map((node: { content: { text: string }[] }) => node.content[0].text)).toEqual([
      "Plant sale",
      "Compost workshop",
      "New officers",
    ]);
    expect(json.content).toHaveLength(2);
  });

  it("leaves the heading alone when only the heading is selected", () => {
    const doc = newsletter();
    const { doc: next } = run(select(doc, 1, doc.child(0).nodeSize - 1), 2);
    const json = next.toJSON();
    expect(json.content[1].type).toBe("paragraph");
    expect(json.content.filter((node: { type: string }) => node.type === "columnLayout")).toHaveLength(1);
    expect(json.content[0].type).toBe("columnLayout");
    expect(json.content[0].content[0].content[0].text).toBe("Garden club news");
  });

  it("returns the paragraphs to one stream and keeps the heading", () => {
    const doc = newsletter();
    const start = doc.child(0).nodeSize + 1;
    const split = run(select(doc, start, doc.content.size - 1), 2).doc;
    const inside = split.child(0).nodeSize + 2;
    const { doc: next } = run(select(split, inside, split.content.size - 1), 1);
    const json = next.toJSON();
    expect(json.content.map((node: { type: string }) => node.type)).toEqual([
      "heading",
      "paragraph",
      "paragraph",
      "paragraph",
    ]);
    expect(json.content[0].content[0].text).toBe("Garden club news");
  });

  it("exports the heading full width and the paragraphs in two columns", async () => {
    const zip = await JSZip.loadAsync(
      await exportDocx({
        title: "Garden club news",
        content: {
          type: "doc",
          content: [
            {
              type: "heading",
              attrs: { level: 1 },
              content: [{ type: "text", text: "Garden club news" }],
            },
            {
              type: "columnLayout",
              attrs: { columns: 2 },
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Plant sale" }] },
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Compost workshop" }],
                },
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "New officers" }],
                },
              ],
            },
          ],
        },
      }),
    );
    const xml = await zip.file("word/document.xml")!.async("string");
    const sects = [...xml.matchAll(/<w:sectPr[\s\S]*?<\/w:sectPr>/g)].map(
      (match) => match[0],
    );
    // The heading paragraph ends the one-column section. The body sectPr
    // after the items is the continuous two-column section.
    const headingEnd = xml.indexOf("Plant sale");
    const headingSection = xml.slice(0, headingEnd);
    expect(headingSection).toContain("Garden club news");
    expect(headingSection).not.toContain('w:num="2"');
    expect(sects.at(-1)).toContain('w:num="2"');
    expect(sects.at(-1)).toContain('w:space="720"');
    expect(sects.at(-1)).toContain('w:val="continuous"');
    expect(xml.indexOf("New officers")).toBeLessThan(xml.lastIndexOf("<w:sectPr"));
  });
});
