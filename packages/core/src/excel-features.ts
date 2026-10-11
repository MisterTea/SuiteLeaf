import type JSZip from "jszip";
import * as XLSX from "xlsx";
import { parseRange, type SheetFile } from "./index";
import { array, parseXml } from "./office";
type Data = Record<string, any>;
const segment = (text: string, tag: string) =>
  text.match(new RegExp(`<${tag}\\b[^>]*(?:/>|>[\\s\\S]*?</${tag}>)`))?.[0];
const flag = (value: unknown) => value === "1" || value === "true";
const color = (node: Data | undefined) =>
  node?.["@_rgb"] ? `#${String(node["@_rgb"]).slice(-6)}` : undefined;
function differentialStyle(d: Data = {}) {
  const style: Data = {};
  if (d.font) {
    if (d.font.b !== undefined) style.bl = 1;
    if (d.font.i !== undefined) style.it = 1;
    if (d.font.u !== undefined) style.ul = { s: 1 };
    if (d.font.strike !== undefined) style.st = { s: 1 };
    if (color(d.font.color)) style.cl = { rgb: color(d.font.color) };
  }
  if (color(d.fill?.patternFill?.fgColor))
    style.bg = { rgb: color(d.fill.patternFill.fgColor) };
  return style;
}
function cfRule(r: Data, style: Data, cell: string): Data | undefined {
  const f = array<any>(r.formula).map(String),
    type = r["@_type"];
  const base = { type: "highlightCell", style };
  if (type === "cellIs") {
    if (f.some((v) => !Number.isFinite(Number(v)))) {
      const operator = r["@_operator"] || "equal";
      const operators: Data = {
        equal: "=",
        notEqual: "<>",
        greaterThan: ">",
        greaterThanOrEqual: ">=",
        lessThan: "<",
        lessThanOrEqual: "<=",
      };
      const value =
        operator === "between"
          ? `AND(${cell}>=${f[0]},${cell}<=${f[1]})`
          : operator === "notBetween"
            ? `OR(${cell}<${f[0]},${cell}>${f[1]})`
            : `${cell}${operators[operator] || "="}${f[0]}`;
      return { ...base, subType: "formula", value: `=${value}` };
    }
    return {
      ...base,
      subType: "number",
      operator: r["@_operator"] || "equal",
      value: f.length > 1 ? f.map(Number) : Number(f[0]),
    };
  }
  if (type === "expression")
    return { ...base, subType: "formula", value: `=${f[0] || "FALSE"}` };
  if (type === "duplicateValues" || type === "uniqueValues")
    return { ...base, subType: type };
  if (
    [
      "containsText",
      "notContainsText",
      "beginsWith",
      "endsWith",
      "containsBlanks",
      "notContainsBlanks",
      "containsErrors",
      "notContainsErrors",
    ].includes(type)
  )
    return { ...base, subType: "text", operator: type, value: r["@_text"] };
  if (type === "timePeriod")
    return { ...base, subType: "timePeriod", operator: r["@_timePeriod"] };
  if (type === "top10")
    return {
      ...base,
      subType: "rank",
      isBottom: flag(r["@_bottom"]),
      isPercent: flag(r["@_percent"]),
      value: +r["@_rank"] || 10,
    };
  if (type === "aboveAverage")
    return {
      ...base,
      subType: "average",
      operator: `${r["@_aboveAverage"] === "0" ? "less" : "greater"}Than${flag(r["@_equalAverage"]) ? "OrEqual" : ""}`,
    };
  const valueConfig = (v: Data) => ({
    type: v["@_type"],
    value: v["@_type"] === "formula" ? v["@_val"] : Number(v["@_val"]) || 0,
  });
  if (type === "colorScale") {
    const c = r.colorScale,
      colors = array<Data>(c.color);
    return {
      type,
      config: array<Data>(c.cfvo).map((v, i) => ({
        index: i,
        value: valueConfig(v),
        color: color(colors[i]) ?? "#ffffff",
      })),
    };
  }
  if (type === "dataBar") {
    const c = r.dataBar,
      values = array<Data>(c.cfvo);
    return {
      type,
      isShowValue: c["@_showValue"] !== "0",
      config: {
        min: valueConfig(values[0]),
        max: valueConfig(values[1]),
        positiveColor: color(c.color) ?? "#4285f4",
        nativeColor: "#ea4335",
        isGradient: true,
      },
    };
  }
  if (type === "iconSet") {
    const c = r.iconSet;
    return {
      type,
      isShowValue: c["@_showValue"] !== "0",
      config: array<Data>(c.cfvo).map((v, i) => ({
        operator: v["@_gte"] === "0" ? "greaterThan" : "greaterThanOrEqual",
        value: valueConfig(v),
        iconType: c["@_iconSet"] || "3TrafficLights1",
        iconId: String(i),
      })),
    };
  }
}
/** Translate Office rules into the same plugin resources used by the live editor. */
export async function importExcelFeatures(
  file: SheetFile,
  zip: JSZip,
  sources: Map<string, string>,
  book: XLSX.WorkBook,
  warnings: string[],
) {
  const validations: Data = {},
    conditionals: Data = {},
    notes: Data = {};
  const stylesPart = (await zip.file("xl/styles.xml")?.async("string")) ?? "";
  const differential = array<Data>(
    parseXml(segment(stylesPart, "dxfs") || "<dxfs/>", "styles").dxfs?.dxf,
  );
  const ranges = (value: string, id: string) =>
    value
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((v) => {
        const range = parseRange(v, id);
        return {
          startRow: range.startRow,
          endRow: range.endRow,
          startColumn: range.startColumn,
          endColumn: range.endColumn,
        };
      });
  let unsupported = 0;
  for (const [id, path] of sources) {
    const sheet = file.content.workbook.sheets[id],
      source = book.Sheets[sheet.name];
    const text = await zip.file(path)!.async("string");
    const colorPart = segment(text, "tabColor");
    if (colorPart) sheet.tabColor = color(parseXml(colorPart, path).tabColor);
    if (segment(text, "sheetProtection"))
      sheet.custom = {
        ...(sheet.custom as Data),
        suiteleafProtection: { sheet: true },
      };
    const dvPart = segment(text, "dataValidations");
    if (dvPart)
      for (const rule of array<Data>(
        parseXml(dvPart, path).dataValidations?.dataValidation,
      )) {
        const dv: Data = {
          uid: crypto.randomUUID(),
          type: rule["@_type"],
          operator: rule["@_operator"] ?? "between",
          formula1: String(rule.formula1 ?? ""),
          formula2:
            rule.formula2 === undefined ? undefined : String(rule.formula2),
          ranges: ranges(rule["@_sqref"] || "", id),
        };
        for (const key of [
          "allowBlank",
          "showErrorMessage",
          "showInputMessage",
        ])
          dv[key] = flag(rule[`@_${key}`]);
        for (const key of [
          "error",
          "errorTitle",
          "errorStyle",
          "prompt",
          "promptTitle",
        ])
          if (rule[`@_${key}`] !== undefined) dv[key] = rule[`@_${key}`];
        if (dv.type === "list")
          dv.formula1 = dv.formula1.startsWith('"')
            ? dv.formula1.slice(1, -1).replace(/""/g, '"')
            : `=${dv.formula1.replace(/^=/, "")}`;
        (validations[id] ??= []).push(dv);
      }
    for (const match of text.matchAll(
      /<conditionalFormatting\b[^>]*>[\s\S]*?<\/conditionalFormatting>/g,
    )) {
      const cf = parseXml(match[0], path).conditionalFormatting;
      for (const rule of array<Data>(cf.cfRule)) {
        const converted = cfRule(
          rule,
          differentialStyle(differential[+rule["@_dxfId"]]),
          String(cf["@_sqref"]).split(/[ :]/)[0],
        );
        if (!converted) {
          unsupported++;
          continue;
        }
        (conditionals[id] ??= []).push({
          cfId: crypto.randomUUID(),
          ranges: ranges(cf["@_sqref"], id),
          stopIfTrue: flag(rule["@_stopIfTrue"]),
          rule: converted,
        });
      }
    }
    for (const [ref, cell] of Object.entries(source ?? {})) {
      if (ref.startsWith("!") || !(cell as XLSX.CellObject).c?.length) continue;
      const { r, c } = XLSX.utils.decode_cell(ref);
      notes[id] ??= {};
      notes[id][r] ??= {};
      notes[id][r][c] = {
        id: crypto.randomUUID(),
        row: r,
        col: c,
        width: 240,
        height: 120,
        note: (cell as XLSX.CellObject)
          .c!.map((c) => `${c.a ? `${c.a}: ` : ""}${c.t}`)
          .join("\n"),
      };
    }
  }
  const resources =
    (file.content.workbook.resources as
      { name: string; data: string }[] | undefined) ?? [];
  for (const [name, data] of Object.entries({
    SHEET_DATA_VALIDATION_PLUGIN: validations,
    SHEET_CONDITIONAL_FORMATTING_PLUGIN: conditionals,
    SHEET_NOTE_PLUGIN: notes,
  }))
    if (Object.keys(data).length)
      resources.push({ name, data: JSON.stringify(data) });
  file.content.workbook.resources = resources;
  if (unsupported)
    warnings.push(
      `${unsupported} conditional formatting rules use unsupported Office extensions and were omitted.`,
    );
}
