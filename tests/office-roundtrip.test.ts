import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { createFile, type DocFile, type SheetFile, type SlideFile } from "../packages/core/src";
import { importBinaryDoc } from "../packages/core/src/doc-binary";
import { exportDocx } from "../packages/core/src/docx-export";
import { importOffice } from "../packages/core/src/office";
import { exportXlsx } from "../packages/core/src/xlsx-export";
import { importForeign } from "../packages/core/src/foreign-import";
import { exportPptx } from "../packages/core/src/pptx-export";
import { parsePowerPoint } from "../packages/core/src/pptx";
import { classifyRoundTrip, emptyDigest } from "../packages/core/src/roundtrip-digest";
import { roundTripOffice } from "../packages/core/src/roundtrip";
import { htmlToDocument } from "../packages/core/src/word";

describe("office export round trip", () => {
  it("keeps bold and italic on a list item that is not wrapped in a paragraph", () => {
    const doc = htmlToDocument(
      "<ul><li><p>Earlier point</p><strong><em>Bold italic item</em></strong></li></ul>",
    );
    const marks: string[] = [];
    const visit = (node: { type?: string; text?: string; marks?: { type: string }[]; content?: unknown[] }) => {
      if (node.text === "Bold italic item")
        marks.push(...(node.marks ?? []).map((mark) => mark.type));
      for (const child of (node.content ?? []) as typeof node[]) visit(child);
    };
    visit(doc);
    expect(marks.sort()).toEqual(["bold", "italic"]);
  });

  it("compares a flat spreadsheet boolean as its value", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.4" office:mimetype="application/vnd.oasis.opendocument.spreadsheet">
 <office:body><office:spreadsheet><table:table table:name="Sheet1">
  <table:table-row>
   <table:table-cell table:formula="of:=TRUE()" office:value-type="boolean" office:boolean-value="true"><text:p>TRUE</text:p></table:table-cell>
   <table:table-cell table:formula="of:=FALSE()" office:value-type="boolean" office:boolean-value="false"><text:p>FALSE</text:p></table:table-cell>
  </table:table-row>
 </table:table></office:spreadsheet></office:body></office:document>`;
    const result = await roundTripOffice(new TextEncoder().encode(xml), "fods", "booleans.fods");
    expect(result.differences.filter((diff) => diff.feature === "import.text")).toEqual([]);
  });

  it("keeps a flat spreadsheet whose sheet name is longer than an Excel tab", async () => {
    const name = "lookup_target.fods/lookup_target.fods/lookup_target.fods";
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.4" office:mimetype="application/vnd.oasis.opendocument.spreadsheet">
 <office:body><office:spreadsheet><table:table table:name="${name}">
  <table:table-row>
   <table:table-cell office:value-type="string"><text:p>Kept value</text:p></table:table-cell>
  </table:table-row>
 </table:table></office:spreadsheet></office:body></office:document>`;
    const result = await roundTripOffice(new TextEncoder().encode(xml), "fods", "long-sheet.fods");
    expect(result.outcome).not.toBe("rejected");
    expect(result.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
  });

  it("does not compare an unresolved flat spreadsheet number as the text NaN", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.4" office:mimetype="application/vnd.oasis.opendocument.spreadsheet">
 <office:body><office:spreadsheet><table:table table:name="Sheet1">
  <table:table-row>
   <table:table-cell table:formula="of:=COM.MICROSOFT.LAMBDA(x$; x$)(42)" office:value-type="float" office:string-value="42"><text:p>42</text:p></table:table-cell>
  </table:table-row>
 </table:table></office:spreadsheet></office:body></office:document>`;
    const result = await roundTripOffice(new TextEncoder().encode(xml), "fods", "unresolved.fods");
    expect(result.differences.filter((diff) => diff.feature === "import.text")).toEqual([]);
  });

  it("compares a flat spreadsheet date as its value", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.4" office:mimetype="application/vnd.oasis.opendocument.spreadsheet">
 <office:body><office:spreadsheet><table:table table:name="Sheet1">
  <table:table-row>
   <table:table-cell office:value-type="date" office:date-value="2021-02-02"><text:p>02/02/21</text:p></table:table-cell>
   <table:table-cell table:formula="of:=TODAY()" office:value-type="date" office:date-value="2021-12-23"><text:p>21</text:p></table:table-cell>
  </table:table-row>
 </table:table></office:spreadsheet></office:body></office:document>`;
    const result = await roundTripOffice(new TextEncoder().encode(xml), "fods", "dates.fods");
    expect(result.differences.filter((diff) => diff.feature === "import.text")).toEqual([]);
  });

  it("keeps a flat spreadsheet cell outside the recorded used range", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" office:version="1.4" office:mimetype="application/vnd.oasis.opendocument.spreadsheet">
 <office:automatic-styles>
  <style:style style:name="r_1" style:family="table-row"><style:table-row-properties style:row-height="1cm"/></style:style>
  <style:style style:name="r_2" style:family="table-row"><style:table-row-properties style:row-height="2cm"/></style:style>
 </office:automatic-styles>
 <office:body><office:spreadsheet><table:table table:name="Sheet1"><table:table-column/>
  <table:table-row table:style-name="r_1"><table:table-cell office:value-type="string" office:string-value="A1"/></table:table-row>
  <table:table-row table:style-name="r_2"><table:table-cell office:value-type="string" office:string-value="A2"/></table:table-row>
 </table:table></office:spreadsheet></office:body></office:document>`;
    const result = await roundTripOffice(new TextEncoder().encode(xml), "fods", "lostRowStyle.fods");
    expect(result.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
  });

  it("keeps a bold ruby reading with the word it annotates", async () => {
    const zip = new JSZip();
    const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
    const office = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${office}/officeDocument" Target="word/document.xml"/></Relationships>`,
    );
    zip.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${w}"><w:body><w:p><w:r><w:t>See </w:t></w:r><w:ruby><w:rubyPr><w:rubyAlign w:val="center"/></w:rubyPr><w:rt><w:r><w:rPr><w:b/></w:rPr><w:t>かな</w:t></w:r></w:rt><w:rubyBase><w:r><w:t>漢字</w:t></w:r></w:rubyBase></w:ruby></w:p></w:body></w:document>`,
    );
    const opened = await importOffice(await zip.generateAsync({ type: "uint8array" }), "docx", "ruby.docx");
    const blob = JSON.stringify(opened.file.content);
    expect(blob).toContain("かな");
    expect(blob).toContain("漢字");
    expect(blob).toContain('"type":"bold"');
  });

  it("keeps text stored in a Word content control", async () => {
    const zip = new JSZip();
    const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
    const office = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${office}/officeDocument" Target="word/document.xml"/></Relationships>`,
    );
    zip.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${w}"><w:body><w:sdt><w:sdtPr><w:alias w:val="Note"/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>Inside the control</w:t></w:r></w:p></w:sdtContent></w:sdt></w:body></w:document>`,
    );
    const opened = await importOffice(await zip.generateAsync({ type: "uint8array" }), "docx", "control.docx");
    expect(JSON.stringify(opened.file.content)).toContain("Inside the control");
  });

  it("does not compare a deleted tracked change as body text", async () => {
    const zip = new JSZip();
    const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
    const office = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${office}/officeDocument" Target="word/document.xml"/></Relationships>`,
    );
    zip.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${w}"><w:body><w:p/><w:p><w:r><w:t>1</w:t></w:r></w:p><w:p><w:r><w:t>Kept sentence</w:t></w:r><w:del w:id="2"><w:r><w:delText>foo</w:delText></w:r></w:del></w:p><w:p><w:del w:id="1"><w:r><w:delText>bar</w:delText></w:r></w:del></w:p><w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>hid</w:t></w:r></w:p></w:body></w:document>`,
    );
    const result = await roundTripOffice(await zip.generateAsync({ type: "uint8array" }), "docx", "deleted.docx");
    expect(result.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
    expect(result.differences.some((diff) => diff.feature === "doc.tracked-changes")).toBe(false);
    const hiddenPath = "datasets/libreoffice/files/sw/qa/extras/layout/data/merge_hidden_redline.docx";
    if (!existsSync(hiddenPath)) return;
    const hidden = await roundTripOffice(await readFile(hiddenPath), "docx", "merge_hidden_redline.docx");
    expect(hidden.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
    const poiPath = "datasets/apache-poi/files/test-data/document/58067.docx";
    if (!existsSync(poiPath)) return;
    const poi = await roundTripOffice(await readFile(poiPath), "docx", "58067.docx");
    expect(poi.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
  });

  it("keeps an equation and a text box through a Word round trip", async () => {
    const zip = new JSZip();
    const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const m = "http://schemas.openxmlformats.org/officeDocument/2006/math";
    const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
    const office = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${office}/officeDocument" Target="word/document.xml"/></Relationships>`,
    );
    zip.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${w}" xmlns:m="${m}"><w:body><w:p><w:r><w:t>Around the box</w:t></w:r></w:p><w:p><m:oMath><m:r><m:t>x</m:t></m:r></m:oMath></w:p><w:p><w:r><w:pict><v:shape><v:textbox><w:txbxContent><w:p><w:r><w:t>Inside the box</w:t></w:r></w:p></w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p></w:body></w:document>`,
    );
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const opened = await importOffice(bytes, "docx", "box.docx");
    expect(JSON.stringify(opened.file.content)).toContain("Inside the box");
    expect(JSON.stringify(opened.file.content)).toContain('"type":"textBox"');
    expect(JSON.stringify(opened.file.content)).toContain('"type":"equation"');
    const result = await roundTripOffice(bytes, "docx", "box.docx");
    expect(result.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
    expect(result.differences.some((diff) => diff.feature === "doc.textbox" || diff.feature === "doc.equation")).toBe(
      false,
    );
  });

  it("keeps a slide transition and animation through a PowerPoint round trip", async () => {
    const file = createFile("slide", "Motion") as SlideFile;
    const id = file.content.slideOrder[0];
    file.content.slides[id].transition = { type: "fade", duration: 0.5 };
    file.content.slides[id].elements = [
      {
        id: "title",
        type: "text",
        x: 80,
        y: 70,
        width: 800,
        height: 80,
        content: "Motion title",
        fontSize: 32,
        animation: "fade-on-click",
      },
    ];
    const bytes = await exportPptx(file);
    const opened = await parsePowerPoint(bytes, "Motion");
    const slide = Object.values(opened.content.slides)[0];
    expect(slide.transition?.type).toBe("fade");
    expect(slide.elements.some((el) => el.animation === "fade-on-click")).toBe(true);
    const result = await roundTripOffice(bytes, "pptx", "motion.pptx");
    expect(result.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
    expect(
      result.differences.some((diff) => diff.feature === "slide.transition" || diff.feature === "slide.animation"),
    ).toBe(false);
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    zip.file(
      "ppt/slides/slide1.xml",
      xml.replace(/<p:transition\b[\s\S]*?<\/p:transition>/, '<p:transition spd="med"><p:wheel spokes="4"/></p:transition>'),
    );
    const wheeled = await roundTripOffice(await zip.generateAsync({ type: "uint8array" }), "pptx", "wheel.pptx");
    expect(wheeled.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
    expect(wheeled.differences.some((diff) => diff.feature === "slide.transition")).toBe(false);
    const wheelSlide = Object.values(
      (await parsePowerPoint(await zip.generateAsync({ type: "uint8array" }), "Wheel")).content.slides,
    )[0];
    expect(wheelSlide.transition?.office).toBe('<p:wheel spokes="4"/>');
  });

  it("keeps text when only the paragraph mark is hidden", async () => {
    const zip = new JSZip();
    const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
    const office = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${office}/officeDocument" Target="word/document.xml"/></Relationships>`,
    );
    zip.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${w}"><w:body><w:p><w:pPr><w:rPr><w:vanish/></w:rPr></w:pPr><w:r><w:t>Alpha</w:t></w:r></w:p><w:p><w:r><w:t>Beta</w:t></w:r></w:p></w:body></w:document>`,
    );
    const result = await roundTripOffice(await zip.generateAsync({ type: "uint8array" }), "docx", "hidden-mark.docx");
    expect(result.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
    const hiddenPath = "datasets/libreoffice/files/sw/qa/extras/layout/data/hidden-para-separator.docx";
    if (!existsSync(hiddenPath)) return;
    const hidden = await roundTripOffice(await readFile(hiddenPath), "docx", "hidden-para-separator.docx");
    expect(hidden.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
    for (const [path, name] of [
      ["datasets/libreoffice/files/sw/qa/extras/ooxmlexport/data/anchor-position.docx", "anchor-position.docx"],
      ["datasets/libreoffice/files/sw/qa/extras/ooxmlexport/data/dml-shape-fillbitmapcrop.docx", "dml-shape-fillbitmapcrop.docx"],
      ["datasets/libreoffice/files/sw/qa/extras/ooxmlexport/data/fdo63685.docx", "fdo63685.docx"],
      ["datasets/libreoffice/files/sw/qa/extras/ooxmlexport/data/tdf106724.docx", "tdf106724.docx"],
      ["datasets/libreoffice/files/sw/qa/extras/ooxmlexport/data/FDO76312.docx", "FDO76312.docx"],
      ["datasets/libreoffice/files/sw/qa/extras/ooxmlexport/data/custom-styles-TOC-semicolon.docx", "custom-styles-TOC-semicolon.docx"],
      ["datasets/libreoffice/files/sw/qa/extras/ooxmlexport/data/fdo65632.docx", "fdo65632.docx"],
      ["datasets/libreoffice/files/sw/qa/extras/ooxmlexport/data/n830205.docx", "n830205.docx"],
      ["datasets/libreoffice/files/sw/qa/extras/ooxmlexport/data/tdf120338.docx", "tdf120338.docx"],
      ["datasets/libreoffice/files/sw/qa/extras/ooxmlexport/data/tdf126206.docx", "tdf126206.docx"],
      ["datasets/libreoffice/files/sw/qa/extras/ooxmlexport/data/tdf32363.docx", "tdf32363.docx"],
      ["datasets/libreoffice/files/sw/qa/extras/layout/data/tdf123163-1.docx", "tdf123163-1.docx"],
      ["datasets/libreoffice/files/sw/qa/extras/ooxmlimport/data/tdf129912.docx", "tdf129912.docx"],
      ["datasets/libreoffice/files/sw/qa/extras/uiwriter/data/TC-table-del-add.docx", "TC-table-del-add.docx"],
    ] as const) {
      if (!existsSync(path)) continue;
      const row = await roundTripOffice(await readFile(path), "docx", name);
      expect(row.differences.filter((diff) => diff.owner === "suiteleaf"), name).toEqual([]);
    }
  });

  it("keeps a table that follows a hidden paragraph mark", async () => {
    const zip = new JSZip();
    const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
    const office = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${office}/officeDocument" Target="word/document.xml"/></Relationships>`,
    );
    zip.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${w}"><w:body><w:p><w:pPr><w:rPr><w:vanish/></w:rPr></w:pPr><w:r><w:t>Alpha</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>Beta</w:t></w:r></w:p></w:body></w:document>`,
    );
    const result = await roundTripOffice(await zip.generateAsync({ type: "uint8array" }), "docx", "hidden-mark-table.docx");
    expect(result.differences.filter((diff) => diff.feature === "import.table" || diff.feature === "import.bold")).toEqual([]);
    const path = "datasets/napierone/files/docx/2390-docx.docx";
    if (!existsSync(path)) return;
    const real = await roundTripOffice(await readFile(path), "docx", "2390-docx.docx");
    expect(real.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
  });

  it("keeps a heading inside a text box with the paragraph around it", async () => {
    const headingPath = "datasets/libreoffice/files/sw/qa/extras/layout/data/toc-inline-heading-order.fodt";
    const picturePath = "datasets/libreoffice/files/sw/qa/extras/odfexport/data/tdf135144.docx";
    if (existsSync(headingPath)) {
      const heading = await roundTripOffice(await readFile(headingPath), "fodt", "toc-inline-heading-order.fodt");
      expect(heading.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
    }
    if (!existsSync(picturePath)) return;
    const picture = await roundTripOffice(await readFile(picturePath), "docx", "tdf135144.docx");
    expect(picture.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
    expect(picture.differences.some((diff) => diff.feature === "doc.textbox")).toBe(false);
    for (const [format, path, name] of [
      ["odt", "datasets/libreoffice/files/sw/qa/extras/odfimport/data/tdf165156.odt", "tdf165156.odt"],
      ["odt", "datasets/libreoffice/files/sw/qa/extras/ooxmlexport/data/ooo106020-1.odt", "ooo106020-1.odt"],
      ["docx", "datasets/libreoffice/files/sw/qa/extras/ooxmlexport/data/listWithLgl.docx", "listWithLgl.docx"],
      ["odt", "datasets/libreoffice/files/sw/qa/extras/odfexport/data/tdf146264.odt", "tdf146264.odt"],
    ] as const) {
      if (!existsSync(path)) continue;
      const result = await roundTripOffice(await readFile(path), format, name);
      expect(result.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
    }
  });

  it("keeps bold text when a paragraph was stored inside a text run", async () => {
    const zip = new JSZip();
    const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
    const office = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${office}/officeDocument" Target="word/document.xml"/></Relationships>`,
    );
    zip.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${w}"><w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold label:<w:p><w:r><w:t>Later paragraph</w:t></w:r></w:p></w:t></w:r></w:p></w:body></w:document>`,
    );
    const opened = await importOffice(await zip.generateAsync({ type: "uint8array" }), "docx", "nested.docx");
    const blob = JSON.stringify(opened.file.content);
    expect(blob).toContain("Bold label:");
    expect(blob).toContain("Later paragraph");
    expect(blob).toContain('"type":"bold"');
  });

  it("treats a line break as the same sentence", () => {
    const reader = emptyDigest();
    reader.texts = ["Hello world"];
    const model = emptyDigest();
    model.texts = ["Helloworld"];
    const again = emptyDigest();
    again.texts = ["Helloworld"];
    expect(classifyRoundTrip(reader, model, again)).toEqual([]);
  });

  it("treats a heading bullet or number as the same heading", () => {
    const reader = emptyDigest();
    reader.texts = ["foo", "No"];
    const model = emptyDigest();
    model.texts = ["\uF0B7 foo", "1. No"];
    const again = emptyDigest();
    again.texts = ["\uF0B7 foo", "1. No"];
    expect(classifyRoundTrip(reader, model, again)).toEqual([]);
    const sectionReader = emptyDigest();
    sectionReader.texts = ["No"];
    const section = emptyDigest();
    section.texts = ["Sect 1.1 No"];
    expect(classifyRoundTrip(sectionReader, section, section)).toEqual([]);
    const spaced = emptyDigest();
    spaced.texts = ["a b c"];
    const tight = emptyDigest();
    tight.texts = ["abc"];
    expect(classifyRoundTrip(spaced, tight, tight)).toEqual([]);
    const replaced = emptyDigest();
    replaced.texts = ["bar"];
    expect(classifyRoundTrip(reader, replaced, replaced).some((diff) => diff.feature === "import.text")).toBe(
      true,
    );
    const listed = emptyDigest();
    listed.texts = [
      "A. Changing how we publish B. Reducing scope",
      "a) Beratung b) Datenmanagementplan",
      "Provide tools v Building relationships",
      "Final proposal o Template follows",
      "• Practice – Protocol stays",
    ];
    const source = emptyDigest();
    source.texts = [
      "Changing how we publish Reducing scope",
      "Beratung Datenmanagementplan",
      "Provide tools Building relationships",
      "Final proposal Template follows",
      "Practice – Protocol stays",
    ];
    expect(classifyRoundTrip(source, listed, listed)).toEqual([]);
    const droppedLetter = emptyDigest();
    droppedLetter.texts = ["section A vehicles stay"];
    const withoutLetter = emptyDigest();
    withoutLetter.texts = ["section vehicles stay"];
    expect(
      classifyRoundTrip(droppedLetter, withoutLetter, withoutLetter).some(
        (diff) => diff.feature === "import.text",
      ),
    ).toBe(true);
  });

  it("keeps underline when Word omits the underline value", async () => {
    const file = createFile("doc", "Note") as DocFile;
    file.content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Underlined words",
              marks: [{ type: "underline" }],
            },
          ],
        },
      ],
    };
    const zip = await JSZip.loadAsync(await exportDocx(file));
    const xml = await zip.file("word/document.xml")!.async("string");
    zip.file("word/document.xml", xml.replace(/<w:u\b[^>]*\/>/g, '<w:u w:color="000000"/>'));
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const result = await roundTripOffice(bytes, "docx", "underlined.docx");
    expect(result.differences.some((diff) => diff.feature === "import.underline")).toBe(false);
  });

  it("classifies import losses as SuiteLeaf and reader gaps as third-party", () => {
    const reader = emptyDigest();
    reader.texts = ["Kept sentence"];
    reader.thirdParty = ["doc.legacy-formatting"];
    const model = emptyDigest();
    const again = emptyDigest();
    again.texts = ["Kept sentence"];
    const differences = classifyRoundTrip(reader, model, again);
    expect(differences).toEqual([
      {
        feature: "doc.legacy-formatting",
        owner: "third-party",
        description: "The legacy DOC extractor returns text and paragraph breaks only.",
      },
      {
        feature: "import.text",
        owner: "suiteleaf",
        description: "Import dropped text on 1 item.",
      },
    ]);
  });

  it("round-trips constructed slide text through PPTX", async () => {
    const file = createFile("slide", "Review") as SlideFile;
    const id = file.content.slideOrder[0];
    file.content.slides[id].elements = [
      {
        id: "title",
        type: "text",
        x: 80,
        y: 70,
        width: 800,
        height: 80,
        content: "Quarterly review slides",
        fontSize: 32,
        bold: true,
      },
    ];
    file.content.slides[id].notes = "Speaker note for the review";
    const opened = await parsePowerPoint(await exportPptx(file), "Review");
    const text = Object.values(opened.content.slides)
      .flatMap((slide) => slide.elements.map((el) => el.content ?? ""))
      .join("\n");
    expect(text).toContain("Quarterly review slides");
    expect(Object.values(opened.content.slides).some((slide) => slide.notes.includes("Speaker note"))).toBe(true);
  });

  it("keeps an underline on a slide when the presentation is written again", async () => {
    const file = createFile("slide", "Marks") as SlideFile;
    const id = file.content.slideOrder[0];
    file.content.slides[id].elements = [
      {
        id: "title",
        type: "text",
        x: 80,
        y: 70,
        width: 800,
        height: 80,
        content: "Underlined words",
        fontSize: 32,
        underline: true,
      },
    ];
    const opened = await parsePowerPoint(await exportPptx(file), "Marks");
    const underlined = Object.values(opened.content.slides).some((slide) =>
      slide.elements.some((el) => el.underline),
    );
    expect(underlined).toBe(true);
  });

  it("ignores an empty self-closing drawing text tag", async () => {
    const file = createFile("slide", "Review") as SlideFile;
    const id = file.content.slideOrder[0];
    file.content.slides[id].elements = [
      {
        id: "title",
        type: "text",
        x: 80,
        y: 70,
        width: 800,
        height: 80,
        content: "Quarterly review slides",
        fontSize: 32,
      },
    ];
    const zip = await JSZip.loadAsync(await exportPptx(file));
    const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    const patched = xml.replace("<a:r>", "<a:r><a:t/></a:r><a:r>");
    expect(patched).not.toBe(xml);
    zip.file("ppt/slides/slide1.xml", patched);
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const result = await roundTripOffice(bytes, "pptx", "empty-run.pptx");
    expect(result.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
  });

  it("does not treat a text-run picture fill as a content image", async () => {
    const file = createFile("slide", "Review") as SlideFile;
    const id = file.content.slideOrder[0];
    file.content.slides[id].elements = [
      {
        id: "title",
        type: "text",
        x: 80,
        y: 70,
        width: 800,
        height: 80,
        content: "Quarterly review slides",
        fontSize: 32,
      },
    ];
    const zip = await JSZip.loadAsync(await exportPptx(file));
    const slideName = Object.keys(zip.files).find((name) => /ppt\/slides\/slide\d+\.xml$/i.test(name));
    expect(slideName).toBeTruthy();
    const xml = await zip.file(slideName!)!.async("string");
    const patched = xml.replace(
      /<a:rPr\b([^>]*?)\/>/,
      '<a:rPr$1><a:blipFill><a:blip r:embed="rIdFill"/></a:blipFill></a:rPr>',
    );
    const paired =
      patched === xml
        ? xml.replace(
            /<a:rPr\b[^>]*>/,
            '$&<a:blipFill><a:blip r:embed="rIdFill"/></a:blipFill>',
          )
        : patched;
    expect(paired).not.toBe(xml);
    zip.file(slideName!, paired);
    const relName = slideName!.replace(/^ppt\/slides\//, "ppt/slides/_rels/") + ".rels";
    const rels = await zip.file(relName)!.async("string");
    zip.file(
      relName,
      rels.replace(
        "</Relationships>",
        '<Relationship Id="rIdFill" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/fill.jpeg"/></Relationships>',
      ),
    );
    zip.file("ppt/media/fill.jpeg", Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]));
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const result = await roundTripOffice(bytes, "pptx", "text-fill.pptx");
    expect(result.differences.filter((diff) => diff.feature === "import.image")).toEqual([]);
  });

  it("keeps a picture that fills a slide group", async () => {
    const file = createFile("slide", "Review") as SlideFile;
    const id = file.content.slideOrder[0];
    file.content.slides[id].elements = [
      {
        id: "title",
        type: "text",
        x: 80,
        y: 70,
        width: 800,
        height: 80,
        content: "Quarterly review slides",
        fontSize: 32,
      },
    ];
    const zip = await JSZip.loadAsync(await exportPptx(file));
    const slideName = Object.keys(zip.files).find((name) => /ppt\/slides\/slide\d+\.xml$/i.test(name));
    expect(slideName).toBeTruthy();
    const xml = await zip.file(slideName!)!.async("string");
    const patched = xml.replace(
      "</p:spTree>",
      '<p:grpSp><p:nvGrpSpPr><p:cNvPr id="8" name="group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/><a:chOff x="0" y="0"/><a:chExt cx="914400" cy="914400"/></a:xfrm><a:blipFill><a:blip r:embed="rIdGroup"/></a:blipFill></p:grpSpPr></p:grpSp></p:spTree>',
    );
    expect(patched).not.toBe(xml);
    zip.file(slideName!, patched);
    const relName = slideName!.replace(/^ppt\/slides\//, "ppt/slides/_rels/") + ".rels";
    const rels = await zip.file(relName)!.async("string");
    zip.file(
      relName,
      rels.replace(
        "</Relationships>",
        '<Relationship Id="rIdGroup" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/group.jpeg"/></Relationships>',
      ),
    );
    zip.file("ppt/media/group.jpeg", Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]));
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const result = await roundTripOffice(bytes, "pptx", "group-fill.pptx");
    expect(result.differences.filter((diff) => diff.feature === "import.image")).toEqual([]);
    const path = "datasets/napierone/files/pptx/0153-pptx.pptx";
    if (!existsSync(path)) return;
    const real = await roundTripOffice(await readFile(path), "pptx", "0153-pptx.pptx");
    expect(real.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
  });

  it("keeps a picture that fills a slide table cell", async () => {
    const file = createFile("slide", "Review") as SlideFile;
    const id = file.content.slideOrder[0];
    file.content.slides[id].elements = [
      {
        id: "title",
        type: "text",
        x: 80,
        y: 70,
        width: 800,
        height: 80,
        content: "Quarterly review slides",
        fontSize: 32,
      },
    ];
    const zip = await JSZip.loadAsync(await exportPptx(file));
    const slideName = Object.keys(zip.files).find((name) => /ppt\/slides\/slide\d+\.xml$/i.test(name));
    expect(slideName).toBeTruthy();
    const xml = await zip.file(slideName!)!.async("string");
    const patched = xml.replace(
      "</p:spTree>",
      '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="9" name="table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblGrid><a:gridCol w="914400"/></a:tblGrid><a:tr h="914400"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></a:txBody><a:tcPr><a:blipFill><a:blip r:embed="rIdCell"/></a:blipFill></a:tcPr></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree>',
    );
    expect(patched).not.toBe(xml);
    zip.file(slideName!, patched);
    const relName = slideName!.replace(/^ppt\/slides\//, "ppt/slides/_rels/") + ".rels";
    const rels = await zip.file(relName)!.async("string");
    zip.file(
      relName,
      rels.replace(
        "</Relationships>",
        '<Relationship Id="rIdCell" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/cell.png"/></Relationships>',
      ),
    );
    zip.file(
      "ppt/media/cell.png",
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const result = await roundTripOffice(bytes, "pptx", "cell-fill.pptx");
    expect(result.differences.filter((diff) => diff.feature === "import.image")).toEqual([]);
    const path = "datasets/napierone/files/pptx/0770-pptx.pptx";
    if (!existsSync(path)) return;
    const real = await roundTripOffice(await readFile(path), "pptx", "0770-pptx.pptx");
    expect(real.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
  });

  it("compares the fallback picture when a slide object is stored twice", async () => {
    const file = createFile("slide", "Review") as SlideFile;
    const id = file.content.slideOrder[0];
    file.content.slides[id].elements = [
      {
        id: "title",
        type: "text",
        x: 80,
        y: 70,
        width: 800,
        height: 80,
        content: "Quarterly review slides",
        fontSize: 32,
      },
    ];
    const zip = await JSZip.loadAsync(await exportPptx(file));
    const slideName = Object.keys(zip.files).find((name) => /ppt\/slides\/slide\d+\.xml$/i.test(name));
    expect(slideName).toBeTruthy();
    const xml = await zip.file(slideName!)!.async("string");
    const patched = xml.replace(
      "</p:spTree>",
      '<mc:AlternateContent><mc:Choice Requires="psez"><p:graphicFrame><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/powerpoint/2016/sectionzoom"><p166:blipFill><a:blip r:embed="rIdChoice"/></p166:blipFill></a:graphicData></a:graphic></p:graphicFrame></mc:Choice><mc:Fallback><p:pic><p:nvPicPr><p:cNvPr id="9" name="zoom"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdFallback"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></mc:Fallback></mc:AlternateContent></p:spTree>',
    );
    expect(patched).not.toBe(xml);
    zip.file(slideName!, patched);
    const relName = slideName!.replace(/^ppt\/slides\//, "ppt/slides/_rels/") + ".rels";
    const rels = await zip.file(relName)!.async("string");
    zip.file(
      relName,
      rels.replace(
        "</Relationships>",
        '<Relationship Id="rIdChoice" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/choice.png"/><Relationship Id="rIdFallback" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/fallback.png"/></Relationships>',
      ),
    );
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    zip.file("ppt/media/choice.png", png);
    zip.file("ppt/media/fallback.png", png);
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const result = await roundTripOffice(bytes, "pptx", "section-zoom.pptx");
    expect(result.differences.filter((diff) => diff.feature === "import.image")).toEqual([]);
    const opened = await parsePowerPoint(bytes, "zoom");
    const images = Object.values(opened.content.slides).flatMap((slide) =>
      slide.elements.filter((el) => el.type === "image"),
    );
    expect(images).toHaveLength(1);
    const path = "datasets/napierone/files/pptx/0880-pptx.pptx";
    if (!existsSync(path)) return;
    const real = await roundTripOffice(await readFile(path), "pptx", "0880-pptx.pptx");
    expect(real.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
  });

  it("keeps a picture fill stored on the same slide picture", async () => {
    const file = createFile("slide", "Review") as SlideFile;
    const id = file.content.slideOrder[0];
    file.content.slides[id].elements = [
      {
        id: "title",
        type: "text",
        x: 80,
        y: 70,
        width: 800,
        height: 80,
        content: "Quarterly review slides",
        fontSize: 32,
      },
    ];
    const zip = await JSZip.loadAsync(await exportPptx(file));
    const slideName = Object.keys(zip.files).find((name) => /ppt\/slides\/slide\d+\.xml$/i.test(name));
    expect(slideName).toBeTruthy();
    const xml = await zip.file(slideName!)!.async("string");
    const patched = xml.replace(
      "</p:spTree>",
      '<p:pic><p:nvPicPr><p:cNvPr id="9" name="Picture"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdMain"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:blipFill><a:blip r:embed="rIdFill"/></a:blipFill></p:spPr></p:pic></p:spTree>',
    );
    expect(patched).not.toBe(xml);
    zip.file(slideName!, patched);
    const relName = slideName!.replace(/^ppt\/slides\//, "ppt/slides/_rels/") + ".rels";
    const rels = await zip.file(relName)!.async("string");
    zip.file(
      relName,
      rels.replace(
        "</Relationships>",
        '<Relationship Id="rIdMain" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/main.png"/><Relationship Id="rIdFill" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/fill.png"/></Relationships>',
      ),
    );
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    zip.file("ppt/media/main.png", png);
    zip.file("ppt/media/fill.png", png);
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const result = await roundTripOffice(bytes, "pptx", "picture-fill.pptx");
    expect(result.differences.filter((diff) => diff.feature === "import.image")).toEqual([]);
    const opened = await parsePowerPoint(bytes, "picture");
    const images = Object.values(opened.content.slides).flatMap((slide) =>
      slide.elements.filter((el) => el.type === "image"),
    );
    expect(images).toHaveLength(2);
    for (const name of ["1028-pptx.pptx", "1029-pptx.pptx"]) {
      const path = `datasets/napierone/files/pptx/${name}`;
      if (!existsSync(path)) continue;
      const real = await roundTripOffice(await readFile(path), "pptx", name);
      expect(real.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
    }
  });

  it("does not treat an external linked picture as a stored image", async () => {
    const file = createFile("slide", "Review") as SlideFile;
    const id = file.content.slideOrder[0];
    file.content.slides[id].elements = [
      {
        id: "title",
        type: "text",
        x: 80,
        y: 70,
        width: 800,
        height: 80,
        content: "Quarterly review slides",
        fontSize: 32,
      },
    ];
    const zip = await JSZip.loadAsync(await exportPptx(file));
    const slideName = Object.keys(zip.files).find((name) => /ppt\/slides\/slide\d+\.xml$/i.test(name));
    expect(slideName).toBeTruthy();
    const xml = await zip.file(slideName!)!.async("string");
    const patched = xml.replace(
      "</p:spTree>",
      '<p:pic><p:nvPicPr><p:cNvPr id="9" name="ext"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:link="rIdExt"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1" cy="1"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree>',
    );
    expect(patched).not.toBe(xml);
    zip.file(slideName!, patched);
    const relName = slideName!.replace(/^ppt\/slides\//, "ppt/slides/_rels/") + ".rels";
    const rels = await zip.file(relName)!.async("string");
    zip.file(
      relName,
      rels.replace(
        "</Relationships>",
        '<Relationship Id="rIdExt" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="file:///tmp/project-logo.jpg" TargetMode="External"/></Relationships>',
      ),
    );
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const result = await roundTripOffice(bytes, "pptx", "external-image.pptx");
    expect(result.differences.filter((diff) => diff.feature === "import.image")).toEqual([]);
  });

  it("keeps a picture that fills a shape which also has a label", async () => {
    const file = createFile("slide", "Review") as SlideFile;
    const id = file.content.slideOrder[0];
    file.content.slides[id].elements = [
      {
        id: "title",
        type: "text",
        x: 80,
        y: 70,
        width: 800,
        height: 80,
        content: "Quarterly review slides",
        fontSize: 32,
      },
    ];
    const zip = await JSZip.loadAsync(await exportPptx(file));
    const slideName = Object.keys(zip.files).find((name) => /ppt\/slides\/slide\d+\.xml$/i.test(name));
    expect(slideName).toBeTruthy();
    const xml = await zip.file(slideName!)!.async("string");
    const patched = xml.replace(
      "</p:spTree>",
      '<p:sp><p:nvSpPr><p:cNvPr id="8" name="fill"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:blipFill><a:blip r:embed="rIdFill"/></a:blipFill></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>Label</a:t></a:r></a:p></p:txBody></p:sp></p:spTree>',
    );
    expect(patched).not.toBe(xml);
    zip.file(slideName!, patched);
    const relName = slideName!.replace(/^ppt\/slides\//, "ppt/slides/_rels/") + ".rels";
    const rels = await zip.file(relName)!.async("string");
    zip.file(
      relName,
      rels.replace(
        "</Relationships>",
        '<Relationship Id="rIdFill" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/fill.jpeg"/></Relationships>',
      ),
    );
    zip.file("ppt/media/fill.jpeg", Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]));
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const result = await roundTripOffice(bytes, "pptx", "shape-fill.pptx");
    expect(result.differences.filter((diff) => diff.feature === "import.image")).toEqual([]);
  });

  it("does not treat a picture bullet as a placed image", async () => {
    const file = createFile("slide", "Review") as SlideFile;
    const id = file.content.slideOrder[0];
    file.content.slides[id].elements = [
      {
        id: "title",
        type: "text",
        x: 80,
        y: 70,
        width: 800,
        height: 80,
        content: "Quarterly review slides",
        fontSize: 32,
      },
    ];
    const zip = await JSZip.loadAsync(await exportPptx(file));
    const slideName = Object.keys(zip.files).find((name) => /ppt\/slides\/slide\d+\.xml$/i.test(name));
    expect(slideName).toBeTruthy();
    const xml = await zip.file(slideName!)!.async("string");
    const patched = xml.replace(
      "<a:p>",
      '<a:p><a:pPr><a:buBlip><a:blip r:embed="rIdFill"/></a:buBlip></a:pPr>',
    );
    expect(patched).not.toBe(xml);
    zip.file(slideName!, patched);
    const relName = slideName!.replace(/^ppt\/slides\//, "ppt/slides/_rels/") + ".rels";
    const rels = await zip.file(relName)!.async("string");
    zip.file(
      relName,
      rels.replace(
        "</Relationships>",
        '<Relationship Id="rIdFill" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/fill.jpeg"/></Relationships>',
      ),
    );
    zip.file("ppt/media/fill.jpeg", Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]));
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const result = await roundTripOffice(bytes, "pptx", "bullet-image.pptx");
    expect(result.differences.filter((diff) => diff.feature === "import.image")).toEqual([]);
  });

  it("keeps a constructed Word sentence through export and import", async () => {
    const file = createFile("doc", "Note") as DocFile;
    file.content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Keep this sentence intact",
              marks: [{ type: "bold" }],
            },
          ],
        },
      ],
    };
    const bytes = await exportDocx(file);
    const result = await roundTripOffice(bytes, "docx", "note.docx");
    expect(result.outcome).not.toBe("rejected");
    expect(result.differences.some((diff) => diff.feature === "import.text" || diff.feature === "export.text")).toBe(
      false,
    );
  });

  it("does not compare a paragraph of only soft hyphens", async () => {
    const zip = new JSZip();
    const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
    const office = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${office}/officeDocument" Target="word/document.xml"/></Relationships>`,
    );
    zip.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${w}"><w:body><w:p><w:r><w:softHyphen/></w:r><w:r><w:softHyphen/></w:r></w:p><w:p><w:r><w:t>Kept sentence</w:t></w:r></w:p></w:body></w:document>`,
    );
    const result = await roundTripOffice(await zip.generateAsync({ type: "uint8array" }), "docx", "soft-hyphen.docx");
    expect(result.differences.filter((diff) => diff.feature === "import.text")).toEqual([]);
    const path = "datasets/napierone/files/docx/0557-docx.docx";
    if (!existsSync(path)) return;
    const real = await roundTripOffice(await readFile(path), "docx", "0557-docx.docx");
    expect(real.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
  });

  it("keeps words on either side of a floating text box together", async () => {
    const zip = new JSZip();
    const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
    const office = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const wp = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
    const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
    const wps = "http://schemas.microsoft.com/office/word/2010/wordprocessingShape";
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${office}/officeDocument" Target="word/document.xml"/></Relationships>`,
    );
    zip.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${w}" xmlns:wp="${wp}" xmlns:a="${a}" xmlns:wps="${wps}"><w:body><w:p><w:r><w:t xml:space="preserve">1. </w:t></w:r><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="9525" cy="9525"/><wp:wrapNone/><a:graphic><a:graphicData uri="${wps}"><wps:wsp><wps:txbx><w:txbxContent><w:p><w:r><w:t>Box words</w:t></w:r></w:p></w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r><w:r><w:t>Amount of grant received?</w:t></w:r></w:p></w:body></w:document>`,
    );
    const result = await roundTripOffice(await zip.generateAsync({ type: "uint8array" }), "docx", "textbox-anchor.docx");
    expect(result.differences.filter((diff) => diff.feature === "import.text")).toEqual([]);
    const path = "datasets/napierone/files/docx/0745-docx.docx";
    if (!existsSync(path)) return;
    const real = await roundTripOffice(await readFile(path), "docx", "0745-docx.docx");
    expect(real.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
  });

  it("does not compare bold on text that was moved away", async () => {
    const zip = new JSZip();
    const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
    const office = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${office}/officeDocument" Target="word/document.xml"/></Relationships>`,
    );
    zip.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${w}"><w:body><w:p><w:moveFrom w:id="1" w:author="A" w:date="2020-01-01T00:00:00Z"><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Q15 </w:t></w:r></w:moveFrom></w:p><w:p><w:r><w:t>Kept sentence</w:t></w:r></w:p></w:body></w:document>`,
    );
    const result = await roundTripOffice(await zip.generateAsync({ type: "uint8array" }), "docx", "moved-bold.docx");
    expect(result.differences.filter((diff) => diff.feature === "import.bold")).toEqual([]);
    const path = "datasets/napierone/files/docx/1009-docx.docx";
    if (!existsSync(path)) return;
    const real = await roundTripOffice(await readFile(path), "docx", "1009-docx.docx");
    expect(real.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
  });

  it("keeps bold around a text box in a cover-page table", async () => {
    const zip = new JSZip();
    const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
    const office = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${office}/officeDocument" Target="word/document.xml"/></Relationships>`,
    );
    zip.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${w}"><w:body><w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Cover Pages"/></w:docPartObj></w:sdtPr><w:sdtContent><w:tbl><w:tr><w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Keep </w:t></w:r><w:r><w:drawing><w:txbxContent><w:p><w:r><w:t>Box words</w:t></w:r></w:p></w:txbxContent></w:drawing></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>the sentence</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:sdtContent></w:sdt></w:body></w:document>`,
    );
    const result = await roundTripOffice(await zip.generateAsync({ type: "uint8array" }), "docx", "cover-textbox.docx");
    expect(result.differences.filter((diff) => diff.feature === "import.bold")).toEqual([]);
    const path = "datasets/napierone/files/docx/0993-docx.docx";
    if (!existsSync(path)) return;
    const real = await roundTripOffice(await readFile(path), "docx", "0993-docx.docx");
    expect(real.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
  });

  it("keeps bold on a cover-page subtitle", async () => {
    const zip = new JSZip();
    const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
    const office = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${office}/officeDocument" Target="word/document.xml"/></Relationships>`,
    );
    zip.file(
      "word/styles.xml",
      `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/></w:style></w:styles>`,
    );
    zip.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${w}"><w:body><w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Cover Pages"/></w:docPartObj></w:sdtPr><w:sdtContent><w:tbl><w:tr><w:sdt><w:sdtPr><w:alias w:val="Subtitle"/></w:sdtPr><w:sdtContent><w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Final </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>Report</w:t></w:r></w:p></w:tc></w:sdtContent></w:sdt></w:tr></w:tbl></w:sdtContent></w:sdt></w:body></w:document>`,
    );
    const result = await roundTripOffice(await zip.generateAsync({ type: "uint8array" }), "docx", "cover-subtitle.docx");
    expect(result.differences.filter((diff) => diff.feature === "import.bold")).toEqual([]);
    const path = "datasets/napierone/files/docx/2321-docx.docx";
    if (!existsSync(path)) return;
    const real = await roundTripOffice(await readFile(path), "docx", "2321-docx.docx");
    expect(real.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
  });

  it("does not compare the label that replaces an unsupported picture", async () => {
    const zip = new JSZip();
    const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
    const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
    const wp = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
    const pic = "http://schemas.openxmlformats.org/drawingml/2006/picture";
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="wmf" ContentType="image/x-wmf"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${r}/officeDocument" Target="word/document.xml"/></Relationships>`,
    );
    zip.file(
      "word/_rels/document.xml.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${rel}"><Relationship Id="rId2" Type="${r}/image" Target="media/image1.wmf"/></Relationships>`,
    );
    zip.file("word/media/image1.wmf", Buffer.from("wmf"));
    zip.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${w}" xmlns:r="${r}" xmlns:a="${a}" xmlns:wp="${wp}" xmlns:pic="${pic}"><w:body><w:p><w:r><w:drawing><wp:inline><wp:extent cx="9525" cy="9525"/><a:graphic><a:graphicData uri="${pic}"><pic:pic><pic:blipFill><a:blip r:embed="rId2"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r><w:r><w:t xml:space="preserve">Yes </w:t></w:r></w:p></w:body></w:document>`,
    );
    const result = await roundTripOffice(await zip.generateAsync({ type: "uint8array" }), "docx", "wmf-answer.docx");
    expect(result.differences.filter((diff) => diff.feature === "import.text")).toEqual([]);
    const path = "datasets/napierone/files/docx/2847-docx.docx";
    if (!existsSync(path)) return;
    const real = await roundTripOffice(await readFile(path), "docx", "2847-docx.docx");
    expect(real.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
  });

  it("does not compare a picture in a hidden run", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const zip = new JSZip();
    const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
    const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
    const wp = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
    const pic = "http://schemas.openxmlformats.org/drawingml/2006/picture";
    const drawing = (id: string) =>
      `<w:drawing><wp:inline><wp:extent cx="9525" cy="9525"/><a:graphic><a:graphicData uri="${pic}"><pic:pic><pic:blipFill><a:blip r:embed="${id}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${r}/officeDocument" Target="word/document.xml"/></Relationships>`,
    );
    zip.file(
      "word/_rels/document.xml.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${rel}"><Relationship Id="rId2" Type="${r}/image" Target="media/image1.png"/><Relationship Id="rId3" Type="${r}/image" Target="media/image2.png"/></Relationships>`,
    );
    zip.file("word/media/image1.png", png);
    zip.file("word/media/image2.png", png);
    zip.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${w}" xmlns:r="${r}" xmlns:a="${a}" xmlns:wp="${wp}" xmlns:pic="${pic}"><w:body><w:p><w:r><w:t>Visible sentence</w:t></w:r><w:r>${drawing("rId2")}</w:r><w:r><w:rPr><w:vanish/></w:rPr>${drawing("rId3")}</w:r></w:p></w:body></w:document>`,
    );
    const result = await roundTripOffice(await zip.generateAsync({ type: "uint8array" }), "docx", "hidden-picture.docx");
    expect(result.differences.filter((diff) => diff.feature === "import.image")).toEqual([]);
    const path = "datasets/napierone/files/docx/0582-docx.docx";
    if (!existsSync(path)) return;
    const real = await roundTripOffice(await readFile(path), "docx", "0582-docx.docx");
    expect(real.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
  });

  it("keeps a picture stored in a heading", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const zip = new JSZip();
    const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
    const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
    const wp = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
    const pic = "http://schemas.openxmlformats.org/drawingml/2006/picture";
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${r}/officeDocument" Target="word/document.xml"/></Relationships>`,
    );
    zip.file(
      "word/_rels/document.xml.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${rel}"><Relationship Id="rId2" Type="${r}/image" Target="media/image1.png"/></Relationships>`,
    );
    zip.file("word/media/image1.png", png);
    zip.file(
      "word/styles.xml",
      `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>`,
    );
    zip.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${w}" xmlns:r="${r}" xmlns:a="${a}" xmlns:wp="${wp}" xmlns:pic="${pic}"><w:body><w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Section title</w:t></w:r><w:r><w:drawing><wp:inline><wp:extent cx="9525" cy="9525"/><a:graphic><a:graphicData uri="${pic}"><pic:pic><pic:blipFill><a:blip r:embed="rId2"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p></w:body></w:document>`,
    );
    const result = await roundTripOffice(await zip.generateAsync({ type: "uint8array" }), "docx", "heading-picture.docx");
    expect(result.differences.filter((diff) => diff.feature === "import.image")).toEqual([]);
    const path = "datasets/napierone/files/docx/0267-docx.docx";
    if (!existsSync(path)) return;
    const real = await roundTripOffice(await readFile(path), "docx", "0267-docx.docx");
    expect(real.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
  });

  it("does not compare underline inside a table-of-contents field", async () => {
    const zip = new JSZip();
    const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
    const office = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${office}/officeDocument" Target="word/document.xml"/></Relationships>`,
    );
    zip.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${w}"><w:body><w:p><w:r><w:t>Contents heading</w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:u w:val="single"/></w:rPr><w:t>Introduction</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:body></w:document>`,
    );
    const result = await roundTripOffice(await zip.generateAsync({ type: "uint8array" }), "docx", "toc-underline.docx");
    expect(result.differences.filter((diff) => diff.feature === "import.underline")).toEqual([]);
    const path = "datasets/napierone/files/docx/0158-docx.docx";
    if (!existsSync(path)) return;
    const real = await roundTripOffice(await readFile(path), "docx", "0158-docx.docx");
    expect(real.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
  });

  it("does not compare a picture in a table-of-contents paragraph", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const zip = new JSZip();
    const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
    const a = "http://schemas.openxmlformats.org/drawingml/2006/main";
    const wp = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
    const pic = "http://schemas.openxmlformats.org/drawingml/2006/picture";
    const drawing = (id: string) =>
      `<w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:extent cx="9525" cy="9525"/><a:graphic><a:graphicData uri="${pic}"><pic:pic><pic:blipFill><a:blip r:embed="${id}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing>`;
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${r}/officeDocument" Target="word/document.xml"/></Relationships>`,
    );
    zip.file(
      "word/_rels/document.xml.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${rel}"><Relationship Id="rId2" Type="${r}/image" Target="media/image1.png"/><Relationship Id="rId3" Type="${r}/image" Target="media/image2.png"/></Relationships>`,
    );
    zip.file("word/media/image1.png", png);
    zip.file("word/media/image2.png", png);
    zip.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${w}" xmlns:r="${r}" xmlns:a="${a}" xmlns:wp="${wp}" xmlns:pic="${pic}"><w:body><w:p><w:r><w:t>Visible sentence</w:t></w:r><w:r><w:drawing><wp:inline><wp:extent cx="9525" cy="9525"/><a:graphic><a:graphicData uri="${pic}"><pic:pic><pic:blipFill><a:blip r:embed="rId2"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p><w:p><w:r>${drawing("rId3")}</w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:body></w:document>`,
    );
    const result = await roundTripOffice(await zip.generateAsync({ type: "uint8array" }), "docx", "toc-picture.docx");
    expect(result.differences.filter((diff) => diff.feature === "import.image")).toEqual([]);
    for (const name of ["2047-docx.docx", "2048-docx.docx"]) {
      const path = `datasets/napierone/files/docx/${name}`;
      if (!existsSync(path)) continue;
      const real = await roundTripOffice(await readFile(path), "docx", name);
      expect(real.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
    }
  });

  it("keeps a non-breaking hyphen inside a sentence", async () => {
    const zip = new JSZip();
    const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
    const office = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${office}/officeDocument" Target="word/document.xml"/></Relationships>`,
    );
    zip.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${w}"><w:body><w:p><w:r><w:t>Alpha</w:t></w:r><w:r><w:noBreakHyphen/></w:r><w:r><w:t>Beta stays</w:t></w:r></w:p></w:body></w:document>`,
    );
    const result = await roundTripOffice(await zip.generateAsync({ type: "uint8array" }), "docx", "hyphen.docx");
    expect(result.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
    const path = "datasets/napierone/files/docx/0050-docx.docx";
    if (!existsSync(path)) return;
    const real = await roundTripOffice(await readFile(path), "docx", "0050-docx.docx");
    expect(real.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
  });

  it("does not compare a table row marked as deleted", async () => {
    const zip = new JSZip();
    const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
    const office = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${office}/officeDocument" Target="word/document.xml"/></Relationships>`,
    );
    zip.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${w}"><w:body><w:tbl><w:tr><w:trPr><w:del w:id="1" w:author="A" w:date="2021-01-01T00:00:00Z"/></w:trPr><w:tc><w:p><w:del w:id="2" w:author="A" w:date="2021-01-01T00:00:00Z"><w:r><w:delText>Gone cell</w:delText></w:r></w:del></w:p></w:tc></w:tr></w:tbl><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Kept cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`,
    );
    const result = await roundTripOffice(await zip.generateAsync({ type: "uint8array" }), "docx", "deleted-row.docx");
    expect(result.differences.filter((diff) => diff.feature === "import.table")).toEqual([]);
  });

  it("keeps a dingbat symbol with the words beside it", async () => {
    const zip = new JSZip();
    const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
    const office = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${office}/officeDocument" Target="word/document.xml"/></Relationships>`,
    );
    zip.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${w}"><w:body><w:p><w:r><w:t>ab</w:t></w:r><w:r><w:sym w:font="Symbol" w:char="F031"/></w:r><w:r><w:t>cd</w:t></w:r></w:p></w:body></w:document>`,
    );
    const result = await roundTripOffice(await zip.generateAsync({ type: "uint8array" }), "docx", "symbol.docx");
    expect(result.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
  });

  it("keeps a short run beside a table with the rest of the paragraph", async () => {
    const zip = new JSZip();
    zip.file("mimetype", "application/vnd.oasis.opendocument.text", { compression: "STORE" });
    zip.file(
      "content.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0">
  <office:body><office:text>
    <text:p><table:table><table:table-row><table:table-cell><text:p>Cell words</text:p></table:table-cell></table:table-row></table:table><text:span>An</text:span><text:span>other words stay together</text:span></text:p>
  </office:text></office:body>
</office:document-content>`,
    );
    const result = await roundTripOffice(await zip.generateAsync({ type: "uint8array" }), "odt", "beside-table.odt");
    expect(result.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
    const path = "datasets/libreoffice/files/sw/qa/extras/layout/data/tdf122607.odt";
    if (!existsSync(path)) return;
    const real = await roundTripOffice(await readFile(path), "odt", "tdf122607.odt");
    expect(real.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
  });

  it("imports RTF and ODT text", async () => {
    const rtf = new TextEncoder().encode("{\\rtf1\\ansi Hello from the RTF file\\par}");
    const rtfFile = (await importForeign(rtf, "rtf", "note.rtf")).file;
    expect(JSON.stringify(rtfFile.content)).toContain("Hello from the RTF file");
    const zip = new JSZip();
    zip.file("mimetype", "application/vnd.oasis.opendocument.text", { compression: "STORE" });
    zip.file(
      "content.xml",
      `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
  <office:body><office:text><text:p>Hello from the ODT file</text:p></office:text></office:body>
</office:document-content>`,
    );
    const odt = await zip.generateAsync({ type: "uint8array" });
    const odtFile = (await importForeign(odt, "odt", "note.odt")).file;
    expect(JSON.stringify(odtFile.content)).toContain("Hello from the ODT file");
  });

  it("reads an exported spreadsheet SVG picture back", async () => {
    const file = createFile("sheet", "Book") as SheetFile;
    const sheetId = file.content.workbook.sheetOrder[0];
    file.content.images = [
      {
        id: "mark",
        sheetId,
        src: `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>').toString("base64")}`,
        row: 0,
        column: 0,
        offsetX: 0,
        offsetY: 0,
        width: 10,
        height: 10,
        anchorType: "1",
      },
    ];
    const again = await importOffice(await exportXlsx(file), "xlsx", "book.xlsx");
    expect((again.file as SheetFile).content.images).toHaveLength(1);
  });

  it("keeps whole-column concatenations after they are stored per row", async () => {
    const path =
      "datasets/apache-poi/files/test-data/spreadsheet/0-www-crossref-org.lib.rivier.edu_education-files_suffix-generator.xlsm";
    if (!existsSync(path)) return;
    const result = await roundTripOffice(await readFile(path), "xlsm", "suffix.xlsm");
    expect(result.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
  });

  it("does not treat a numeric cell's stored decimals as missing text", async () => {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    );
    zip.file(
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    );
    zip.file(
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    );
    zip.file(
      "xl/worksheets/sheet1.xml",
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>0.27272727272727298</v></c></row></sheetData></worksheet>`,
    );
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const result = await roundTripOffice(bytes, "xlsx", "number.xlsx");
    expect(result.outcome).not.toBe("rejected");
    expect(result.differences.filter((diff) => diff.feature === "import.text")).toEqual([]);
  });

  it("reads an Excel character escape as the character", async () => {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    );
    zip.file(
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    );
    zip.file(
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    );
    zip.file(
      "xl/worksheets/sheet1.xml",
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Hello_x000D_world</t></is></c></row></sheetData></worksheet>`,
    );
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const result = await roundTripOffice(bytes, "xlsx", "escape.xlsx");
    expect(result.outcome).not.toBe("rejected");
    expect(result.differences.filter((diff) => diff.feature === "import.text")).toEqual([]);
  });

  it("keeps letters that spell an Excel character escape", async () => {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    );
    zip.file(
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    );
    zip.file(
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    );
    zip.file(
      "xl/worksheets/sheet1.xml",
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Keep _x005F_x000D_ the letters</t></is></c></row></sheetData></worksheet>`,
    );
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const result = await roundTripOffice(bytes, "xlsx", "literal-escape.xlsx");
    expect(result.differences.filter((diff) => diff.feature === "export.text")).toEqual([]);
    const path = "datasets/napierone/files/ods/0018-ods.ods";
    if (!existsSync(path)) return;
    const real = await roundTripOffice(await readFile(path), "ods", "0018-ods.ods");
    expect(real.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
  });

  it("keeps an ampersand entity spelling and a numeric character reference", async () => {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    );
    zip.file(
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    );
    zip.file(
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    );
    zip.file(
      "xl/worksheets/sheet1.xml",
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Hello &amp; world</t></is></c><c r="B1" t="inlineStr"><is><t>Hello &amp;amp; world</t></is></c><c r="C1" t="inlineStr"><is><t>Line&#xA;break</t></is></c></row></sheetData></worksheet>`,
    );
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const result = await roundTripOffice(bytes, "xlsx", "entities.xlsx");
    expect(result.outcome).not.toBe("rejected");
    expect(
      result.differences.filter((diff) => diff.feature === "import.text" || diff.feature === "export.text"),
    ).toEqual([]);
  });

  it("keeps a one-character rich-text run in a spreadsheet cell", async () => {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    );
    zip.file(
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    );
    zip.file(
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    );
    zip.file(
      "xl/worksheets/sheet1.xml",
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><r><t>A</t></r><r><t xml:space="preserve"> - Hello world</t></r></is></c></row></sheetData></worksheet>`,
    );
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const result = await roundTripOffice(bytes, "xlsx", "rich-run.xlsx");
    expect(result.outcome).not.toBe("rejected");
    expect(result.differences.filter((diff) => diff.feature === "import.text")).toEqual([]);
  });

  it("does not treat a worksheet background as a placed image", async () => {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    );
    zip.file(
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    );
    zip.file(
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    );
    zip.file(
      "xl/worksheets/sheet1.xml",
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData/><picture r:id="rId1"/></worksheet>`,
    );
    zip.file(
      "xl/worksheets/_rels/sheet1.xml.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.jpeg"/></Relationships>`,
    );
    zip.file("xl/media/image1.jpeg", Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]));
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const result = await roundTripOffice(bytes, "xlsx", "background.xlsx");
    expect(result.outcome).not.toBe("rejected");
    expect(result.differences.filter((diff) => diff.feature === "import.image")).toEqual([]);
  });

  it("keeps pictures grouped together on a spreadsheet", async () => {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`,
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    );
    zip.file(
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    );
    zip.file(
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    );
    zip.file(
      "xl/worksheets/sheet1.xml",
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData/><drawing r:id="rId1"/></worksheet>`,
    );
    zip.file(
      "xl/worksheets/_rels/sheet1.xml.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`,
    );
    zip.file(
      "xl/drawings/drawing1.xml",
      `<?xml version="1.0" encoding="UTF-8"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:grpSp><xdr:nvGrpSpPr><xdr:cNvPr id="4" name="Group"/><xdr:cNvGrpSpPr/></xdr:nvGrpSpPr><xdr:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/><a:chOff x="0" y="0"/><a:chExt cx="2000000" cy="1000000"/></a:xfrm></xdr:grpSpPr><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="left"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="900000" cy="900000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="3" name="right"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId2"/></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="1000000" y="0"/><a:ext cx="900000" cy="900000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic></xdr:grpSp><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`,
    );
    zip.file(
      "xl/drawings/_rels/drawing1.xml.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/left.png"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/right.png"/></Relationships>`,
    );
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    zip.file("xl/media/left.png", png);
    zip.file("xl/media/right.png", png);
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const result = await roundTripOffice(bytes, "xlsx", "grouped.xlsx");
    expect(result.differences.filter((diff) => diff.feature === "import.image")).toEqual([]);
    for (const name of ["0524-xlsx.xlsx", "0526-xlsx.xlsx"]) {
      const path = `datasets/napierone/files/xlsx/${name}`;
      if (!existsSync(path)) continue;
      const real = await roundTripOffice(await readFile(path), "xlsx", name);
      expect(real.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
    }
  });

  it("keeps a spreadsheet header picture", async () => {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    );
    zip.file(
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    );
    zip.file(
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    );
    zip.file(
      "xl/worksheets/sheet1.xml",
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData/><legacyDrawing r:id="rId1"/></worksheet>`,
    );
    zip.file(
      "xl/worksheets/_rels/sheet1.xml.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/></Relationships>`,
    );
    zip.file(
      "xl/drawings/vmlDrawing1.vml",
      `<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><v:shape id="CH" style="position:absolute;margin-left:0;margin-top:0;width:72pt;height:36pt"><v:imagedata o:relid="rId1" o:title="Logo"/></v:shape></xml>`,
    );
    zip.file(
      "xl/drawings/_rels/vmlDrawing1.vml.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo.jpeg"/></Relationships>`,
    );
    zip.file("xl/media/logo.jpeg", Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]));
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const result = await roundTripOffice(bytes, "xlsx", "header.xlsx");
    expect(result.differences.filter((diff) => diff.feature === "import.image")).toEqual([]);
    for (const name of ["0829-xlsx.xlsx", "0830-xlsx.xlsx"]) {
      const path = `datasets/napierone/files/xlsx/${name}`;
      if (!existsSync(path)) continue;
      const real = await roundTripOffice(await readFile(path), "xlsx", name);
      expect(real.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
    }
  });

  it("does not treat a zero-width spreadsheet picture as a placed image", async () => {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`,
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    );
    zip.file(
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    );
    zip.file(
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    );
    zip.file(
      "xl/worksheets/sheet1.xml",
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData/><drawing r:id="rId1"/></worksheet>`,
    );
    zip.file(
      "xl/worksheets/_rels/sheet1.xml.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`,
    );
    zip.file(
      "xl/drawings/drawing1.xml",
      `<?xml version="1.0" encoding="UTF-8"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="zero"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="2133600"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`,
    );
    zip.file(
      "xl/drawings/_rels/drawing1.xml.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.jpeg"/></Relationships>`,
    );
    zip.file("xl/media/image1.jpeg", Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]));
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const result = await roundTripOffice(bytes, "xlsx", "zero-width.xlsx");
    expect(result.outcome).not.toBe("rejected");
    expect(result.differences.filter((diff) => diff.feature === "import.image")).toEqual([]);
  });

  it("keeps a picture that floats over the page", async () => {
    const path =
      "datasets/docx-corpus/files/de/006d241fd90e05861f80be5df3d6f7904a0ba4301680e082eb1e52b65d90f4e0.docx";
    if (!existsSync(path)) return;
    const result = await roundTripOffice(await readFile(path), "docx", "anchor.docx");
    expect(result.outcome).not.toBe("rejected");
    expect(result.differences.filter((diff) => diff.feature === "import.image")).toEqual([]);
  });

  it("keeps pictures stored only as VML", async () => {
    const path =
      "datasets/docx-corpus/files/ar/021e661d69d27d907b0827a22e6fd4fdd5cda40c883cfeff00d78be2ef71e81a.docx";
    if (!existsSync(path)) return;
    const result = await roundTripOffice(await readFile(path), "docx", "vml.docx");
    expect(result.outcome).not.toBe("rejected");
    expect(result.differences.filter((diff) => diff.feature === "import.image")).toEqual([]);
  });

  it("does not treat a cached table of contents as missing body text", async () => {
    const path =
      "datasets/docx-corpus/files/ar/00e95b59e12e4a3d4a68a97cf4e1f102c91b206c83768c3f13a7b88881c0157e.docx";
    if (!existsSync(path)) return;
    const result = await roundTripOffice(await readFile(path), "docx", "toc.docx");
    expect(result.outcome).not.toBe("rejected");
    expect(result.differences.filter((diff) => diff.feature === "import.text")).toEqual([]);
  });

  it("does not treat an invalid cell reference as missing text", async () => {
    const path = "datasets/apache-poi/files/test-data/spreadsheet/invalid_cell_reference.xlsx";
    if (!existsSync(path)) return;
    const result = await roundTripOffice(await readFile(path), "xlsx", "invalid_cell_reference.xlsx");
    expect(result.outcome).not.toBe("rejected");
    expect(result.differences.filter((diff) => diff.feature === "import.text")).toEqual([]);
  });

  it("compares an Excel future function without its storage prefix", async () => {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    );
    zip.file(
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    );
    zip.file(
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    );
    zip.file(
      "xl/worksheets/sheet1.xml",
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><f>TYPE(_xlfn.ANCHORARRAY(B1))</f><v>1</v></c><c r="B1"><f>_xlfn.UNIQUE(_xlfn.ANCHORARRAY(C1))</f><v>1</v></c></row></sheetData></worksheet>`,
    );
    const result = await roundTripOffice(await zip.generateAsync({ type: "uint8array" }), "xlsx", "future.xlsx");
    expect(result.differences.filter((diff) => diff.feature === "import.formula")).toEqual([]);
  });

  it("keeps pictures stored in an OpenDocument spreadsheet", async () => {
    const path = "datasets/libreoffice/files/sc/qa/unit/data/ods/3AnchorTypes.ods";
    if (!existsSync(path)) return;
    const result = await roundTripOffice(await readFile(path), "ods", "3AnchorTypes.ods");
    expect(result.outcome).not.toBe("rejected");
    expect(result.differences.filter((diff) => diff.feature === "import.image")).toEqual([]);
  });

  it("compares a formatted OpenDocument number as its value", async () => {
    const path = "datasets/libreoffice/files/sc/qa/unit/data/ods/cachedValue.ods";
    if (!existsSync(path)) return;
    const result = await roundTripOffice(await readFile(path), "ods", "cachedValue.ods");
    expect(result.outcome).not.toBe("rejected");
    expect(result.differences.filter((diff) => diff.feature === "import.text")).toEqual([]);
  });

  it("keeps an underlined run in an OpenDocument spreadsheet", async () => {
    const path = "datasets/libreoffice/files/sc/qa/unit/data/ods/formats.ods";
    if (!existsSync(path)) return;
    const result = await roundTripOffice(await readFile(path), "ods", "formats.ods");
    expect(result.outcome).not.toBe("rejected");
    expect(result.differences.filter((diff) => diff.feature === "import.underline")).toEqual([]);
  });

  it("compares an OpenDocument formula as a formula", async () => {
    const path = "datasets/libreoffice/files/sc/qa/unit/data/ods/functions.ods";
    if (!existsSync(path)) return;
    const result = await roundTripOffice(await readFile(path), "ods", "functions.ods");
    expect(result.outcome).not.toBe("rejected");
    expect(result.differences.filter((diff) => diff.feature === "import.text")).toEqual([]);
  });

  it("keeps bold and italic runs in an OpenDocument spreadsheet", async () => {
    const path = "datasets/libreoffice/files/sc/qa/unit/data/ods/rich-text-cells.ods";
    if (!existsSync(path)) return;
    const result = await roundTripOffice(await readFile(path), "ods", "rich-text-cells.ods");
    expect(result.outcome).not.toBe("rejected");
    expect(result.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
  });

  it("keeps a nested table and a footnote in an OpenDocument text file", async () => {
    const nested = "datasets/libreoffice/files/sw/qa/extras/layout/data/tdf142694-1.odt";
    const footnote = "datasets/libreoffice/files/sw/qa/extras/layout/data/tdf145826.odt";
    const marked = "datasets/libreoffice/files/sw/qa/extras/layout/data/tdf148897.odt";
    const inside = "datasets/libreoffice/files/sw/qa/extras/layout/data/tdf152106.odt";
    const section = "datasets/libreoffice/files/sw/qa/extras/layout/data/footnote-in-2-column-section.fodt";
    const contents = "datasets/libreoffice/files/sw/qa/extras/layout/data/ToC-in-linked-frame-on-first-page-style.fodt";
    const sentence = "datasets/libreoffice/files/sw/qa/extras/layout/data/tdf143239-1-min.odt";
    if (
      !existsSync(nested) ||
      !existsSync(footnote) ||
      !existsSync(sentence) ||
      !existsSync(marked) ||
      !existsSync(inside) ||
      !existsSync(section) ||
      !existsSync(contents)
    )
      return;
    const nestedResult = await roundTripOffice(await readFile(nested), "odt", "tdf142694-1.odt");
    const footnoteResult = await roundTripOffice(await readFile(footnote), "odt", "tdf145826.odt");
    const markedResult = await roundTripOffice(await readFile(marked), "odt", "tdf148897.odt");
    const insideResult = await roundTripOffice(await readFile(inside), "odt", "tdf152106.odt");
    const sectionResult = await roundTripOffice(await readFile(section), "fodt", "footnote-in-2-column-section.fodt");
    const contentsResult = await roundTripOffice(
      await readFile(contents),
      "fodt",
      "ToC-in-linked-frame-on-first-page-style.fodt",
    );
    const sentenceResult = await roundTripOffice(await readFile(sentence), "odt", "tdf143239-1-min.odt");
    expect(nestedResult.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
    expect(footnoteResult.differences.filter((diff) => diff.feature === "import.notes")).toEqual([]);
    expect(markedResult.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
    expect(insideResult.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
    expect(sectionResult.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
    expect(contentsResult.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
    expect(sentenceResult.differences.filter((diff) => diff.feature === "import.text")).toEqual([]);
  });

  it("compares a slide table cell once", async () => {
    const path = "datasets/libreoffice/files/sd/qa/unit/data/fdo79731.odp";
    const spanned = "datasets/libreoffice/files/sd/qa/unit/data/odp/cellspan.odp";
    if (!existsSync(path) || !existsSync(spanned)) return;
    const result = await roundTripOffice(await readFile(path), "odp", "fdo79731.odp");
    const spannedResult = await roundTripOffice(await readFile(spanned), "odp", "cellspan.odp");
    expect(result.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
    expect(spannedResult.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
  });

  it("keeps bold and italic in a slide table", async () => {
    const path = "datasets/libreoffice/files/sd/qa/unit/data/odp/invalidPrstDashEnumValue.odp";
    if (!existsSync(path)) return;
    const result = await roundTripOffice(await readFile(path), "odp", "invalidPrstDashEnumValue.odp");
    expect(result.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
    expect(result.differences.some((diff) => diff.feature === "slide.table-format")).toBe(false);
  });

  it("keeps a one-character speaker note with the other notes", async () => {
    const file = createFile("slide", "Review") as SlideFile;
    const id = file.content.slideOrder[0];
    file.content.slides[id].elements = [
      {
        id: "title",
        type: "text",
        x: 80,
        y: 70,
        width: 800,
        height: 80,
        content: "Quarterly review slides",
        fontSize: 32,
      },
    ];
    file.content.slides[id].notes = "36";
    const zip = await JSZip.loadAsync(await exportPptx(file));
    const notesName = Object.keys(zip.files).find((name) => /ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(name));
    expect(notesName).toBeTruthy();
    const notesXml = await zip.file(notesName!)!.async("string");
    const patched = notesXml.replace(
      "</p:spTree>",
      '<p:sp><p:nvSpPr><p:cNvPr id="9" name="Note"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>g</a:t></a:r></a:p></p:txBody></p:sp></p:spTree>',
    );
    expect(patched).not.toBe(notesXml);
    zip.file(notesName!, patched);
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const result = await roundTripOffice(bytes, "pptx", "short-note.pptx");
    expect(result.differences.filter((diff) => diff.feature === "import.notes")).toEqual([]);
    const path = "datasets/napierone/files/pptx/2107-pptx.pptx";
    if (!existsSync(path)) return;
    const real = await roundTripOffice(await readFile(path), "pptx", "2107-pptx.pptx");
    expect(real.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
  });

  it("keeps speaker notes with the slide", async () => {
    const path = "datasets/libreoffice/files/sd/qa/unit/data/odp/search-all-notes.odp";
    if (!existsSync(path)) return;
    const result = await roundTripOffice(await readFile(path), "odp", "search-all-notes.odp");
    expect(result.differences.filter((diff) => diff.feature === "import.text" || diff.feature === "import.notes")).toEqual(
      [],
    );
    expect(result.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
  });

  it("keeps a picture nested in an OpenDocument paragraph", async () => {
    const path = "datasets/libreoffice/files/sw/qa/extras/layout/data/tdf134298.ott";
    if (!existsSync(path)) return;
    const result = await roundTripOffice(await readFile(path), "ott", "tdf134298.ott");
    expect(result.differences.filter((diff) => diff.feature === "import.image")).toEqual([]);
    expect(result.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
  });

  it("keeps a list on a slide as bulleted text", async () => {
    const path = "datasets/libreoffice/files/sd/qa/unit/data/HtmlExportTestDocument.odp";
    if (!existsSync(path)) return;
    const result = await roundTripOffice(await readFile(path), "odp", "HtmlExportTestDocument.odp");
    expect(result.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
  });

  it("does not expand empty rows repeated to fill the sheet", async () => {
    const path = "datasets/libreoffice/files/sc/qa/unit/data/ods/too-many-cols-rows.ods";
    if (!existsSync(path)) return;
    const result = await roundTripOffice(await readFile(path), "ods", "too-many-cols-rows.ods");
    expect(result.outcome).not.toBe("rejected");
    expect(result.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
  });

  it("does not treat an embedded spreadsheet chart as a dropped picture", async () => {
    const path = "datasets/libreoffice/files/sc/qa/unit/data/ods/tdf141914.ods";
    if (!existsSync(path)) return;
    const result = await roundTripOffice(await readFile(path), "ods", "tdf141914.ods");
    expect(result.outcome).not.toBe("rejected");
    expect(result.differences.filter((diff) => diff.feature === "import.image")).toEqual([]);
  });

  it("keeps a formula that has no cached result", async () => {
    const path = "datasets/apache-poi/files/test-data/spreadsheet/bug60858.xlsx";
    if (!existsSync(path)) return;
    const result = await roundTripOffice(await readFile(path), "xlsx", "bug60858.xlsx");
    expect(result.outcome).not.toBe("rejected");
    expect(result.differences.filter((diff) => diff.feature === "import.formula")).toEqual([]);
  });

  it("keeps a picture anchored to the spreadsheet page", async () => {
    const path =
      "datasets/apache-poi/files/test-data/spreadsheet/absolute-anchor-over-empty-sheet.xlsx";
    if (!existsSync(path)) return;
    const result = await roundTripOffice(
      await readFile(path),
      "xlsx",
      "absolute-anchor-over-empty-sheet.xlsx",
    );
    expect(result.outcome).not.toBe("rejected");
    expect(result.differences.filter((diff) => diff.feature === "import.image")).toEqual([]);
  });

  it("does not count a spreadsheet cell and its text run twice", async () => {
    const path = "datasets/apache-poi/files/test-data/spreadsheet/SampleSS.ods";
    if (!existsSync(path)) return;
    const result = await roundTripOffice(await readFile(path), "ods", "SampleSS.ods");
    expect(result.outcome).not.toBe("rejected");
    expect(result.differences.filter((diff) => diff.feature === "import.text")).toEqual([]);
  });

  it("keeps a paragraph in a nested cover-page table", async () => {
    const zip = new JSZip();
    const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const rel = "http://schemas.openxmlformats.org/package/2006/relationships";
    const office = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    );
    zip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${rel}"><Relationship Id="rId1" Type="${office}/officeDocument" Target="word/document.xml"/></Relationships>`,
    );
    zip.file(
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${w}"><w:body><w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Cover Pages"/></w:docPartObj></w:sdtPr><w:sdtContent><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Northwind Traders</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Second cover line</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:tc></w:tr></w:tbl></w:sdtContent></w:sdt></w:body></w:document>`,
    );
    const result = await roundTripOffice(
      await zip.generateAsync({ type: "uint8array" }),
      "docx",
      "nested-cover.docx",
    );
    expect(result.differences.filter((diff) => diff.feature === "import.text")).toEqual([]);
    const path =
      "datasets/libreoffice/files/sw/qa/extras/ooxmlexport/data/sdt-company-multipara.docx";
    if (!existsSync(path)) return;
    const real = await roundTripOffice(await readFile(path), "docx", "sdt-company-multipara.docx");
    expect(real.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
  });

  it("reads paragraph text from a Word 97 document", async () => {
    const path = "datasets/apache-poi/files/test-data/document/47304.doc";
    if (!existsSync(path)) return;
    const file = importBinaryDoc(await readFile(path), "doc", "47304.doc");
    expect(JSON.stringify(file.content).toLowerCase()).toContain("test");
  });

  it("keeps a WebP picture on a slide", async () => {
    const file = createFile("slide", "Pictures") as SlideFile;
    const id = file.content.slideOrder[0];
    file.content.slides[id].elements = [
      {
        id: "photo",
        type: "image",
        x: 40,
        y: 40,
        width: 120,
        height: 80,
        src: "data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=",
      },
    ];
    const opened = await parsePowerPoint(await exportPptx(file), "Pictures");
    const images = Object.values(opened.content.slides).flatMap((slide) =>
      slide.elements.filter((el) => el.type === "image"),
    );
    expect(images).toHaveLength(1);
    expect(images[0]?.src?.startsWith("data:image/webp;base64,")).toBe(true);
    const path =
      "datasets/zenodo10k/files/pptx/cc-by-4.0/2020/8707d21431fa960300d9c4872a1c367a-Universitätsbibliotheken und Digitalisierung 2020.pptx";
    if (!existsSync(path)) return;
    const real = await roundTripOffice(await readFile(path), "pptx", "webp.pptx");
    expect(real.differences.filter((diff) => diff.owner === "suiteleaf")).toEqual([]);
  });
});
