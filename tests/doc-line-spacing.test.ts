import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createFile } from "../packages/core/src";
import { exportDocx } from "../packages/core/src/docx-export";
import { docxLineSpacing } from "../packages/core/src/line-spacing";
import {
  applyLineSpacing,
  selectionLineSpacing,
} from "../apps/web/src/editors/doc-line-spacing";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "inline*",
      group: "block",
      attrs: { lineSpacing: { default: null } },
    },
    heading: {
      content: "inline*",
      group: "block",
      attrs: { level: { default: 1 } },
    },
    text: { group: "inline" },
  },
});

function paragraph(text: string, lineSpacing: string | null = null) {
  return schema.node(
    "paragraph",
    { lineSpacing },
    text ? [schema.text(text)] : [],
  );
}

function stateFrom(doc: ReturnType<Schema["node"]>, from: number, to = from) {
  return EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, from, to),
  });
}

describe("paragraph line spacing", () => {
  it("changes only the paragraphs in the selection", () => {
    const doc = schema.node("doc", null, [
      paragraph("Welcome to the garden club meeting tonight."),
      paragraph("Plant the south bed with winter kale."),
      paragraph("Second the motion and open the vote."),
      schema.node("heading", { level: 1 }, [schema.text("Minutes")]),
    ]);
    const welcome = stateFrom(doc, 1);
    expect(selectionLineSpacing(welcome)).toBe("single");
    const opened = welcome.apply(applyLineSpacing(welcome, "1.5").transaction);
    expect(opened.doc.child(0).attrs.lineSpacing).toBe("1.5");
    expect(opened.doc.child(1).attrs.lineSpacing).toBe(null);
    expect(opened.doc.child(2).attrs.lineSpacing).toBe(null);
    expect(selectionLineSpacing(opened)).toBe("1.5");

    const motionStart = opened.doc.child(0).nodeSize + 1;
    const motionEnd = opened.doc.content.size - opened.doc.child(3).nodeSize - 1;
    const motion = stateFrom(opened.doc, motionStart, motionEnd);
    expect(selectionLineSpacing(motion)).toBe("single");
    const doubled = motion.apply(applyLineSpacing(motion, "double").transaction);
    expect(doubled.doc.child(0).attrs.lineSpacing).toBe("1.5");
    expect(doubled.doc.child(1).attrs.lineSpacing).toBe("double");
    expect(doubled.doc.child(2).attrs.lineSpacing).toBe("double");
    expect(doubled.doc.child(3).type.name).toBe("heading");
  });

  it("reports mixed spacing when the selection covers two values", () => {
    const doc = schema.node("doc", null, [
      paragraph("Welcome", "1.5"),
      paragraph("Motion", "double"),
    ]);
    const both = stateFrom(doc, 1, doc.content.size - 1);
    expect(selectionLineSpacing(both)).toBe("mixed");
  });
});

describe("docx paragraph spacing", () => {
  it("writes each paragraph's line spacing instead of one value for the document", async () => {
    expect(docxLineSpacing("1.5")).toEqual({ line: 360, lineRule: "auto" });
    expect(docxLineSpacing("double")).toEqual({ line: 480, lineRule: "auto" });
    expect(docxLineSpacing("single")).toEqual({ line: 240, lineRule: "auto" });
    expect(docxLineSpacing(null)).toEqual({ line: 240, lineRule: "auto" });
    const file = createFile("doc", "Garden club minutes");
    if (file.kind !== "doc") throw new Error("expected a document");
    file.content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { lineSpacing: "1.5" },
          content: [{ type: "text", text: "Welcome to the greenhouse." }],
        },
        {
          type: "paragraph",
          attrs: { lineSpacing: "double" },
          content: [{ type: "text", text: "Plant the south bed." }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "The vote stays single." }],
        },
      ],
    };
    const zip = await JSZip.loadAsync(await exportDocx(file));
    const xml = await zip.file("word/document.xml")!.async("string");
    const paragraphs = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(
      (match) => match[0],
    );
    const welcome = paragraphs.find((p) => p.includes("Welcome to the greenhouse."));
    const motion = paragraphs.find((p) => p.includes("Plant the south bed."));
    const single = paragraphs.find((p) => p.includes("The vote stays single."));
    expect(welcome).toContain('w:line="360"');
    expect(welcome).toContain('w:lineRule="auto"');
    expect(motion).toContain('w:line="480"');
    expect(motion).not.toContain('w:line="360"');
    expect(single).toContain('w:line="240"');
    expect(xml).not.toContain('w:docDefaults');
  });
});
