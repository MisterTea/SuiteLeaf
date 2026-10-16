import type { SlideElement } from "@suiteleaf/core";

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
