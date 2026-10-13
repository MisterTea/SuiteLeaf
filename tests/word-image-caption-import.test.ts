import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { exportDocx } from "../packages/core/src/docx-export";
import { importOffice } from "../packages/core/src/office";
import type { JsonNode } from "../packages/core/src";
import {
  captionLine,
  captionStoryDocx,
  description,
  noonSentence,
} from "./word-image-caption-fixtures";

function textNodes(node: JsonNode): JsonNode[] {
  const out: JsonNode[] = [];
  if (node.type === "text") out.push(node);
  for (const child of node.content ?? []) out.push(...textNodes(child));
  return out;
}

function paragraphText(node: JsonNode | undefined): string {
  return textNodes(node ?? { type: "paragraph" })
    .map((item) => item.text)
    .join("");
}

function imagesOf(node: JsonNode): JsonNode[] {
  const found: JsonNode[] = [];
  const visit = (current: JsonNode) => {
    if (current.type === "image") found.push(current);
    current.content?.forEach(visit);
  };
  visit(node);
  return found;
}

function paragraphsOf(node: JsonNode): JsonNode[] {
  return (node.content ?? []).filter((child) => child.type === "paragraph");
}

function mark(node: JsonNode | undefined, type: string) {
  return node?.marks?.find((item) => item.type === type);
}

describe("Word caption import", () => {
  it("keeps the Caption paragraph on the photo and leaves the next sentence", async () => {
    const { file, report } = await importOffice(
      await captionStoryDocx(),
      "docx",
      "Saturday market.docx",
    );
    if (file.kind !== "doc") throw new Error("expected a document");
    const [image] = imagesOf(file.content);
    expect(image?.type).toBe("image");
    expect(String(image?.attrs?.src ?? "")).toMatch(/^data:image\/png;base64,/);
    expect(image?.attrs?.caption).toBe(captionLine);
    expect(image?.attrs?.alt).toBe(description);

    const paragraphs = paragraphsOf(file.content);
    expect(paragraphs.map(paragraphText)).not.toContain(captionLine);
    expect(paragraphs.map(paragraphText)).not.toContain(description);
    const noon = paragraphs.find((node) =>
      paragraphText(node).includes("We arrived at"),
    );
    expect(paragraphText(noon)).toBe(noonSentence);
    expect(file.content.content?.some(
      (node) => node.type === "heading" && paragraphText(node) === "Recovered document text",
    )).toBe(false);
    expect(report.textPreserved).toBe(true);

    const noonWord = textNodes(noon!).find((node) => node.text === "noon");
    expect(mark(noonWord, "highlight")?.attrs?.color).toBe("#ffff00");
    expect(mark(noonWord, "textStyle")?.attrs).toMatchObject({
      color: "#c00000",
      fontSize: "18pt",
      fontFamily: "Georgia",
    });
    expect(noon?.attrs).toMatchObject({
      firstLineIndent: 0.5,
      lineSpacing: "1.5",
      spaceBefore: 12,
      spaceAfter: 6,
    });

    const zip = await JSZip.loadAsync(await exportDocx(file));
    const xml = await zip.file("word/document.xml")!.async("string");
    const drawing = xml.indexOf("</w:drawing>");
    const captionAt = xml.indexOf(captionLine);
    const sentenceAt = xml.indexOf("We arrived at");
    expect(xml).toContain(`descr="${description}"`);
    expect(drawing).toBeGreaterThan(-1);
    expect(captionAt).toBeGreaterThan(drawing);
    expect(sentenceAt).toBeGreaterThan(captionAt);
    expect(xml).not.toContain(`<w:t>${description}</w:t>`);
    const exported = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(
      (match) => match[0],
    );
    const captionXml = exported.find((item) => item.includes(captionLine));
    const noonXml = exported.find((item) => item.includes("We arrived at"));
    expect(captionXml).toMatch(/<w:pStyle\b[^>]*w:val="Caption"/);
    expect(noonXml).not.toMatch(/<w:pStyle\b[^>]*w:val="Caption"/);
    expect(noonXml?.toLowerCase()).toContain('w:fill="ffff00"');
    expect(noonXml).toContain('w:firstLine="720"');

    const again = await importOffice(
      await zip.generateAsync({ type: "uint8array" }),
      "docx",
      "Saturday market.docx",
    );
    if (again.file.kind !== "doc") throw new Error("expected a document");
    const [roundTrip] = imagesOf(again.file.content);
    expect(roundTrip?.attrs?.caption).toBe(captionLine);
    expect(roundTrip?.attrs?.alt).toBe(description);
    const againParagraphs = paragraphsOf(again.file.content).map(paragraphText);
    expect(againParagraphs).not.toContain(captionLine);
    expect(againParagraphs).toContain(noonSentence);
  });

  it("reads a style named Caption even when the style id is different", async () => {
    const zip = await JSZip.loadAsync(await captionStoryDocx());
    const styles = await zip.file("word/styles.xml")!.async("string");
    const document = await zip.file("word/document.xml")!.async("string");
    zip.file(
      "word/styles.xml",
      styles.replace('w:styleId="Caption"', 'w:styleId="StallCaption"'),
    );
    zip.file(
      "word/document.xml",
      document.replace(
        "<w:pStyle w:val=\"Caption\"/>",
        "<w:pStyle w:val=\"StallCaption\"/>",
      ),
    );
    const { file } = await importOffice(
      await zip.generateAsync({ type: "uint8array" }),
      "docx",
      "Saturday market.docx",
    );
    if (file.kind !== "doc") throw new Error("expected a document");
    expect(imagesOf(file.content)[0]?.attrs?.caption).toBe(captionLine);
    expect(imagesOf(file.content)[0]?.attrs?.alt).toBe(description);
    expect(paragraphsOf(file.content).map(paragraphText)).not.toContain(
      captionLine,
    );
    expect(paragraphsOf(file.content).map(paragraphText)).toContain(
      noonSentence,
    );
  });

  it("does not take a following sentence that is not the Caption style", async () => {
    const { file } = await importOffice(
      await captionStoryDocx(undefined, "sentence-then-caption"),
      "docx",
      "Saturday market.docx",
    );
    if (file.kind !== "doc") throw new Error("expected a document");
    const [image] = imagesOf(file.content);
    expect(image?.attrs?.alt).toBe(description);
    expect(image?.attrs?.caption ?? "").toBe("");
    const paragraphs = paragraphsOf(file.content).map(paragraphText);
    expect(paragraphs).toContain(noonSentence);
    expect(paragraphs).toContain(captionLine);
  });
});
