import * as XLSX from "xlsx";
import { officeZlib } from "./zip-inflater";
XLSX.CFB.utils.use_zlib(officeZlib);
import JSZip from "jszip";
import { importExcelFeatures } from "./excel-features";
import { readWorksheetOutline } from "./excel-outline";
import { readExcelImages } from "./excel-images";
import { readCharts } from "./excel-charts";
import { styleTable } from "./excel-styles";
import { attrParser, b, decodeXmlEntities, segment } from "./excel-xml";
import {
  createFile,
  chartSchema,
  type SheetFile,
  type ChartDefinition,
} from "./index";
import { removedLinkWarning, takeExcelHyperlink } from "./sheet-links";
import {
  array,
  parseXml,
  relationships,
  type OfficeImport,
  OfficeImportError,
} from "./office";

export { normalizeBinaryExcel } from "./excel-binary";

export function implicitIntersectConcatenatedWholeColumns(
  formula: string,
  row: number,
): string {
  const parts = formula.match(/"(?:[^"]|"")*"|[^"]+/g) ?? [];
  let depth = 0;
  let hasTopLevelConcatenation = false;
  for (const part of parts) {
    if (part.startsWith('"')) continue;
    for (const character of part) {
      if (character === "(") depth++;
      else if (character === ")") depth = Math.max(0, depth - 1);
      else if (character === "&" && depth === 0)
        hasTopLevelConcatenation = true;
    }
  }
  if (!hasTopLevelConcatenation) return formula;
  return parts
    .map((part) =>
      part.startsWith('"')
        ? part
        : part.replace(
            /(^|[^._A-Z0-9])(\$?[A-Z]{1,3}:\$?[A-Z]{1,3})(?![_.\(A-Za-z0-9])/g,
            (_, prefix, columns) => {
              const [first, last] = columns.split(":");
              if (first.replace("$", "") !== last.replace("$", ""))
                return `${prefix}@${columns}`;
              // Excel's legacy implicit intersection takes this row's cell.
              // Univer's @ range coercion turns empty cells into numeric zero;
              // guard the scalar reference so concatenation retains empty text.
              const cell = `${first}${row + 1}`;
              return `${prefix}IF(ISBLANK(${cell}),"",${cell})`;
            },
          ),
    )
    .join("");
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
  const droppedLinks: string[] = [];
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
  const commentSources: XLSX.WorkBook = { SheetNames: [], Sheets: {} };
  const binaryChartsPart = zip.file("xl/suiteleaf-binary-charts.json");
  const binaryCharts: ChartDefinition[] = binaryChartsPart
    ? array<unknown>(JSON.parse(await binaryChartsPart.async("string"))).map(
        (chart) => chartSchema.parse(chart),
      )
    : [];
  const binaryChartSheetIds = new Set(
    binaryCharts.map((chart) => chart.sheetId),
  );
  for (let i = 0; i < book.SheetNames.length; i++) {
    const name = book.SheetNames[i],
      source = book.Sheets[name] ?? {},
      id = sheetIds.get(name)!;
    const meta =
      sourceSheets.find((s) => s["@_name"] === name) ?? sourceSheets[i];
    const rel = rels.get(meta?.["@_id"]);
    const partPath = rel?.path ?? `xl/worksheets/sheet${i + 1}.xml`;
    const isChartsheet =
      binaryChartSheetIds.has(id) ||
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
      takeExcelHyperlink(cell, target, droppedLinks);
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
    // Avoid scanning every cell for formulas in formula-free sheets. The broad
    // cell-to-formula regex becomes quadratic when no formula exists, which is
    // common in large formatted or merged workbooks.
    if (/<(?:\w+:)?f\b/.test(raw)) {
      const cellPattern =
        /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
      const formulaPattern =
        /<(?:\w+:)?f\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?f>)/;
      const sharedDefs = new Map<
        string,
        { origin: { r: number; c: number }; formula: string }
      >();
      for (const m of raw.matchAll(cellPattern)) {
        const cAttrs = attrParser(m[1]);
        const formula = m[2]?.match(formulaPattern);
        if (!formula) continue;
        const fAttrs = attrParser(formula[1]);
        const fText = formula[2]
          ? decodeXmlEntities(formula[2].trim())
          : undefined;
        // SheetJS omits a formula cell that has no cached value.
        if (cAttrs.r && fText) {
          const pos = XLSX.utils.decode_cell(cAttrs.r);
          if (pos.r >= 0 && pos.r <= 1048575 && pos.c >= 0 && pos.c <= 16383) {
            const target = ((cellData[pos.r] ??= {})[pos.c] ??= {});
            if (!target.f) {
              target.f = "=" + fText.replace(/^=/, "");
              stats.formulas++;
              maxRow = Math.max(maxRow, pos.r);
              maxCol = Math.max(maxCol, pos.c);
            }
          }
        }
        if (
          cAttrs.r &&
          fAttrs.si !== undefined &&
          fAttrs.t === "shared" &&
          fText
        ) {
          const origin = XLSX.utils.decode_cell(cAttrs.r);
          sharedDefs.set(fAttrs.si, { origin, formula: fText });
        }
      }
      if (sharedDefs.size) {
        const colRegex =
          /(^|[^._A-Z0-9])(\$?)([A-Z]{1,3}):(\$?)([A-Z]{1,3})(?![_.\(A-Za-z0-9])/g;
        for (const m of raw.matchAll(cellPattern)) {
          const cAttrs = attrParser(m[1]);
          const formula = m[2]?.match(formulaPattern);
          if (!formula) continue;
          const fAttrs = attrParser(formula[1]);
          if (
            cAttrs.r &&
            fAttrs.si !== undefined &&
            sharedDefs.has(fAttrs.si)
          ) {
            const def = sharedDefs.get(fAttrs.si)!;
            const pos = XLSX.utils.decode_cell(cAttrs.r);
            const dc = pos.c - def.origin.c;
            const hasWholeColumnRange = colRegex.test(def.formula);
            colRegex.lastIndex = 0;
            let corrected = def.formula;
            if (dc !== 0 && hasWholeColumnRange) {
              corrected = corrected.replace(
                colRegex,
                (_, prefix, s1, c1, s2, c2) => {
                  const shift = (colStr: string, abs: boolean) => {
                    if (abs) return "$" + colStr;
                    const newCol = XLSX.utils.decode_col(colStr) + dc;
                    return newCol >= 0 ? XLSX.utils.encode_col(newCol) : colStr;
                  };
                  return (
                    prefix + shift(c1, s1 === "$") + ":" + shift(c2, s2 === "$")
                  );
                },
              );
            }
            corrected = implicitIntersectConcatenatedWholeColumns(
              corrected,
              pos.r,
            );
            if (pos.r < 0 || pos.r > 1048575 || pos.c < 0 || pos.c > 16383) continue;
            const target = ((cellData[pos.r] ??= {})[pos.c] ??= {});
            if (!target.f || corrected !== def.formula) {
              if (!target.f) stats.formulas++;
              target.f = "=" + corrected;
              maxRow = Math.max(maxRow, pos.r);
              maxCol = Math.max(maxCol, pos.c);
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
    const columnPixels: Record<string, number> = {};
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
          columnPixels[c] = d.w;
        }
        if (a.hidden === "1" || a.hidden === "true") d.hd = 1;
        if (a.style !== undefined && styles["excel-" + a.style])
          d.s = "excel-" + a.style;
        if (Object.keys(d).length) columnData[c] = d;
      }
    }
    const outline = readWorksheetOutline(raw);
    for (const column of outline.columnGroups.flatMap((group) => group.collapsed))
      (columnData[column] ??= {}).hd = 1;
    for (const row of outline.rowGroups.flatMap((group) => group.collapsed))
      (rowData[row] ??= {}).hd = 1;
    for (const group of outline.columnGroups)
      maxCol = Math.max(maxCol, group.endColumn);
    for (const group of outline.rowGroups) maxRow = Math.max(maxRow, group.endRow);
    if (outline.columnGroups.length || outline.rowGroups.length)
      features.push("outline");
    if (outline.nested)
      warnings.push(
        "Nested Excel outlines were opened as one group. Inner outline levels were not kept separate.",
      );
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
          // Export maps these pixel widths back to the stored character widths.
          columnPixels,
          characterPixels: 7,
          defaultColumnPixels: defaultColumnWidth,
        },
        ...(outline.columnGroups.length
          ? { suiteleafColumnGroups: outline.columnGroups }
          : {}),
        ...(outline.rowGroups.length
          ? { suiteleafRowGroups: outline.rowGroups }
          : {}),
      },
      defaultStyle: styles["excel-0"] ? "excel-0" : undefined,
      defaultColumnWidth,
      defaultRowHeight,
      zoomRatio: 1,
      showGridlines: isChartsheet
        ? 0
        : view?.["@_showGridLines"] === "0"
          ? 0
          : 1,
      rightToLeft: view?.["@_rightToLeft"] === "1" ? 1 : 0,
    };
    const comments: XLSX.WorkSheet = {};
    const denseCells = (source as any)["!data"] as
      (XLSX.CellObject | undefined)[][] | undefined;
    if (denseCells)
      denseCells.forEach((row, r) =>
        row?.forEach((cell, c) => {
          if (cell?.c?.length)
            comments[XLSX.utils.encode_cell({ r, c })] = {
              t: cell.t,
              c: cell.c,
            };
        }),
      );
    else
      for (const [ref, cell] of Object.entries(source))
        if (!ref.startsWith("!") && (cell as XLSX.CellObject)?.c?.length)
          comments[ref] = cell;
    commentSources.Sheets[name] = comments;
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
  await importExcelFeatures(file, zip, sheetSources, commentSources, warnings);
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
  if (binaryChartsPart) {
    file.content.charts.push(...binaryCharts);
    stats.charts += binaryCharts.length;
    if (!features.includes("charts")) features.push("charts");
    for (const chart of binaryCharts) {
      if (workbook.sheets[chart.sheetId])
        workbook.sheets[chart.sheetId].showGridlines = 0;
    }
  }
  file.content.images = await readExcelImages(zip, sheetSources, warnings);
  for (const [feature, warning] of Object.entries({
    autofilters:
      "Autofilter definitions are not recreated; the data can be filtered with the Sheets toolbar.",
    sheet_protection:
      "Protected Excel sheets open read-only; local protection can be removed in Data, Protect sheets and ranges.",
    pivot_tables:
      "Excel pivot results are retained as cells, but Excel pivot definitions are not recreated.",

    external_links:
      "External workbook links are retained as formula text and cached values; no external files are fetched.",
  }))
    if (features.includes(feature)) warnings.push(warning);
  if (droppedLinks.length) warnings.push(removedLinkWarning(droppedLinks));
  if (stats.formulas) {
    features.push("formulas");
    warnings.push(
      `${stats.formulas === 1 ? "1 Excel formula was" : `${stats.formulas} Excel formulas were`} kept with their last calculated results. SuiteLeaf recalculates them with its own formula engine, so results of Excel-only functions may differ.`,
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
