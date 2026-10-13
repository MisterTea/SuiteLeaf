import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createFile } from "../packages/core/src";
import { exportDocx } from "../packages/core/src/docx-export";

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
});
