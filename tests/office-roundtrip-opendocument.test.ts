import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { importForeign } from "../packages/core/src/foreign-import";
import { roundTripOffice } from "../packages/core/src/roundtrip";

describe("office export round trip", () => {
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

  it("does not count a spreadsheet cell and its text run twice", async () => {
    const path = "datasets/apache-poi/files/test-data/spreadsheet/SampleSS.ods";
    if (!existsSync(path)) return;
    const result = await roundTripOffice(await readFile(path), "ods", "SampleSS.ods");
    expect(result.outcome).not.toBe("rejected");
    expect(result.differences.filter((diff) => diff.feature === "import.text")).toEqual([]);
  });
});
