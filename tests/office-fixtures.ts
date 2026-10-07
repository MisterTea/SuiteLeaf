import JSZip from "jszip";
const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';
export async function wordFixture() {
  const z = new JSZip();
  z.file(
    "[Content_Types].xml",
    `${xmlHeader}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  z.file(
    "_rels/.rels",
    `${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  z.file(
    "word/document.xml",
    `${xmlHeader}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Office field notes</w:t></w:r></w:p><w:p><w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>Hello 世界 — مرحبا</w:t></w:r></w:p><w:p><w:hyperlink r:id="safe"><w:r><w:t>Reference</w:t></w:r></w:hyperlink><w:hyperlink r:id="bad"><w:r><w:t>Unsafe link</w:t></w:r></w:hyperlink></w:p><w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="5000"/><w:gridCol w:w="5000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>Team</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>North</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>2</w:t></w:r></w:p></w:body></w:document>`,
  );
  z.file(
    "word/styles.xml",
    `${xmlHeader}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`,
  );
  z.file(
    "word/_rels/document.xml.rels",
    `${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="safe" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.org" TargetMode="External"/><Relationship Id="bad" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="javascript:alert(1)" TargetMode="External"/></Relationships>`,
  );
  return z.generateAsync({ type: "uint8array" });
}
export async function excelFixture(empty = false) {
  const z = new JSZip();
  z.file(
    "[Content_Types].xml",
    `${xmlHeader}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
  );
  z.file(
    "_rels/.rels",
    `${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  z.file(
    "xl/workbook.xml",
    `${xmlHeader}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="1"/><sheets><sheet name="Budget" sheetId="1" r:id="sheet1"/></sheets><definedNames><definedName name="Revenue">Budget!$B$1</definedName></definedNames></workbook>`,
  );
  z.file(
    "xl/_rels/workbook.xml.rels",
    `${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="sheet1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  z.file(
    "xl/styles.xml",
    `${xmlHeader}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><fonts count="1"><font><b/><name val="Arial"/><sz val="12"/><color rgb="FF123456"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFCCEEAA"/></patternFill></fill></fills><borders count="1"><border/></borders><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="1" borderId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0"/></cellXfs></styleSheet>`,
  );
  z.file(
    "xl/worksheets/sheet1.xml",
    `${xmlHeader}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:D5"/><sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="1" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="24"/><col min="2" max="2" width="12" hidden="1"/></cols>${empty ? "<sheetData/>" : '<sheetData><row r="1" ht="30"><c r="A1" s="0" t="inlineStr"><is><t>Studio budget</t></is></c><c r="B1"><v>100</v></c><c r="C1"><f>Revenue*2</f><v>200</v></c></row><row r="2"><c r="A2"><f>B1*2</f><v>200</v></c><c r="B2"><f t="shared" si="0" ref="B2:B3">B1*3</f><v>300</v></c><c r="D2" t="b"><v>1</v></c></row><row r="3"><c r="B3"><f t="shared" si="0"/><v>900</v></c></row><row r="4"><c r="A4" s="1"><v>45000</v></c><c r="D4" t="e"><f>1/0</f><v>#DIV/0!</v></c></row><row r="5"><c r="A5" t="inlineStr"><is><t>=literal</t></is></c></row></sheetData>'}<mergeCells count="1"><mergeCell ref="A1:A1"/></mergeCells></worksheet>`,
  );
  return z.generateAsync({ type: "uint8array" });
}
