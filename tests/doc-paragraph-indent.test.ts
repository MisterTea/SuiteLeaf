import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createFile } from "../packages/core/src";
import { exportDocx } from "../packages/core/src/docx-export";
import {
  docxParagraphIndent,
  firstLineIndentAttribute,
  hangingIndentAttribute,
  indentInches,
  parseIndentInches,
} from "../packages/core/src/paragraph-indent";
import { applyLineSpacing } from "../apps/web/src/editors/doc-line-spacing";
import { applyParagraphSpace } from "../apps/web/src/editors/doc-paragraph-spacing";
import {
  applySpecialIndent,
  selectionSpecialIndent,
} from "../apps/web/src/editors/doc-paragraph-indent";

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
        firstLineIndent: { default: null },
        hangingIndent: { default: null },
      },
    },
    text: { group: "inline" },
  },
});

function paragraph(text: string, attrs: Record<string, unknown> = {}) {
  return schema.node("paragraph", attrs, text ? [schema.text(text)] : []);
}

function stateFrom(doc: ReturnType<Schema["node"]>, from: number, to = from) {
  return EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, from, to),
  });
}

describe("first-line and hanging indent", () => {
  it("parses inches and treats zero as no indent", () => {
    expect(indentInches(null)).toBe(0);
    expect(indentInches(0)).toBe(0);
    expect(indentInches("0.5")).toBe(0.5);
    expect(indentInches(0.5)).toBe(0.5);
    expect(parseIndentInches("0.5")).toBe(0.5);
    expect(parseIndentInches("0")).toBe(0);
    expect(parseIndentInches("")).toBeNull();
    expect(parseIndentInches("0.5in")).toBeNull();
    expect(parseIndentInches("7")).toBeNull();
    expect(firstLineIndentAttribute(0.5)).toEqual({
      "data-first-line-indent": "0.5",
      style: "text-indent: 0.5in",
    });
    expect(hangingIndentAttribute(0.5)).toEqual({
      "data-hanging-indent": "0.5",
      style: "padding-left: 0.5in; text-indent: -0.5in",
    });
    expect(firstLineIndentAttribute(0)).toEqual({});
    expect(hangingIndentAttribute(null)).toEqual({});
    expect(docxParagraphIndent({ firstLineIndent: 0.5 })).toEqual({
      firstLine: 720,
    });
    expect(docxParagraphIndent({ hangingIndent: 0.5 })).toEqual({
      left: 720,
      hanging: 720,
    });
    expect(
      docxParagraphIndent({ firstLineIndent: 0, hangingIndent: 0 }),
    ).toBeUndefined();
    expect(docxParagraphIndent(undefined)).toBeUndefined();
  });

  it("indents only the selected paragraph and leaves spacing alone", () => {
    const doc = schema.node("doc", null, [
      paragraph("The river was still dark.", {
        lineSpacing: "1.5",
        spaceAfter: 12,
        keepNext: true,
      }),
      paragraph("By noon the market had filled the square.", {
        lineSpacing: "double",
        spaceBefore: 6,
        widowControl: true,
      }),
    ]);
    const story = stateFrom(doc, 1);
    expect(selectionSpecialIndent(story)).toEqual({ kind: "none", inches: 0 });
    const indented = story.apply(
      applySpecialIndent(story, "firstLine", 0.5).transaction,
    );
    expect(indented.doc.child(0).attrs).toMatchObject({
      lineSpacing: "1.5",
      spaceAfter: 12,
      keepNext: true,
      firstLineIndent: 0.5,
      hangingIndent: null,
    });
    expect(indented.doc.child(1).attrs).toMatchObject({
      lineSpacing: "double",
      spaceBefore: 6,
      widowControl: true,
      firstLineIndent: null,
      hangingIndent: null,
    });
    expect(selectionSpecialIndent(indented)).toEqual({
      kind: "firstLine",
      inches: 0.5,
    });

    const spaced = indented.apply(
      applyParagraphSpace(indented, "after", 18).transaction,
    );
    expect(spaced.doc.child(0).attrs.spaceAfter).toBe(18);
    expect(spaced.doc.child(0).attrs.firstLineIndent).toBe(0.5);
    const opened = spaced.apply(applyLineSpacing(spaced, "double").transaction);
    expect(opened.doc.child(0).attrs.lineSpacing).toBe("double");
    expect(opened.doc.child(0).attrs.firstLineIndent).toBe(0.5);
    expect(opened.doc.child(0).attrs.spaceAfter).toBe(18);
  });

  it("clears the other indent on that paragraph only", () => {
    const doc = schema.node("doc", null, [
      paragraph("The river was still dark.", {
        firstLineIndent: 0.5,
        lineSpacing: "1.5",
      }),
      paragraph("By noon the market had filled the square.", {
        firstLineIndent: 0.5,
      }),
    ]);
    const story = stateFrom(doc, 1);
    const hanging = story.apply(
      applySpecialIndent(story, "hanging", 0.5).transaction,
    );
    expect(hanging.doc.child(0).attrs).toMatchObject({
      firstLineIndent: null,
      hangingIndent: 0.5,
      lineSpacing: "1.5",
    });
    expect(hanging.doc.child(1).attrs.firstLineIndent).toBe(0.5);
    expect(hanging.doc.child(1).attrs.hangingIndent).toBe(null);
    expect(selectionSpecialIndent(hanging)).toEqual({
      kind: "hanging",
      inches: 0.5,
    });

    const both = stateFrom(hanging.doc, 1, hanging.doc.content.size - 1);
    expect(selectionSpecialIndent(both).kind).toBe("mixed");
    const cleared = hanging.apply(
      applySpecialIndent(hanging, "none", 0).transaction,
    );
    expect(cleared.doc.child(0).attrs.firstLineIndent).toBe(null);
    expect(cleared.doc.child(0).attrs.hangingIndent).toBe(null);
    expect(cleared.doc.child(0).attrs.lineSpacing).toBe("1.5");
    expect(cleared.doc.child(1).attrs.firstLineIndent).toBe(0.5);
  });

  it("treats zero inches as none", () => {
    const doc = schema.node("doc", null, [
      paragraph("The river was still dark.", {
        hangingIndent: 0.5,
        spaceAfter: 12,
      }),
    ]);
    const story = stateFrom(doc, 1);
    const cleared = story.apply(
      applySpecialIndent(story, "hanging", 0).transaction,
    );
    expect(cleared.doc.child(0).attrs.hangingIndent).toBe(null);
    expect(cleared.doc.child(0).attrs.firstLineIndent).toBe(null);
    expect(cleared.doc.child(0).attrs.spaceAfter).toBe(12);
    expect(selectionSpecialIndent(cleared)).toEqual({
      kind: "none",
      inches: 0,
    });
  });
});

describe("docx first-line and hanging indent", () => {
  it("writes only the indent that is set, and keeps the rest of the paragraph", async () => {
    const file = createFile("doc", "The lamps on the bridge");
    if (file.kind !== "doc") throw new Error("expected a document");
    file.content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: {
            lineSpacing: "1.5",
            spaceAfter: 12,
            keepNext: true,
            firstLineIndent: 0.5,
          },
          content: [{ type: "text", text: "The river was still dark." }],
        },
        {
          type: "paragraph",
          attrs: { lineSpacing: "double", spaceBefore: 6, hangingIndent: 0.5 },
          content: [
            { type: "text", text: "Okada, Mara. The Lamps on the Bridge." },
          ],
        },
        {
          type: "paragraph",
          attrs: { lineSpacing: "single", spaceAfter: 0 },
          content: [
            { type: "text", text: "By noon the market had filled the square." },
          ],
        },
      ],
    };
    const zip = await JSZip.loadAsync(await exportDocx(file));
    const xml = await zip.file("word/document.xml")!.async("string");
    const paragraphs = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(
      (match) => match[0],
    );
    const story = paragraphs.find((p) =>
      p.includes("The river was still dark."),
    );
    const citation = paragraphs.find((p) => p.includes("Okada, Mara"));
    const square = paragraphs.find((p) => p.includes("By noon the market"));
    expect(story).toContain('w:firstLine="720"');
    expect(story).toContain('w:line="360"');
    expect(story).toContain('w:after="240"');
    expect(story).toContain("<w:keepNext");
    expect(story).not.toContain("w:hanging");
    expect(citation).toContain('w:hanging="720"');
    expect(citation).toContain('w:left="720"');
    expect(citation).toContain('w:line="480"');
    expect(citation).toContain('w:before="120"');
    expect(citation).not.toContain("w:firstLine");
    expect(square).toContain('w:line="240"');
    expect(square).not.toContain("w:firstLine");
    expect(square).not.toContain("w:hanging");
    expect(square).not.toContain("w:ind");
  });

  it("keeps columns, roman restart, margins, and headers beside the indents", async () => {
    const inch = (n: number) => n * 96;
    const file = createFile("doc", "Field report");
    if (file.kind !== "doc") throw new Error("expected a document");
    file.content = {
      type: "doc",
      attrs: {
        pageSettings: {
          margin: inch(1),
          marginTop: inch(1),
          marginBottom: inch(1),
          marginLeft: inch(1),
          marginRight: inch(1),
          header: "Town council",
          footer: "Draft",
          headerFromEdge: inch(0.5),
          footerFromEdge: inch(1),
          pageNumbers: true,
          pageNumberFormat: "roman",
          pageNumberPosition: "bottom-center",
          pageNumberPositionSet: true,
        },
      },
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Contents" }],
        },
        { type: "paragraph", content: [{ type: "text", text: "Maps." }] },
        { type: "pageBreak" },
        {
          type: "heading",
          attrs: { level: 1, startArabic: true },
          content: [{ type: "text", text: "Chapter 1" }],
        },
        {
          type: "paragraph",
          attrs: { firstLineIndent: 0.5, keepLines: true },
          content: [{ type: "text", text: "The river was still dark." }],
        },
        {
          type: "columnLayout",
          attrs: { columns: 2 },
          content: [
            {
              type: "paragraph",
              attrs: { hangingIndent: 0.5, widowControl: true },
              content: [
                { type: "text", text: "Okada, Mara. The Lamps on the Bridge." },
              ],
            },
            {
              type: "paragraph",
              content: [{ type: "text", text: "Plant sale" }],
            },
          ],
        },
      ],
    };
    const zip = await JSZip.loadAsync(await exportDocx(file));
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain('w:fmt="lowerRoman"');
    expect(xml).toContain('w:fmt="decimal"');
    expect(xml).toContain('w:start="1"');
    expect(xml).toContain('w:val="nextPage"');
    expect(xml).toContain('w:header="720"');
    expect(xml).toContain('w:top="1440"');
    expect(xml).toContain('w:num="2"');
    expect(xml).toContain('w:space="720"');
    const paragraphs = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(
      (match) => match[0],
    );
    const story = paragraphs.find((p) =>
      p.includes("The river was still dark."),
    );
    const citation = paragraphs.find((p) => p.includes("Okada, Mara"));
    const sale = paragraphs.find((p) => p.includes("Plant sale"));
    expect(story).toContain('w:firstLine="720"');
    expect(story).toContain("<w:keepLines");
    expect(story).not.toContain("w:hanging");
    expect(citation).toContain('w:hanging="720"');
    expect(citation).toContain("<w:widowControl");
    expect(citation).not.toContain("w:firstLine");
    expect(sale).not.toContain("w:ind");
    const headers = await Promise.all(
      Object.keys(zip.files)
        .filter((name) => /word\/header\d+\.xml$/.test(name))
        .map((name) => zip.file(name)!.async("string")),
    );
    expect(headers.some((header) => header.includes("Town council"))).toBe(
      true,
    );
    const footers = await Promise.all(
      Object.keys(zip.files)
        .filter((name) => /word\/footer\d+\.xml$/.test(name))
        .map((name) => zip.file(name)!.async("string")),
    );
    expect(footers.some((footer) => footer.includes("Draft"))).toBe(true);
  });
});
