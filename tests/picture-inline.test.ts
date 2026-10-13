import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createFile, parseFile, serializeFile } from "../packages/core/src";
import { exportDocx } from "../packages/core/src/docx-export";
import { importOffice } from "../packages/core/src/office";
import {
  INLINE_TEXT_HEIGHT,
  inlineFrame,
  settleWordPictures,
} from "../packages/core/src/image-inline";
import type { JsonNode } from "../packages/core/src";
import { stallSentenceDocx } from "./sentence-picture";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";

function pictures(node: JsonNode, type: string): JsonNode[] {
  const found: JsonNode[] = [];
  const visit = (current: JsonNode) => {
    if (current.type === type) found.push(current);
    current.content?.forEach(visit);
  };
  visit(node);
  return found;
}

describe("picture in the sentence", () => {
  it("shrinks a page-sized picture to about the height of the words", () => {
    expect(inlineFrame({ width: 320, height: 240 })).toEqual({
      width: Math.round(INLINE_TEXT_HEIGHT * (320 / 240)),
      height: INLINE_TEXT_HEIGHT,
    });
    expect(inlineFrame({ width: 28, height: 20 })).toEqual({ width: 28, height: 20 });
  });

  it("keeps a picture between words, and a picture with no words on its own line", () => {
    const doc = settleWordPictures({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Meet at the " },
            { type: "image", attrs: { src: png } },
            { type: "text", text: "stall on Saturday." },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "image", attrs: { src: png, wrap: "left" } },
            { type: "text", text: "Dear friend" },
          ],
        },
        {
          type: "paragraph",
          content: [{ type: "image", attrs: { src: png, alt: "Logo" } }],
        },
      ],
    });
    const sentence = doc.content?.[0];
    expect(sentence?.type).toBe("paragraph");
    expect(sentence?.content?.map((node) => node.type)).toEqual([
      "text",
      "inlineImage",
      "text",
    ]);
    expect(sentence?.content?.[1].attrs?.wrap).toBeUndefined();
    expect(doc.content?.[1].type).toBe("image");
    expect(doc.content?.[1].attrs?.wrap).toBe("left");
    expect(doc.content?.[2].type).toBe("paragraph");
    expect(doc.content?.[2].content?.[0].text).toBe("Dear friend");
    expect(doc.content?.[3].type).toBe("image");
    expect(doc.content?.[3].attrs?.alt).toBe("Logo");
    expect(doc.content?.[3].attrs?.wrap).toBeUndefined();
  });

  it("opens a Word inline picture in the middle of the sentence", async () => {
    const { file } = await importOffice(
      await stallSentenceDocx(),
      "docx",
      "Saturday note.docx",
    );
    if (file.kind !== "doc") throw new Error("expected a document");
    const paragraph = file.content.content?.find((node) =>
      node.content?.some((child) => child.type === "inlineImage"),
    );
    expect(paragraph?.type).toBe("paragraph");
    const text = paragraph?.content?.map((node) => node.text ?? "").join("");
    expect(text).toContain("Meet at the ");
    expect(text).toContain("stall on Saturday.");
    const image = paragraph?.content?.find((node) => node.type === "inlineImage");
    const imageAt = paragraph?.content?.findIndex((node) => node.type === "inlineImage") ?? -1;
    expect(imageAt).toBeGreaterThan(0);
    expect(paragraph?.content?.[imageAt - 1].text).toContain("the");
    expect(paragraph?.content?.[imageAt + 1].text).toContain("stall");
    expect(image?.attrs?.src).toMatch(/^data:image\/png;base64,/);
    expect(pictures(file.content, "image")).toEqual([]);
  });

  it("writes an in-line picture back to Word and reads it in the sentence again", async () => {
    const file = createFile("doc", "Saturday note");
    if (file.kind !== "doc") throw new Error("expected a document");
    file.content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Meet at the " },
            {
              type: "inlineImage",
              attrs: { src: png, alt: "The stall", width: 27, height: 20 },
            },
            { type: "text", text: "stall on Saturday." },
          ],
        },
      ],
    };
    expect(parseFile(serializeFile(file))).toEqual(file);
    const docx = await exportDocx(file);
    const zip = await JSZip.loadAsync(docx);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toMatch(/<wp:inline\b/);
    expect(xml).not.toMatch(/<wp:anchor\b/);
    expect(xml).toContain("Meet at the ");
    expect(xml).toContain("stall on Saturday.");
    const again = await importOffice(docx, "docx", "Saturday note.docx");
    if (again.file.kind !== "doc") throw new Error("expected a document");
    const paragraph = again.file.content.content?.[0];
    expect(paragraph?.content?.some((node) => node.type === "inlineImage")).toBe(true);
    expect(paragraph?.content?.map((node) => node.text ?? "").join("")).toBe(
      "Meet at the stall on Saturday.",
    );
  });
});
