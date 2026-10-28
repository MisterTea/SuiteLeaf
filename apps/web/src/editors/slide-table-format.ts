import type { CSSProperties } from "react";
import type { SlideElement } from "@suiteleaf/core";

/** Paint imported cell fill, type size, and rules. Editor tables keep the default grid. */
export function slideCellPaint(
  mark: NonNullable<SlideElement["cellMarks"]>[number][number] | undefined,
  hideDefaultRules: boolean,
): CSSProperties {
  return {
    fontWeight: mark?.bold ? 700 : undefined,
    fontStyle: mark?.italic ? "italic" : undefined,
    background: mark?.fill,
    color: mark?.color,
    fontSize: mark?.fontSize
      ? `calc(${mark.fontSize} * var(--slide-pt, 1) * 1px)`
      : undefined,
    textAlign: mark?.align,
    lineHeight: mark?.fontSize ? 1 : undefined,
    whiteSpace: mark?.fontSize ? "pre-wrap" : undefined,
    border: mark?.border
      ? `calc(1px * var(--slide-pt, 1)) solid ${mark.border}`
      : hideDefaultRules
        ? "none"
        : undefined,
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
