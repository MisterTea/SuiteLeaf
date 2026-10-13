import type { JsonNode } from "@suiteleaf/core";

/**
 * Pixel width of each logical column. A cell that spans columns stores one
 * entry per column, so a title across Item and Amount contributes both widths.
 */
export function tableColumnWidths(rows: JsonNode[]): number[] | null {
  let count = 0;
  const widths: Array<number | undefined> = [];
  for (const row of rows) {
    if (row.type !== "tableRow") continue;
    let column = 0;
    for (const cell of row.content ?? []) {
      const span = Math.max(1, Number(cell.attrs?.colspan) || 1);
      const colwidth = cell.attrs?.colwidth;
      for (let offset = 0; offset < span; offset += 1) {
        const value = Array.isArray(colwidth) ? colwidth[offset] : undefined;
        const width = typeof value === "number" ? value : Number.NaN;
        const index = column + offset;
        if (Number.isFinite(width) && width > 0 && widths[index] === undefined)
          widths[index] = width;
      }
      column += span;
    }
    count = Math.max(count, column);
  }
  if (count < 1) return null;
  const known = widths.slice(0, count);
  if (known.some((width) => width === undefined)) return null;
  return known as number[];
}

/** The same width for every column, still adding up to the current total. */
export function equalColumnShares(widths: number[]): number[] {
  if (widths.length === 0) return [];
  const total = widths.reduce((sum, width) => sum + width, 0);
  const share = total / widths.length;
  const shares = widths.map(() => share);
  shares[shares.length - 1] = total - share * (widths.length - 1);
  return shares;
}

function sameColwidth(cell: JsonNode, next: number[]): boolean {
  const current = cell.attrs?.colwidth;
  return (
    Array.isArray(current) &&
    current.length === next.length &&
    current.every((width, index) => width === next[index])
  );
}

/**
 * Make the columns the same width without changing the table's overall width.
 * Words, colspan, and rows stay as they are. A spanned cell keeps one width
 * for each column it covers.
 */
export function equalizeTableColumns(table: JsonNode): JsonNode {
  if (table.type !== "table") return table;
  const rows = table.content ?? [];
  const current = tableColumnWidths(rows);
  if (!current) return table;
  const shares = equalColumnShares(current);
  let changed = false;
  const content = rows.map((row) => {
    if (row.type !== "tableRow") return row;
    let column = 0;
    const cells = (row.content ?? []).map((cell) => {
      const span = Math.max(1, Number(cell.attrs?.colspan) || 1);
      const next = shares.slice(column, column + span);
      column += span;
      if (next.length !== span || sameColwidth(cell, next)) return cell;
      changed = true;
      return { ...cell, attrs: { ...cell.attrs, colwidth: next } };
    });
    return { ...row, content: cells };
  });
  if (!changed) return table;
  return { ...table, content };
}

/** Equalize the first table. Everything after it, including the next paragraph, stays put. */
export function equalizeDocumentTable(doc: JsonNode): JsonNode {
  let done = false;
  return {
    ...doc,
    content: (doc.content ?? []).map((node) => {
      if (done || node.type !== "table") return node;
      done = true;
      return equalizeTableColumns(node);
    }),
  };
}
