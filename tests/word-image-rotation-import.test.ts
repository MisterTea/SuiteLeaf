import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { exportDocx } from "../packages/core/src/docx-export";
import { imageRotation } from "../packages/core/src/image-rotation";
import { importOffice } from "../packages/core/src/office";
import type { JsonNode } from "../packages/core/src";
import {
  captionLine,
  description,
  noonSentence,
  rotationStoryDocx,
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

describe("Word rotation import", () => {
  it("keeps a 90 degree turn, the caption, and the description", async () => {
    const { file } = await importOffice(
      await rotationStoryDocx(),
      "docx",
      "Saturday market.docx",
    );
    if (file.kind !== "doc") throw new Error("expected a document");
    const [turned, upright] = imagesOf(file.content);
    expect(turned?.attrs?.rotation).toBe(90);
    expect(turned?.attrs?.caption).toBe(captionLine);
    expect(turned?.attrs?.alt).toBe(description);
    expect(turned?.attrs?.width ?? 280).toBe(280);
    expect(turned?.attrs?.height ?? 160).toBe(160);

    expect(imageRotation(upright?.attrs?.rotation)).toBe(0);
    expect(upright?.attrs?.width ?? 200).toBe(200);
    expect(upright?.attrs?.height ?? 120).toBe(120);

    const paragraphs = paragraphsOf(file.content);
    expect(paragraphs.map(paragraphText)).not.toContain(captionLine);
    expect(paragraphs.map(paragraphText)).not.toContain(description);
    expect(paragraphs.map(paragraphText)).toContain(noonSentence);

    const zip = await JSZip.loadAsync(await exportDocx(file));
    const xml = await zip.file("word/document.xml")!.async("string");
    const drawings = [...xml.matchAll(/<w:drawing\b[\s\S]*?<\/w:drawing>/g)].map(
      (match) => match[0],
    );
    expect(drawings[0]).toContain('rot="5400000"');
    expect(drawings[0]).toContain(`descr="${description}"`);
    expect(drawings[1] ?? "").not.toContain("rot=");
    const drawing = xml.indexOf("</w:drawing>");
    const captionAt = xml.indexOf(captionLine);
    expect(captionAt).toBeGreaterThan(drawing);
    expect(xml.indexOf("We arrived at")).toBeGreaterThan(captionAt);
    expect(xml).not.toContain(`<w:t>${description}</w:t>`);
  });

  it("reads a missing rot and a non-quarter turn as upright", async () => {
    const missing = await importOffice(
      await rotationStoryDocx(undefined, undefined, null),
      "docx",
      "Saturday market.docx",
    );
    if (missing.file.kind !== "doc") throw new Error("expected a document");
    const [plain] = imagesOf(missing.file.content);
    expect(imageRotation(plain?.attrs?.rotation)).toBe(0);
    expect(plain?.attrs?.caption).toBe(captionLine);
    expect(plain?.attrs?.alt).toBe(description);
    expect(plain?.attrs?.width ?? 280).toBe(280);
    expect(plain?.attrs?.height ?? 160).toBe(160);

    const odd = await importOffice(
      await rotationStoryDocx(undefined, undefined, "1000000"),
      "docx",
      "Saturday market.docx",
    );
    if (odd.file.kind !== "doc") throw new Error("expected a document");
    const [other] = imagesOf(odd.file.content);
    expect(imageRotation(other?.attrs?.rotation)).toBe(0);
    expect(other?.attrs?.caption).toBe(captionLine);
    expect(other?.attrs?.alt).toBe(description);
    expect(other?.attrs?.width ?? 280).toBe(280);
    expect(other?.attrs?.height ?? 160).toBe(160);
  });
});
