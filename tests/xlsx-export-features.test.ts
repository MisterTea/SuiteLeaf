import JSZip from "jszip";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { createFile, type SheetFile } from "../packages/core/src";
import { exportXlsx } from "../packages/core/src/xlsx-export";

function workbook(resources: Record<string, unknown>, cells: Record<number, Record<number, unknown>> = {}) {
  const file = createFile("sheet", "Book") as SheetFile;
  const id = file.content.workbook.sheetOrder[0];
  file.content.workbook.sheets[id].cellData = cells as never;
  file.content.workbook.resources = Object.entries(resources).map(([name, data]) => ({
    name,
    data: JSON.stringify({ [id]: data }),
  }));
  return { file, id };
}

async function exported(file: SheetFile) {
  const bytes = await exportXlsx(file);
  const zip = await JSZip.loadAsync(bytes);
  return {
    sheet: await zip.file("xl/worksheets/sheet1.xml")!.async("string"),
    styles: await zip.file("xl/styles.xml")!.async("string"),
    book: XLSX.read(bytes, { type: "array" }),
  };
}

const range = { startRow: 1, endRow: 3, startColumn: 1, endColumn: 1 };
const highlight = (rule: Record<string, unknown>, stopIfTrue = false) => ({
  ranges: [range],
  stopIfTrue,
  rule: { type: "highlightCell", style: { bl: 1, bg: { rgb: "#ff0000" } }, ...rule },
});

describe("XLSX conditional formatting export", () => {
  it("writes each highlight rule as the matching Excel rule", async () => {
    const { file } = workbook({
      SHEET_CONDITIONAL_FORMATTING_PLUGIN: [
        highlight({ subType: "number", operator: "between", value: [1, 5] }, true),
        highlight({ subType: "number", operator: "greaterThan", value: 3 }),
        highlight({ subType: "formula", value: "=$A1>0" }),
        highlight({ subType: "duplicateValues" }),
        highlight({ subType: "rank", value: 3, isBottom: true, isPercent: false }),
        highlight({ subType: "average", operator: "lessThanOrEqual" }),
        highlight({ subType: "average", operator: "greaterThan" }),
        highlight({ subType: "timePeriod", operator: "lastWeek" }),
      ],
    });
    const { sheet, styles } = await exported(file);
    expect(sheet).toContain(
      '<conditionalFormatting sqref="B2:B4"><cfRule stopIfTrue="1" type="cellIs" dxfId="0" priority="1" operator="between"><formula>1</formula><formula>5</formula></cfRule></conditionalFormatting>',
    );
    expect(sheet).toContain('operator="greaterThan"><formula>3</formula></cfRule>');
    expect(sheet).toContain('type="expression" dxfId="2" priority="3"><formula>$A1&gt;0</formula>');
    expect(sheet).toContain('<cfRule stopIfTrue="0" type="duplicateValues" dxfId="3" priority="4"/>');
    expect(sheet).toContain('type="top10" dxfId="4" priority="5" rank="3" bottom="1" percent="0"/>');
    expect(sheet).toContain('aboveAverage="0" equalAverage="1"/>');
    expect(sheet).toContain('aboveAverage="1" equalAverage="0"/>');
    expect(sheet).toContain('type="timePeriod" timePeriod="lastWeek"');
    expect(styles).toContain('<dxfs count="8"><dxf><font><sz val="11"/>');
    expect(styles).toContain('<fgColor rgb="FFFF0000"/>');
  });

  it("writes text rules as formulas on the first cell", async () => {
    const operators = [
      "containsText",
      "notContainsText",
      "beginsWith",
      "endsWith",
      "equal",
      "notEqual",
      "containsBlanks",
      "notContainsBlanks",
      "containsErrors",
      "notContainsErrors",
    ];
    const { file } = workbook({
      SHEET_CONDITIONAL_FORMATTING_PLUGIN: operators.map((operator) =>
        highlight({ subType: "text", operator, value: 'say "hi"' }),
      ),
    });
    const formulas = [...(await exported(file)).sheet.matchAll(/<formula>([^<]*)<\/formula>/g)].map((m) =>
      m[1].replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">"),
    );
    expect(formulas).toEqual([
      'NOT(ISERROR(SEARCH("say ""hi""",B2)))',
      'ISERROR(SEARCH("say ""hi""",B2))',
      'LEFT(B2,LEN("say ""hi"""))="say ""hi"""',
      'RIGHT(B2,LEN("say ""hi"""))="say ""hi"""',
      'B2="say ""hi"""',
      'B2<>"say ""hi"""',
      "LEN(TRIM(B2))=0",
      "LEN(TRIM(B2))>0",
      "ISERROR(B2)",
      "NOT(ISERROR(B2))",
    ]);
  });

  it("writes color scales, data bars, and icon sets, and skips unknown rules", async () => {
    const { file } = workbook({
      SHEET_CONDITIONAL_FORMATTING_PLUGIN: [
        {
          ranges: [range],
          rule: {
            type: "colorScale",
            config: [
              { index: 0, value: { type: "min" }, color: "#fff" },
              { index: 1, value: { type: "percentile", value: 50 }, color: "rgb(10, 20, 300)" },
              { index: 2, color: "teal" },
            ],
          },
        },
        {
          ranges: [range],
          rule: { type: "dataBar", isShowValue: true, config: { min: { type: "num", value: 1 }, positiveColor: "#00ff00" } },
        },
        { ranges: [range], rule: { type: "dataBar" } },
        {
          ranges: [range],
          rule: {
            type: "iconSet",
            isShowValue: false,
            config: [
              { operator: "greaterThanOrEqual", value: { type: "percent", value: 0 }, iconType: "3Flags" },
              { operator: "greaterThan", value: { type: "num", value: 5 } },
            ],
          },
        },
        { ranges: [range], rule: { type: "iconSet" } },
        { ranges: [range], rule: { type: "somethingNew" } },
        highlight({ subType: "unknown" }),
      ],
    });
    const { sheet } = await exported(file);
    expect(sheet).toContain(
      '<colorScale><cfvo type="min" val="0"/><cfvo type="percentile" val="50"/><cfvo type="percentile" val="0"/><color rgb="FFFFFFFF"/><color rgb="FF0A14FF"/><color rgb="FF000000"/></colorScale>',
    );
    expect(sheet).toContain(
      '<dataBar showValue="1"><cfvo type="num" val="1"/><cfvo type="max" val="0"/><color rgb="FF00FF00"/></dataBar>',
    );
    expect(sheet).toContain('<dataBar showValue="0"><cfvo type="min" val="0"/><cfvo type="max" val="0"/>');
    expect(sheet).toContain(
      '<iconSet iconSet="3Flags" showValue="0"><cfvo type="percent" val="0" gte="1"/><cfvo type="num" val="5" gte="0"/></iconSet>',
    );
    expect(sheet).toContain('<iconSet iconSet="3Arrows" showValue="0"></iconSet>');
    expect(sheet.match(/<conditionalFormatting /g)).toHaveLength(5);
  });
});

describe("XLSX protection and comments export", () => {
  it("locks only the protected range and fills its empty cells", async () => {
    const { file } = workbook(
      { SHEET_RANGE_PROTECTION_PLUGIN: [{ ranges: [{ startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 }] }] },
      { 0: { 0: { v: "locked" }, 2: { v: "open" } } },
    );
    const { sheet, styles, book } = await exported(file);
    expect(sheet).toContain('<sheetProtection sheet="1" objects="1" scenarios="1"/>');
    const ws = book.Sheets[book.SheetNames[0]];
    expect(ws.A2).toBeDefined();
    const styleOf = (ref: string) => Number(new RegExp(`<c r="${ref}"[^>]* s="(\\d+)"`).exec(sheet)![1]);
    const xfs = [...styles.matchAll(/<xf numFmtId="\d+"[^>]*>[\s\S]*?<\/xf>/g)].map((m) => m[0]);
    expect(xfs[styleOf("A1")]).toContain('<protection locked="1"/>');
    expect(xfs[styleOf("C1")]).toContain('<protection locked="0"/>');
  });

  it("refuses to export protection over more than a million cells", async () => {
    const { file } = workbook({
      SHEET_RANGE_PROTECTION_PLUGIN: [{ ranges: [{ startRow: 0, endRow: 1_000_000, startColumn: 0, endColumn: 1 }] }],
    });
    await expect(exportXlsx(file)).rejects.toThrow("Export protection for ranges with at most 1,000,000 cells.");
  });

  it("writes notes and comment threads as cell comments", async () => {
    const { file } = workbook(
      {
        SHEET_NOTE_PLUGIN: { 4: { 2: { note: "Check the total" } } },
        SHEET_UNIVER_THREAD_COMMENT_PLUGIN: [
          {
            ref: "B2",
            authorName: "Ann",
            text: { dataStream: "Is this right?\r\n" },
            resolved: true,
            children: [{ personId: "bob", text: { dataStream: "Yes" } }, {}],
          },
          { ref: "C5", text: { dataStream: "Second" } },
          { ref: "not a cell" },
        ],
      },
      { 1: { 1: { v: 2 } } },
    );
    const { book } = await exported(file);
    const ws = book.Sheets[book.SheetNames[0]];
    expect(ws.B2.c[0].t).toBe("[Resolved] Ann: Is this right?\nbob: Yes\nLocal user: ");
    expect(ws.C5.c.map((c: { t: string }) => c.t)).toEqual(["Check the total", "Local user: Second"]);
    expect(ws["!ref"]).toBe("A1:C5");
  });
});
