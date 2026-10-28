import * as XLSX from "xlsx";
import JSZip from "jszip";
import { addXlsxDrawings } from "./xlsx-drawings";
import { applyWorksheetOutline } from "./excel-outline";
import { excelErrorStyle } from "./excel-validation";
import { columnName, type SheetFile } from "./index";
import { cellHyperlink } from "./sheet-links";
import { officeFont } from "./office-fonts";

type Data = Record<string, any>;
const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
/**
 * SheetJS writes plain strings as formula-string cells and decodes `_xHHHH_`
 * twice when it reads them back. A shared string is decoded once, which keeps
 * letters that already spell an escape. `&` is escaped by that writer.
 */
const sheetJsText = (value: string) =>
  value.replace(/_x([0-9A-Fa-f]{4})_/g, "_x005F_x$1_");

/** Excel sheet tabs are at most 31 characters and cannot contain \ / ? * [ ] :. */
export function excelSheetAlias(name: string, used: Set<string>): string {
  const cleaned = name.replace(/[\u0000-\u001f[\]:*?/\\]/g, "").trim();
  const base = (cleaned || "Sheet").slice(0, 31);
  let alias = base;
  let n = 2;
  while (used.has(alias)) {
    const suffix = ` ${n}`;
    alias = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    n += 1;
  }
  used.add(alias);
  return alias;
}
const rgb = (v: unknown) =>
  /^#[\da-f]{3}$/i.test(String(v))
    ? `FF${String(v)
        .slice(1)
        .split("")
        .map((c) => c + c)
        .join("")
        .toUpperCase()}`
    : /^#[\da-f]{6}$/i.test(String(v))
      ? `FF${String(v).slice(1).toUpperCase()}`
      : /^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+/i.test(String(v))
        ? `FF${String(v)
            .match(/\d+/g)!
            .slice(0, 3)
            .map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0"))
            .join("")
            .toUpperCase()}`
        : "FF000000";
const rangeRef = (r: Data) =>
  `${columnName(r.startColumn)}${r.startRow + 1}:${columnName(r.endColumn)}${r.endRow + 1}`;
const xml = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body}`;
function resource(workbook: Data, name: string): Data {
  const item = workbook.resources?.find((r: Data) => r.name === name);
  if (!item?.data) return {};
  return JSON.parse(item.data);
}
/** Imported sheets write back the workbook's stored Excel character widths;
 * columns resized in SuiteLeaf use the pixels per character from import. */
function excelWidths(s: Data) {
  const layout = s.custom?.excelLayout;
  const unit = Number(layout?.characterPixels);
  if (!(unit > 0)) return undefined;
  const stored = new Map<number, number>();
  for (const [c, px] of Object.entries(layout.columnPixels ?? {}))
    if (Number.isFinite(layout.columnWidths?.[c]))
      stored.set(Number(px), layout.columnWidths[c]);
  const chars = (px: number, column?: number) => {
    if (
      column !== undefined &&
      layout.columnPixels?.[column] === px &&
      Number.isFinite(layout.columnWidths?.[column])
    )
      return layout.columnWidths[column];
    return stored.get(px) ?? Math.round((px / unit) * 256) / 256;
  };
  const defaultPixels = Number(s.defaultColumnWidth);
  return {
    chars,
    base: Number(layout.baseColumnWidthChars) || 8,
    default:
      !(defaultPixels > 0) || defaultPixels === layout.defaultColumnPixels
        ? layout.defaultColumnWidthChars
        : chars(defaultPixels),
  };
}
function font(s: Data) {
  return `<font><sz val="${Number(s.fs) || 11}"/><name val="${esc(officeFont(s.ff || "Arial"))}"/>${s.bl ? "<b/>" : ""}${s.it ? "<i/>" : ""}${s.ul?.s ? "<u/>" : ""}${s.st?.s ? "<strike/>" : ""}${s.cl ? `<color rgb="${rgb(s.cl.rgb)}"/>` : ""}</font>`;
}
function fill(s: Data) {
  return `<fill><patternFill patternType="${s.bg ? "solid" : "none"}">${s.bg ? `<fgColor rgb="${rgb(s.bg.rgb)}"/><bgColor indexed="64"/>` : ""}</patternFill></fill>`;
}
function border(s: Data) {
  const styles = [
    "",
    "thin",
    "hair",
    "dotted",
    "dashed",
    "dashDot",
    "dashDotDot",
    "double",
    "medium",
    "mediumDashed",
    "mediumDashDot",
    "mediumDashDotDot",
    "slantDashDot",
    "thick",
  ];
  return `<border>${["left", "right", "top", "bottom"]
    .map((name, i) => {
      const b = s.bd?.[["l", "r", "t", "b"][i]];
      return `<${name}${b ? ` style="${styles[b.s] || "thin"}"` : ""}>${b ? `<color rgb="${rgb(b.cl?.rgb)}"/>` : ""}</${name}>`;
    })
    .join("")}</border>`;
}
function dxf(s: Data) {
  return `<dxf>${font(s)}${fill(s)}${border(s)}</dxf>`;
}
function validation(rule: Data): string {
  const types: Data = {
    decimal: "decimal",
    whole: "whole",
    textLength: "textLength",
    date: "date",
    time: "time",
    list: "list",
    listMultiple: "list",
    custom: "custom",
    checkbox: "list",
  };
  const type = types[rule.type];
  if (!type) return "";
  let f1 = rule.formula1 ?? "";
  const f2 = rule.formula2;
  if (
    type === "list" &&
    !String(f1).startsWith("=") &&
    String(f1).startsWith("[")
  ) {
    try {
      const options = JSON.parse(f1);
      if (Array.isArray(options)) f1 = options.map(String).join(",");
    } catch {
      /* Older snapshots use comma-separated options. */
    }
  }
  if (type === "list" && !String(f1).startsWith("="))
    f1 = `"${rule.type === "checkbox" ? (f1 || f2 ? `${f1 || "TRUE"},${f2 || "FALSE"}` : "1,0") : String(f1).replace(/^"|"$/g, "").replace(/"/g, '""')}"`;
  return `<dataValidation type="${type}" sqref="${esc((rule.ranges ?? []).map(rangeRef).join(" "))}" allowBlank="${rule.allowBlank ? 1 : 0}" showErrorMessage="${rule.showErrorMessage ? 1 : 0}" errorStyle="${esc(excelErrorStyle(rule.errorStyle))}"${rule.operator && type !== "list" ? ` operator="${esc(rule.operator)}"` : ""} error="${esc(rule.error)}" errorTitle="${esc(rule.errorTitle)}"><formula1>${esc(String(f1).replace(/^=/, ""))}</formula1>${f2 && type !== "list" ? `<formula2>${esc(f2)}</formula2>` : ""}</dataValidation>`;
}
function conditional(rule: Data, priority: number, dxfs: string[]): string {
  const r = rule.rule ?? rule;
  let body = "";
  if (r.type === "highlightCell") {
    const id = dxfs.push(dxf(r.style ?? {})) - 1;
    const kind = r.subType;
    if (kind === "number")
      body = `<cfRule type="cellIs" dxfId="${id}" priority="${priority}" operator="${esc(r.operator)}"><formula>${esc(Array.isArray(r.value) ? r.value[0] : r.value)}</formula>${Array.isArray(r.value) ? `<formula>${esc(r.value[1])}</formula>` : ""}</cfRule>`;
    else if (kind === "formula")
      body = `<cfRule type="expression" dxfId="${id}" priority="${priority}"><formula>${esc(String(r.value).replace(/^=/, ""))}</formula></cfRule>`;
    else if (kind === "uniqueValues" || kind === "duplicateValues")
      body = `<cfRule type="${kind}" dxfId="${id}" priority="${priority}"/>`;
    else if (kind === "rank")
      body = `<cfRule type="top10" dxfId="${id}" priority="${priority}" rank="${r.value}" bottom="${r.isBottom ? 1 : 0}" percent="${r.isPercent ? 1 : 0}"/>`;
    else if (kind === "average")
      body = `<cfRule type="aboveAverage" dxfId="${id}" priority="${priority}" aboveAverage="${String(r.operator).startsWith("less") ? 0 : 1}" equalAverage="${String(r.operator).endsWith("OrEqual") ? 1 : 0}"/>`;
    else if (kind === "timePeriod")
      body = `<cfRule type="timePeriod" timePeriod="${esc(r.operator)}" dxfId="${id}" priority="${priority}"/>`;
    else if (kind === "text") {
      const cell = rangeRef(rule.ranges[0]).split(":")[0];
      const text = String(r.value).replace(/"/g, '""');
      const blanks: Data = {
        containsBlanks: `LEN(TRIM(${cell}))=0`,
        notContainsBlanks: `LEN(TRIM(${cell}))>0`,
        containsErrors: `ISERROR(${cell})`,
        notContainsErrors: `NOT(ISERROR(${cell}))`,
      };
      const formula =
        blanks[r.operator] ??
        (r.operator === "beginsWith"
          ? `LEFT(${cell},LEN("${text}"))="${text}"`
          : r.operator === "endsWith"
            ? `RIGHT(${cell},LEN("${text}"))="${text}"`
            : r.operator === "equal" || r.operator === "notEqual"
              ? `${cell}${r.operator === "notEqual" ? "<>" : "="}"${text}"`
              : `${r.operator === "notContainsText" ? "ISERROR" : "NOT(ISERROR"}(SEARCH("${text}",${cell}))${r.operator === "notContainsText" ? "" : ")"}`);
      body = `<cfRule type="expression" dxfId="${id}" priority="${priority}"><formula>${esc(formula)}</formula></cfRule>`;
    }
  } else if (r.type === "colorScale")
    body = `<cfRule type="colorScale" priority="${priority}"><colorScale>${(r.config ?? []).map((c: Data) => `<cfvo type="${c.value?.type || "percentile"}" val="${esc(c.value?.value ?? 0)}"/>`).join("")}${(r.config ?? []).map((c: Data) => `<color rgb="${rgb(c.color)}"/>`).join("")}</colorScale></cfRule>`;
  else if (r.type === "dataBar")
    body = `<cfRule type="dataBar" priority="${priority}"><dataBar showValue="${r.isShowValue ? 1 : 0}"><cfvo type="${esc(r.config?.min?.type || "min")}" val="${esc(r.config?.min?.value ?? 0)}"/><cfvo type="${esc(r.config?.max?.type || "max")}" val="${esc(r.config?.max?.value ?? 0)}"/><color rgb="${rgb(r.config?.positiveColor)}"/></dataBar></cfRule>`;
  else if (r.type === "iconSet")
    body = `<cfRule type="iconSet" priority="${priority}"><iconSet iconSet="${esc(r.config?.[0]?.iconType || "3Arrows")}" showValue="${r.isShowValue ? 1 : 0}">${(r.config ?? []).map((c: Data) => `<cfvo type="${esc(c.value?.type || "percent")}" val="${esc(c.value?.value ?? 0)}" gte="${c.operator === "greaterThan" ? 0 : 1}"/>`).join("")}</iconSet></cfRule>`;
  body = body.replace(
    "<cfRule",
    `<cfRule stopIfTrue="${rule.stopIfTrue ? 1 : 0}"`,
  );
  return body
    ? `<conditionalFormatting sqref="${esc(rule.ranges.map(rangeRef).join(" "))}">${body}</conditionalFormatting>`
    : "";
}
/** Export current values and formulas of every sheet, with native styles and feature resources. */
export async function exportXlsx(
  file: Pick<SheetFile, "content">,
): Promise<Uint8Array> {
  const wb = file.content.workbook as Data;
  const book = XLSX.utils.book_new();
  const styles: Data[] = [{}];
  const styleIds = new Map<string, number>();
  const sheetStyles: Map<string, number>[] = [];
  const sheetDefaults: number[] = [];
  const resolve = (v: unknown): Data =>
    typeof v === "string" ? (wb.styles?.[v] ?? {}) : (v ?? {});
  const notes = resource(wb, "SHEET_NOTE_PLUGIN");
  const threads = resource(wb, "SHEET_UNIVER_THREAD_COMMENT_PLUGIN");
  const rangeProtections = resource(wb, "SHEET_RANGE_PROTECTION_PLUGIN");
  const validations = resource(wb, "SHEET_DATA_VALIDATION_PLUGIN");
  const conditionals = resource(wb, "SHEET_CONDITIONAL_FORMATTING_PLUGIN");
  for (const id of wb.sheetOrder) {
    const s = wb.sheets[id];
    const sheet: XLSX.WorkSheet = {};
    const cellStyles = new Map<string, number>();
    const protectedRanges = (rangeProtections[id] ?? []).flatMap(
      (rule: Data) => rule.ranges ?? [],
    );
    const sheetProtected = s.custom?.suiteleafProtection?.sheet;
    const defaultStyleId =
      styles.push({
        suiteleafLocked: !protectedRanges.length || !!sheetProtected,
      }) - 1;
    sheetDefaults.push(defaultStyleId);
    let lastRow = 0,
      lastCol = 0;
    for (const [row, cells] of Object.entries(s.cellData ?? {}))
      for (const [col, raw] of Object.entries(cells as Data)) {
        if (!raw) continue;
        const cell = raw as Data,
          r = Number(row),
          c = Number(col),
          ref = XLSX.utils.encode_cell({ r, c });
        const href = cellHyperlink(cell);
        const stored =
          cell.v ?? cell.p?.body?.dataStream?.replace(/[\r\n]+$/g, "") ?? "";
        const value =
          cell.t === 3
            ? stored === true ||
              stored === 1 ||
              String(stored).toUpperCase() === "TRUE"
            : stored;
        const errorCodes: Data = {
          "#NULL!": 0,
          "#DIV/0!": 7,
          "#VALUE!": 15,
          "#REF!": 23,
          "#NAME?": 29,
          "#NUM!": 36,
          "#N/A": 42,
          "#GETTING_DATA": 43,
        };
        const error = cell.f && Object.hasOwn(errorCodes, String(value));
        sheet[ref] = {
          t: error
            ? "e"
            : cell.t === 4
              ? "s"
              : typeof value === "number"
                ? "n"
                : typeof value === "boolean"
                  ? "b"
                  : "s",
          v: error
            ? errorCodes[String(value)]
            : cell.t === 4
              ? sheetJsText(String(value))
              : typeof value === "string"
                ? sheetJsText(value)
                : value,
          ...(cell.f ? { f: String(cell.f).replace(/^=/, "") } : {}),
          ...(href ? { l: { Target: href } } : {}),
        };
        const style = {
          ...resolve(s.defaultStyle),
          ...resolve(s.rowData?.[r]?.s),
          ...resolve(s.columnData?.[c]?.s),
          ...resolve(cell.s),
        };
        if (protectedRanges.length && !sheetProtected)
          style.suiteleafLocked = protectedRanges.some(
            (range: Data) =>
              r >= range.startRow &&
              r <= range.endRow &&
              c >= range.startColumn &&
              c <= range.endColumn,
          );
        const key = JSON.stringify(style);
        let n = styleIds.get(key);
        if (n === undefined) {
          n = styles.push(style) - 1;
          styleIds.set(key, n);
        }
        cellStyles.set(ref, n);
        lastRow = Math.max(lastRow, r);
        lastCol = Math.max(lastCol, c);
      }
    if (!sheetProtected)
      for (const range of protectedRanges) {
        const count =
          (range.endRow - range.startRow + 1) *
          (range.endColumn - range.startColumn + 1);
        if (count > 1000000)
          throw new Error(
            "Export protection for ranges with at most 1,000,000 cells.",
          );
        for (let r = range.startRow; r <= range.endRow; r++)
          for (let c = range.startColumn; c <= range.endColumn; c++) {
            const ref = XLSX.utils.encode_cell({ r, c });
            if (!sheet[ref]) {
              sheet[ref] = { t: "s", v: "" };
              cellStyles.set(ref, 0);
            }
          }
        lastRow = Math.max(lastRow, range.endRow);
        lastCol = Math.max(lastCol, range.endColumn);
      }
    for (const [r, row] of Object.entries(notes[id] ?? {}))
      for (const [c, note] of Object.entries(row as Data)) {
        const ref = XLSX.utils.encode_cell({ r: +r, c: +c });
        sheet[ref] ??= { t: "s", v: "" };
        sheet[ref].c = [{ a: "SuiteLeaf", t: (note as Data).note }];
        lastRow = Math.max(lastRow, +r);
        lastCol = Math.max(lastCol, +c);
      }
    for (const thread of threads[id] ?? []) {
      const ref = String(thread.ref ?? "").split(":")[0];
      if (!/^[A-Z]+[1-9]\d*$/.test(ref)) continue;
      sheet[ref] ??= { t: "s", v: "" };
      const body = [thread, ...(thread.children ?? [])]
        .map(
          (comment) =>
            `${comment.authorName || comment.personId || "Local user"}: ${comment.text?.dataStream?.replace(/\r?\n$/, "") ?? ""}`,
        )
        .join("\n");
      sheet[ref].c = [
        ...(sheet[ref].c ?? []),
        { a: "SuiteLeaf", t: `${thread.resolved ? "[Resolved] " : ""}${body}` },
      ];
      const cell = XLSX.utils.decode_cell(ref);
      lastRow = Math.max(lastRow, cell.r);
      lastCol = Math.max(lastCol, cell.c);
    }
    sheet["!ref"] = XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: lastRow, c: lastCol },
    });
    sheet["!merges"] = (s.mergeData ?? []).map((r: Data) => ({
      s: { r: r.startRow, c: r.startColumn },
      e: { r: r.endRow, c: r.endColumn },
    }));
    sheet["!rows"] = [];
    sheet["!cols"] = [];
    for (const [r, data] of Object.entries(s.rowData ?? {}))
      sheet["!rows"][+r] = {
        hpt:
          typeof (data as Data).h === "number"
            ? ((data as Data).h * 72) / 96
            : undefined,
        hidden: !!(data as Data).hd,
      };
    const widths = excelWidths(s);
    for (const [c, data] of Object.entries(s.columnData ?? {})) {
      const w = (data as Data).w;
      sheet["!cols"][+c] = {
        ...(widths && typeof w === "number"
          ? { width: widths.chars(w, +c) }
          : { wpx: w }),
        hidden: !!(data as Data).hd,
      };
    }
    const usedNames = (book.SheetNames ?? []) as string[];
    XLSX.utils.book_append_sheet(
      book,
      sheet,
      excelSheetAlias(String(s.name ?? ""), new Set(usedNames)),
    );
    sheetStyles.push(cellStyles);
  }
  book.Workbook = {
    WBProps: { date1904: wb.dateSystem === "date1904" },
    Sheets: book.SheetNames.map((name: string, index: number) => ({
      name,
      Hidden: wb.sheets[wb.sheetOrder[index]].hidden || 0,
    })),
  };
  const names = resource(wb, "SHEET_DEFINED_NAME_PLUGIN");
  book.Workbook.Names = Object.values(names).map((n: Data) => {
    const scope =
      typeof n.localSheetId === "string"
        ? wb.sheetOrder.indexOf(n.localSheetId)
        : n.localSheetId;
    return {
      Name: n.name,
      Ref: String(n.formulaOrRefString).replace(/^=/, ""),
      ...(typeof scope === "number" && scope >= 0 ? { Sheet: scope } : {}),
    };
  });
  const zip = await JSZip.loadAsync(
    XLSX.write(book, {
      type: "array",
      bookType: "xlsx",
      bookSST: true,
      compression: true,
    }),
  );
  const dxfs: string[] = [];
  for (let i = 0; i < wb.sheetOrder.length; i++) {
    const id = wb.sheetOrder[i],
      s = wb.sheets[id],
      path = `xl/worksheets/sheet${i + 1}.xml`;
    let text = await zip.file(path)!.async("string");
    text = text.replace(/<c\b([^>]*)>/g, (tag, attrs) => {
      const ref = /\br="([^"]+)"/.exec(attrs)?.[1];
      return ref && sheetStyles[i].has(ref)
        ? `<c${attrs.replace(/\s+s="[^"]*"/, "")} s="${sheetStyles[i].get(ref)}">`
        : tag;
    });
    const widths = excelWidths(s);
    if (
      s.custom?.suiteleafProtection?.sheet ||
      (rangeProtections[id] ?? []).length
    ) {
      const columns: string[] = [];
      let nextColumn = 0;
      const chars = (px: number) => widths?.chars(px) ?? (px - 5) / 7;
      const defaultColumn = (start: number, end: number) =>
        `<col min="${start + 1}" max="${end + 1}" width="${widths?.default ?? chars(s.defaultColumnWidth || 100)}" style="${sheetDefaults[i]}"/>`;
      for (const c of Object.keys(s.columnData ?? {})
        .map(Number)
        .sort((a, b) => a - b)) {
        if (c > nextColumn) columns.push(defaultColumn(nextColumn, c - 1));
        const data = s.columnData[c];
        columns.push(
          `<col min="${c + 1}" max="${c + 1}" width="${chars(data.w ?? s.defaultColumnWidth ?? 100)}" customWidth="1" hidden="${data.hd ? 1 : 0}" style="${sheetDefaults[i]}"/>`,
        );
        nextColumn = c + 1;
      }
      if (nextColumn <= 16383) columns.push(defaultColumn(nextColumn, 16383));
      const cols = `<cols>${columns.join("")}</cols>`;
      if (/<cols>/.test(text))
        text = text.replace(/<cols>[\s\S]*?<\/cols>/, cols);
      else text = text.replace("<sheetData", `${cols}<sheetData`);
    }
    if (widths && (widths.default !== undefined || widths.base !== 8)) {
      const height = ((Number(s.defaultRowHeight) || 20) * 72) / 96;
      const format = `<sheetFormatPr${widths.base !== 8 ? ` baseColWidth="${widths.base}"` : ""}${widths.default !== undefined ? ` defaultColWidth="${widths.default}"` : ""} defaultRowHeight="${height}"/>`;
      text = text
        .replace(/<sheetFormatPr\b[^>]*\/>/, "")
        .replace(/<(cols|sheetData)\b/, `${format}<$1`);
    }
    const freeze = s.freeze;
    const sheetPr = `<sheetPr>${s.tabColor ? `<tabColor rgb="${rgb(s.tabColor)}"/>` : ""}</sheetPr>`;
    text = text
      .replace(/<sheetPr\b[^>]*(?:\/>|>[\s\S]*?<\/sheetPr>)/, "")
      .replace(/(<worksheet\b[^>]*>)/, `$1${sheetPr}`);
    if (freeze && (freeze.xSplit || freeze.ySplit))
      text = text.replace(
        /<sheetViews>[\s\S]*?<\/sheetViews>/,
        `<sheetViews><sheetView workbookViewId="0"><pane xSplit="${freeze.xSplit || 0}" ySplit="${freeze.ySplit || 0}" topLeftCell="${columnName(freeze.xSplit || 0)}${(freeze.ySplit || 0) + 1}" state="frozen"/></sheetView></sheetViews>`,
      );
    const cf = (conditionals[id] ?? [])
      .map((r: Data, i: number) => conditional(r, i + 1, dxfs))
      .join("");
    const dv = (validations[id] ?? []).map(validation).filter(Boolean);
    const protection = {
      sheet:
        s.custom?.suiteleafProtection?.sheet ||
        (rangeProtections[id] ?? []).length > 0,
    };
    if (protection?.sheet)
      text = text.replace(
        "</sheetData>",
        '</sheetData><sheetProtection sheet="1" objects="1" scenarios="1"/>',
      );
    const extra =
      cf +
      (dv.length
        ? `<dataValidations count="${dv.length}">${dv.join("")}</dataValidations>`
        : "");
    const selfClosingSheet =
      !text.includes("</sheetData>") && text.includes("<sheetData/>");
    const after = text.includes("</mergeCells>")
      ? "</mergeCells>"
      : selfClosingSheet
        ? "<sheetData/>"
        : "</sheetData>";
    if (
      protection?.sheet &&
      !text.includes("</mergeCells>") &&
      !selfClosingSheet
    )
      text = text.replace(
        '<sheetProtection sheet="1" objects="1" scenarios="1"/>',
        `<sheetProtection sheet="1" objects="1" scenarios="1"/>${extra}`,
      );
    else text = text.replace(after, `${after}${extra}`);
    zip.file(path, applyWorksheetOutline(text, s.custom));
  }
  const formats = styles
    .map(
      (s, i) =>
        `<numFmt numFmtId="${164 + i}" formatCode="${esc(s.n?.pattern || "General")}"/>`,
    )
    .join("");
  const xfs = styles
    .map(
      (s, i) =>
        `<xf numFmtId="${164 + i}" fontId="${i}" fillId="${i + 2}" borderId="${i}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1" applyNumberFormat="1" applyProtection="1"><alignment horizontal="${["general", "left", "center", "right"][s.ht] || "general"}" vertical="${["bottom", "top", "center", "bottom"][s.vt] || "bottom"}" wrapText="${s.tb === 3 ? 1 : 0}"${s.tr?.a ? ` textRotation="${s.tr.a < 0 ? 90 - s.tr.a : s.tr.a}"` : ""}/>${s.suiteleafLocked !== undefined ? `<protection locked="${s.suiteleafLocked ? 1 : 0}"/>` : ""}</xf>`,
    )
    .join("");
  zip.file(
    "xl/styles.xml",
    xml(
      `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="${styles.length}">${formats}</numFmts><fonts count="${styles.length}">${styles.map(font).join("")}</fonts><fills count="${styles.length + 2}"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${styles.map(fill).join("")}</fills><borders count="${styles.length}">${styles.map(border).join("")}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${styles.length}">${xfs}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="${dxfs.length}">${dxfs.join("")}</dxfs></styleSheet>`,
    ),
  );
  await addXlsxDrawings(zip, file);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
