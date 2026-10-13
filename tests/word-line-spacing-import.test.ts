import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { exportDocx } from "../packages/core/src/docx-export";
import { lineSpacingFromWord } from "../packages/core/src/line-spacing";
import { importOffice } from "../packages/core/src/office";
import type { JsonNode } from "../packages/core/src";
import {
  comfortableParagraph,
  exactParagraph,
  lineSpacingEdgeDocx,
  lineSpacingStoryDocx,
  plainParagraph,
  storyParagraph,
  unusualParagraph,
  unruledParagraph,
  verseLines,
} from "./word-line-spacing-fixtures";

function plainText(node: JsonNode): string {
  return (node.text ?? "") + (node.content ?? []).map(plainText).join("");
}

describe("Word line spacing import", () => {
  it("keeps 1.5 and double, leaves exact and missing spacing single, and keeps the first-line indent", async () => {
    const { file } = await importOffice(
      await lineSpacingStoryDocx(),
      "docx",
      "The river at night.docx",
    );
    if (file.kind !== "doc") throw new Error("expected a document");
    const paragraphs = (file.content.content ?? []).filter(
      (node) => node.type === "paragraph",
    );
    const story = paragraphs.find((node) =>
      plainText(node).includes("counted the lamps"),
    );
    const plain = paragraphs.find((node) =>
      plainText(node).includes("wooden crate"),
    );
    const verse = paragraphs.find((node) =>
      plainText(node).includes("slow count"),
    );
    const exact = paragraphs.find((node) =>
      plainText(node).includes("exact height"),
    );

    expect(plainText(story ?? { type: "paragraph" })).toBe(storyParagraph);
    expect(plainText(plain ?? { type: "paragraph" })).toBe(plainParagraph);
    expect(plainText(verse ?? { type: "paragraph" })).toBe(verseLines.join(""));
    expect(plainText(exact ?? { type: "paragraph" })).toBe(exactParagraph);

    expect(story?.attrs?.lineSpacing).toBe("1.5");
    expect(story?.attrs?.firstLineIndent).toBe(0.5);
    expect(story?.attrs?.hangingIndent).toBeUndefined();
    expect(story?.attrs?.spaceAfter).toBeUndefined();
    expect(story?.attrs?.spaceBefore).toBeUndefined();

    expect(plain?.attrs?.lineSpacing).toBeUndefined();
    expect(plain?.attrs?.firstLineIndent).toBeUndefined();

    expect(verse?.attrs?.lineSpacing).toBe("double");
    expect(verse?.attrs?.spaceBefore).toBeUndefined();
    expect(verse?.attrs?.firstLineIndent).toBeUndefined();
    expect(verse?.attrs?.hangingIndent).toBeUndefined();

    expect(exact?.attrs?.lineSpacing).toBeUndefined();
    expect(exact?.attrs?.firstLineIndent).toBeUndefined();

    const zip = await JSZip.loadAsync(await exportDocx(file));
    const xml = await zip.file("word/document.xml")!.async("string");
    const exported = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(
      (match) => match[0],
    );
    const storyXml = exported.find((item) => item.includes("counted the lamps"));
    const plainXml = exported.find((item) => item.includes("wooden crate"));
    const verseXml = exported.find((item) => item.includes("slow count"));
    const exactXml = exported.find((item) => item.includes("exact height"));

    expect(storyXml).toContain('w:line="360"');
    expect(storyXml).toContain('w:lineRule="auto"');
    expect(storyXml).toContain('w:firstLine="720"');
    expect(storyXml).not.toContain("w:after");
    expect(verseXml).toContain('w:line="480"');
    expect(verseXml).toContain('w:lineRule="auto"');
    expect(verseXml).not.toContain("w:before");
    expect(plainXml).toContain('w:line="240"');
    expect(plainXml).toContain('w:lineRule="auto"');
    expect(exactXml).toContain('w:line="240"');
    expect(exactXml).toContain('w:lineRule="auto"');
    expect(exactXml).not.toContain('w:line="320"');
    expect(exactXml).not.toContain('w:lineRule="exact"');
  });

  it("maps the other auto multiples and leaves an unrecognized line single", async () => {
    expect(lineSpacingFromWord({ line: "240", lineRule: "auto" })).toBe(
      "single",
    );
    expect(lineSpacingFromWord({ line: 276, lineRule: "auto" })).toBe("1.15");
    expect(lineSpacingFromWord({ line: "360", lineRule: "auto" })).toBe("1.5");
    expect(lineSpacingFromWord({ line: "480", lineRule: "auto" })).toBe(
      "double",
    );
    expect(lineSpacingFromWord({ line: "400", lineRule: "auto" })).toBeNull();
    expect(lineSpacingFromWord({ line: "360", lineRule: "exact" })).toBeNull();
    expect(lineSpacingFromWord({ line: "480", lineRule: "atLeast" })).toBeNull();
    expect(lineSpacingFromWord({ line: "360" })).toBeNull();
    expect(lineSpacingFromWord(null)).toBeNull();

    const { file } = await importOffice(
      await lineSpacingEdgeDocx(),
      "docx",
      "Other multiples.docx",
    );
    if (file.kind !== "doc") throw new Error("expected a document");
    const paragraphs = (file.content.content ?? []).filter(
      (node) => node.type === "paragraph",
    );
    const comfortable = paragraphs.find((node) =>
      plainText(node).includes("one point fifteen"),
    );
    const unusual = paragraphs.find((node) =>
      plainText(node).includes("unusual multiple"),
    );
    const unruled = paragraphs.find((node) =>
      plainText(node).includes("without a rule"),
    );
    const explicit = paragraphs.find((node) =>
      plainText(node).includes("Explicit single"),
    );
    expect(plainText(comfortable ?? { type: "paragraph" })).toBe(
      comfortableParagraph,
    );
    expect(comfortable?.attrs?.lineSpacing).toBe("1.15");
    expect(plainText(unusual ?? { type: "paragraph" })).toBe(unusualParagraph);
    expect(unusual?.attrs?.lineSpacing).toBeUndefined();
    expect(unusual?.attrs?.firstLineIndent).toBe(0.5);
    expect(plainText(unruled ?? { type: "paragraph" })).toBe(unruledParagraph);
    expect(unruled?.attrs?.lineSpacing).toBeUndefined();
    expect(explicit?.attrs?.lineSpacing).toBe("single");
    expect(explicit?.attrs?.hangingIndent).toBe(0.5);
    expect(explicit?.attrs?.firstLineIndent).toBeUndefined();
  });
});
