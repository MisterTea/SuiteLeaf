import JSZip from "jszip";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { createFile, type SheetFile } from "../packages/core/src";
import { importExcelFeatures } from "../packages/core/src/excel-features";

const styles = `<styleSheet><dxfs count="2">
<dxf><font><b/><i/><u/><strike/><color rgb="FFFF0000"/></font><fill><patternFill><fgColor rgb="FF00FF00"/></patternFill></fill></dxf>
<dxf><font/></dxf>
</dxfs></styleSheet>`;

async function importRules(rules: string, extra = "") {
  const file = createFile("sheet", "Book") as SheetFile;
  const id = file.content.workbook.sheetOrder[0];
  const name = file.content.workbook.sheets[id].name;
  const zip = new JSZip();
  zip.file("xl/styles.xml", styles);
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<worksheet>${extra}<conditionalFormatting sqref="B2:B5 D1">${rules}</conditionalFormatting></worksheet>`,
  );
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["a"]]), name);
  const warnings: string[] = [];
  await importExcelFeatures(file, zip, new Map([[id, "xl/worksheets/sheet1.xml"]]), book, warnings);
  const resource = file.content.workbook.resources?.find((r) => r.name === "SHEET_CONDITIONAL_FORMATTING_PLUGIN");
  const rows = resource ? (JSON.parse(resource.data)[id] as { rule: Record<string, unknown>; ranges: unknown[]; stopIfTrue: boolean }[]) : [];
  return { rules: rows.map((row) => row.rule), rows, warnings, sheet: file.content.workbook.sheets[id] };
}

describe("Excel conditional formatting import", () => {
  it("turns cell comparisons with text into formulas and keeps number comparisons", async () => {
    const { rules, rows } = await importRules(`
      <cfRule type="cellIs" dxfId="0" operator="between" stopIfTrue="1"><formula>"a"</formula><formula>"c"</formula></cfRule>
      <cfRule type="cellIs" dxfId="1" operator="notBetween"><formula>"a"</formula><formula>"c"</formula></cfRule>
      <cfRule type="cellIs" operator="notEqual"><formula>"x"</formula></cfRule>
      <cfRule type="cellIs" operator="weird"><formula>"x"</formula></cfRule>
      <cfRule type="cellIs"><formula>"x"</formula></cfRule>
      <cfRule type="cellIs" operator="between"><formula>1</formula><formula>5</formula></cfRule>
      <cfRule type="cellIs"><formula>3</formula></cfRule>`);
    expect(rules[0]).toEqual({
      type: "highlightCell",
      style: { bl: 1, it: 1, ul: { s: 1 }, st: { s: 1 }, cl: { rgb: "#FF0000" }, bg: { rgb: "#00FF00" } },
      subType: "formula",
      value: '=AND(B2>="a",B2<="c")',
    });
    expect(rows[0].stopIfTrue).toBe(true);
    expect(rows[0].ranges).toEqual([
      { startRow: 1, endRow: 4, startColumn: 1, endColumn: 1 },
      { startRow: 0, endRow: 0, startColumn: 3, endColumn: 3 },
    ]);
    expect(rules.slice(1, 5).map((r) => r.value)).toEqual([
      '=OR(B2<"a",B2>"c")',
      '=B2<>"x"',
      '=B2="x"',
      '=B2="x"',
    ]);
    expect(rules[1].style).toEqual({});
    expect(rules[5]).toMatchObject({ subType: "number", operator: "between", value: [1, 5] });
    expect(rules[6]).toMatchObject({ subType: "number", operator: "equal", value: 3 });
  });

  it("reads expression, duplicate, text, time, rank, and average rules", async () => {
    const { rules } = await importRules(`
      <cfRule type="expression"><formula>$A1&gt;0</formula></cfRule>
      <cfRule type="expression"></cfRule>
      <cfRule type="duplicateValues"/>
      <cfRule type="uniqueValues"/>
      <cfRule type="containsText" text="tea"/>
      <cfRule type="notContainsBlanks"/>
      <cfRule type="timePeriod" timePeriod="lastWeek"/>
      <cfRule type="top10" rank="3" bottom="1" percent="true"/>
      <cfRule type="top10"/>
      <cfRule type="aboveAverage" aboveAverage="0" equalAverage="1"/>
      <cfRule type="aboveAverage"/>`);
    const withoutStyle = rules.map((rule) => {
      const copy = { ...rule };
      delete copy.style;
      return copy;
    });
    expect(withoutStyle).toEqual([
      { type: "highlightCell", subType: "formula", value: "=$A1>0" },
      { type: "highlightCell", subType: "formula", value: "=FALSE" },
      { type: "highlightCell", subType: "duplicateValues" },
      { type: "highlightCell", subType: "uniqueValues" },
      { type: "highlightCell", subType: "text", operator: "containsText", value: "tea" },
      { type: "highlightCell", subType: "text", operator: "notContainsBlanks" },
      { type: "highlightCell", subType: "timePeriod", operator: "lastWeek" },
      { type: "highlightCell", subType: "rank", isBottom: true, isPercent: true, value: 3 },
      { type: "highlightCell", subType: "rank", isBottom: false, isPercent: false, value: 10 },
      { type: "highlightCell", subType: "average", operator: "lessThanOrEqual" },
      { type: "highlightCell", subType: "average", operator: "greaterThan" },
    ]);
  });

  it("reads color scales, data bars, and icon sets", async () => {
    const { rules } = await importRules(`
      <cfRule type="colorScale"><colorScale><cfvo type="min"/><cfvo type="formula" val="$A$1"/><cfvo type="max"/><color rgb="FFF8696B"/><color rgb="FFFFEB84"/></colorScale></cfRule>
      <cfRule type="dataBar"><dataBar showValue="0"><cfvo type="num" val="2"/><cfvo type="max"/><color rgb="FF638EC6"/></dataBar></cfRule>
      <cfRule type="dataBar"><dataBar><cfvo type="min"/><cfvo type="max"/></dataBar></cfRule>
      <cfRule type="iconSet"><iconSet iconSet="3Arrows"><cfvo type="percent" val="0"/><cfvo type="percent" val="33" gte="0"/></iconSet></cfRule>
      <cfRule type="iconSet"><iconSet showValue="0"><cfvo type="num" val="x"/></iconSet></cfRule>`);
    expect(rules[0]).toEqual({
      type: "colorScale",
      config: [
        { index: 0, value: { type: "min", value: 0 }, color: "#F8696B" },
        { index: 1, value: { type: "formula", value: "$A$1" }, color: "#FFEB84" },
        { index: 2, value: { type: "max", value: 0 }, color: "#ffffff" },
      ],
    });
    expect(rules[1]).toMatchObject({
      type: "dataBar",
      isShowValue: false,
      config: { min: { type: "num", value: 2 }, positiveColor: "#638EC6", isGradient: true },
    });
    expect(rules[2]).toMatchObject({ isShowValue: true, config: { positiveColor: "#4285f4" } });
    expect(rules[3]).toEqual({
      type: "iconSet",
      isShowValue: true,
      config: [
        { operator: "greaterThanOrEqual", value: { type: "percent", value: 0 }, iconType: "3Arrows", iconId: "0" },
        { operator: "greaterThan", value: { type: "percent", value: 33 }, iconType: "3Arrows", iconId: "1" },
      ],
    });
    expect(rules[4]).toMatchObject({
      isShowValue: false,
      config: [{ iconType: "3TrafficLights1", value: { type: "num", value: 0 } }],
    });
  });

  it("counts rules it cannot translate and reads the tab color and protection", async () => {
    const { rules, warnings, sheet } = await importRules(
      `<cfRule type="x14:extension"/><cfRule type="duplicateValues"/>`,
      `<sheetPr><tabColor rgb="FF123456"/></sheetPr><sheetProtection sheet="1"/>`,
    );
    expect(rules).toHaveLength(1);
    expect(warnings).toEqual([
      "1 conditional formatting rules use unsupported Office extensions and were omitted.",
    ]);
    expect(sheet.tabColor).toBe("#123456");
    expect(sheet.custom).toMatchObject({ suiteleafProtection: { sheet: true } });
  });
});
