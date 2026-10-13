import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createFile } from "../packages/core/src";
import { exportDocx } from "../packages/core/src/docx-export";
import {
  docxParagraphGap,
  paragraphSpaceAttribute,
  paragraphSpacePoints,
  parseParagraphSpace,
} from "../packages/core/src/paragraph-spacing";
import { applyLineSpacing } from "../apps/web/src/editors/doc-line-spacing";
import {
  applyParagraphSpace,
  selectionParagraphSpace,
} from "../apps/web/src/editors/doc-paragraph-spacing";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "inline*",
      group: "block",
      attrs: {
        lineSpacing: { default: null },
        spaceBefore: { default: null },
        spaceAfter: { default: null },
        keepNext: { default: null },
        keepLines: { default: null },
        widowControl: { default: null },
      },
    },
    heading: {
      content: "inline*",
      group: "block",
      attrs: {
        level: { default: 1 },
        spaceBefore: { default: null },
        spaceAfter: { default: null },
      },
    },
    text: { group: "inline" },
  },
});

function paragraph(
  text: string,
  attrs: Record<string, unknown> = {},
) {
  return schema.node("paragraph", attrs, text ? [schema.text(text)] : []);
}

function stateFrom(doc: ReturnType<Schema["node"]>, from: number, to = from) {
  return EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, from, to),
  });
}

describe("paragraph space before and after", () => {
  it("parses points and treats zero as no gap", () => {
    expect(paragraphSpacePoints(null)).toBe(0);
    expect(paragraphSpacePoints(0)).toBe(0);
    expect(paragraphSpacePoints("12")).toBe(12);
    expect(paragraphSpacePoints(12.5)).toBe(12.5);
    expect(paragraphSpacePoints(-4)).toBe(0);
    expect(parseParagraphSpace("12")).toBe(12);
    expect(parseParagraphSpace("0")).toBe(0);
    expect(parseParagraphSpace("")).toBeNull();
    expect(parseParagraphSpace("12pt")).toBeNull();
    expect(parseParagraphSpace("300")).toBeNull();
    expect(paragraphSpaceAttribute("after", 12)).toEqual({
      "data-space-after": "12",
      style: "margin-bottom: 0; padding-bottom: 12pt",
    });
    expect(paragraphSpaceAttribute("before", 0)).toEqual({
      "data-space-before": "0",
      style: "margin-top: 0; padding-top: 0",
    });
    expect(paragraphSpaceAttribute("after", null)).toEqual({});
    expect(docxParagraphGap({ spaceAfter: 12 })).toEqual({ after: 240 });
    expect(docxParagraphGap({ spaceBefore: 12, spaceAfter: 0 })).toEqual({ before: 240 });
    expect(docxParagraphGap(undefined)).toEqual({});
  });

  it("changes space after on the selection only, and leaves line spacing alone", () => {
    const doc = schema.node("doc", null, [
      paragraph("Welcome to the greenhouse.", { lineSpacing: "1.5", keepNext: true }),
      paragraph("Motion"),
      paragraph("Plant the south bed with beans.", { lineSpacing: "double", keepLines: true }),
    ]);
    const welcome = stateFrom(doc, 1);
    expect(selectionParagraphSpace(welcome, "after")).toBe(0);
    const opened = welcome.apply(applyParagraphSpace(welcome, "after", 12).transaction);
    expect(opened.doc.child(0).attrs).toMatchObject({
      lineSpacing: "1.5",
      keepNext: true,
      spaceAfter: 12,
      spaceBefore: null,
    });
    expect(opened.doc.child(1).attrs.spaceAfter).toBe(null);
    expect(opened.doc.child(2).attrs).toMatchObject({
      lineSpacing: "double",
      keepLines: true,
      spaceAfter: null,
    });
    expect(selectionParagraphSpace(opened, "after")).toBe(12);

    const spaced = opened.apply(applyLineSpacing(opened, "double").transaction);
    expect(spaced.doc.child(0).attrs.lineSpacing).toBe("double");
    expect(spaced.doc.child(0).attrs.spaceAfter).toBe(12);
  });

  it("space before on the heading does not clear the welcome's space after", () => {
    const doc = schema.node("doc", null, [
      paragraph("Welcome to the greenhouse.", { lineSpacing: "1.5", spaceAfter: 12 }),
      schema.node("heading", { level: 2 }, [schema.text("Motion")]),
      paragraph("Plant the south bed.", { lineSpacing: "double", widowControl: true }),
    ]);
    const headingPos = doc.child(0).nodeSize + 1;
    const heading = stateFrom(doc, headingPos);
    const moved = heading.apply(applyParagraphSpace(heading, "before", 12).transaction);
    expect(moved.doc.child(0).attrs.spaceAfter).toBe(12);
    expect(moved.doc.child(0).attrs.lineSpacing).toBe("1.5");
    expect(moved.doc.child(1).attrs.spaceBefore).toBe(12);
    expect(moved.doc.child(1).attrs.spaceAfter).toBe(null);
    expect(moved.doc.child(2).attrs.spaceAfter).toBe(null);
    expect(moved.doc.child(2).attrs.widowControl).toBe(true);
  });

  it("zero removes the gap and leaves line spacing", () => {
    const doc = schema.node("doc", null, [
      paragraph("Plant the south bed.", {
        lineSpacing: "double",
        spaceAfter: 12,
        keepLines: true,
      }),
    ]);
    const motion = stateFrom(doc, 1);
    const cleared = motion.apply(applyParagraphSpace(motion, "after", 0).transaction);
    expect(cleared.doc.child(0).attrs.spaceAfter).toBe(0);
    expect(cleared.doc.child(0).attrs.lineSpacing).toBe("double");
    expect(cleared.doc.child(0).attrs.keepLines).toBe(true);
    expect(selectionParagraphSpace(cleared, "after")).toBe(0);
  });

  it("reports mixed space when the selection covers two values", () => {
    const doc = schema.node("doc", null, [
      paragraph("Welcome", { spaceAfter: 12 }),
      paragraph("Motion", { spaceAfter: 0 }),
    ]);
    const both = stateFrom(doc, 1, doc.content.size - 1);
    expect(selectionParagraphSpace(both, "after")).toBe("mixed");
  });
});

describe("docx space before and after", () => {
  it("writes w:before and w:after only on paragraphs that have them", async () => {
    const file = createFile("doc", "Garden club minutes");
    if (file.kind !== "doc") throw new Error("expected a document");
    file.content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { lineSpacing: "1.5", spaceAfter: 12 },
          content: [{ type: "text", text: "Welcome to the greenhouse." }],
        },
        {
          type: "paragraph",
          attrs: { spaceBefore: 12 },
          content: [{ type: "text", text: "Motion" }],
        },
        {
          type: "paragraph",
          attrs: { lineSpacing: "double", spaceAfter: 0 },
          content: [{ type: "text", text: "Plant the south bed." }],
        },
      ],
    };
    const zip = await JSZip.loadAsync(await exportDocx(file));
    const xml = await zip.file("word/document.xml")!.async("string");
    const paragraphs = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((match) => match[0]);
    const welcome = paragraphs.find((p) => p.includes("Welcome to the greenhouse."));
    const heading = paragraphs.find((p) => p.includes(">Motion<"));
    const motion = paragraphs.find((p) => p.includes("Plant the south bed."));
    expect(welcome).toContain('w:after="240"');
    expect(welcome).toContain('w:line="360"');
    expect(welcome).not.toContain("w:before");
    expect(heading).toContain('w:before="240"');
    expect(heading).toContain('w:line="240"');
    expect(heading).not.toContain("w:after");
    expect(motion).toContain('w:line="480"');
    expect(motion).not.toContain("w:before");
    expect(motion).not.toContain("w:after");
  });
});
