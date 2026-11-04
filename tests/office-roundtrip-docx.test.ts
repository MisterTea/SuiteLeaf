import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { createFile, type DocFile } from "../packages/core/src";
import { importBinaryDoc } from "../packages/core/src/doc-binary";
import { exportDocx } from "../packages/core/src/docx-export";
import { importOffice } from "../packages/core/src/office";
import { roundTripOffice } from "../packages/core/src/roundtrip";
import { htmlToDocument } from "../packages/core/src/word";

describe("office export round trip", { timeout: 60_000 }, () => {
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
});
