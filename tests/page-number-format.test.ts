import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createFile } from "../packages/core/src";
import { exportDocx } from "../packages/core/src/docx-export";
import {
  documentPageSettings,
  pageFace,
} from "../packages/core/src/document-layout";

/** The paragraph that carries a PAGE field, without matching NUMPAGES. */
function pageFieldParagraph(xml: string): string | undefined {
  return xml
    .split(/<w:p[\s>]/)
    .slice(1)
    .find((paragraph) => /PAGE(?!S)/.test(paragraph));
}

describe("page number Word export", () => {
  it("writes Page N at the top right and leaves the footer text alone", async () => {
    const file = createFile("doc", "Minutes");
    if (file.kind !== "doc") throw new Error();
    file.content = {
      type: "doc",
      attrs: {
        pageSettings: {
          header: "Garden club minutes",
          footer: "Committee draft",
          pageNumbers: true,
          pageNumberFormat: "page",
          pageNumberPosition: "top-right",
          pageNumberPositionSet: true,
        },
      },
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Present" }] },
      ],
    };
    const zip = await JSZip.loadAsync(await exportDocx(file));
    const header = await zip.file("word/header1.xml")!.async("string");
    const footer = await zip.file("word/footer1.xml")!.async("string");
    expect(header).toContain("Garden club minutes");
    expect(header).toMatch(/PAGE(?!S)/);
    expect(header).not.toContain("NUMPAGES");
    expect(footer).toContain("Committee draft");
    expect(footer).not.toContain("NUMPAGES");
    expect(footer).not.toMatch(/PAGE(?!S)/);
  });
  it("starts Word at the chosen page, and at 1 after an unnumbered cover", async () => {
    const file = createFile("doc", "Minutes");
    if (file.kind !== "doc") throw new Error();
    const settings = {
      footer: "Committee draft",
      pageNumbers: true,
      pageNumberFormat: "page",
      pageNumberPosition: "bottom-center",
      pageNumberPositionSet: true,
      pageNumberStart: 4,
    };
    file.content = {
      type: "doc",
      attrs: { pageSettings: settings },
      content: [
        { type: "paragraph", content: [{ type: "text", text: "October minutes" }] },
        { type: "pageBreak" },
        { type: "paragraph", content: [{ type: "text", text: "Votes" }] },
      ],
    };
    const started = await JSZip.loadAsync(await exportDocx(file));
    const startedDoc = await started.file("word/document.xml")!.async("string");
    expect(startedDoc).toContain('w:start="4"');
    expect(startedDoc).not.toContain("w:titlePg");
    const startedFooter = await started.file("word/footer1.xml")!.async("string");
    expect(startedFooter).toContain("Committee draft");
    expect(startedFooter).toContain("Page ");
    expect(startedFooter).toMatch(/PAGE(?!S)/);

    file.content = {
      ...file.content,
      attrs: {
        pageSettings: { ...settings, coverHasNoNumber: true },
      },
    };
    const covered = await JSZip.loadAsync(await exportDocx(file));
    const coveredDoc = await covered.file("word/document.xml")!.async("string");
    expect(coveredDoc).toContain('w:start="0"');
    expect(coveredDoc).not.toContain('w:start="4"');
    expect(coveredDoc).toContain("w:titlePg");
    expect(coveredDoc).toContain('w:type="first"');
    const footers = await Promise.all(
      Object.keys(covered.files)
        .filter((name) => /word\/footer\d+\.xml$/.test(name))
        .map((name) => covered.file(name)!.async("string")),
    );
    const plain = footers.filter((xml) => !/PAGE(?!S)/.test(xml));
    const numbered = footers.filter((xml) => /PAGE(?!S)/.test(xml));
    expect(plain.some((xml) => xml.includes("Committee draft"))).toBe(true);
    expect(numbered.some((xml) => xml.includes("Committee draft"))).toBe(true);
    expect(numbered.some((xml) => xml.includes("Page "))).toBe(true);
  });
  it("writes lowercase roman before a heading and arabic 1 from that heading", async () => {
    const file = createFile("doc", "Field report");
    if (file.kind !== "doc") throw new Error();
    file.content = {
      type: "doc",
      attrs: {
        pageSettings: {
          footer: "Draft",
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
          attrs: { level: 1 },
          content: [{ type: "text", text: "Figures" }],
        },
        { type: "pageBreak" },
        {
          type: "heading",
          attrs: { level: 1, startArabic: true },
          content: [{ type: "text", text: "Chapter 1" }],
        },
        { type: "paragraph", content: [{ type: "text", text: "The survey." }] },
      ],
    };
    const zip = await JSZip.loadAsync(await exportDocx(file));
    const doc = await zip.file("word/document.xml")!.async("string");
    expect(doc).toContain('w:fmt="lowerRoman"');
    expect(doc).toContain('w:start="1"');
    expect(doc).toContain('w:fmt="decimal"');
    expect(doc).toContain('w:val="nextPage"');
    const chapter = doc.indexOf("Chapter 1");
    expect(doc.indexOf("Figures")).toBeGreaterThan(0);
    expect(doc.indexOf("Figures")).toBeLessThan(chapter);
    expect(doc.indexOf('w:fmt="lowerRoman"')).toBeLessThan(chapter);
    expect(doc.indexOf('w:fmt="decimal"')).toBeGreaterThan(chapter);
    const breaks = doc.match(/w:pageBreakBefore/g) ?? [];
    expect(breaks).toHaveLength(1);
    const footers = await Promise.all(
      Object.keys(zip.files)
        .filter((name) => /word\/footer\d+\.xml$/.test(name))
        .map((name) => zip.file(name)!.async("string")),
    );
    expect(footers.length).toBeGreaterThan(1);
    for (const footer of footers) {
      expect(footer).toContain("Draft");
      expect(footer).toMatch(/PAGE(?!S)/);
      expect(footer).not.toContain("Page ");
      expect(footer).not.toContain("NUMPAGES");
    }
  });

  it("puts a centered top-center number in the header and keeps bottom-right in the footer", async () => {
    const saved = documentPageSettings({
      type: "doc",
      attrs: {
        pageSettings: {
          header: "Field report",
          footer: "Draft",
          pageNumbers: true,
          pageNumberFormat: "page",
          pageNumberPosition: "top-center",
          pageNumberPositionSet: true,
          marginTop: 96,
          marginBottom: 96,
          marginLeft: 96,
          marginRight: 96,
          headerFromEdge: 48,
        },
      },
    });
    expect(saved.pageNumberPosition).toBe("top-center");
    expect(saved.marginTop).toBe(96);
    expect(saved.marginBottom).toBe(96);
    expect(saved.marginLeft).toBe(96);
    expect(saved.marginRight).toBe(96);
    expect(saved.headerFromEdge).toBe(48);
    expect(pageFace(saved, 0, 1)).toMatchObject({
      header: "Field report",
      footer: "Draft",
      numberSide: "top-center",
      pageNumber: "Page 1",
    });
    expect(pageFace(saved, 0, 1).numberSide).not.toMatch(/^(left|right|center)$/);

    const file = createFile("doc", "Short report");
    if (file.kind !== "doc") throw new Error();
    file.content = {
      type: "doc",
      attrs: {
        pageSettings: {
          header: "Field report",
          footer: "Draft",
          pageNumbers: true,
          pageNumberFormat: "page",
          pageNumberPosition: "top-center",
          pageNumberPositionSet: true,
          marginTop: 96,
          headerFromEdge: 48,
        },
      },
      content: [
        { type: "paragraph", content: [{ type: "text", text: "One page." }] },
      ],
    };
    const zip = await JSZip.loadAsync(await exportDocx(file));
    const header = await zip.file("word/header1.xml")!.async("string");
    const footer = await zip.file("word/footer1.xml")!.async("string");
    const numbered = pageFieldParagraph(header);
    expect(numbered).toBeTruthy();
    expect(numbered).toMatch(/w:val="center"/);
    expect(footer).toContain("Draft");
    expect(footer).not.toMatch(/PAGE(?!S)/);
    expect(header).not.toMatch(/NUMPAGES/);
    const section = await zip.file("word/document.xml")!.async("string");
    expect(section).toContain('w:header="720"');
    expect(section).toContain('w:top="1440"');

    file.content = {
      ...file.content,
      attrs: {
        pageSettings: {
          header: "Field report",
          footer: "Draft",
          pageNumbers: true,
          pageNumberFormat: "page",
          pageNumberPosition: "bottom-right",
          pageNumberPositionSet: true,
        },
      },
    };
    const bottom = await JSZip.loadAsync(await exportDocx(file));
    const bottomHeader = await bottom.file("word/header1.xml")!.async("string");
    const bottomFooter = await bottom.file("word/footer1.xml")!.async("string");
    expect(bottomHeader).not.toMatch(/PAGE(?!S)/);
    expect(pageFieldParagraph(bottomFooter)).toBeTruthy();
    expect(bottomFooter).not.toMatch(/w:val="center"/);
  });
});
