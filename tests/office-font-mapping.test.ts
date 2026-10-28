import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createFile, type DocFile, type SlideFile } from "../packages/core/src/index";
import { importOffice } from "../packages/core/src/office";
import { officeFont, suiteLeafFont } from "../packages/core/src/office-fonts";
import { wordDefaultFont } from "../packages/core/src/word-fonts";
import { bodyFontFamily, documentPageSettings } from "../packages/core/src/document-layout";
import { exportDocx } from "../packages/core/src/docx-export";
import { exportPptx } from "../packages/core/src/pptx-export";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { exportXlsx } from "../packages/core/src/xlsx-export";
import { excelFixture } from "./office-fixtures";

describe("Office font names", () => {
  it("become the installed family that lays text out the same way, and back", () => {
    expect(suiteLeafFont("Calibri")).toBe("SuiteLeaf Willow");
    expect(suiteLeafFont("Calibri Light")).toBe("SuiteLeaf Willow Light");
    expect(suiteLeafFont("Aptos SemiBold")).toBe("SuiteLeaf Elm SemiBold");
    expect(suiteLeafFont("ＭＳ ゴシック")).toBe("SuiteLeaf Bamboo");
    expect(officeFont("SuiteLeaf Willow")).toBe("Calibri");
    expect(officeFont("SuiteLeaf Elm SemiBold")).toBe("Aptos SemiBold");
    expect(suiteLeafFont("Some Brand Font")).toBe("Some Brand Font");
    expect(officeFont("Roboto")).toBe("Roboto");
    expect(suiteLeafFont(undefined)).toBeUndefined();
  });

  it("finds a Word document's body font in the Normal style, the defaults, or the theme", () => {
    const theme = '<a:minorFont><a:latin typeface="Calibri"/></a:minorFont><a:majorFont><a:latin typeface="Cambria"/></a:majorFont>';
    const defaults = (fonts: string) => `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts ${fonts}/></w:rPr></w:rPrDefault></w:docDefaults>`;
    expect(wordDefaultFont(defaults('w:asciiTheme="minorHAnsi"'), theme)).toBe("SuiteLeaf Willow");
    expect(wordDefaultFont(defaults('w:ascii="Times New Roman"'))).toBe("SuiteLeaf Maple");
    const normal = '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:rPr><w:rFonts w:ascii="Aptos"/></w:rPr></w:style>';
    expect(wordDefaultFont(defaults('w:ascii="Arial"') + normal)).toBe("SuiteLeaf Elm");
    expect(wordDefaultFont("<w:styles/>")).toBeUndefined();
  });

  it("keeps only a plain family name for the document body font", () => {
    expect(documentPageSettings({ type: "doc", attrs: { pageSettings: { font: 'Evil", serif; x' } } }).font).toBe("Evil serif x");
    expect(bodyFontFamily("SuiteLeaf Willow")).toBe('"SuiteLeaf Willow", Arial, sans-serif');
    expect(bodyFontFamily("")).toBe("Arial, sans-serif");
  });

  it("writes Office names into a Word file and reads them back as SuiteLeaf families", async () => {
    const file = createFile("doc", "Fonts") as DocFile;
    file.content = {
      type: "doc",
      attrs: { pageSettings: { font: "SuiteLeaf Willow" } },
      content: [{ type: "paragraph", content: [{ type: "text", text: "Body", marks: [{ type: "textStyle", attrs: { fontFamily: "SuiteLeaf Maple" } }] }] }],
    };
    const zip = await JSZip.loadAsync(await exportDocx(file));
    expect(await zip.file("word/styles.xml")!.async("string")).toMatch(/w:ascii="Calibri"/);
    const documentXml = await zip.file("word/document.xml")!.async("string");
    expect(documentXml).toMatch(/w:ascii="Times New Roman"/);
    expect(documentXml).not.toContain("SuiteLeaf");
    const { file: back } = await importOffice(await zip.generateAsync({ type: "uint8array" }), "docx", "fonts.docx");
    expect(documentPageSettings((back as DocFile).content).font).toBe("SuiteLeaf Willow");
  });

  it("writes Office names into a workbook and reads them back as SuiteLeaf families", async () => {
    const { file } = await importOffice(await excelFixture(), "xlsx", "fonts.xlsx");
    if (file.kind !== "sheet") throw new Error("Expected sheet");
    expect(file.content.workbook.styles!["excel-0"].ff).toBe("SuiteLeaf Aspen");
    const zip = await JSZip.loadAsync(await exportXlsx(file));
    const styles = await zip.file("xl/styles.xml")!.async("string");
    expect(styles).toContain('<name val="Arial"/>');
    expect(styles).not.toContain("SuiteLeaf");
  });

  it("writes Office names into a deck and reads them back as SuiteLeaf families", async () => {
    const file = createFile("slide", "Fonts") as SlideFile;
    const slide = file.content.slides[file.content.slideOrder[0]];
    slide.elements = [{ ...slide.elements[0], fontFamily: "SuiteLeaf Willow", content: "Title" }];
    const bytes = await exportPptx(file);
    const zip = await JSZip.loadAsync(bytes);
    const slideXml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slideXml).toContain('typeface="Calibri"');
    expect(slideXml).not.toContain("SuiteLeaf");
    const deck = (await parsePowerPoint(bytes)).content;
    const text = deck.slides[deck.slideOrder[0]].elements.find((el) => el.content === "Title");
    expect(text?.fontFamily).toBe("SuiteLeaf Willow");
  });
});
