import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createFile, parseFile, serializeFile } from "../packages/core/src";
import {
  documentHtml,
  documentPageSettings,
  MARGIN_DEFAULT_PX,
} from "../packages/core/src/document-layout";
import { exportDocx } from "../packages/core/src/docx-export";
import { importOffice } from "../packages/core/src/office";
import {
  firstSectionPageMargins,
  pagePxToTwips,
} from "../packages/core/src/word-page-margins";
import {
  COUNCIL_MARGINS,
  councilLetterDocx,
  plainNoteDocx,
  wordDocument,
} from "./word-margin-fixtures";

const councilPx = {
  marginTop: 144,
  marginBottom: 72,
  marginLeft: 96,
  marginRight: 72,
};

function settingsOf(content: { attrs?: { pageSettings?: unknown } }) {
  return documentPageSettings(content as { type: string; attrs?: { pageSettings?: object } });
}

describe("Word page margins", () => {
  it("reads the first section's four edges and ignores a later section", () => {
    const xml = `<w:body><w:p><w:pPr><w:sectPr><w:pgMar w:header="720" w:footer="720" w:gutter="360" w:top="2160" w:right="1080" w:bottom="1080" w:left="1440"/></w:sectPr></w:pPr></w:p><w:sectPr><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body>`;
    expect(firstSectionPageMargins(xml)).toEqual(councilPx);
  });

  it("keeps the default when the first section has no page margins", () => {
    expect(firstSectionPageMargins("<w:body><w:p/></w:body>")).toBeNull();
    expect(
      firstSectionPageMargins(
        `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>`,
      ),
    ).toBeNull();
    expect(
      firstSectionPageMargins(
        `<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240"/></w:sectPr></w:pPr></w:p><w:sectPr><w:pgMar w:top="2160" w:right="1080" w:bottom="1080" w:left="1440"/></w:sectPr>`,
      ),
    ).toBeNull();
  });

  it("imports a council letter's w:pgMar into four edges", async () => {
    const { file } = await importOffice(
      await councilLetterDocx(),
      "docx",
      "Council letter.docx",
    );
    if (file.kind !== "doc") throw new Error("expected a document");
    expect(settingsOf(file.content)).toMatchObject({
      ...councilPx,
      pageNumbers: false,
    });
    expect(file.content.attrs?.pageSettings).not.toHaveProperty("gutter");
    const saved = parseFile(serializeFile(file));
    expect(settingsOf(saved.content)).toMatchObject({
      ...councilPx,
      pageNumbers: false,
    });
  });

  it("opens a Word file with no page margins at the current default", async () => {
    const { file } = await importOffice(
      await plainNoteDocx(),
      "docx",
      "Plain note.docx",
    );
    if (file.kind !== "doc") throw new Error("expected a document");
    expect(file.content.attrs?.pageSettings).toBeUndefined();
    const settings = settingsOf(file.content);
    expect(settings.marginTop).toBe(MARGIN_DEFAULT_PX);
    expect(settings.marginBottom).toBe(MARGIN_DEFAULT_PX);
    expect(settings.marginLeft).toBe(MARGIN_DEFAULT_PX);
    expect(settings.marginRight).toBe(MARGIN_DEFAULT_PX);
  });

  it("uses only the first section when a file has several", async () => {
    const { file } = await importOffice(
      await wordDocument({
        paragraphs: [
          { text: "First", heading: true },
          { text: "Second" },
        ],
        margins: COUNCIL_MARGINS,
        nextMargins: { top: 720, right: 720, bottom: 720, left: 720 },
        mirror: true,
      }),
      "docx",
      "Two sections.docx",
    );
    if (file.kind !== "doc") throw new Error("expected a document");
    expect(settingsOf(file.content)).toMatchObject(councilPx);
  });

  it("writes the four edges back and leaves the others unchanged", async () => {
    const { file } = await importOffice(
      await councilLetterDocx(),
      "docx",
      "Council letter.docx",
    );
    if (file.kind !== "doc") throw new Error("expected a document");
    const pageSettings = {
      ...(file.content.attrs?.pageSettings as object),
      marginRight: 96,
    };
    file.content = {
      ...file.content,
      attrs: { ...file.content.attrs, pageSettings },
    };
    const zip = await JSZip.loadAsync(await exportDocx(file));
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain(`w:top="${pagePxToTwips(144)}"`);
    expect(xml).toContain(`w:bottom="${pagePxToTwips(72)}"`);
    expect(xml).toContain(`w:left="${pagePxToTwips(96)}"`);
    expect(xml).toContain(`w:right="${pagePxToTwips(96)}"`);
    const roundTrip = await importOffice(await zip.generateAsync({ type: "uint8array" }), "docx", "back.docx");
    if (roundTrip.file.kind !== "doc") throw new Error("expected a document");
    expect(settingsOf(roundTrip.file.content)).toMatchObject({
      ...councilPx,
      marginRight: 96,
    });
  });

  it("opens a one-margin SuiteLeaf file with that margin on every edge", () => {
    const file = createFile("doc", "Older letter");
    if (file.kind !== "doc") throw new Error("expected a document");
    file.content = {
      type: "doc",
      attrs: { pageSettings: { margin: 96, header: "Clerk" } },
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
    };
    const opened = parseFile(serializeFile(file));
    const settings = settingsOf(opened.content);
    expect(settings.margin).toBe(96);
    expect(settings.marginTop).toBe(96);
    expect(settings.marginBottom).toBe(96);
    expect(settings.marginLeft).toBe(96);
    expect(settings.marginRight).toBe(96);
    expect(settings.header).toBe("Clerk");
  });

  it("prints each edge in the HTML page box", () => {
    const html = documentHtml("Letter", "<p>City Council</p>", {
      size: "letter",
      landscape: false,
      margin: 72,
      ...councilPx,
      header: "",
      footer: "",
      pageNumbers: false,
    });
    expect(html).toContain("padding: 1.5in 0.75in 0.75in 1in");
    expect(html).toContain("margin: 1.5in 0.75in 0.75in 1in");
  });
});
