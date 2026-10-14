import { describe, expect, it } from "vitest";
import {
  documentPageSettings,
  pageFace,
} from "../packages/core/src/document-layout";
import { parseFile, serializeFile } from "../packages/core/src";
import { documentText } from "../packages/core/src/word";
import { exportDocx } from "../packages/core/src/docx-export";
import JSZip from "jszip";
import { headerPartText } from "../packages/core/src/word-headers";
import { importOffice } from "../packages/core/src/office";
import {
  councilMinutesDocx,
  pageNumberHeaderDocx,
} from "./word-letterhead-fixture";

describe("Word header text", () => {
  it("drops a page-number field and keeps the words beside it", () => {
    const xml = `<w:p><w:r><w:t>Council</w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>3</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`;
    expect(headerPartText(xml)).toEqual({ text: "Council", pageNumber: true });
  });
  it("treats a header that is only a page number as a page number", () => {
    const complex = `<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`;
    const simple = `<w:p><w:fldSimple w:instr=" PAGE "><w:r><w:t>4</w:t></w:r></w:fldSimple></w:p>`;
    expect(headerPartText(complex)).toEqual({ text: "", pageNumber: true });
    expect(headerPartText(simple)).toEqual({ text: "", pageNumber: true });
  });
});

describe("importing a Word letterhead", () => {
  it("keeps the first, even, and odd headers apart", async () => {
    const { file, report } = await importOffice(
      await councilMinutesDocx(),
      "docx",
      "council-minutes.docx",
    );
    if (file.kind !== "doc") throw new Error("expected a document");
    const settings = documentPageSettings(file.content);
    expect(settings.differentFirstPage).toBe(true);
    expect(settings.differentOddEven).toBe(true);
    expect(settings.pageNumbers).toBe(true);
    expect(settings.firstHeader).toBe("Town Council");
    expect(settings.evenHeader).toBe("Minutes");
    expect(settings.oddHeader).toBe("Council");
    expect(settings.header).toBe("Council");
    expect(settings.header).not.toContain("Minutes");
    expect(settings.header).not.toContain("Town");
    expect(settings.evenFooter).toBe("");
    expect(settings.oddFooter).toBe("");
    expect(pageFace(settings, 0, 3)).toMatchObject({
      header: "Town Council",
      numberSide: "none",
      pageNumber: "",
    });
    expect(pageFace(settings, 1, 3)).toMatchObject({
      header: "Minutes",
      headerAlign: "left",
      numberSide: "left",
      pageNumber: "2 / 3",
    });
    expect(pageFace(settings, 2, 3)).toMatchObject({
      header: "Council",
      headerAlign: "right",
      numberSide: "right",
      pageNumber: "3 / 3",
    });
    const text = documentText(file.content);
    expect(text).toContain("October minutes");
    expect(text).toContain("Matters arising");
    expect(text).toContain("Decisions");
    expect(text).not.toContain("Town Council");
    expect(text).not.toContain("Imported header");
    expect(text).not.toContain("Imported footer");
    const paragraphs = (file.content.content ?? [])
      .filter((node) => node.type === "paragraph")
      .map((node) => documentText(node));
    expect(paragraphs).not.toContain("2");
    expect(paragraphs).not.toContain("3");
    expect(paragraphs).not.toContain("PAGE");
    expect(
      (file.content.content ?? []).filter((node) => node.type === "pageBreak"),
    ).toHaveLength(2);
    expect(report.warnings.join("\n")).not.toMatch(
      /header\/footer text is retained|flattened|merged/i,
    );
    const saved = parseFile(serializeFile(file));
    expect(documentPageSettings(saved.content)).toMatchObject({
      differentFirstPage: true,
      differentOddEven: true,
      firstHeader: "Town Council",
      evenHeader: "Minutes",
      oddHeader: "Council",
      pageNumbers: true,
    });
  });

  it.each([false, true])(
    "keeps a header that is only a page number out of the body (simple=%s)",
    async (simple) => {
      const { file, report } = await importOffice(
        await pageNumberHeaderDocx(simple),
        "docx",
        "numbers.docx",
      );
      if (file.kind !== "doc") throw new Error("expected a document");
      const settings = documentPageSettings(file.content);
      expect(settings.pageNumbers).toBe(true);
      expect(settings.header).toBe("");
      expect(settings.differentFirstPage).toBe(false);
      expect(documentText(file.content)).toBe("The budget stands.");
      expect(documentText(file.content)).not.toMatch(/\bPAGE\b|\b[134]\b/);
      expect(report.warnings.join("\n")).not.toMatch(
        /header\/footer text is retained|Imported header/i,
      );
    },
  );

  it("writes the three headers back to Word", async () => {
    const imported = await importOffice(
      await councilMinutesDocx(),
      "docx",
      "council-minutes.docx",
    );
    if (imported.file.kind !== "doc") throw new Error("expected a document");
    const zip = await JSZip.loadAsync(await exportDocx(imported.file));
    const settingsXml = await zip.file("word/settings.xml")!.async("string");
    expect(settingsXml).toContain("evenAndOddHeaders");
    const documentXml = await zip.file("word/document.xml")!.async("string");
    expect(documentXml).toContain("titlePg");
    expect(documentXml).toContain('w:type="first"');
    expect(documentXml).toContain('w:type="even"');
    const headers = await Promise.all(
      Object.keys(zip.files)
        .filter((path) => /word\/header\d+\.xml$/.test(path))
        .map((path) => zip.file(path)!.async("string")),
    );
    expect(headers.some((xml) => xml.includes("Town Council"))).toBe(true);
    expect(headers.some((xml) => xml.includes(">Minutes<"))).toBe(true);
    expect(headers.some((xml) => /<w:t[^>]*>Council<\/w:t>/.test(xml))).toBe(
      true,
    );
    const again = await importOffice(
      await zip.generateAsync({ type: "uint8array" }),
      "docx",
      "council-minutes.docx",
    );
    if (again.file.kind !== "doc") throw new Error("expected a document");
    expect(documentPageSettings(again.file.content)).toMatchObject({
      differentFirstPage: true,
      differentOddEven: true,
      firstHeader: "Town Council",
      evenHeader: "Minutes",
      oddHeader: "Council",
      pageNumbers: true,
    });
    expect(again.report.warnings.join("\n")).not.toMatch(
      /header\/footer text is retained|flattened|merged/i,
    );
  });
});
