import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createFile, parseFile, serializeFile } from "../packages/core/src";
import { exportDocx } from "../packages/core/src/docx-export";
import {
  defaultPageSettings,
  documentHtml,
  documentPageSettings,
  watermarkText,
} from "../packages/core/src/document-layout";

const minutes = () => {
  const file = createFile("doc", "Garden club minutes");
  if (file.kind !== "doc") throw new Error();
  file.content = {
    type: "doc",
    attrs: {
      pageSettings: {
        ...defaultPageSettings,
        watermark: "DRAFT",
      },
    },
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Asha will book the village hall." }],
      },
      { type: "pageBreak" },
      {
        type: "paragraph",
        content: [{ type: "text", text: "Next meeting: 2 November." }],
      },
    ],
  };
  return file;
};

describe("watermark text", () => {
  it("is blank until a phrase is saved", () => {
    expect(defaultPageSettings.watermark).toBe("");
    expect(watermarkText("  ")).toBe("");
    expect(watermarkText(12)).toBe("");
    expect(documentPageSettings({ type: "doc" }).watermark).toBe("");
    expect(
      documentPageSettings({
        type: "doc",
        attrs: { pageSettings: { header: "Old file" } },
      }).watermark,
    ).toBe("");
  });

  it("keeps a short phrase and drops surrounding spaces", () => {
    expect(watermarkText("  DRAFT  ")).toBe("DRAFT");
    expect(watermarkText("Garden club")).toBe("Garden club");
    expect(watermarkText("x".repeat(80))).toHaveLength(40);
    expect(
      documentPageSettings({
        type: "doc",
        attrs: { pageSettings: { watermark: " FINAL " } },
      }).watermark,
    ).toBe("FINAL");
  });
});

describe("watermark export", () => {
  it("draws the word behind the HTML page, not as a paragraph", () => {
    const html = documentHtml("Minutes", "<p>The hall is booked.</p>", {
      ...defaultPageSettings,
      watermark: "A & B",
    });
    const mark = html.indexOf(
      '<div class="page-watermark" aria-hidden="true">A &amp; B</div>',
    );
    const body = html.indexOf("<p>The hall is booked.</p>");
    expect(mark).toBeGreaterThan(0);
    expect(body).toBeGreaterThan(mark);
    expect(html).not.toContain("<p>A &amp; B</p>");
  });

  it("omits the watermark when the field is empty", () => {
    const html = documentHtml("Notes", "<p>Text</p>", defaultPageSettings);
    expect(html).not.toContain("page-watermark");
  });

  it("writes a Word watermark and leaves the paragraphs alone", async () => {
    const file = minutes();
    const zip = await JSZip.loadAsync(await exportDocx(file));
    const header = await zip.file("word/header1.xml")!.async("string");
    const doc = await zip.file("word/document.xml")!.async("string");
    expect(header).toContain("PowerPlusWaterMarkObject");
    expect(header).toContain('string="DRAFT"');
    expect(doc).toContain("village hall");
    expect(doc).not.toContain("DRAFT");
    expect(parseFile(serializeFile(file)).content).toEqual(file.content);
  });

  it("drops the Word watermark when the field is cleared", async () => {
    const file = minutes();
    if (file.kind !== "doc") throw new Error();
    file.content.attrs = {
      pageSettings: { ...defaultPageSettings, watermark: "   " },
    };
    const zip = await JSZip.loadAsync(await exportDocx(file));
    const header = await zip.file("word/header1.xml")!.async("string");
    const doc = await zip.file("word/document.xml")!.async("string");
    expect(header).not.toContain("PowerPlusWaterMarkObject");
    expect(header).not.toContain("DRAFT");
    expect(doc).toContain("village hall");
  });
});
