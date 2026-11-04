import * as XLSX from "xlsx";
import JSZip from "jszip";
import { readBinaryExcelLayout } from "./excel-binary-metadata";
import { readBinaryLineCharts } from "./excel-binary-charts";
import { attrParser, segment } from "./excel-xml";
import { OfficeImportError } from "./office";

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
    const binaryCharts = readBinaryLineCharts(bytes, book);
    if (binaryCharts.length)
      converted.file(
        "xl/suiteleaf-binary-charts.json",
        JSON.stringify(binaryCharts),
      );
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
    const binaryStylesPart = converted.file("xl/styles.xml");
    let binaryStyles = binaryStylesPart
      ? await binaryStylesPart.async("string")
      : "";
    const originalXfs =
      segment(binaryStyles, "cellXfs")?.match(
        /<xf\b[^>]*(?:\/>|>[\s\S]*?<\/xf>)/g,
      ) ?? [];
    const addedXfs: string[] = [];
    const styleIds = new Map<string, number>();
    if (layout.fonts?.length) {
      const escape = (value: string) =>
        value.replace(
          /[&<>"]/g,
          (c) =>
            ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
        );
      binaryStyles = binaryStyles.replace(
        /<fonts\b[^>]*>[\s\S]*?<\/fonts>/,
        `<fonts count="${layout.fonts.length}">${layout.fonts.map((f) => `<font><name val="${escape(f.family)}"/><sz val="${f.size}"/>${f.bold ? "<b/>" : ""}${f.italic ? "<i/>" : ""}</font>`).join("")}</fonts>`,
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
      if (dimensions.frozen && dimensions.pane) {
        const { columns, rows } = dimensions.pane;
        const views = `<sheetViews><sheetView workbookViewId="0"><pane xSplit="${columns}" ySplit="${rows}" state="frozen"/></sheetView></sheetViews>`;
        const oldViews = segment(sheet, "sheetViews");
        sheet = oldViews
          ? sheet.replace(oldViews, views)
          : sheet.replace(/<sheetFormatPr\b/, views + "<sheetFormatPr");
      }
      sheet = sheet.replace(/<row\b([^>]*)>/g, (tag, text) => {
        const a = attrParser(text),
          height = dimensions.rowHeights?.[Number(a.r) - 1];
        if (height === undefined) return tag;
        const cleaned = text.replace(/\s+(?:ht|customHeight)="[^"]*"/g, "");
        return `<row${cleaned} ht="${height}" customHeight="1">`;
      });
      sheet = sheet.replace(/<c\b([^>]*)>/g, (tag, text) => {
        const a = attrParser(text),
          xfIndex = dimensions.cellXfs?.[a.r];
        const xf = xfIndex === undefined ? undefined : layout.xfs?.[xfIndex];
        if (!xf || !layout.fonts?.length) return tag;
        const key = `${a.s ?? 0}:${xfIndex}`;
        let id = styleIds.get(key);
        if (id === undefined) {
          const base = attrParser(originalXfs[Number(a.s) || 0] ?? "");
          // BIFF font index 4 is reserved and is absent from FONT records.
          const font = xf.font > 4 ? xf.font - 1 : xf.font;
          base.fontId = String(font);
          base.applyAlignment = "1";
          const horizontal =
            [
              "general",
              "left",
              "center",
              "right",
              "fill",
              "justify",
              "centerContinuous",
              "distributed",
            ][xf.horizontal] ?? "general";
          const vertical =
            ["top", "center", "bottom", "justify", "distributed"][
              xf.vertical
            ] ?? "bottom";
          id = originalXfs.length + addedXfs.length;
          addedXfs.push(
            `<xf ${Object.entries(base)
              .map(([k, v]) => `${k}="${v}"`)
              .join(
                " ",
              )}><alignment horizontal="${horizontal}" vertical="${vertical}" wrapText="${xf.wrap ? 1 : 0}"/></xf>`,
          );
          styleIds.set(key, id);
        }
        return `<c${text.replace(/\s+s="[^"]*"/g, "")} s="${id}">`;
      });
      converted.file(path, sheet);
    }
    if (addedXfs.length && binaryStylesPart) {
      binaryStyles = binaryStyles.replace(
        /<cellXfs\b[^>]*>[\s\S]*?<\/cellXfs>/,
        `<cellXfs count="${originalXfs.length + addedXfs.length}">${originalXfs.join("")}${addedXfs.join("")}</cellXfs>`,
      );
      converted.file("xl/styles.xml", binaryStyles);
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
