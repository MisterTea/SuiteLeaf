import { DEFAULT_PADDING_DATA, DocSimpleSkeleton, FontCache } from "@univerjs/engine-render";
import { Fragment } from "react";
import { wordOnLine, type Box, type CellLayout, type SheetIssue, type TextLine } from "./grid-spelling";

type Rect = { left: number; top: number; width: number; height: number };

function readRect(sheet: any, row: number, column: number): Rect | null {
  try {
    const raw = JSON.parse(sheet.getRange(row, column, 1, 1).getCellRect().toJSON());
    return { left: raw.left, top: raw.top, width: raw.width, height: raw.height };
  } catch {
    return null;
  }
}

function viewportRect(sheet: any, row: number, column: number): Rect | null {
  const cell = readRect(sheet, row, column);
  if (!cell) return null;
  let scrollX = 0;
  let scrollY = 0;
  try {
    const freeze = sheet.getFreeze?.() ?? {};
    const frozenRows = freeze.ySplit ? (freeze.startRow ?? 0) : 0;
    const frozenColumns = freeze.xSplit ? (freeze.startColumn ?? 0) : 0;
    const state = sheet.getScrollState?.() ?? {};
    const base = readRect(sheet, frozenRows, frozenColumns);
    const start = readRect(
      sheet,
      (state.sheetViewStartRow ?? 0) + frozenRows,
      (state.sheetViewStartColumn ?? 0) + frozenColumns,
    );
    if (base && start) {
      if (column >= frozenColumns) scrollX = start.left - base.left + (state.offsetX ?? 0);
      if (row >= frozenRows) scrollY = start.top - base.top + (state.offsetY ?? 0);
    }
  } catch {
    /* The first paint can happen before the grid can scroll. */
  }
  return { ...cell, left: cell.left - scrollX, top: cell.top - scrollY };
}

type CellStyle = {
  fs?: number;
  ff?: string;
  it?: number;
  bl?: number;
  ht?: number;
  vt?: number;
  tb?: number;
  pd?: { t?: number; b?: number; l?: number; r?: number };
};

/** Univer's alignment and wrap numbers: 2 is center and middle, 3 is right, bottom, and wrap. */
const WRAP = 3;
const TOP = 1;
const MIDDLE = 2;

/**
 * The cell's font, padding, alignment, and lines, read the way the grid paints
 * them. The painted font cache wins over the stored style when it has the cell.
 */
function cellLayout(sheet: any, row: number, column: number, text: string, rect: Rect) {
  let style: CellStyle = {};
  try {
    style = sheet.getRange(row, column, 1, 1).getCellStyleData?.() ?? {};
  } catch {
    style = {};
  }
  let painted: { fontString?: string; wrapStrategy?: number; verticalAlign?: number; horizontalAlign?: number; resolvedHorizontalAlign?: number } | null = null;
  try {
    painted = sheet.getSkeleton?.()?.getFont?.(row, column) ?? null;
  } catch {
    painted = null;
  }
  const size = typeof style.fs === "number" && style.fs > 0 ? style.fs : 11;
  const family = typeof style.ff === "string" && style.ff ? style.ff : "Arial";
  const italic = style.it === 1 ? "italic" : "normal";
  const weight = style.bl === 1 ? "bold" : "normal";
  const font = painted?.fontString || `${italic} ${weight} ${size}pt ${family}`;
  const ht = painted?.resolvedHorizontalAlign ?? painted?.horizontalAlign ?? style.ht;
  const vt = painted?.verticalAlign ?? style.vt;
  const wrap = (painted?.wrapStrategy ?? style.tb) === WRAP;
  const cell: CellLayout = {
    width: rect.width,
    height: rect.height,
    padLeft: style.pd?.l ?? DEFAULT_PADDING_DATA.l,
    padRight: style.pd?.r ?? DEFAULT_PADDING_DATA.r,
    padTop: style.pd?.t ?? DEFAULT_PADDING_DATA.t,
    padBottom: style.pd?.b ?? DEFAULT_PADDING_DATA.b,
    align: ht === 2 ? "center" : ht === 3 ? "right" : "left",
    vAlign: vt === TOP ? "top" : vt === MIDDLE ? "middle" : "bottom",
  };
  const contentWidth = Math.max(0, cell.width - cell.padLeft - cell.padRight);
  const contentHeight = Math.max(0, cell.height - cell.padTop - cell.padBottom);
  const lines: TextLine[] = new DocSimpleSkeleton(
    text,
    font,
    wrap,
    contentWidth,
    cell.vAlign === "top" ? contentHeight : Infinity,
  ).calculate();
  const measure = (value: string) => FontCache.getMeasureText(value, font).width;
  return { cell, lines, measure };
}

export type Mark = {
  key: string;
  cellKey: string;
  word: string;
  label: string;
  left: number;
  top: number;
  width: number;
  hitLeft: number;
  hitTop: number;
  hitWidth: number;
  hitHeight: number;
  cell: Box;
};

export function placeMarks(workbook: any, host: HTMLElement, issues: SheetIssue[]): Mark[] {
  const sheet = workbook?.getActiveSheet?.();
  if (!sheet) return [];
  const canvas = [...host.querySelectorAll("canvas")]
    .filter((node) => {
      const box = node.getBoundingClientRect();
      return box.width > 80 && box.height > 80;
    })
    .sort((a, b) => {
      const left = a.getBoundingClientRect();
      const right = b.getBoundingClientRect();
      return right.width * right.height - left.width * left.height;
    })[0];
  if (!canvas) return [];
  const box = canvas.getBoundingClientRect();
  const marks: Mark[] = [];
  for (const issue of issues) {
    if (issue.sheetId !== sheet.getSheetId()) continue;
    const rect = viewportRect(sheet, issue.row, issue.column);
    if (!rect) continue;
    const layout = cellLayout(sheet, issue.row, issue.column, issue.text, rect);
    const band = wordOnLine(issue.text, issue.from, issue.to, layout.lines, layout.measure, layout.cell);
    if (!band) continue;
    const left = box.left + rect.left + band.x;
    const top = box.top + rect.top + band.y;
    if (left + band.width < box.left + 40 || left > box.right) continue;
    if (top < box.top + 16 || top > box.bottom) continue;
    const cellLeft = Math.max(box.left, box.left + rect.left);
    const cellTop = Math.max(box.top, box.top + rect.top);
    const cellRight = Math.min(box.right, box.left + rect.left + rect.width);
    const cellBottom = Math.min(box.bottom, box.top + rect.top + rect.height);
    const cell = {
      left: cellLeft,
      top: cellTop,
      width: Math.max(0, cellRight - cellLeft),
      height: Math.max(0, cellBottom - cellTop),
    };
    const hitLeft = Math.max(left, cell.left);
    const hitWidth = Math.min(left + band.width, cell.left + cell.width) - hitLeft;
    if (hitWidth < 4 || cell.height < 4) continue;
    marks.push({
      key: issue.key,
      cellKey: `${issue.sheetId}:${issue.row}:${issue.column}`,
      word: issue.word,
      label: issue.label,
      left,
      top,
      width: band.width,
      hitLeft,
      hitTop: cell.top,
      hitWidth,
      hitHeight: cell.height,
      cell,
    });
  }
  return marks;
}

export function SheetMarks({ marks, activeKey }: { marks: Mark[]; activeKey: string | null }) {
  return (
    <>
      {marks.map((mark) => (
        <Fragment key={mark.key}>
          <div
            className="sheet-spell-hit"
            data-spell-key={mark.key}
            data-spell-word={mark.word}
            data-spell-cell={mark.label}
            style={{
              left: mark.hitLeft,
              top: mark.hitTop,
              width: mark.hitWidth,
              height: mark.hitHeight,
            }}
          />
          <div
            className={`sheet-spell-mark${mark.key === activeKey ? " current" : ""}`}
            data-spell-word={mark.word}
            data-spell-cell={mark.label}
            style={{ left: mark.left, top: mark.top, width: mark.width }}
          />
        </Fragment>
      ))}
    </>
  );
}
