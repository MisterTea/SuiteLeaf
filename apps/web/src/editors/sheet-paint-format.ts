/**
 * Bold, font color, and number format copied from one cell.
 * The cell's value is not part of the copy.
 */
export type CopiedCellFormat = {
  bold: boolean;
  /** CSS color, such as "#1a73e8". Null when the source has no font color. */
  color: string | null;
  /** Excel/Univer number-format code. Null when the source has no number format. */
  numberFormat: string | null;
};

/** A cell the copied format can be painted onto. `value` is never replaced. */
export type CellPaintTarget = {
  value: unknown;
  bold: boolean;
  color: string | null;
  numberFormat: string | null;
};

/** The style fields a sheet range reports for the active cell. */
export type CellStyleSnapshot = {
  bl?: number | boolean | null;
  cl?: { rgb?: string | null } | string | null;
  n?: { pattern?: string | null } | null;
} | null;

function colorOf(
  color: { rgb?: string | null } | string | null | undefined,
): string | null {
  if (!color) return null;
  if (typeof color === "string") {
    const trimmed = color.trim();
    return trimmed ? trimmed : null;
  }
  const rgb = color.rgb?.trim();
  return rgb ? rgb : null;
}

function patternOf(pattern: string | null | undefined): string | null {
  const trimmed = pattern?.trim() ?? "";
  if (!trimmed || trimmed === "General") return null;
  return trimmed;
}

/**
 * Reads bold, font color, and number format from a cell style.
 * A plain cell returns an empty format. The value is not read.
 */
export function copyCellFormat(
  style: CellStyleSnapshot,
  numberFormat?: string | null,
): CopiedCellFormat {
  const fromStyle =
    style?.n && typeof style.n === "object" ? style.n.pattern : null;
  return {
    bold: style?.bl === 1 || style?.bl === true,
    color: colorOf(style?.cl),
    numberFormat: patternOf(numberFormat) ?? patternOf(fromStyle),
  };
}

export function isEmptyCellFormat(format: CopiedCellFormat | null): boolean {
  return !format || (!format.bold && !format.color && !format.numberFormat);
}

/**
 * Paints a copied format onto a cell. The destination value stays.
 * An empty copy changes nothing, including a cell that already has a format.
 */
export function applyCopiedCellFormat(
  destination: CellPaintTarget,
  format: CopiedCellFormat | null,
): CellPaintTarget {
  if (isEmptyCellFormat(format) || !format) return { ...destination };
  return {
    value: destination.value,
    bold: format.bold ? true : destination.bold,
    color: format.color ?? destination.color,
    numberFormat: format.numberFormat ?? destination.numberFormat,
  };
}
