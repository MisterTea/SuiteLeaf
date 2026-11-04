import {
  anchorRowSpans,
  builtinTableStyle,
  plainTableGrid,
  cellMarkUsed,
  explicitTableCell,
  tableLineLayout,
  mergeTableCell,
  tableCellContinues,
  distributeUnsetTableRows,
  growClippedTableRows,
  scaleRowsIntoFrame,
  tableFractions,
  tableFrameBox,
  tableTextRowEmu,
  tableStyleAt,
  tableStyleById,
  tableStyleEdges,
  tableStyleFlags,
  tablePropertyFillXml,
} from "./pptx-table";
import { applyBlipLuminance, paintableImage } from "./pptx-pictures";
import { paintColor, themeFillReference } from "./pptx-theme";
import { parseXmlAttrs, resolveZipPath } from "./pptx-package";
import { detectImageMime } from "./pptx-media";
import type { SlideContext } from "./pptx-slide-context";

/** A DrawingML table, with its style, row heights, and cell pictures. */
export async function paintSlideTable(
  slide: SlideContext,
  gfXml: string,
  gfMatch: RegExpExecArray,
  tblMatch: RegExpExecArray,
) {
  const {
    zip,
    slidePath,
    slideRels,
    width,
    height,
    emuWidth,
    emuHeight,
    elements,
    parseTransform,
    parseTextBody,
    recolor,
    scheme,
    tableStylesXml,
    themeFont,
    themePart,
    colorMap,
    rememberShape,
    masterPart,
  } = slide;
  // Table text takes the master's otherStyle: its size, alignment, and colour.
  const otherStyle =
    /<p:otherStyle\b[\s\S]*?<\/p:otherStyle>/.exec(masterPart?.xml || "")?.[0] || "";
  const tbl = tblMatch[0];
  const frame = parseTransform(gfXml, gfMatch.index, gfXml.length);
  const cols = [...tbl.matchAll(/<a:gridCol\b[^>]*\bw="(\d+)"/g)].map(
    (match) => Number(match[1]),
  );
  const rows: string[][] = [];
  const cellMarks: ReturnType<typeof explicitTableCell>[][] = [];
  const rowSpans = anchorRowSpans(tbl);
  let anchor = 0;
  const pictures: {
    xEmu: number;
    yEmu: number;
    wEmu: number;
    hEmu: number;
    src: string;
    rowIndex: number;
  }[] = [];
  let yEmu = 0;
  const rowEmu: number[] = [];
  const cellColumns: number[][] = [];
  const trRx = /<a:tr\b[\s\S]*?<\/a:tr>/g;
  let trMatch: RegExpExecArray | null;
  while ((trMatch = trRx.exec(tbl)) !== null) {
    const rowXml = trMatch[0];
    const rowH = Number(/<a:tr\b[^>]*\bh="(\d+)"/.exec(rowXml)?.[1] ?? 0);
    const row: string[] = [];
    const marks: ReturnType<typeof explicitTableCell>[] = [];
    const columns: number[] = [];
    let xEmu = 0;
    let col = 0;
    const tcRx = /<a:tc\b[\s\S]*?<\/a:tc>/g;
    let tcMatch: RegExpExecArray | null;
    while ((tcMatch = tcRx.exec(rowXml)) !== null) {
      const cell = tcMatch[0];
      const span = Number(/gridSpan="(\d+)"/.exec(cell)?.[1] ?? 1);
      const wEmu = cols
        .slice(col, col + span)
        .reduce((sum, width) => sum + width, 0);
      if (tableCellContinues(cell)) {
        xEmu += wEmu;
        col += span;
        continue;
      }
      const tcPr = /<a:tcPr\b[\s\S]*?<\/a:tcPr>/.exec(cell)?.[0] ?? "";
      for (const blipMatch of tcPr.matchAll(/<a:blip\b([^>]*)\/?>/g)) {
        const blipAttrs = parseXmlAttrs(blipMatch[1]);
        const rId = blipAttrs["r:embed"] || blipAttrs["r:link"];
        if (!rId || !slideRels[rId]) continue;
        const mediaFile = zip.file(
          resolveZipPath(slidePath, slideRels[rId].target),
        );
        if (!mediaFile) continue;
        const imgBytes = await mediaFile.async("uint8array");
        const src = recolor(
          applyBlipLuminance(paintableImage(imgBytes, detectImageMime(imgBytes)), cell),
          cell,
        );
        if (!src) continue;
        pictures.push({
          xEmu,
          yEmu,
          wEmu,
          hEmu: rowH,
          src,
          rowIndex: rowEmu.length,
        });
      }
      const cellTx = await parseTextBody(cell, otherStyle ? [otherStyle] : [], { table: true });
      columns.push(col);
      row.push(cellTx.map((p) => p.text).join("\n"));
      const laid = explicitTableCell(cell, cellTx, (xml) =>
        paintColor(xml, scheme),
      );
      const lines = tableLineLayout(cellTx);
      if (lines) laid.lines = lines;
      const rowSpan = rowSpans[anchor] ?? 1;
      anchor += 1;
      if (rowSpan > 1) laid.rowSpan = rowSpan;
      marks.push(laid);
      xEmu += wEmu;
      col += span;
    }
    if (row.length > 0) {
      rows.push(row);
      cellMarks.push(marks);
      cellColumns.push(columns);
      rowEmu.push(rowH);
    }
    yEmu += rowH;
  }
  const styleId =
    /<a:tableStyleId>([^<]*)<\/a:tableStyleId>/.exec(tbl)?.[1]?.trim() ?? "";
  const styleXml = styleId
    ? (tableStyleById(tableStylesXml, styleId) ?? builtinTableStyle(styleId))
    : plainTableGrid();
  const flags = tableStyleFlags(tbl);
  const paint = (xml: string) => paintColor(xml, scheme);
  const styledMarks = cellMarks.map((tableRow, rowIndex) => {
    let grid = 0;
    return tableRow.map((cell) => {
      const colCount = cols.length || grid + (cell.colSpan ?? 1);
      const styled = styleXml
        ? tableStyleAt(
            styleXml,
            flags,
            rowIndex,
            grid,
            rows.length,
            colCount,
            paint,
          )
        : undefined;
      const edges = styleXml
        ? tableStyleEdges(
            styleXml,
            flags,
            rowIndex,
            grid,
            rows.length,
            colCount,
            paint,
          )
        : undefined;
      grid += cell.colSpan ?? 1;
      return mergeTableCell(cell, styled, undefined, edges);
    });
  });
  const tableW = cols.reduce((sum, width) => sum + width, 0) || 1;
  // A row that clips its text grows, and growth past the frame is scaled
  // back into the frame. A modest on-slide frame that is taller than
  // those rows is the resized table, so the rows scale up to fill it.
  const xfrm =
    /<(?:a|p):xfrm\b[\s\S]*?<\/(?:a|p):xfrm>/.exec(gfXml)?.[0] ?? "";
  const frameCx = Number(/<(?:a|p):ext\b[^>]*\bcx="(\d+)"/.exec(xfrm)?.[1] ?? 0);
  const frameCy = Number(/<(?:a|p):ext\b[^>]*\bcy="(\d+)"/.exec(xfrm)?.[1] ?? 0);
  const frameTop = Number(/<(?:a|p):off\b[^>]*\by="(-?\d+)"/.exec(xfrm)?.[1] ?? 0);
  const distributedRows = distributeUnsetTableRows(rowEmu, frameCy, frameCx);
  const neededRows = tableTextRowEmu(rows, styledMarks, cols, cellColumns);
  const grownRows = growClippedTableRows(
    distributedRows,
    neededRows,
    frameCy,
    frameCx,
  );
  // Stored rows that clip their text, inside a modest on-slide frame,
  // are the resized grid. Rows that already fit leave the extra frame empty.
  const storedClipsText = distributedRows.some(
    (height, index) => (neededRows[index] ?? 0) > height + 12700,
  );
  const resolvedRows = storedClipsText
    ? scaleRowsIntoFrame(grownRows, frameCy, frameTop, frameCx, emuHeight)
    : grownRows;
  const rowStart: number[] = [];
  let gridH = 0;
  for (const height of resolvedRows) {
    rowStart.push(gridH);
    gridH += height;
  }
  for (const picture of pictures) {
    const start = rowStart[picture.rowIndex];
    if (start == null) continue;
    picture.yEmu = start;
    picture.hEmu = resolvedRows[picture.rowIndex] ?? picture.hEmu;
  }
  const box = tableFrameBox(
    frame,
    frameCx,
    frameCy,
    tableW,
    gridH || yEmu || 1,
    { width, height, emuWidth, emuHeight },
  );
  const tableH = box.emuHeight;
  for (const picture of pictures) {
    elements.push({
      id: crypto.randomUUID(),
      type: "image",
      x: frame.x + Math.round((picture.xEmu / tableW) * box.width),
      y: frame.y + Math.round((picture.yEmu / tableH) * box.height),
      width: Math.max(
        20,
        Math.round((picture.wEmu / tableW) * box.width),
      ),
      height: Math.max(
        16,
        Math.round((picture.hEmu / tableH) * box.height),
      ),
      src: picture.src,
      alt: "Slide image",
    });
  }
  if (rows.length > 0) {
    const hasMarks = styledMarks.some((tableRow) =>
      tableRow.some((cell) => cellMarkUsed(cell)),
    );
    const colWidths = tableFractions(cols);
    const rowHeights =
      tableH > 0 ? resolvedRows.map((height) => height / tableH) : undefined;
    const minorFont = themeFont("+mn-lt");
    const directFill = tablePropertyFillXml(tbl);
    const styleBg = themeFillReference(
      themePart?.xml,
      /<a:tblBg\b[\s\S]*?<\/a:tblBg>/.exec(styleXml || "")?.[0] ?? "",
      colorMap,
    );
    const directBg =
      directFill && directFill !== "none"
        ? themeFillReference(themePart?.xml, directFill, colorMap)
        : undefined;
    // A gradient or solid on tblPr is the wash behind transparent cells.
    // noFill is an explicit empty background, not a request for the style.
    const tableBg = directFill === "none" ? undefined : directBg || styleBg;
    rememberShape(gfXml);
    elements.push({
      id: crypto.randomUUID(),
      type: "table",
      x: frame.x,
      y: frame.y,
      width: box.width,
      height: box.height,
      rows,
      ...(tableBg ? { fill: tableBg } : {}),
      ...(minorFont ? { fontFamily: minorFont } : {}),
      ...(colWidths ? { colWidths } : {}),
      ...(rowHeights ? { rowHeights } : {}),
      ...(hasMarks ? { cellMarks: styledMarks } : {}),
      ...(/\brtl="(?:1|true)"/.test(/<a:tblPr\b[^>]*>/.exec(tbl)?.[0] ?? "")
        ? { rtl: true }
        : {}),
    });
  }
}
