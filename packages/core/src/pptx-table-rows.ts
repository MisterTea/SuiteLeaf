import { fontAdvance } from "./font-advances";
import { presentationSingleSpacing } from "./pptx-line-spacing";

/**
 * Google Slides writes a 3,000,000 EMU frame and keeps the real size on the
 * grid. PowerPoint draws that grid. A frame taller than its rows is leftover
 * space, not a stretch target: painting the rows into it covers the text
 * below. A frame that matches its grid, or a shorter resized frame, stays put.
 */
export function tableFrameBox(
  frame: { width: number; height: number },
  frameCx: number,
  frameCy: number,
  gridW: number,
  gridH: number,
  metrics: { width: number; height: number; emuWidth: number; emuHeight: number },
): { width: number; height: number; emuHeight: number } {
  const placeholder =
    frameCx === 3000000 &&
    frameCy === 3000000 &&
    gridW > 0 &&
    gridH > 0 &&
    (gridW !== frameCx || gridH !== frameCy);
  if (placeholder) {
    return {
      width: (gridW / metrics.emuWidth) * metrics.width,
      height: (gridH / metrics.emuHeight) * metrics.height,
      emuHeight: gridH,
    };
  }
  const rowsAreShorter = gridH > 0 && frameCy > gridH;
  return {
    width: frame.width,
    height: rowsAreShorter
      ? (gridH / metrics.emuHeight) * metrics.height
      : frame.height,
    emuHeight: rowsAreShorter ? gridH : frameCy > 0 ? frameCy : gridH || 1,
  };
}

/**
 * A stored row height is kept. Height 0 is unset, not a collapsed row, unless
 * the explicit rows already fill the frame. Those unset rows share whatever
 * frame height is left so the grid stays inside the graphic frame. The
 * 3,000,000 EMU placeholder is not a real frame, so it does not donate space.
 */
export function distributeUnsetTableRows(
  rowEmu: number[],
  frameCy: number,
  frameCx = 0,
): number[] {
  if (frameCx === 3000000 && frameCy === 3000000) return rowEmu;
  const unset = rowEmu.filter((height) => !(height > 0)).length;
  if (unset === 0) return rowEmu;
  const set = rowEmu.reduce((sum, height) => sum + (height > 0 ? height : 0), 0);
  const leftover = frameCy - set;
  if (!(leftover > 0)) return rowEmu;
  const share = leftover / unset;
  return rowEmu.map((height) => (height > 0 ? height : share));
}

/**
 * A resized table keeps its old row heights while the frame is the size
 * PowerPoint paints. Scale those rows into an on-slide frame that is only
 * modestly taller. A frame more than half again as tall is leftover space:
 * stretching it would cover the shapes underneath. The 3,000,000 EMU
 * placeholder is not a real frame.
 */
export function scaleRowsIntoFrame(
  rowEmu: number[],
  frameCy: number,
  frameTop: number,
  frameCx: number,
  slideEmuHeight: number,
): number[] {
  if (frameCx === 3000000 && frameCy === 3000000) return rowEmu;
  const sum = rowEmu.reduce((total, height) => total + height, 0);
  if (!(sum > 0) || !(frameCy > sum) || frameCy > sum * 1.5) return rowEmu;
  if (frameTop < -1 || frameTop + frameCy > slideEmuHeight + 1) return rowEmu;
  const scale = frameCy / sum;
  return rowEmu.map((height) => height * scale);
}

function wrapLines(
  text: string,
  widthPt: number,
  advances: number[],
): number {
  let offset = 0;
  let count = 0;
  for (const para of text.split("\n")) {
    if (!para) {
      count += 1;
      offset += 1;
      continue;
    }
    let line = 0;
    let lines = 1;
    let gap = 0;
    for (const word of para.match(/ +|[^ ]+/g) ?? []) {
      const chars = [...word];
      const widths = advances.slice(offset, offset + chars.length);
      offset += chars.length;
      const wordWidth = widths.reduce((sum, value) => sum + value, 0);
      if (/^ +$/.test(word)) { gap += wordWidth; continue; }
      if (wordWidth > widthPt) {
        if (line > 0) {
          lines += 1;
          line = 0;
        }
        for (const advance of widths) {
          if (line > 0 && line + advance > widthPt) {
            lines += 1;
            line = advance;
          } else line += advance;
        }
        gap = 0;
        continue;
      }
      if (line > 0 && line + gap + wordWidth > widthPt) {
        lines += 1;
        line = wordWidth;
      } else line += gap + wordWidth;
      gap = 0;
    }
    offset += 1; // explicit paragraph break
    count += lines;
  }
  return Math.max(count, 1);
}

type RowMeasure = {
  fontSize?: number;
  font?: string;
  bold?: boolean;
  italic?: boolean;
  padTop?: number;
  padRight?: number;
  padBottom?: number;
  padLeft?: number;
  colSpan?: number;
  textFlow?: "up" | "down" | "upright";
  /** Subscript runs are narrower than the concatenated cell text. */
  runs?: { text?: string; baseline?: number; fontSize?: number; font?: string; bold?: boolean; italic?: boolean; scriptScale?: boolean }[];
};

/** Measure the same face, style, and script size that each rendered run uses. */
function cellAdvances(text: string, mark: RowMeasure, font: number): number[] {
  const runs = mark.runs?.length && mark.runs.map(run => run.text || "").join("").replace(/\n+$/, "") === text
    ? mark.runs : [{ text }];
  return runs.flatMap(run => {
    const size = (run.fontSize && run.fontSize > 0 ? run.fontSize : font) * (run.scriptScale ? 2 / 3 : 1);
    const advanceOf = fontAdvance(run.font ?? mark.font, run.bold ?? !!mark.bold, run.italic ?? !!mark.italic);
    return [...(run.text || "")].map(ch => advanceOf(ch) * size);
  });
}

/**
 * Several empty paragraphs are line boxes. One empty paragraph is just an
 * empty cell, and it does not make the row taller.
 */
function blankParagraphLines(text: string): number {
  if (text.trim()) return 0;
  const lines = text.split("\n").length;
  return lines >= 2 ? lines : 0;
}

/** Wrapped height of one row, in EMUs. An empty row needs nothing. */
export function tableTextRowEmu(
  rows: string[][],
  marks: RowMeasure[][],
  colEmu: number[],
  columnStarts?: number[][],
): number[] {
  const pt = 12700;
  return rows.map((row, r) => {
    let col = 0;
    let need = 0;
    row.forEach((text, c) => {
      col = columnStarts?.[r]?.[c] ?? col;
      const mark = marks[r]?.[c];
      const span = mark?.colSpan && mark.colSpan > 0 ? mark.colSpan : 1;
      const width = colEmu.slice(col, col + span).reduce((sum, cell) => sum + cell, 0);
      col += span;
      // Rotated text runs along the spanning cell's height. Measuring it
      // against a narrow column creates dozens of false wrapped lines.
      if (mark?.textFlow) return;
      // Fixture grids use token widths. A real cell is at least a tenth of an inch.
      if (!(width > 100_000)) return;
      const blanks = blankParagraphLines(text);
      // A trailing empty paragraph is the end mark of the cell. It does not
      // add a line, and it must not stretch a row PowerPoint left equal.
      const body = text.replace(/\n+$/, "");
      if (!body.trim() && !blanks) return;
      const sized = mark?.fontSize && mark.fontSize > 0 ? mark.fontSize : 0;
      // Wrapped words keep the 14pt measure when the cell names no size.
      // Unsized empty paragraphs are the 18pt body default. Both sit on the
      // font-independent presentation line box.
      const font = sized || (blanks ? 18 : 14);
      const padLeft = (mark?.padLeft ?? 7.2) * pt;
      const padRight = (mark?.padRight ?? 7.2) * pt;
      const padTop = mark?.padTop ?? 3.6;
      const padBottom = mark?.padBottom ?? 3.6;
      const grid = presentationSingleSpacing;
      if (!body.trim() && blanks) {
        const height = (padTop + padBottom + blanks * font * grid) * pt;
        if (height > need) need = height;
        return;
      }
      const inner = Math.max(font, (width - padLeft - padRight) / pt);
      const lines = wrapLines(body, inner, cellAdvances(body, mark ?? {}, font));
      const height = (padTop + padBottom + lines * font * grid) * pt;
      if (height > need) need = height;
    });
    return need;
  });
}

/**
 * A stored row that clips its wrapped text grows to that text.
 * Rows that already fit stay on the stored grid, so a taller frame is not a
 * stretch target. Growth that would pass the graphic frame is scaled back
 * into it. The 3,000,000 EMU placeholder is not a real frame.
 */
export function growClippedTableRows(
  rowEmu: number[],
  neededEmu: number[],
  frameCy = 0,
  frameCx = 0,
): number[] {
  const grown = rowEmu.map((height, index) => {
    const need = neededEmu[index] ?? 0;
    if (!(height > 0) || !(need > height + 12700)) return height;
    return need;
  });
  const grew = grown.some((height, index) => height > (rowEmu[index] ?? 0));
  const sum = grown.reduce((total, height) => total + height, 0);
  if (
    !grew ||
    (frameCx === 3000000 && frameCy === 3000000) ||
    !(frameCy > 0) ||
    !(sum > frameCy)
  )
    return grown;
  const scale = frameCy / sum;
  return grown.map((height) => height * scale);
}
