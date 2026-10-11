import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { createFile, parseFile, serializeFile } from "../packages/core/src";
import { exportDocx } from "../packages/core/src/docx-export";
import { importOffice } from "../packages/core/src/office";
import { exportXlsx } from "../packages/core/src/xlsx-export";

describe("local Office export", () => {
  it("writes DOCX rich text, tables, layout and repeated page furniture", async () => {
    const file = createFile("doc", "Review & approval");
    if (file.kind !== "doc") throw new Error();
    file.content = {
      type: "doc",
      attrs: {
        pageSettings: {
          size: "a4",
          landscape: true,
          margin: 48,
          header: "Confidential & internal",
          footer: "SuiteLeaf",
          pageNumbers: true,
        },
      },
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Review" }],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Keep <this>",
              marks: [
                { type: "bold" },
                {
                  type: "textStyle",
                  attrs: { color: "#ff0000", fontSize: "12pt" },
                },
              ],
            },
          ],
        },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Cell" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        { type: "pageBreak" },
        { type: "paragraph", content: [{ type: "text", text: "Next page" }] },
      ],
    };
    const zip = await JSZip.loadAsync(await exportDocx(file));
    const doc = await zip.file("word/document.xml")!.async("string");
    expect(doc).toContain("Keep &lt;this&gt;");
    expect(doc).toContain("<w:b");
    expect(doc).toContain("<w:tbl>");
    expect(doc).toContain("<w:pageBreakBefore");
    expect(doc).toContain('w:w="16838"');
    expect(doc).toContain('w:top="720"');
    expect(await zip.file("word/header1.xml")!.async("string")).toContain(
      "Confidential &amp; internal",
    );
    expect(await zip.file("word/footer1.xml")!.async("string")).toContain(
      "NUMPAGES",
    );
    expect(parseFile(serializeFile(file)).content).toEqual(file.content);
  });
  it("exports all sheets with formulas, cached values, styles, notes, validation and conditional rules", async () => {
    const file = createFile("sheet", "Budget");
    if (file.kind !== "sheet") throw new Error();
    const id = file.content.workbook.sheetOrder[0];
    const sheet = file.content.workbook.sheets[id];
    sheet.cellData = {
      0: {
        0: { v: "Amount" },
        1: {
          v: 12,
          s: {
            bl: 1,
            bg: { rgb: "#ff0000" },
            n: { pattern: "$#,##0.00" },
            tb: 3,
          },
        },
      },
      1: { 1: { f: "=B1*2", v: 24 } },
    };
    sheet.mergeData = [
      { startRow: 2, endRow: 2, startColumn: 0, endColumn: 1 },
    ];
    sheet.cellData[0][2] = { v: "00123", t: 4, s: { bg: { rgb: "#fff" } } };
    sheet.cellData[1][2] = { f: "=1/0", v: "#DIV/0!" };
    sheet.tabColor = "#00ff00";
    sheet.rowData = { 0: { h: 32 } };
    sheet.columnData = { 0: { w: 120 } };
    file.content.workbook.sheetOrder.push("hidden");
    file.content.workbook.sheets.hidden = {
      id: "hidden",
      name: "Hidden",
      hidden: 1,
      rowCount: 100,
      columnCount: 26,
      cellData: { 0: { 0: { v: true } } },
    };
    file.content.workbook.resources = [
      {
        name: "SHEET_NOTE_PLUGIN",
        data: JSON.stringify({
          [id]: { 1: { 1: { note: "Check & verify" } } },
        }),
      },
      {
        name: "SHEET_DATA_VALIDATION_PLUGIN",
        data: JSON.stringify({
          [id]: [
            {
              uid: "dv",
              type: "decimal",
              operator: "between",
              formula1: "0",
              formula2: "100",
              ranges: [
                { startRow: 1, endRow: 10, startColumn: 1, endColumn: 1 },
              ],
            },
          ],
        }),
      },
      {
        name: "SHEET_CONDITIONAL_FORMATTING_PLUGIN",
        data: JSON.stringify({
          [id]: [
            {
              cfId: "cf",
              ranges: [
                { startRow: 1, endRow: 10, startColumn: 1, endColumn: 1 },
              ],
              rule: {
                type: "highlightCell",
                subType: "number",
                operator: "greaterThan",
                value: 20,
                style: { bg: { rgb: "#00ff00" } },
              },
            },
          ],
        }),
      },
    ];
    file.content.charts = [
      {
        id: "chart",
        title: "Budget totals",
        type: "bar",
        sheetId: id,
        source: {
          sheetId: id,
          startRow: 0,
          endRow: 1,
          startColumn: 0,
          endColumn: 1,
        },
        x: 20,
        y: 100,
        width: 500,
        height: 300,
      },
    ];
    file.content.images = [
      {
        id: "image",
        sheetId: id,
        src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
        row: 4,
        column: 2,
        offsetX: 0,
        offsetY: 0,
        width: 32,
        height: 32,
        anchorType: "2",
      },
    ];
    const bytes = await exportXlsx(file);
    const wb = XLSX.read(bytes, { type: "array", cellStyles: true });
    expect(wb.SheetNames).toHaveLength(2);
    const exported = wb.Sheets[wb.SheetNames[0]];
    expect(exported.B2.f).toBe("B1*2");
    expect(exported.B2.v).toBe(24);
    expect(exported.C1.v).toBe("00123");
    expect(exported.C1.t).toBe("s");
    expect(exported.C2.t).toBe("e");
    expect(exported.B1.z).toBe("$#,##0.00");
    expect(exported.B2.c?.[0].t).toBe("Check & verify");
    expect(wb.Workbook?.Sheets?.[1].Hidden).toBe(1);
    expect(exported["!merges"]).toHaveLength(1);
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    expect(xml).toContain('sqref="B2:B11"');
    expect(xml).toContain("<formula1>0</formula1>");
    expect(xml).toContain('type="cellIs"');
    expect(xml).toContain('<tabColor rgb="FF00FF00"');
    expect(await zip.file("xl/styles.xml")!.async("string")).toContain(
      '<fgColor rgb="FFFFFFFF"/>',
    );
    expect(zip.file("xl/charts/chart1.xml")).not.toBeNull();
    expect(zip.file("xl/media/image1.png")).not.toBeNull();
    const imported = await importOffice(bytes, "xlsx", "budget.xlsx");
    if (imported.file.kind !== "sheet") throw new Error();
    const resources = imported.file.content.workbook.resources as {
      name: string;
      data: string;
    }[];
    expect(
      resources.find((r) => r.name === "SHEET_DATA_VALIDATION_PLUGIN")?.data,
    ).toContain('"formula2":"100"');
    expect(
      resources.find((r) => r.name === "SHEET_CONDITIONAL_FORMATTING_PLUGIN")
        ?.data,
    ).toContain('"greaterThan"');
    expect(
      resources.find((r) => r.name === "SHEET_NOTE_PLUGIN")?.data,
    ).toContain("Check & verify");
    expect(imported.file.content.charts).toHaveLength(1);
    expect(imported.file.content.images).toHaveLength(1);
  });
});
