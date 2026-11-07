import type { CSSProperties } from "react";
import { presentationSingleSpacing, type SlideElement } from "@suiteleaf/core";

/** Cell writing direction changes its contents, while borders stay on the grid. */
export function tableCellFlow(mark: NonNullable<SlideElement["cellMarks"]>[number][number] | undefined): CSSProperties | undefined {
  if (!mark?.textFlow) return;
  return {
    width: "100%", height: "100%", flexShrink: 0,
    writingMode: "vertical-rl",
    textOrientation: mark.textFlow === "upright" ? "upright" : "mixed",
    ...(mark.textFlow === "up" ? { transform: "rotate(180deg)" } : {}),
    display: "flex",
    alignItems: mark.align === "center" ? "center" : mark.align === "right" ? "flex-end" : "flex-start",
    justifyContent: mark.valign === "middle" ? "center" : mark.valign === "bottom" ? "flex-end" : "flex-start",
  };
}

function ruleCss(
  rule: { color: string; width?: number } | undefined,
): string | undefined {
  if (!rule) return;
  const width = rule.width ?? 1;
  return `calc(${width} * var(--slide-pt, 1) * 1px) solid ${rule.color}`;
}

function padCss(points: number | undefined): string | undefined {
  if (points == null) return;
  return `calc(${points} * var(--slide-pt, 1) * 1px)`;
}

/**
 * A table row's stored height, in the slide's container width.
 * A percentage of the table is an indefinite height, so the row collapses to
 * its text and an empty row sits on a different grid than PowerPoint.
 */
export function tableRowHeightCss(
  fraction: number,
  tableHeight: number,
  slideWidth: number,
): string {
  if (!(fraction > 0) || !(tableHeight > 0) || !(slideWidth > 0)) return "0px";
  return `calc(${fraction * tableHeight} / ${slideWidth} * 100cqw)`;
}

/**
 * Keep the row on that height. In-flow text would grow the row; the clip is
 * taken out of flow so a wrapped cell cannot steal space from the next row.
 * The stored height includes the rule. A content box would paint the border
 * outside that height and push every following row down by a pixel.
 */
export function tableCellLayout(
  rowHeight: string | undefined,
  spansRows: boolean,
  painted: CSSProperties,
): { td: CSSProperties; clip?: CSSProperties } {
  if (!rowHeight) return { td: painted };
  const { paddingTop, paddingRight, paddingBottom, paddingLeft, verticalAlign, ...rest } =
    painted;
  // DrawingML insets are measured from the grid, whose strokes are centred.
  // CSS positions an absolute child inside the collapsed half-border instead.
  // Return that half-stroke to the text area rather than narrowing every cell.
  const gridEdge = (border: CSSProperties["borderLeft"]) => {
    if (typeof border !== "string" || border === "none") return "0px";
    const width = /^calc\(([-\d.]+) \* var\(--slide-pt, 1\) \* 1px\)/.exec(border)?.[1];
    return width ? `calc(${-Number(width) / 2} * var(--slide-pt, 1) * 1px)` : "0px";
  };
  return {
    td: {
      ...rest,
      padding: 0,
      position: "relative",
      boxSizing: "border-box",
      ...(spansRows ? {} : { height: rowHeight }),
    },
    clip: {
      position: "absolute",
      inset: 0,
      left: gridEdge(painted.borderLeft ?? painted.border),
      right: gridEdge(painted.borderRight ?? painted.border),
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      justifyContent:
        verticalAlign === "middle" ? "center" : verticalAlign === "bottom" ? "flex-end" : "flex-start",
      paddingTop,
      paddingRight,
      paddingBottom,
      paddingLeft,
    },
  };
}

/** Paint imported cell fill, type size, and rules. Editor tables keep the default grid. */
export function slideCellPaint(
  mark: NonNullable<SlideElement["cellMarks"]>[number][number] | undefined,
  hideDefaultRules: boolean,
): CSSProperties {
  const edged = !!(
    mark?.borderTop ||
    mark?.borderRight ||
    mark?.borderBottom ||
    mark?.borderLeft
  );
  return {
    fontFamily: mark?.font,
    fontWeight: mark?.bold ? 700 : undefined,
    fontStyle: mark?.italic ? "italic" : undefined,
    background: mark?.fill,
    color: mark?.color,
    fontSize: mark?.fontSize
      ? `calc(${mark.fontSize} * var(--slide-pt, 1) * 1px)`
      : undefined,
    textAlign: mark?.align,
    // Use the same presentation line box as the row measurer.
    lineHeight: mark?.fontSize ? presentationSingleSpacing : undefined,
    whiteSpace: "pre-wrap",
    verticalAlign:
      mark?.valign === "middle"
        ? "middle"
        : mark?.valign === "bottom"
          ? "bottom"
          : mark?.valign === "top"
            ? "top"
            : undefined,
    paddingTop: padCss(mark?.padTop),
    paddingRight: padCss(mark?.padRight),
    paddingBottom: padCss(mark?.padBottom),
    paddingLeft: padCss(mark?.padLeft),
    border: edged
      ? "none"
      : mark?.border
        ? `calc(1px * var(--slide-pt, 1)) solid ${mark.border}`
        : hideDefaultRules
          ? "none"
          : undefined,
    borderTop: ruleCss(mark?.borderTop),
    borderRight: ruleCss(mark?.borderRight),
    borderBottom: ruleCss(mark?.borderBottom),
    borderLeft: ruleCss(mark?.borderLeft),
  };
}

/** Turn bold or italic on or off for one cell. Other cells keep their marks. */
export function toggleSlideCellMark(
  el: SlideElement,
  row: number,
  col: number,
  kind: "bold" | "italic",
): Pick<SlideElement, "cellMarks"> | null {
  const rows = el.rows;
  if (!rows?.[row] || col < 0 || col >= rows[row].length) return null;
  const marks = rows.map((cells, rowIndex) =>
    cells.map((_, column) => ({ ...(el.cellMarks?.[rowIndex]?.[column] ?? {}) })),
  );
  const cell = marks[row][col];
  if (cell[kind]) delete cell[kind];
  else cell[kind] = true;
  return { cellMarks: marks };
}
