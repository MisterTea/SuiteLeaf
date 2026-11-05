import { describe, expect, it } from "vitest";
import { createFile, type DocFile, type JsonNode } from "../packages/core/src";
import { listReference, listReferences } from "../packages/core/src/docx-blocks";
import { exportDocx } from "../packages/core/src/docx-export";
import { importOffice } from "../packages/core/src/office";
import { numberedLines } from "../packages/core/src/compat/libreoffice";
import { applyWordListTypes, numberLabel, numberedParagraphs, numberingFormats } from "../packages/core/src/word-lists";
import JSZip from "jszip";

const lvl = (ilvl: number, format: string, start?: number) =>
  `<w:lvl w:ilvl="${ilvl}">${start ? `<w:start w:val="${start}"/>` : ""}<w:numFmt w:val="${format}"/></w:lvl>`;
const numbering = `<w:numbering>
  <w:abstractNum w:abstractNumId="0">${lvl(0, "decimal")}${lvl(1, "lowerRoman")}</w:abstractNum>
  <w:abstractNum w:abstractNumId="1">${lvl(0, "lowerLetter")}</w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
  <w:num w:numId="3"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="5"/></w:lvlOverride></w:num>
  <w:num w:numId="4"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0">${lvl(0, "upperLetter")}</w:lvlOverride></w:num>
</w:numbering>`;
const p = (text: string, numId?: string, ilvl = 0, style?: string) =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${numId ? `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>` : ""}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const styles = `<w:styles><w:style w:type="paragraph" w:styleId="ListLetter"><w:pPr><w:numPr><w:numId w:val="2"/></w:numPr></w:pPr></w:style></w:styles>`;

describe("Word list numbering", () => {
  it("writes numbers as Word does in each format", () => {
    expect([1, 3, 27].map((n) => numberLabel(n, "lowerLetter"))).toEqual(["a", "c", "aa"]);
    expect(numberLabel(2, "upperLetter")).toBe("B");
    expect([4, 9, 14, 1994].map((n) => numberLabel(n, "lowerRoman"))).toEqual(["iv", "ix", "xiv", "mcmxciv"]);
    expect(numberLabel(3, "upperRoman")).toBe("III");
    expect(numberLabel(4000, "upperRoman")).toBe("4000");
    expect(numberLabel(7, "decimalZero")).toBe("7");
  });

  it("follows a list to its abstract levels, overrides, starts, and paragraph styles", () => {
    const format = numberingFormats(numbering);
    expect(format("1", 1)).toBe("lowerRoman");
    expect(format("4", 0)).toBe("upperLetter");
    expect(format("9", 0)).toBeUndefined();
    const doc = [
      p("One", "1"),
      p("Nested", "1", 1),
      p("Two", "1"),
      p("Nested again", "1", 1),
      p("Plain"),
      p("From style", undefined, 0, "ListLetter"),
      p("Off", "0"),
      p("Five", "3"),
      p("Big", "4"),
    ].join("");
    expect(numberedParagraphs(doc, numbering, styles).map((x) => `${x.label} ${x.text}`)).toEqual([
      "1 One",
      "i Nested",
      "2 Two",
      "i Nested again",
      "a From style",
      "5 Five",
      "A Big",
    ]);
  });

  it("gives each ordered list the style of its first Word paragraph, matched by text", () => {
    const list = (texts: string[]): JsonNode => ({
      type: "orderedList",
      attrs: { start: 1 },
      content: texts.map((text) => ({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text }] }] })),
    });
    const content: JsonNode = { type: "doc", content: [list(["One", "Two"]), list(["From style"]), list(["Unknown"])] };
    const doc = [p("One", "1"), p("Two", "1"), p("From style", undefined, 0, "ListLetter")].join("");
    expect(applyWordListTypes(content, doc, numbering, styles)).toBe(1);
    expect(content.content!.map((node) => node.attrs)).toEqual([{ start: 1 }, { start: 1, type: "a" }, { start: 1 }]);
    expect(applyWordListTypes(content, "<w:document/>", numbering)).toBe(0);
  });

  it("exports each ordered list with its own numbering style, start, and instance", async () => {
    const file = createFile("doc") as DocFile;
    const item = (text: string) => ({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
    file.content = {
      type: "doc",
      content: [
        { type: "orderedList", attrs: { start: 1 }, content: [item("Water"), item("Stake")] },
        // Mammoth joins two lists that touch, so a paragraph keeps them apart on reopen.
        { type: "paragraph", content: [{ type: "text", text: "Then" }] },
        { type: "orderedList", attrs: { start: 1, type: "i" }, content: [item("Compost")] },
        { type: "paragraph", content: [{ type: "text", text: "Between" }] },
        { type: "orderedList", attrs: { start: 3 }, content: [item("Weed")] },
      ],
    };
    expect(listReference({ type: "orderedList", attrs: { type: "Z", start: -2 } })).toEqual({
      reference: "suiteleaf-list-decimal-1",
      format: "decimal",
      start: 1,
    });
    expect(listReferences(file.content).map((ref) => ref.reference)).toEqual([
      "suiteleaf-list-decimal-1",
      "suiteleaf-list-lowerRoman-1",
      "suiteleaf-list-decimal-3",
    ]);
    const zip = await JSZip.loadAsync(await exportDocx(file));
    const xml = await zip.file("word/document.xml")!.async("string");
    const numberingXml = await zip.file("word/numbering.xml")!.async("string");
    expect(numberedParagraphs(xml, numberingXml).map((x) => `${x.label} ${x.text}`)).toEqual(["1 Water", "2 Stake", "i Compost", "3 Weed"]);
    const reopened = (await importOffice(await exportDocx(file), "docx", "lists.docx")).file;
    const types = (reopened.content as JsonNode).content!.filter((n) => n.type === "orderedList").map((n) => n.attrs?.type ?? "1");
    expect(types).toEqual(["1", "i", "1"]);
  });

  it("reads numbered lines from LibreOffice text", () => {
    expect(numberedLines("Intro\n    1. Water\n    b) Mulch\nPlain words here")).toBe("1 Water\nb Mulch");
  });
});
