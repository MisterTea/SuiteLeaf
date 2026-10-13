import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { exportDocx } from "../packages/core/src/docx-export";
import { importOffice } from "../packages/core/src/office";
import {
  PAGE_LAYOUT_NOTE,
  PAGE_LAYOUT_NOTE_BESIDE,
  drawingPlacement,
} from "../packages/core/src/image-wrap";
import type { JsonNode } from "../packages/core/src";
import { letterDocx, letterGreeting } from "./letter-picture";

function imagesOf(node: JsonNode): JsonNode[] {
  const found: JsonNode[] = [];
  const visit = (current: JsonNode) => {
    if (current.type === "image") found.push(current);
    current.content?.forEach(visit);
  };
  visit(node);
  return found;
}

const squareLeft = `<w:drawing><wp:anchor><wp:positionH relativeFrom="column"><wp:align>left</wp:align></wp:positionH><wp:wrapSquare wrapText="bothSides"/></wp:anchor></w:drawing>`;
const squareRight = `<w:drawing><wp:anchor><wp:positionH relativeFrom="column"><wp:align>right</wp:align></wp:positionH><wp:wrapSquare wrapText="bothSides"/></wp:anchor></w:drawing>`;
const inline = `<w:drawing><wp:inline><wp:extent cx="1" cy="1"/></wp:inline></w:drawing>`;

describe("picture wrap", () => {
  it("reads square wrap as beside the paragraph, and inline as its own line", () => {
    const at = (xml: string) => drawingPlacement(xml, xml.length);
    expect(at(squareLeft)).toMatchObject({ wrap: "left", represented: true });
    expect(at(squareRight)).toMatchObject({ wrap: "right", represented: true });
    expect(at(inline)).toEqual({ wrap: null, floating: false, represented: true });
  });

  it("opens a square-wrapped Word picture beside the text without a floating-placement note", async () => {
    const { file, report } = await importOffice(
      await letterDocx("left"),
      "docx",
      "A letter.docx",
    );
    if (file.kind !== "doc") throw new Error("expected a document");
    const [image] = imagesOf(file.content);
    expect(image.attrs?.wrap).toBe("left");
    expect(file.content.content?.some((node) => node.type === "paragraph")).toBe(true);
    expect(JSON.stringify(file.content)).toContain("Dear friend");
    expect(report.warnings.join("\n")).not.toContain("floating placement");
    expect(report.warnings).toContain(PAGE_LAYOUT_NOTE_BESIDE);
    expect(letterGreeting.startsWith("Dear friend")).toBe(true);
  });

  it("mirrors a square wrap aligned to the right", async () => {
    const { file, report } = await importOffice(
      await letterDocx("right"),
      "docx",
      "A letter.docx",
    );
    if (file.kind !== "doc") throw new Error("expected a document");
    expect(imagesOf(file.content)[0].attrs?.wrap).toBe("right");
    expect(report.warnings.join("\n")).not.toContain("floating placement");
  });

  it("opens a Word inline picture in the sentence and still mentions floating placement", async () => {
    const { file, report } = await importOffice(
      await letterDocx("inline"),
      "docx",
      "A letter.docx",
    );
    if (file.kind !== "doc") throw new Error("expected a document");
    const paragraph = file.content.content?.find((node) => node.type === "paragraph");
    expect(paragraph?.content?.some((node) => node.type === "inlineImage")).toBe(true);
    expect(paragraph?.content?.map((node) => node.text ?? "").join("")).toContain("Dear friend");
    expect(imagesOf(file.content)).toEqual([]);
    expect(report.warnings).toContain(PAGE_LAYOUT_NOTE);
  });

  it("writes square wrap back to Word and reads it again", async () => {
    const logo = await letterDocx("inline");
    const imported = await importOffice(logo, "docx", "A letter.docx");
    if (imported.file.kind !== "doc") throw new Error("expected a document");
    const paragraph = imported.file.content.content?.find((node) =>
      node.content?.some((child) => child.type === "inlineImage"),
    );
    const inline = paragraph?.content?.find((node) => node.type === "inlineImage");
    if (!paragraph || !inline) throw new Error("expected an inline picture");
    imported.file.content.content = [
      { type: "image", attrs: { ...inline.attrs, wrap: "left" } },
      {
        type: "paragraph",
        content: paragraph.content?.filter((node) => node.type !== "inlineImage"),
      },
    ];
    const again = await importOffice(
      await exportDocx(imported.file),
      "docx",
      "A letter.docx",
    );
    if (again.file.kind !== "doc") throw new Error("expected a document");
    expect(imagesOf(again.file.content)[0].attrs?.wrap).toBe("left");
    const zip = await JSZip.loadAsync(await exportDocx(again.file));
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toMatch(/<wp:wrapSquare\b/);
    expect(xml).toMatch(/<wp:align>left<\/wp:align>/);
    expect(again.report.warnings.join("\n")).not.toContain("floating placement");
  });
});
