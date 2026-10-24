import { describe, expect, it } from "vitest";
import {
  Document,
  FootnoteReferenceRun,
  HeadingLevel,
  Packer,
  Paragraph,
  TableOfContents,
  TextRun,
  EndnoteReferenceRun,
} from "docx";
import JSZip from "jszip";
import { createFile, type JsonNode } from "../packages/core/src";
import { exportDocx } from "../packages/core/src/docx-export";
import { notesImportSummary } from "../packages/core/src/doc-notes";
import { documentText } from "../packages/core/src/word";
import { importOffice } from "../packages/core/src/office";

function paragraph(text: string, marks?: JsonNode["marks"]): JsonNode {
  return { type: "paragraph", content: [{ type: "text", text, ...(marks ? { marks } : {}) }] };
}
function heading(level: number, text: string): JsonNode {
  return { type: "heading", attrs: { level }, content: [{ type: "text", text }] };
}
function ref(id: string, kind: "footnote" | "endnote"): JsonNode {
  return { type: "noteReference", attrs: { id, kind, label: "" } };
}
function note(id: string, kind: "footnote" | "endnote", text: string): JsonNode {
  return {
    type: "note",
    attrs: { id, kind, label: "" },
    content: [paragraph(text)],
  };
}

function walk(node: JsonNode, out: JsonNode[] = []): JsonNode[] {
  out.push(node);
  node.content?.forEach((child) => walk(child, out));
  return out;
}

describe("table of contents, footnotes and endnotes", () => {
  it("keeps digits immediately after note references as literal text", async () => {
    const file = createFile("doc", "Adjacent digits");
    if (file.kind !== "doc") throw new Error("Expected a document");
    file.content = {
      type: "doc",
      content: [
        { type: "paragraph", content: [ref("a", "footnote"), { type: "text", text: "1" }] },
        { type: "paragraph", content: [ref("b", "endnote"), { type: "text", text: "6" }] },
        note("a", "footnote", "First source."),
        note("b", "endnote", "Second source."),
      ],
    };
    const { file: imported, report } = await importOffice(await exportDocx(file), "docx", "Adjacent digits");
    if (imported.kind !== "doc") throw new Error("Expected a document");
    const paragraphs = imported.content.content ?? [];
    expect(paragraphs[0].content).toMatchObject([
      { type: "noteReference", attrs: { kind: "footnote", label: "1" } },
      { type: "text", text: "1" },
    ]);
    expect(paragraphs[1].content).toMatchObject([
      { type: "noteReference", attrs: { kind: "endnote", label: "i" } },
      { type: "text", text: "6" },
    ]);
    expect(report.stats.recoveredParagraphs).toBe(0);
  });

  it("summarizes imported notes the way the banner reads them", () => {
    expect(
      notesImportSummary({ footnotes: 4, endnotes: 1, tocs: 1 }),
    ).toBe("4 footnotes, 1 endnote, 1 table of contents");
    expect(notesImportSummary({ footnotes: 1, endnotes: 0, tocs: 0 })).toBe("1 footnote");
  });

  it("exports a Word table-of-contents field and real footnotes and endnotes", async () => {
    const file = createFile("doc", "Grant report 2026");
    if (file.kind !== "doc") throw new Error();
    file.content = {
      type: "doc",
      content: [
        heading(1, "Introduction"),
        {
          type: "tableOfContents",
          attrs: { pageNumbers: true, maxLevel: 3 },
        },
        heading(1, "Results"),
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Attendance rose 40%" },
            ref("a", "footnote"),
            { type: "text", text: " after coaching." },
            ref("b", "footnote"),
          ],
        },
        heading(2, "Budget"),
        { type: "paragraph", content: [{ type: "text", text: "See the funder" }, ref("c", "footnote")] },
        heading(1, "Next year"),
        { type: "paragraph", content: [{ type: "text", text: "A fourth source" }, ref("d", "footnote"), { type: "text", text: " and an endnote" }, ref("e", "endnote"), { type: "text", text: "." }] },
        note("a", "footnote", "League register, 2025."),
        note("b", "footnote", "Coach diaries."),
        note("c", "footnote", "Treasurer's report."),
        note("d", "footnote", "Funder guidance."),
        note("e", "endnote", "Added by the funder's officer."),
      ],
    };
    const bytes = await exportDocx(file);
    const zip = await JSZip.loadAsync(bytes);
    const documentXml = await zip.file("word/document.xml")!.async("string");
    const footnotesXml = await zip.file("word/footnotes.xml")!.async("string");
    const endnotesXml = await zip.file("word/endnotes.xml")!.async("string");
    expect(documentXml).toMatch(/<w:instrText[^>]*>[^<]*TOC/);
    expect(documentXml.match(/<w:footnoteReference\b/g)).toHaveLength(4);
    expect(documentXml.match(/<w:endnoteReference\b/g)).toHaveLength(1);
    expect(footnotesXml).toContain("League register, 2025.");
    expect(footnotesXml).toContain("Funder guidance.");
    expect(endnotesXml).toContain("Added by the funder");
    expect(documentXml).not.toContain("League register, 2025.");

    const { file: back, report } = await importOffice(bytes, "docx", "Grant report 2026.docx");
    expect(file.kind).toBe("doc");
    if (back.kind !== "doc") return;
    expect(report.warnings).toContain("4 footnotes, 1 endnote, 1 table of contents");
    expect(report.features).toContain("table_of_contents");
    const nodes = walk(back.content);
    const markers = nodes.filter((node) => node.type === "noteReference");
    expect(markers.map((node) => node.attrs?.kind)).toEqual([
      "footnote",
      "footnote",
      "footnote",
      "footnote",
      "endnote",
    ]);
    const bodies = nodes.filter((node) => node.type === "note");
    expect(bodies.map((node) => documentText(node))).toEqual([
      "League register, 2025.",
      "Coach diaries.",
      "Treasurer's report.",
      "Funder guidance.",
      "Added by the funder's officer.",
    ]);
    expect(bodies.map((node) => node.attrs?.kind)).toEqual([
      "footnote",
      "footnote",
      "footnote",
      "footnote",
      "endnote",
    ]);
    expect(nodes.some((node) => node.type === "tableOfContents")).toBe(true);
    expect(documentText(back.content)).not.toContain("SLFN");
    expect(documentText(back.content)).toContain("Attendance rose 40%");
    expect(back.content.content?.some((node) => node.type === "heading" && documentText(node) === "Budget")).toBe(true);
  });

  it("keeps Word's own endnotes as endnotes and its contents field as a live table", async () => {
    const doc = new Document({
      footnotes: {
        1: { children: [new Paragraph("First source.")] },
        2: { children: [new Paragraph("Second source.")] },
        3: { children: [new Paragraph("Third source.")] },
        4: { children: [new Paragraph("Fourth source.")] },
      },
      endnotes: {
        1: { children: [new Paragraph("Officer's endnote.")] },
      },
      sections: [
        {
          children: [
            new Paragraph({ text: "Grant report 2026", heading: HeadingLevel.HEADING_1 }),
            new TableOfContents("Contents", { hyperlink: true, headingStyleRange: "1-3" }),
            new Paragraph({
              heading: HeadingLevel.HEADING_1,
              children: [
                new TextRun("Results "),
                new FootnoteReferenceRun(1),
              ],
            }),
            new Paragraph({
              heading: HeadingLevel.HEADING_2,
              children: [new TextRun("Budget "), new FootnoteReferenceRun(2)],
            }),
            new Paragraph({
              children: [
                new TextRun("Later "),
                new FootnoteReferenceRun(3),
                new TextRun(" and "),
                new FootnoteReferenceRun(4),
                new TextRun(" plus "),
                new EndnoteReferenceRun(1),
              ],
            }),
          ],
        },
      ],
    });
    const bytes = new Uint8Array(await Packer.toBuffer(doc));
    const { file, report } = await importOffice(bytes, "docx", "Returned grant.docx");
    if (file.kind !== "doc") throw new Error();
    expect(report.warnings).toContain("4 footnotes, 1 endnote, 1 table of contents");
    const nodes = walk(file.content);
    const notes = nodes.filter((node) => node.type === "note");
    expect(notes.filter((node) => node.attrs?.kind === "footnote")).toHaveLength(4);
    expect(notes.filter((node) => node.attrs?.kind === "endnote")).toHaveLength(1);
    expect(documentText(notes.find((node) => node.attrs?.kind === "endnote")!)).toBe("Officer's endnote.");
    expect(nodes.filter((node) => node.type === "noteReference" && node.attrs?.kind === "endnote")).toHaveLength(1);
    expect(nodes.some((node) => node.type === "tableOfContents" && node.attrs?.pageNumbers !== false)).toBe(true);
    const linked = nodes.filter((node) => node.type === "noteReference").every((marker) =>
      notes.some((body) => body.attrs?.id === marker.attrs?.id),
    );
    expect(linked).toBe(true);
  });
});
