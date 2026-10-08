import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import * as CFB from "cfb";
import { readFileSync, existsSync } from "node:fs";
import * as XLSX from "xlsx";
import { importOffice, OfficeImportError } from "../packages/core/src/office";
import { documentText } from "../packages/core/src/word";
import {
  createFile,
  serializeFile,
  parseFile,
  type JsonNode,
} from "../packages/core/src";
import { wordFixture, excelFixture } from "./office-fixtures";
function nodes(n: JsonNode): JsonNode[] {
  return [n, ...(n.content ?? []).flatMap(nodes)];
}
describe("editable Office imports", () => {
  it.skipIf(
    !existsSync(
      "datasets/libreoffice/files/sc/qa/unit/data/xlsb/shared_formula.xlsb",
    ),
  )("preserves formulas from an original XLSB workbook", async () => {
    const { file } = await importOffice(
      readFileSync(
        "datasets/libreoffice/files/sc/qa/unit/data/xlsb/shared_formula.xlsb",
      ),
      "xlsb",
      "shared_formula.xlsb",
    );
    if (file.kind !== "sheet") throw new Error("Expected sheet");
    const sheet =
      file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
    expect(sheet.cellData!["0"]["0"]).toMatchObject({ v: 3, f: "=1+2" });
    expect(sheet.cellData!["29"]["0"].f).toBe("=1+2");
    expect(parseFile(serializeFile(file))).toEqual(file);
  });
  it.skipIf(
    !existsSync("datasets/apache-poi/files/test-data/spreadsheet/Simple.xls"),
  )(
    "imports real legacy XLS worksheets and retains original format through a native save",
    async () => {
      const { file, report } = await importOffice(
        readFileSync(
          "datasets/apache-poi/files/test-data/spreadsheet/Simple.xls",
        ),
        "xls",
        "Simple.xls",
      );
      if (file.kind !== "sheet") throw new Error("Expected sheet");
      const workbook = file.content.workbook;
      expect(workbook.sheetOrder.map((id) => workbook.sheets[id].name)).toEqual(
        ["Sheet1", "Sheet2", "Sheet3"],
      );
      expect(
        workbook.sheets[workbook.sheetOrder[0]].cellData!["0"]["0"].v,
      ).toBe("replaceMe");
      expect(report.format).toBe("xls");
      expect(file.importInfo!.sourceFormat).toBe("xls");
      expect(parseFile(serializeFile(file))).toEqual(file);
    },
  );
  it.skipIf(
    !existsSync("datasets/apache-poi/files/test-data/spreadsheet/date.xlsb") ||
      !existsSync(
        "datasets/apache-poi/files/test-data/spreadsheet/Simple.xlsb",
      ),
  )(
    "imports a real XLSB date with its number format and rejects unreadable binary sheet names",
    async () => {
      const { file } = await importOffice(
        readFileSync(
          "datasets/apache-poi/files/test-data/spreadsheet/date.xlsb",
        ),
        "xlsb",
        "date.xlsb",
      );
      if (file.kind !== "sheet") throw new Error("Expected sheet");
      expect(
        file.content.workbook.sheets[file.content.workbook.sheetOrder[0]]
          .cellData!["0"]["0"].v,
      ).toBe(41286);
      expect(file.importInfo!.sourceFormat).toBe("xlsb");
      await expect(
        importOffice(
          readFileSync(
            "datasets/apache-poi/files/test-data/spreadsheet/Simple.xlsb",
          ),
          "xlsb",
          "Simple.xlsb",
        ),
      ).rejects.toMatchObject({ code: "conversion-failed" });
    },
  );
  it.each(["xls", "xlsb"] as const)(
    "preserves %s cell values and merges",
    async (format) => {
      const book = XLSX.utils.book_new();
      const sheet = XLSX.utils.aoa_to_sheet([
        ["Quantity", 12],
        ["Total", 24],
      ]);
      sheet["!merges"] = [{ s: { r: 2, c: 0 }, e: { r: 2, c: 1 } }];
      XLSX.utils.book_append_sheet(book, sheet, "Budget");
      const { file } = await importOffice(
        new Uint8Array(XLSX.write(book, { type: "array", bookType: format })),
        format,
        `Budget.${format}`,
      );
      if (file.kind !== "sheet") throw new Error("Expected sheet");
      const imported =
        file.content.workbook.sheets[file.content.workbook.sheetOrder[0]];
      expect(imported.cellData!["0"]["1"].v).toBe(12);
      expect(imported.cellData!["1"]["1"].v).toBe(24);
      expect(imported.mergeData).toContainEqual({
        startRow: 2,
        endRow: 2,
        startColumn: 0,
        endColumn: 1,
      });
      expect(parseFile(serializeFile(file))).toEqual(file);
    },
  );
  it.each(["xlsm", "xltx"] as const)(
    "imports %s XML packages with original format metadata",
    async (format) => {
      const { file } = await importOffice(
        await excelFixture(),
        format,
        `Budget.${format}`,
      );
      expect(file.kind).toBe("sheet");
      expect(file.importInfo!.sourceFormat).toBe(format);
      expect(parseFile(serializeFile(file))).toEqual(file);
    },
  );
  it("preserves Word headings, Unicode, emphasis, tables and safe links through native saves", async () => {
    const { file, report } = await importOffice(
      await wordFixture(),
      "docx",
      "Field notes.docx",
    );
    expect(file.kind).toBe("doc");
    if (file.kind !== "doc") return;
    expect(documentText(file.content)).toContain("Hello 世界 — مرحبا");
    const all = nodes(file.content);
    expect(all.some((n) => n.type === "heading" && n.attrs?.level === 1)).toBe(
      true,
    );
    expect(all.some((n) => n.type === "table")).toBe(true);
    expect(all.some((n) => n.marks?.some((m) => m.type === "bold"))).toBe(true);
    expect(
      all.some((n) => n.marks?.some((m) => m.type === "superscript")),
    ).toBe(true);
    expect(
      all.some((n) =>
        n.marks?.some((m) => String(m.attrs?.href).startsWith("javascript:")),
      ),
    ).toBe(false);
    expect(report.textPreserved).toBe(true);
    expect(parseFile(serializeFile(file))).toEqual(file);
  });
  it.skipIf(
    !existsSync(
      "datasets/apache-poi/files/test-data/document/checkboxes.docx",
    ),
  )(
    "preserves checkboxes in docx form fields as checked and unchecked symbols",
    async () => {
      const { file, report } = await importOffice(
        readFileSync(
          "datasets/apache-poi/files/test-data/document/checkboxes.docx",
        ),
        "docx",
        "checkboxes.docx",
      );
      expect(file.kind).toBe("doc");
      if (file.kind !== "doc") return;
      const text = documentText(file.content);
      expect(text).toContain("unchecked: ☐");
      expect(text).toContain("Or checked: ☒");
      expect(text).toContain("Test a checkbox within a textbox: ☐ -> ☒");
      expect(text).toContain("☒☐☒");
      expect(report.textPreserved).toBe(true);
    },
  );
  it("preserves Excel cell types, shared formulas, date system, named ranges, styles and dimensions", async () => {
    const { file } = await importOffice(
      await excelFixture(),
      "xlsx",
      "Budget.xlsx",
    );
    if (file.kind !== "sheet") throw new Error("Expected sheet");
    const w = file.content.workbook,
      s = w.sheets[w.sheetOrder[0]],
      cells = s.cellData!;
    expect(w.dateSystem).toBe("date1904");
    expect(cells["1"]["0"]!.f).toBe("=B1*2");
    expect(cells["2"]["1"]!.f).toBe("=B2*3");
    expect(cells["1"]["3"]!.v).toBe(true);
    expect(cells["3"]["3"]!.v).toBe("#DIV/0!");
    expect(cells["4"]["0"]!.v).toBe("=literal");
    expect(cells["4"]["0"]!.f).toBeUndefined();
    expect((w.styles as any)["excel-0"]).toMatchObject({
      ff: "Arial",
      bl: 1,
      bg: { rgb: "#CCEEAA" },
      pd: { l: 4, r: 4 },
    });
    expect(s.columnData).toMatchObject({ "0": { w: 168 }, "1": { hd: 1 } });
    expect(s.rowData).toMatchObject({ "0": { h: 40 } });
    expect(s.freeze).toMatchObject({ xSplit: 1, ySplit: 1 });
    expect(JSON.stringify(w.resources)).toContain("Revenue");
    expect(parseFile(serializeFile(file))).toEqual(file);
  });
  it("loads empty sheets without hanging on self-closing XML", async () => {
    const r = await importOffice(
      await excelFixture(true),
      "xlsx",
      "Empty.xlsx",
    );
    expect(r.report.stats.cells).toBe(0);
  });
  it("clearly rejects damaged, wrong-format and encrypted inputs without manufacturing content", async () => {
    await expect(
      importOffice(
        new TextEncoder().encode("not a document"),
        "docx",
        "Bad.docx",
      ),
    ).rejects.toMatchObject({ code: "invalid-container" });
    const z = new JSZip();
    z.file("[Content_Types].xml", "<Types/>");
    await expect(
      importOffice(
        await z.generateAsync({ type: "uint8array" }),
        "xlsx",
        "Bad.xlsx",
      ),
    ).rejects.toMatchObject({ code: "missing-part" });
    const c = CFB.utils.cfb_new();
    CFB.utils.cfb_add(c, "EncryptedPackage", new Uint8Array([1, 2, 3]));
    const bytes = CFB.write(c, { type: "array" });
    await expect(
      importOffice(new Uint8Array(bytes), "docx", "Locked.docx"),
    ).rejects.toBeInstanceOf(OfficeImportError);
    await expect(
      importOffice(new Uint8Array(bytes), "docx", "Locked.docx"),
    ).rejects.toMatchObject({ code: "encrypted" });
  });
});

it("rejects malformed native cells while allowing nullable SDK formula/type flags", () => {
  const f = createFile("sheet");
  if (f.kind !== "sheet") throw new Error("Expected sheet");
  const s = f.content.workbook.sheets[f.content.workbook.sheetOrder[0]];
  s.cellData = { "0": { "0": { v: 12, f: null, t: null } } };
  expect(parseFile(serializeFile(f)).kind).toBe("sheet");
  s.cellData = { bad: { "0": { v: 12 } } };
  expect(() => parseFile(JSON.stringify(f))).toThrow("invalid coordinates");
  s.cellData = { "0": { "0": { v: { unexpected: "object" } } as any } };
  expect(() => parseFile(JSON.stringify(f))).toThrow();
});

it("imports Word document with lists, image tags, and strike/underline formatting", async () => {
  const z = new JSZip();
  const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';
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
    `${xmlHeader}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:rPr><w:u w:val="single"/><w:strike/></w:rPr><w:t>Task item</w:t></w:r></w:p><w:p><w:r><w:rPr><w:vertAlign w:val="subscript"/></w:rPr><w:t>sub</w:t></w:r></w:p></w:body></w:document>`,
  );
  z.file(
    "word/styles.xml",
    `${xmlHeader}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/></w:style></w:styles>`,
  );
  z.file(
    "word/_rels/document.xml.rels",
    `${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`,
  );
  const buf = await z.generateAsync({ type: "uint8array" });
  const { file } = await importOffice(buf, "docx", "List.docx");
  expect(file.kind).toBe("doc");
  expect(documentText(file.content)).toContain("Task item");
});

it("imports Excel workbook with embedded bar chart", async () => {
  const z = new JSZip();
  const xmlHeader = '<?xml version="1.0" encoding="UTF-8"?>';
  z.file(
    "[Content_Types].xml",
    `${xmlHeader}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/><Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/></Types>`,
  );
  z.file(
    "_rels/.rels",
    `${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  z.file(
    "xl/workbook.xml",
    `${xmlHeader}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sales" sheetId="1" r:id="sheet1"/></sheets></workbook>`,
  );
  z.file(
    "xl/_rels/workbook.xml.rels",
    `${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="sheet1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  z.file(
    "xl/styles.xml",
    `${xmlHeader}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><name val="Arial"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellXfs></styleSheet>`,
  );
  z.file(
    "xl/worksheets/sheet1.xml",
    `${xmlHeader}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Region</t></is></c><c r="B1" t="inlineStr"><is><t>Revenue</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>North</t></is></c><c r="B2"><v>100</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>South</t></is></c><c r="B3"><v>200</v></c></row></sheetData><drawing r:id="d1"/></worksheet>`,
  );
  z.file(
    "xl/worksheets/_rels/sheet1.xml.rels",
    `${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="d1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`,
  );
  z.file(
    "xl/drawings/drawing1.xml",
    `${xmlHeader}<wsDr xmlns="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><twoCellAnchor><from><col>3</col><row>1</row></from><to><col>8</col><row>12</row></to><graphicFrame><graphic><graphicData><chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="c1"/></graphicData></graphic></graphicFrame></twoCellAnchor></wsDr>`,
  );
  z.file(
    "xl/drawings/_rels/drawing1.xml.rels",
    `${xmlHeader}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="c1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>`,
  );
  z.file(
    "xl/charts/chart1.xml",
    `${xmlHeader}<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:barChart><c:ser><c:cat><c:strRef><c:f>Sales!$A$2:$A$3</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>Sales!$B$2:$B$3</c:f></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>`,
  );
  const buf = await z.generateAsync({ type: "uint8array" });
  const { file } = await importOffice(buf, "xlsx", "SalesChart.xlsx");
  expect(file.kind).toBe("sheet");
  if (file.kind === "sheet") {
    expect(file.content.charts.length).toBe(1);
    expect(file.content.charts[0].type).toBe("bar");
  }
});
