import { TableRow } from "@tiptap/extension-table";
import type { JsonNode } from "@suiteleaf/core";

/**
 * Optional row height, in CSS pixels. Missing on older documents, which still
 * open. The editor writes it as the row's height, and save stores it on the row.
 */
export const tableRowWithHeight = TableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      height: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const raw =
            element.style.height || element.getAttribute("height") || "";
          const value = Number.parseFloat(raw);
          return Number.isFinite(value) && value > 0 ? value : null;
        },
        renderHTML: (attributes: { height?: unknown }) => {
          const height = positiveHeight(attributes.height);
          if (height === null) return {};
          return { height: String(height), style: `height: ${height}px` };
        },
      },
    };
  },
});

function positiveHeight(value: unknown): number | null {
  const height = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(height) && height > 0 ? height : null;
}

/** Stored height, or the rendered height when the row is tall because text wrapped. */
function rowSize(row: JsonNode, measured: number | undefined): number | null {
  const stored = positiveHeight(row.attrs?.height);
  const seen = positiveHeight(measured);
  if (stored === null && seen === null) return null;
  return Math.max(stored ?? 0, seen ?? 0);
}

/**
 * Make every row as tall as the tallest. The tallest row is left as it is,
 * so wrapped text is not squeezed. Words, colspan, and column widths stay.
 * `measured` is each row's rendered height, in order, when the tall one has
 * no stored height yet.
 */
export function equalizeTableRows(
  table: JsonNode,
  measured?: readonly number[],
): JsonNode {
  if (table.type !== "table") return table;
  const rows = table.content ?? [];
  let index = 0;
  const heights: number[] = [];
  for (const row of rows) {
    if (row.type !== "tableRow") continue;
    const size = rowSize(row, measured?.[index]);
    index += 1;
    if (size !== null) heights.push(size);
  }
  if (heights.length === 0) return table;
  const tallest = Math.max(...heights);
  index = 0;
  let changed = false;
  const content = rows.map((row) => {
    if (row.type !== "tableRow") return row;
    const stored = positiveHeight(row.attrs?.height);
    index += 1;
    if (stored === tallest) return row;
    changed = true;
    return { ...row, attrs: { ...row.attrs, height: tallest } };
  });
  if (!changed) return table;
  return { ...table, content };
}

/** Equalize the first table. Everything after it, including the next paragraph, stays put. */
export function equalizeDocumentTableRows(
  doc: JsonNode,
  measured?: readonly number[],
): JsonNode {
  let done = false;
  return {
    ...doc,
    content: (doc.content ?? []).map((node) => {
      if (done || node.type !== "table") return node;
      done = true;
      return equalizeTableRows(node, measured);
    }),
  };
}

/** Rendered height of each real row. Page-break spacers inside the table are skipped. */
export function measureTableRowHeights(table: HTMLTableElement): number[] {
  return [...table.rows]
    .filter((row) => !row.classList.contains("doc-page-spacer"))
    .map((row) => Math.max(row.offsetHeight, row.scrollHeight));
}
