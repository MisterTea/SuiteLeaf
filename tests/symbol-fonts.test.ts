import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { createFile, type DocFile, type JsonNode, type SheetFile } from "../packages/core/src";
import { exportDocx } from "../packages/core/src/docx-export";
import { importOffice } from "../packages/core/src/office";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { exportPptx } from "../packages/core/src/pptx-export";
import { symbolBulletFont } from "../packages/core/src/pptx-lists";
import { isSymbolFont, symbolCode } from "../packages/core/src/symbol-fonts";
import { markWordSymbols, symbolSpans } from "../packages/core/src/word-symbols";
import { exportXlsx } from "../packages/core/src/xlsx-export";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

async function docx(body: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`);
  return zip.generateAsync({ type: "uint8array" });
}

function textNodes(node: JsonNode): JsonNode[] {
  return node.type === "text" ? [node] : (node.content ?? []).flatMap(textNodes);
}

const fontOf = (node: JsonNode) => node.marks?.find((mark) => mark.type === "textStyle")?.attrs?.fontFamily;

describe("symbol fonts", () => {
  it("knows the Office symbol fonts and their private-use codes", () => {
    expect(["Wingdings", "wingdings 2", " Symbol ", "Marlett", "MT Extra", "Bookshelf Symbol 7"].every(isSymbolFont)).toBe(true);
    expect(isSymbolFont("Calibri")).toBe(false);
    expect(isSymbolFont(undefined)).toBe(false);
    expect(symbolCode("F04A")).toBe("\uF04A");
    expect(symbolCode("4A")).toBe("\uF04A");
    expect(symbolCode("zz")).toBe("");
    expect(symbolBulletFont("MS Reference Specialty")).toBe("MS Reference Specialty");
    expect(symbolBulletFont("Arial")).toBeUndefined();
  });

  it("marks symbol-font Word text and turns the marks into SuiteLeaf spans", () => {
    const xml = markWordSymbols(
      `<w:p><w:r><w:sym w:font="Wingdings" w:char="F04A"/></w:r><w:r><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr><w:t>p</w:t></w:r><w:r><w:t>plain</w:t></w:r><w:r><w:sym w:font="Calibri" w:char="0041"/></w:r></w:p>`,
    );
    expect(xml).not.toContain('w:font="Wingdings"');
    expect(xml).toContain('w:font="Calibri"');
    expect(xml).toContain("<w:t>plain</w:t>");
    const html = symbolSpans(`<p>${xml.match(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)!.map((t) => t.replace(/<[^>]+>/g, "")).join("")}</p>`);
    expect(html).toBe('<p><span data-font="SuiteLeaf Sprig">\uF04A</span><span data-font="SuiteLeaf Thistle">p</span>plain</p>');
  });

  it("imports Word symbol text in the SuiteLeaf face and writes the Office font back", async () => {
    const bytes = await docx(
      `<w:p><w:r><w:t xml:space="preserve">Call </w:t></w:r><w:r><w:sym w:font="Wingdings" w:char="F028"/></w:r><w:r><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr><w:t>a</w:t></w:r></w:p>`,
    );
    const { file } = await importOffice(bytes, "docx", "symbols.docx");
    const doc = file as DocFile;
    const nodes = textNodes(doc.content as JsonNode);
    expect(nodes.map((node) => [node.text, fontOf(node)])).toEqual([
      ["Call ", undefined],
      ["\uF028", "SuiteLeaf Sprig"],
      ["a", "SuiteLeaf Thistle"],
    ]);
    const xml = await (await JSZip.loadAsync(await exportDocx(doc))).file("word/document.xml")!.async("string");
    expect(xml).toMatch(/w:ascii="Wingdings"[\s\S]*?\uF028/);
    expect(xml).toMatch(/w:ascii="Symbol"[\s\S]*?>a</);
    expect(xml).not.toContain("SuiteLeaf");
  });

  it("imports PowerPoint symbol runs in the SuiteLeaf face and writes the Office font back", async () => {
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      `<p:sld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="3000000" cy="1000000"/></a:xfrm></p:spPr><p:txBody><a:p>` +
        `<a:r><a:rPr sz="1800"><a:latin typeface="Calibri"/></a:rPr><a:t>Mail </a:t></a:r>` +
        `<a:r><a:rPr sz="1800"><a:latin typeface="Wingdings"/></a:rPr><a:t>*</a:t></a:r>` +
        `<a:r><a:rPr sz="1800"><a:latin typeface="Calibri"/><a:sym typeface="Webdings"/></a:rPr><a:t>\uF021</a:t></a:r>` +
        `<a:r><a:rPr sz="1800"><a:latin typeface="Symbol"/></a:rPr><a:t>m</a:t></a:r>` +
        `<a:r><a:rPr sz="1800"><a:latin typeface="Calibri"/><a:sym typeface="Symbol"/></a:rPr><a:t>\uF0B1 ok</a:t></a:r>` +
        `</a:p></p:txBody></p:sp></p:spTree></p:sld>`,
    );
    const file = await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }));
    const box = file.content.slides[file.content.slideOrder[0]].elements[0];
    expect(box.runs?.map((run) => [run.text, run.font])).toEqual([
      ["Mail ", undefined],
      ["*", "SuiteLeaf Sprig"],
      ["\uF021", "SuiteLeaf Fern"],
      ["m", "SuiteLeaf Thistle"],
      ["\uF0B1", "SuiteLeaf Thistle"],
      [" ok", undefined],
    ]);
    expect(box.fontFamily).toBe("SuiteLeaf Willow");
    const xml = await (await JSZip.loadAsync(await exportPptx(file))).file("ppt/slides/slide1.xml")!.async("string");
    expect(xml).toMatch(/typeface="Wingdings"[\s\S]*?<a:t>\*<\/a:t>/);
    expect(xml).toContain('typeface="Webdings"');
    expect(xml).toMatch(/typeface="Symbol"[\s\S]*?<a:t>m<\/a:t>/);
    expect(xml).not.toContain("SuiteLeaf");
  });

  it("writes a sheet's symbol face as the Office font and reads it back", async () => {
    const sheet = createFile("sheet", "Symbols") as SheetFile;
    const workbook = sheet.content.workbook as {
      styles?: Record<string, unknown>;
      sheetOrder: string[];
      sheets: Record<string, { cellData?: Record<number, Record<number, unknown>> }>;
    };
    workbook.styles = { ...workbook.styles, sym: { ff: "SuiteLeaf Sprig" } };
    workbook.sheets[workbook.sheetOrder[0]].cellData = { 0: { 0: { v: "J", s: "sym" } } };
    const bytes = await exportXlsx(sheet);
    const styles = await (await JSZip.loadAsync(bytes)).file("xl/styles.xml")!.async("string");
    expect(styles).toContain('<name val="Wingdings"/>');
    expect(styles).not.toContain("SuiteLeaf");
    const back = (await importOffice(bytes, "xlsx", "symbols.xlsx")).file as SheetFile;
    const faces = Object.values((back.content.workbook as { styles: Record<string, { ff?: string }> }).styles).map((style) => style.ff);
    expect(faces).toContain("SuiteLeaf Sprig");
  });
});
