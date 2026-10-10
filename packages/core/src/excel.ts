import * as XLSX from "xlsx";
import { officeZlib } from "./zip-inflater";
XLSX.CFB.utils.use_zlib(officeZlib);
import JSZip from "jszip";
import { readExcelImages } from "./excel-images";
import { readBinaryExcelLayout } from "./excel-binary-metadata";
import {
  createFile,
  parseRange,
  type SheetFile,
  type ChartDefinition,
} from "./index";
import {
  array,
  parseXml,
  readXml,
  relationships,
  type OfficeImport,
  OfficeImportError,
} from "./office";

/** Read binary formats without VBA, then reuse the editable XML importer. */
export async function normalizeBinaryExcel(
  bytes: Uint8Array,
): Promise<Uint8Array> {
  if (
    !(bytes[0] === 0xd0 && bytes[1] === 0xcf) &&
    !(bytes[0] === 0x50 && bytes[1] === 0x4b) &&
    bytes[0] !== 0x09
  )
    throw new OfficeImportError(
      "invalid-container",
      "This file has an invalid Excel binary signature.",
    );
  try {
    const book = XLSX.read(bytes, {
      type: "array",
      cellFormula: true,
      cellNF: true,
      cellStyles: true,
      cellDates: false,
      bookVBA: false,
    });
    if (
      !book.SheetNames.length ||
      book.SheetNames.some(
        (name) =>
          !name || name.length > 31 || /[\u0000-\u001f\[\]:*?/\\]/.test(name),
      )
    )
      throw new OfficeImportError(
        "conversion-failed",
        "The binary Excel workbook contains unreadable worksheet names.",
      );
    const normalized = new Uint8Array(
      XLSX.write(book, {
        type: "array",
        bookType: "xlsx",
        cellStyles: true,
        bookVBA: false,
      }),
    );
    const layout = readBinaryExcelLayout(bytes, book);
    const converted = await JSZip.loadAsync(normalized);
    if (layout.normalFont) {
      const family = layout.normalFont.family.replace(/[&<>"]+/g, (text) =>
        Array.from(
          text,
          (character) =>
            ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[
              character
            ],
        ).join(""),
      );
      const stylesPart = converted.file("xl/styles.xml");
      if (stylesPart)
        converted.file(
          "xl/styles.xml",
          (await stylesPart.async("string")).replace(
            /(<fonts\b[^>]*>)<font>[\s\S]*?<\/font>/,
            `$1<font><name val="${family}"/><sz val="${layout.normalFont.size}"/></font>`,
          ),
        );
    }
    for (const [index, dimensions] of layout.sheets.entries()) {
      const path = `xl/worksheets/sheet${index + 1}.xml`;
      const part = converted.file(path);
      if (!part || !Object.keys(dimensions).length) continue;
      let sheet = await part.async("string");
      const original = segment(sheet, "sheetFormatPr");
      const attributes = attrParser(original ?? "");
      if (dimensions.defaultRowHeight !== undefined)
        attributes.defaultRowHeight = String(dimensions.defaultRowHeight);
      if (dimensions.baseColumnWidthChars !== undefined)
        attributes.baseColWidth = String(dimensions.baseColumnWidthChars);
      if (dimensions.defaultColumnWidthChars !== undefined)
        attributes.defaultColWidth = String(dimensions.defaultColumnWidthChars);
      const format = `<sheetFormatPr ${Object.entries(attributes)
        .map(([key, value]) => `${key}="${value}"`)
        .join(" ")}/>`;
      sheet = original
        ? sheet.replace(original, format)
        : sheet.replace(/<(?:\w+:)?sheetData\b/, format + "<sheetData");
      converted.file(path, sheet);
    }
    return converted.generateAsync({ type: "uint8array" });
  } catch (e) {
    if (e instanceof OfficeImportError) throw e;
    const message = e instanceof Error ? e.message : String(e);
    throw new OfficeImportError(
      /password|encrypted/i.test(message) ? "encrypted" : "conversion-failed",
      `Excel conversion failed: ${message}`,
    );
  }
}

const attrParser = (text: string): Record<string, string> => {
  const o: Record<string, string> = {};
  for (const m of text.matchAll(/([\w:]+)\s*=\s*["']([^"']*)["']/g))
    o[m[1].split(":").pop()!] = m[2];
  return o;
};
function segment(xml: string, name: string): string | undefined {
  return new RegExp(
    `<(?:(?:[\\w]+):)?${name}\\b[^>]*(?:\\/>|>[\\s\\S]*?<\\/(?:(?:[\\w]+):)?${name}>)`,
  ).exec(xml)?.[0];
}
const b = (v: any) =>
  v !== undefined && v !== null && v !== "0" && v !== "false";
const indexedColors = [
  "000000",
  "FFFFFF",
  "FF0000",
  "00FF00",
  "0000FF",
  "FFFF00",
  "FF00FF",
  "00FFFF",
  "000000",
  "FFFFFF",
  "FF0000",
  "00FF00",
  "0000FF",
  "FFFF00",
  "FF00FF",
  "00FFFF",
  "800000",
  "008000",
  "000080",
  "808000",
  "800080",
  "008080",
  "C0C0C0",
  "808080",
  "9999FF",
  "993366",
  "FFFFCC",
  "CCFFFF",
  "660066",
  "FF8080",
  "0066CC",
  "CCCCFF",
  "000080",
  "FF00FF",
  "FFFF00",
  "00FFFF",
  "800080",
  "800000",
  "008080",
  "0000FF",
  "00CCFF",
  "CCFFFF",
  "CCFFCC",
  "FFFF99",
  "99CCFF",
  "FF99CC",
  "CC99FF",
  "FFCC99",
  "3366FF",
  "33CCCC",
  "99CC00",
  "FFCC00",
  "FF9900",
  "FF6600",
  "666699",
  "969696",
  "003366",
  "339966",
  "003300",
  "333300",
  "993300",
  "993366",
  "333399",
  "333333",
].map((value) => "#" + value);
function color(c: any, palette: string[]): string | undefined {
  if (!c) return;
  let rgb = c["@_rgb"];
  if (rgb && /^[a-f\d]{6,8}$/i.test(rgb)) return "#" + rgb.slice(-6);
  if (c["@_theme"] !== undefined) rgb = palette[+c["@_theme"]];
  else if (c["@_indexed"] !== undefined)
    rgb = +c["@_indexed"] === 64 ? "#000000" : indexedColors[+c["@_indexed"]];
  if (!rgb) return;
  const tint = Number(c["@_tint"]) || 0;
  if (!tint) return rgb;
  const channels = (rgb as string)
    .replace("#", "")
    .match(/../g)!
    .map((v: string) => parseInt(v, 16));
  return (
    "#" +
    channels
      .map((n: number) =>
        Math.round(tint < 0 ? n * (1 + tint) : n + (255 - n) * tint)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
async function styleTable(zip: JSZip): Promise<Record<string, any>> {
  const palette = [
    "#FFFFFF",
    "#000000",
    "#EEECE1",
    "#1F497D",
    "#4F81BD",
    "#C0504D",
    "#9BBB59",
    "#8064A2",
    "#4BACC6",
    "#F79646",
    "#0000FF",
    "#800080",
  ];
  const theme = zip.file("xl/theme/theme1.xml");
  if (theme) {
    try {
      const t = parseXml(await theme.async("string"), "theme");
      const scheme = t.theme?.themeElements?.clrScheme;
      const order = [
        "lt1",
        "dk1",
        "lt2",
        "dk2",
        "accent1",
        "accent2",
        "accent3",
        "accent4",
        "accent5",
        "accent6",
        "hlink",
        "folHlink",
      ];
      order.forEach((key, i) => {
        const node = scheme?.[key];
        const value = node?.srgbClr?.["@_val"] ?? node?.sysClr?.["@_lastClr"];
        if (value) palette[i] = "#" + value;
      });
    } catch {
      /* Theme colors fall back to standard Office colors. */
    }
  }
  const f = zip.file("xl/styles.xml");
  if (!f) return { styles: {}, normalFont: { family: "Calibri", size: 11 } };
  const s = parseXml(await f.async("string"), "xl/styles.xml").styleSheet;
  const fonts = array<any>(s?.fonts?.font),
    fills = array<any>(s?.fills?.fill),
    borders = array<any>(s?.borders?.border),
    formats = new Map(
      array<any>(s?.numFmts?.numFmt).map((n) => [
        +n["@_numFmtId"],
        n["@_formatCode"],
      ]),
    );
  const out: Record<string, any> = {};
  array<any>(s?.cellXfs?.xf).forEach((xf, i) => {
    // Native Excel's cell text inset is three points; the grid uses CSS pixels.
    // A stored cell XF replaces the column's alignment in Excel. Explicit
    // General/bottom defaults prevent Univer composing a column alignment
    // into a cell whose XF omits an alignment element.
    const style: any = {
        ht: 0,
        vt: 3,
        tb: 1,
        pd: { l: (3 * 96) / 72, r: (3 * 96) / 72 },
      },
      font = fonts[+xf["@_fontId"]],
      fill = fills[+xf["@_fillId"]],
      border = borders[+xf["@_borderId"]];
    if (font) {
      if (font.name?.["@_val"]) style.ff = font.name["@_val"];
      if (font.sz?.["@_val"]) style.fs = +font.sz["@_val"];
      if (
        font.b !== undefined &&
        font.b?.["@_val"] !== "0" &&
        font.b?.["@_val"] !== "false"
      )
        style.bl = 1;
      if (
        font.i !== undefined &&
        font.i?.["@_val"] !== "0" &&
        font.i?.["@_val"] !== "false"
      )
        style.it = 1;
      if (font.u !== undefined) style.ul = { s: 1 };
      if (font.strike !== undefined) style.st = { s: 1 };
      const cl = color(font.color, palette);
      if (cl) style.cl = { rgb: cl };
    }
    const bg = color(fill?.patternFill?.fgColor, palette);
    if (bg && fill?.patternFill?.["@_patternType"] !== "none")
      style.bg = { rgb: bg };
    const inherited = array<any>(s?.cellStyleXfs?.xf)[Number(xf["@_xfId"] ?? 0)]
      ?.alignment;
    const a = b(xf["@_applyAlignment"])
      ? (xf.alignment ?? {})
      : (xf.alignment ?? inherited);
    if (a) {
      if (a["@_horizontal"] === "center") style.pd = { l: 0, r: 0 };
      if (a["@_horizontal"] === "right") style.pd = { l: 0, r: 96 / 72 };
      style.ht =
        ({ left: 1, center: 2, right: 3, justify: 4, distributed: 6 } as any)[
          a["@_horizontal"]
        ] ?? 0;
      style.vt =
        ({ top: 1, center: 2, bottom: 3 } as any)[a["@_vertical"]] ?? 3;
      if (b(a["@_wrapText"])) style.tb = 3;
      if (a["@_textRotation"])
        style.tr = { a: Math.min(90, +a["@_textRotation"]) };
    }
    const pattern =
      formats.get(+xf["@_numFmtId"]) ?? XLSX.SSF.get_table()[+xf["@_numFmtId"]];
    if (pattern && pattern !== "General") style.n = { pattern };
    if (border) {
      const bd: any = {};
      const types: any = {
        thin: 1,
        hair: 2,
        dotted: 3,
        dashed: 4,
        dashDot: 5,
        dashDotDot: 6,
        double: 7,
        medium: 8,
        mediumDashed: 9,
        mediumDashDot: 10,
        mediumDashDotDot: 11,
        slantDashDot: 12,
        thick: 13,
      };
      for (const [side, key] of Object.entries({
        top: "t",
        bottom: "b",
        left: "l",
        right: "r",
      })) {
        const edge = border[side];
        if (edge?.["@_style"])
          bd[key] = {
            s: types[edge["@_style"]] ?? 1,
            cl: { rgb: color(edge.color, palette) ?? "#000000" },
          };
      }
      if (Object.keys(bd).length) style.bd = bd;
    }
    if (Object.keys(style).length) out["excel-" + i] = style;
  });
  const normalStyle = array<any>(s?.cellStyles?.cellStyle).find(
    (style) => style["@_builtinId"] === "0" || style["@_name"] === "Normal",
  );
  const normalXf = array<any>(s?.cellStyleXfs?.xf)[
    Number(normalStyle?.["@_xfId"] ?? 0)
  ];
  const normalFont = fonts[Number(normalXf?.["@_fontId"] ?? 0)];
  return {
    styles: out,
    normalFont: {
      family: normalFont?.name?.["@_val"] ?? "Calibri",
      size: Number(normalFont?.sz?.["@_val"]) || 11,
    },
  };
}
export async function importXlsx(
  bytes: Uint8Array,
  title: string,
  inspected: { zip: JSZip; part: string; xml: string },
): Promise<OfficeImport> {
  const { zip, part, xml } = inspected;
  const warnings: string[] = [],
    features: string[] = [],
    stats: Record<string, number> = {
      sheets: 0,
      cells: 0,
      formulas: 0,
      merges: 0,
      charts: 0,
    };
  // JSZip resolves package entries robustly; regenerate consistent headers while
  // reusing already-compressed DEFLATE payloads. This also avoids ambiguous ZIP
  // descriptor layouts that the spreadsheet ZIP reader otherwise mishandles.
  const readBytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
  });
  let textUnits = 0;
  let book: XLSX.WorkBook;
  try {
    book = XLSX.read(readBytes, {
      type: "array",
      cellFormula: true,
      cellNF: true,
      cellStyles: false,
      cellDates: false,
      sheetStubs: false,
      dense: true,
      bookVBA: false,
      bookFiles: false,
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    if (
      /invalid (?:literal|code|distance|stored)|uncompressed data size mismatch|Corrupted zip/.test(
        error,
      )
    )
      throw new OfficeImportError(
        "invalid-container",
        `An Office ZIP part is corrupt: ${error}`,
      );
    throw new OfficeImportError(
      "conversion-failed",
      `Excel conversion failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!book.SheetNames.length)
    throw new OfficeImportError(
      "missing-sheets",
      "The Excel workbook has no worksheets.",
    );
  const root = parseXml(xml, part).workbook;
  const sourceSheets = array<any>(root?.sheets?.sheet),
    rels = await relationships(zip, part),
    styleData = await styleTable(zip);
  const { styles, normalFont } = styleData;
  const file = createFile("sheet", title) as SheetFile;
  const workbook = file.content.workbook;
  workbook.sheetOrder = [];
  workbook.sheets = {};
  workbook.styles = styles;
  workbook.dateSystem = b(root?.workbookPr?.["@_date1904"])
    ? "date1904"
    : "date1900";
  const sheetIds = new Map(
    book.SheetNames.map((name, i) => [name, `sheet-${i + 1}`]),
  );
  const sheetSources = new Map<string, string>();
  for (let i = 0; i < book.SheetNames.length; i++) {
    const name = book.SheetNames[i],
      source = book.Sheets[name] ?? {},
      id = sheetIds.get(name)!;
    const meta =
      sourceSheets.find((s) => s["@_name"] === name) ?? sourceSheets[i];
    const rel = rels.get(meta?.["@_id"]);
    const partPath =
      rel?.path ?? `xl/worksheets/sheet${i + 1}.xml`;
    const isChartsheet =
      rel?.type.endsWith("/chartsheet") ||
      partPath.includes("chartsheets/") ||
      (source as any)["!type"] === "chart";
    const raw = zip.file(partPath)
      ? await zip.file(partPath)!.async("string")
      : "";
    if (!raw && meta?.["@_id"] === "") {
      workbook.sheetOrder.push(id);
      workbook.sheets[id] = {
        id,
        name,
        rowCount: 1000,
        columnCount: 26,
        cellData: {},
      };
      warnings.push(
        `Worksheet ${name} has no XML part; an empty placeholder was imported.`,
      );
      continue;
    }
    if (!raw)
      throw new OfficeImportError(
        "missing-part",
        `The worksheet ${name} has no readable XML part.`,
      );
    sheetSources.set(id, partPath);
    const cellData: Record<string, Record<string, any>> = {};
    let maxRow = 0,
      maxCol = 0;
    const copyCell = (
      cell: XLSX.CellObject,
      coords: { r: number; c: number },
    ) => {
      if (typeof cell.v === "string") {
        textUnits += cell.v.length;
        if (textUnits > 100 * 1024 * 1024)
          throw new OfficeImportError(
            "content-limit",
            "This workbook contains more than 100 MB of cell text; it exceeds the editable import limit.",
          );
        if (cell.v.length > 32767)
          warnings.push(
            "Some long cell text exceeds Excel’s standard length limit; its contents are retained.",
          );
      }
      if (
        coords.r > 1048575 ||
        coords.c > 16383 ||
        coords.r < 0 ||
        coords.c < 0
      ) {
        warnings.push(`A cell outside Excel's grid in ${name} was ignored.`);
        return;
      }
      if (++stats.cells > 10000000)
        throw new OfficeImportError(
          "cell-limit",
          "This workbook exceeds the 10 million stored-cell import limit.",
        );
      const target: any = {};
      if (cell.v !== undefined && cell.v !== null) {
        if (typeof cell.v === "number" && !Number.isFinite(cell.v))
          target.v = String(cell.v);
        else target.v = cell.t === "e" ? (cell.w ?? String(cell.v)) : cell.v;
        target.t =
          typeof target.v === "number"
            ? 2
            : typeof target.v === "boolean"
              ? 3
              : 1;
      }
      if (cell.f) {
        target.f = "=" + cell.f;
        stats.formulas++;
        if (cell.F) {
          target.ref = cell.F;
          target.ft = 2;
        }
      }
      if (cell.z && cell.z !== "General") target.s = { n: { pattern: cell.z } };
      if (Object.keys(target).length) {
        (cellData[coords.r] ??= {})[coords.c] = target;
        maxRow = Math.max(maxRow, coords.r);
        maxCol = Math.max(maxCol, coords.c);
      }
    };
    if (!isChartsheet) {
      const rows = (source as any)["!data"] as
        (XLSX.CellObject[] | undefined)[] | undefined;
      if (rows) {
        rows.forEach((row, r) =>
          row?.forEach((cell, c) => {
            if (cell) copyCell(cell, { r, c });
          }),
        );
      } else
        for (const [address, cell] of Object.entries(source)) {
          if (!address.startsWith("!"))
            copyCell(cell as XLSX.CellObject, XLSX.utils.decode_cell(address));
        }
    }

    // SheetJS's internal shift_formula_str does not shift whole-column references
    // (e.g. A:A, B:B) in shared formulas because its cell regex requires row digits.
    // Shift column ranges across shared formula ranges so recipient cells evaluate correctly.
    const sharedDefs = new Map<string, { origin: { r: number; c: number }; formula: string }>();
    for (const m of raw.matchAll(
      /<(?:\w+:)?c\b([^>]*?)>(?:[\s\S]*?<(?:\w+:)?f\b([^>]*?)>([\s\S]*?)<\/(?:\w+:)?f>)/g,
    )) {
      const cAttrs = attrParser(m[1]);
      const fAttrs = attrParser(m[2]);
      const fText = m[3]?.trim();
      if (cAttrs.r && fAttrs.si !== undefined && fAttrs.t === "shared" && fText) {
        const origin = XLSX.utils.decode_cell(cAttrs.r);
        sharedDefs.set(fAttrs.si, { origin, formula: fText });
      }
    }
    if (sharedDefs.size) {
      const colRegex =
        /(^|[^._A-Z0-9])(\$?)([A-Z]{1,3}):(\$?)([A-Z]{1,3})(?![_.\(A-Za-z0-9])/g;
      for (const m of raw.matchAll(
        /<(?:\w+:)?c\b([^>]*?)>(?:[\s\S]*?<(?:\w+:)?f\b([^>]*?)\/?>)/g,
      )) {
        const cAttrs = attrParser(m[1]);
        const fAttrs = attrParser(m[2]);
        if (cAttrs.r && fAttrs.si !== undefined && sharedDefs.has(fAttrs.si)) {
          const def = sharedDefs.get(fAttrs.si)!;
          const pos = XLSX.utils.decode_cell(cAttrs.r);
          const dc = pos.c - def.origin.c;
          if (dc !== 0 && colRegex.test(def.formula)) {
            const shifted = def.formula.replace(
              colRegex,
              (_, prefix, s1, c1, s2, c2) => {
                const shift = (colStr: string, abs: boolean) => {
                  if (abs) return "$" + colStr;
                  const newCol = XLSX.utils.decode_col(colStr) + dc;
                  return newCol >= 0 ? XLSX.utils.encode_col(newCol) : colStr;
                };
                return (
                  prefix +
                  shift(c1, s1 === "$") +
                  ":" +
                  shift(c2, s2 === "$")
                );
              },
            );
            if (cellData[pos.r]?.[pos.c]) {
              cellData[pos.r][pos.c].f = "=" + shifted;
            }
          }
        }
      }
    }

    // Apply original cell style IDs without building a second full worksheet tree.
    for (const m of raw.matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/?>)/g)) {
      const a = attrParser(m[1]);
      if (a.s === undefined || !a.r || !styles["excel-" + a.s]) continue;
      const pos = XLSX.utils.decode_cell(a.r);
      if (pos.r < 0 || pos.r > 1048575 || pos.c < 0 || pos.c > 16383) continue;
      const target = ((cellData[pos.r] ??= {})[pos.c] ??= {});
      target.s = "excel-" + a.s;
      maxRow = Math.max(maxRow, pos.r);
      maxCol = Math.max(maxCol, pos.c);
    }
    // Numeric and right-aligned cells use a compact numeric inset. Keep rendering and the
    // width-dependent rounding calculation on the same available rectangle.
    for (const cells of Object.values(cellData)) {
      for (const cell of Object.values(cells)) {
        const style = typeof cell.s === "string" ? styles[cell.s] : cell.s;
        if (
          typeof cell.v === "number" &&
          !style?.n &&
          !style?.ht &&
          style?.tb !== 3
        ) {
          cell.s = { ...style, pd: { l: 0, r: 96 / 72 } };
        }
      }
    }
    const rowData: Record<string, any> = {},
      columnData: Record<string, any> = {};
    const columnWidths: Record<string, number> = {};
    for (const m of raw.matchAll(/<(?:\w+:)?row\b([^>]*?)(?:\/?>)/g)) {
      const a = attrParser(m[1]);
      const r = Number(a.r) - 1;
      if (r < 0 || r > 1048575) continue;
      const d: any = {};
      if (a.ht !== undefined) d.h = (+a.ht * 96) / 72;
      if (a.hidden === "1" || a.hidden === "true") d.hd = 1;
      if (a.s !== undefined && styles["excel-" + a.s]) d.s = "excel-" + a.s;
      if (Object.keys(d).length) rowData[r] = d;
    }
    for (const m of raw.matchAll(/<(?:\w+:)?col\b([^>]*?)(?:\/?>)/g)) {
      const a = attrParser(m[1]);
      for (let c = Math.max(0, +a.min - 1); c < Math.min(16384, +a.max); c++) {
        const d: any = {};
        if (
          a.width !== undefined &&
          Number.isFinite(+a.width) &&
          +a.width >= 0
        ) {
          columnWidths[c] = +a.width;
          // OOXML widths already include padding; apply the stored-width formula.
          // The browser refines dimensions after loading the workbook Normal font.
          d.w = Math.floor(((256 * +a.width + Math.floor(128 / 7)) / 256) * 7);
        }
        if (a.hidden === "1" || a.hidden === "true") d.hd = 1;
        if (a.style !== undefined && styles["excel-" + a.style])
          d.s = "excel-" + a.style;
        if (Object.keys(d).length) columnData[c] = d;
      }
    }
    const merges = (source["!merges"] ?? [])
      .filter(
        (r) => r.s.r >= 0 && r.s.c >= 0 && r.e.r <= 1048575 && r.e.c <= 16383,
      )
      .map((r) => ({
        startRow: r.s.r,
        endRow: r.e.r,
        startColumn: r.s.c,
        endColumn: r.e.c,
      }));
    stats.merges += merges.length;
    for (const r of merges) {
      maxRow = Math.max(maxRow, r.endRow);
      maxCol = Math.max(maxCol, r.endColumn);
    }
    const views = segment(raw, "sheetViews");
    const view = views
      ? array<any>(parseXml(views, "sheetViews").sheetViews?.sheetView)[0]
      : undefined;
    const pane = view?.pane;
    const freeze =
      pane && String(pane["@_state"]).startsWith("frozen")
        ? {
            xSplit: Number(pane["@_xSplit"]) || 0,
            ySplit: Number(pane["@_ySplit"]) || 0,
            startRow: Number(pane["@_ySplit"]) || -1,
            startColumn: Number(pane["@_xSplit"]) || -1,
          }
        : undefined;
    const sheetFormat = attrParser(segment(raw, "sheetFormatPr") ?? "");
    const rowHeight = Number(sheetFormat.defaultRowHeight);
    const columnWidth = Number(sheetFormat.defaultColWidth);
    // OOXML row dimensions are points; Univer's grid dimensions are CSS pixels.
    const defaultRowHeight =
      Number.isFinite(rowHeight) && rowHeight > 0 ? (rowHeight * 96) / 72 : 20;
    const defaultColumnWidth =
      Number.isFinite(columnWidth) && columnWidth > 0
        ? Math.floor(((256 * columnWidth + Math.floor(128 / 7)) / 256) * 7)
        : 64;
    const hidden = book.Workbook?.Sheets?.[i]?.Hidden ?? 0;
    workbook.sheetOrder.push(id);
    workbook.sheets[id] = {
      id,
      name,
      cellData,
      rowCount: isChartsheet ? 100 : Math.max(1000, maxRow + 1),
      columnCount: isChartsheet ? 26 : Math.max(26, maxCol + 1),
      rowData,
      columnData,
      mergeData: merges,
      hidden,
      freeze,
      custom: {
        excelLayout: {
          normalFont,
          defaultColumnWidthChars:
            Number.isFinite(columnWidth) && columnWidth > 0
              ? columnWidth
              : undefined,
          baseColumnWidthChars:
            Number(sheetFormat.baseColWidth) > 0
              ? Number(sheetFormat.baseColWidth)
              : 8,
          columnWidths,
        },
      },
      defaultStyle: styles["excel-0"] ? "excel-0" : undefined,
      defaultColumnWidth,
      defaultRowHeight,
      zoomRatio: 1,
      showGridlines: isChartsheet ? 0 : view?.["@_showGridLines"] === "0" ? 0 : 1,
      rightToLeft: view?.["@_rightToLeft"] === "1" ? 1 : 0,
    };
    delete book.Sheets[name];
    for (const [feature, re] of Object.entries({
      conditional_formatting: /<(?:\w+:)?conditionalFormatting\b/,
      data_validation: /<(?:\w+:)?dataValidations\b/,
      autofilters: /<(?:\w+:)?autoFilter\b/,
      sheet_protection: /<(?:\w+:)?sheetProtection\b/,
      hyperlinks: /<(?:\w+:)?hyperlinks\b/,
    }))
      if (re.test(raw)) features.push(feature);
  }
  stats.sheets = workbook.sheetOrder.length;
  if (!workbook.sheetOrder.some((id) => !workbook.sheets[id].hidden)) {
    workbook.sheets[workbook.sheetOrder[0]].hidden = 0;
    warnings.push(
      "The first worksheet was made visible because the source had no visible worksheets.",
    );
  }
  const names = book.Workbook?.Names ?? [];
  if (names.length) {
    features.push("named_ranges");
    workbook.resources = [
      {
        name: "SHEET_DEFINED_NAME_PLUGIN",
        data: JSON.stringify(
          Object.fromEntries(
            names
              .filter((n) => !n.Name.startsWith("_xlnm."))
              .map((n, i) => [
                `name-${i}`,
                {
                  id: `name-${i}`,
                  name: n.Name,
                  formulaOrRefString: n.Ref,
                  localSheetId:
                    n.Sheet === undefined
                      ? undefined
                      : workbook.sheetOrder[n.Sheet],
                },
              ]),
          ),
        ),
      },
    ];
  }
  const members = Object.keys(zip.files);
  const countParts = (part: string) =>
    members.filter((p) => new RegExp(`^xl/${part}/[^/]+\\.xml$`).test(p))
      .length;
  for (const [feature, folder] of Object.entries({
    charts: "charts",
    pivot_tables: "pivotTables",
    images: "media",
    external_links: "externalLinks",
  })) {
    const count =
      feature === "images"
        ? members.filter((p) => p.startsWith("xl/media/") && !p.endsWith("/"))
            .length
        : countParts(folder);
    if (count) {
      features.push(feature);
      stats[feature] = count;
    }
  }
  if (stats.charts || features.includes("charts"))
    await readCharts(zip, file, sheetSources, sheetIds, warnings);
  file.content.images = await readExcelImages(zip, sheetSources, warnings);
  for (const [feature, warning] of Object.entries({
    conditional_formatting:
      "Conditional formatting rules are not recreated; original base cell styles are retained.",
    data_validation: "Excel validation rules are not enforced after import.",
    autofilters:
      "Autofilter definitions are not recreated; the data can be filtered with the Sheets toolbar.",
    sheet_protection:
      "Excel protection is not applied; the imported copy is editable.",
    hyperlinks:
      "Hyperlink cell labels are preserved; hyperlink targets are not recreated.",
    pivot_tables:
      "Excel pivot results are retained as cells, but Excel pivot definitions are not recreated.",

    external_links:
      "External workbook links are retained as formula text and cached values; no external files are fetched.",
  }))
    if (features.includes(feature)) warnings.push(warning);
  if (stats.formulas) {
    features.push("formulas");
    warnings.push(
      "Excel formulas and cached results are retained; recalculation uses the available Univer functions and may differ for Excel-specific functions.",
    );
  }
  return {
    file,
    report: {
      format: "xlsx",
      warnings: [...new Set(warnings)],
      features: [...new Set(features)],
      stats,
    },
  };
}
async function readCharts(
  zip: JSZip,
  file: SheetFile,
  parts: Map<string, string>,
  ids: Map<string, string>,
  warnings: string[],
) {
  for (const [sheetId, part] of parts) {
    const sheetRels = await relationships(zip, part);
    for (const drawing of sheetRels.values()) {
      if (drawing.external || !drawing.type.endsWith("/drawing")) continue;
      try {
        const d = await readXml(zip, drawing.path),
          rels = await relationships(zip, drawing.path);
        const root = d.wsDr;
        const anchors = [
          ...array<any>(root?.twoCellAnchor),
          ...array<any>(root?.oneCellAnchor),
          ...array<any>(root?.absoluteAnchor),
        ];
        for (const anchor of anchors) {
          const chartRel =
            anchor.graphicFrame?.graphic?.graphicData?.chart?.["@_id"];
          const path = rels.get(chartRel)?.path;
          if (!path) continue;
          const x = await readXml(zip, path);
          const plot = x.chartSpace?.chart?.plotArea;
          const type = plot?.barChart
            ? "bar"
            : plot?.lineChart
              ? "line"
              : plot?.pieChart
                ? "pie"
                : plot?.scatterChart
                  ? "scatter"
                  : undefined;
          if (!type) {
            warnings.push("An Excel chart type could not be recreated.");
            continue;
          }
          const model =
            plot[
              type === "bar"
                ? "barChart"
                : type === "line"
                  ? "lineChart"
                  : type === "pie"
                    ? "pieChart"
                    : "scatterChart"
            ];
          const series = array<any>(model.ser);
          const refs = series
            .flatMap((s) => [
              s.cat?.strRef?.f ?? s.cat?.numRef?.f ?? s.xVal?.numRef?.f,
              s.val?.numRef?.f ?? s.yVal?.numRef?.f,
            ])
            .filter((v) => typeof v === "string") as string[];
          const parsed = refs
            .map((ref) => {
              const m = /^(?:'((?:[^']|'')+)'|([^!]+))!(.+)$/.exec(ref);
              if (!m) return;
              const sourceId = ids.get((m[1] ?? m[2]).replaceAll("''", "'"));
              if (!sourceId) return;
              try {
                return parseRange(m[3], sourceId);
              } catch {
                return;
              }
            })
            .filter(Boolean) as ReturnType<typeof parseRange>[];
          if (
            !parsed.length ||
            parsed.some((r) => r.sheetId !== parsed[0].sheetId)
          ) {
            warnings.push(
              "A chart with external or nonrectangular source data was not recreated.",
            );
            continue;
          }
          const hasCat = series.some(
            (s) => s.cat?.strRef?.f || s.cat?.numRef?.f || s.xVal?.numRef?.f,
          );
          const minCol = Math.min(...parsed.map((r) => r.startColumn));
          const startColumn = !hasCat && minCol > 0 ? minCol - 1 : minCol;
          const source = {
            sheetId: parsed[0].sheetId,
            startRow: Math.max(
              0,
              Math.min(...parsed.map((r) => r.startRow)) - 1,
            ),
            endRow: Math.max(...parsed.map((r) => r.endRow)),
            startColumn,
            endColumn: Math.max(...parsed.map((r) => r.endColumn)),
          };
          const isAbsolute = !anchor.from && !!anchor.pos;
          const posX = isAbsolute
            ? Math.round(Number(anchor.pos?.["@_x"] ?? 0) / 9525)
            : Number(anchor.from?.col ?? 3) * 100;
          const posY = isAbsolute
            ? Math.round(Number(anchor.pos?.["@_y"] ?? 0) / 9525)
            : Number(anchor.from?.row ?? 3) * 24;
          const width = isAbsolute
            ? Math.min(1000, Math.round(Number(anchor.ext?.["@_cx"] ?? 0) / 9525) || 880)
            : 520;
          const height = isAbsolute
            ? Math.min(650, Math.round(Number(anchor.ext?.["@_cy"] ?? 0) / 9525) || 580)
            : 340;
          const title = String(
            x.chartSpace?.chart?.title?.tx?.rich?.p?.r?.t ??
              x.chartSpace?.chart?.title?.tx?.strRef?.strCache?.pt?.v ??
              "",
          );
          const c: ChartDefinition = {
            id: crypto.randomUUID(),
            title,
            type,
            source,
            sheetId,
            x: isAbsolute ? Math.max(20, posX) : posX,
            y: isAbsolute ? Math.max(10, posY) : posY,
            width,
            height,
          };
          if (anchor.to && type === "line") {
            const importedSeries = series
              .map((s, index) => {
                const formula = s.val?.numRef?.f;
                const m =
                  typeof formula === "string"
                    ? /^(?:'((?:[^']|'')+)'|([^!]+))!(.+)$/.exec(formula)
                    : null;
                const sourceId =
                  m && ids.get((m[1] ?? m[2]).replaceAll("''", "'"));
                return sourceId && m
                  ? {
                      name: String(s.tx?.v ?? `Series${index + 1}`),
                      values: parseRange(m[3], sourceId),
                      color: ["#4F81BD", "#C0504D", "#9BBB59", "#8064A2"][
                        index % 4
                      ],
                    }
                  : null;
              })
              .filter(Boolean) as NonNullable<
              ChartDefinition["excel"]
            >["series"];
            if (importedSeries.length === series.length) {
              const point = (p: any, key: string) => Number(p?.[key] ?? 0);
              c.title = String(
                x.chartSpace?.chart?.title?.tx?.rich?.p?.r?.t ?? "",
              );
              c.excel = {
                series: importedSeries,
                legend: String(
                  x.chartSpace?.chart?.legend?.legendPos?.["@_val"] ?? "r",
                ),
                markers: model.marker?.["@_val"] !== "0",
                anchor: {
                  fromColumn: point(anchor.from, "col"),
                  fromRow: point(anchor.from, "row"),
                  fromColumnOffset: point(anchor.from, "colOff") / 9525,
                  fromRowOffset: point(anchor.from, "rowOff") / 9525,
                  toColumn: point(anchor.to, "col"),
                  toRow: point(anchor.to, "row"),
                  toColumnOffset: point(anchor.to, "colOff") / 9525,
                  toRowOffset: point(anchor.to, "rowOff") / 9525,
                },
              };
            }
          }
          file.content.charts.push(c);
        }
      } catch (e) {
        warnings.push(
          `A chart could not be recreated: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }
  if (file.content.charts.length)
    warnings.push(
      "Basic Excel charts are recreated from cell ranges; advanced chart styling and nonadjacent series may differ.",
    );
}
