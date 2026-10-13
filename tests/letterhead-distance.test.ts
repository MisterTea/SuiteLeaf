import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { parseFile, serializeFile } from "../packages/core/src";
import { documentPageSettings } from "../packages/core/src/document-layout";
import { exportDocx } from "../packages/core/src/docx-export";
import { furniturePlainText } from "../packages/core/src/letterhead-distance";
import { importOffice } from "../packages/core/src/office";
import {
  firstSectionEdgeDistances,
  pagePxToTwips,
} from "../packages/core/src/word-page-margins";
import { documentText } from "../packages/core/src/word";
import {
  councilLetterheadDocx,
  letterheadDocx,
  LETTER_MARGINS,
} from "./letterhead-fixtures";

const inch = (n: number) => n * 96;

function settingsOf(content: { attrs?: { pageSettings?: unknown } }) {
  return documentPageSettings(
    content as { type: string; attrs?: { pageSettings?: object } },
  );
}

describe("letterhead distance from Word", () => {
  it("reads w:header and w:footer from the first section only", () => {
    const xml = `<w:body><w:p><w:pPr><w:sectPr><w:pgMar w:header="720" w:footer="1080" w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:pPr></w:p><w:sectPr><w:pgMar w:header="2160" w:footer="2160" w:top="720"/></w:sectPr></w:body>`;
    expect(firstSectionEdgeDistances(xml)).toEqual({
      headerFromEdge: 48,
      footerFromEdge: 72,
    });
    expect(
      firstSectionEdgeDistances(
        `<w:sectPr><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>`,
      ),
    ).toBeNull();
    expect(firstSectionEdgeDistances("<w:body><w:p/></w:body>")).toBeNull();
  });

  it("keeps plain letterhead text and drops drawings and tabs", () => {
    const xml = `<w:hdr><w:p><w:r><w:drawing><w:t>logo</w:t></w:drawing><w:tab/><w:t>Town &amp; council</w:t></w:r></w:p></w:hdr>`;
    expect(furniturePlainText(xml)).toBe("Town & council");
  });

  it("imports both distances in inches without moving the body margin", async () => {
    const { file, report } = await importOffice(
      await councilLetterheadDocx(),
      "docx",
      "Council letter.docx",
    );
    if (file.kind !== "doc") throw new Error("expected a document");
    expect(file.content.attrs?.pageSettings).toMatchObject({
      marginTop: inch(1),
      marginBottom: inch(1),
      marginLeft: inch(1),
      marginRight: inch(1),
      headerFromEdge: inch(0.5),
      footerFromEdge: inch(0.5),
      header: "Town council",
      footer: "Hearing notes",
      pageNumbers: false,
    });
    expect(file.content.attrs?.pageSettings).not.toHaveProperty("gutter");
    expect(documentText(file.content)).toContain("notes start an inch in");
    expect(documentText(file.content)).not.toContain("Imported header");
    expect(documentText(file.content)).not.toContain("Town council");
    expect(report.warnings).toContain(
      "Letterhead: header 0.5 in, footer 0.5 in from the edge",
    );
    const saved = parseFile(serializeFile(file));
    expect(settingsOf(saved.content)).toMatchObject({
      marginTop: inch(1),
      headerFromEdge: inch(0.5),
      footerFromEdge: inch(0.5),
      header: "Town council",
      footer: "Hearing notes",
    });
  });

  it("writes a changed header distance back and leaves the footer", async () => {
    const { file } = await importOffice(
      await councilLetterheadDocx(),
      "docx",
      "Council letter.docx",
    );
    if (file.kind !== "doc") throw new Error("expected a document");
    const pageSettings = {
      ...(file.content.attrs?.pageSettings as object),
      headerFromEdge: inch(0.75),
    };
    file.content = {
      ...file.content,
      attrs: { ...file.content.attrs, pageSettings },
    };
    const zip = await JSZip.loadAsync(await exportDocx(file));
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain(`w:header="${pagePxToTwips(inch(0.75))}"`);
    expect(xml).toContain(`w:footer="${pagePxToTwips(inch(0.5))}"`);
    expect(xml).toContain(`w:top="${pagePxToTwips(inch(1))}"`);
    const roundTrip = await importOffice(
      await zip.generateAsync({ type: "uint8array" }),
      "docx",
      "back.docx",
    );
    if (roundTrip.file.kind !== "doc") throw new Error("expected a document");
    expect(settingsOf(roundTrip.file.content)).toMatchObject({
      marginTop: inch(1),
      headerFromEdge: inch(0.75),
      footerFromEdge: inch(0.5),
      header: "Town council",
      footer: "Hearing notes",
    });
  });

  it("leaves the header distance when only the footer changes", async () => {
    const { file } = await importOffice(
      await councilLetterheadDocx(),
      "docx",
      "Council letter.docx",
    );
    if (file.kind !== "doc") throw new Error("expected a document");
    file.content = {
      ...file.content,
      attrs: {
        ...file.content.attrs,
        pageSettings: {
          ...(file.content.attrs?.pageSettings as object),
          footerFromEdge: inch(0.75),
        },
      },
    };
    const xml = await (
      await JSZip.loadAsync(await exportDocx(file))
    )
      .file("word/document.xml")!
      .async("string");
    expect(xml).toContain(`w:header="${pagePxToTwips(inch(0.5))}"`);
    expect(xml).toContain(`w:footer="${pagePxToTwips(inch(0.75))}"`);
  });

  it("keeps the current default when the file has no header or footer distance", async () => {
    const { file } = await importOffice(
      await letterheadDocx({
        header: "Workshop agenda",
        footer: "Staff note",
        margins: null,
        headerTwips: null,
        footerTwips: null,
        body: "This file has no header distance.",
      }),
      "docx",
      "Workshop.docx",
    );
    if (file.kind !== "doc") throw new Error("expected a document");
    expect(file.content.attrs?.pageSettings).not.toHaveProperty("headerFromEdge");
    expect(file.content.attrs?.pageSettings).not.toHaveProperty("footerFromEdge");
    const settings = settingsOf(file.content);
    expect(settings.headerFromEdge).toBe(72);
    expect(settings.footerFromEdge).toBe(72);
    expect(settings.marginTop).toBe(72);
    expect(settings.header).toBe("Workshop agenda");
  });

  it("does not copy the body margin into the distance when Word omitted it", async () => {
    const { file } = await importOffice(
      await letterheadDocx({
        header: "Town council",
        footer: "Hearing notes",
        margins: LETTER_MARGINS,
        headerTwips: null,
        footerTwips: null,
      }),
      "docx",
      "Margins only.docx",
    );
    if (file.kind !== "doc") throw new Error("expected a document");
    const stored = file.content.attrs?.pageSettings as {
      marginTop?: number;
      headerFromEdge?: number;
      footerFromEdge?: number;
    };
    expect(stored.marginTop).toBe(inch(1));
    expect(stored).not.toHaveProperty("headerFromEdge");
    expect(stored).not.toHaveProperty("footerFromEdge");
    const settings = settingsOf(file.content);
    expect(settings.headerFromEdge).toBe(inch(1));
    expect(settings.footerFromEdge).toBe(inch(1));
    expect(settings.marginTop).toBe(inch(1));
  });

  it("imports one distance and leaves the other at the default", async () => {
    const { file } = await importOffice(
      await letterheadDocx({
        margins: LETTER_MARGINS,
        headerTwips: 720,
        footerTwips: null,
      }),
      "docx",
      "Header only.docx",
    );
    if (file.kind !== "doc") throw new Error("expected a document");
    const stored = file.content.attrs?.pageSettings as {
      headerFromEdge?: number;
      footerFromEdge?: number;
      marginTop?: number;
      marginBottom?: number;
    };
    expect(stored.headerFromEdge).toBe(inch(0.5));
    expect(stored).not.toHaveProperty("footerFromEdge");
    expect(stored.marginTop).toBe(inch(1));
    expect(stored.marginBottom).toBe(inch(1));
    expect(settingsOf(file.content).footerFromEdge).toBe(inch(1));
  });

  it("ignores a header distance on a later section", async () => {
    const { file } = await importOffice(
      await letterheadDocx({
        margins: LETTER_MARGINS,
        headerTwips: 720,
        footerTwips: 720,
        laterHeaderTwips: 2160,
        body: "Second section notes",
      }),
      "docx",
      "Two sections.docx",
    );
    if (file.kind !== "doc") throw new Error("expected a document");
    expect(settingsOf(file.content).headerFromEdge).toBe(inch(0.5));
    expect(settingsOf(file.content).marginTop).toBe(inch(1));
  });
});
