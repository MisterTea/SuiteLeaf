import type { JsonNode } from "@suiteleaf/core";

/**
 * Sort the body rows of a document table. Header rows stay first, and each
 * body row moves as a whole. A column of numbers sorts numerically, so 10
 * follows 2. Anything else sorts A to Z, ignoring case.
 */

/** The direction the next click will apply. The same column flips; another starts A to Z. */
export function nextSortAscending(
  previous: { column: number; ascending: boolean } | null,
  column: number,
): boolean {
  if (!previous || previous.column !== column) return true;
  return !previous.ascending;
}

/** "Sort Amount small to large" — the header's words, never a column number. */
export function sortColumnLabel(
  header: string,
  numeric: boolean,
  ascending: boolean,
): string {
  const name = header.trim();
  const direction = numeric
    ? ascending
      ? "small to large"
      : "large to small"
    : ascending
      ? "A to Z"
      : "Z to A";
  return name ? `Sort ${name} ${direction}` : `Sort ${direction}`;
}

function plainText(node: JsonNode | undefined): string {
  if (!node) return "";
  if (node.text) return node.text;
  return (node.content ?? []).map((child) => plainText(child)).join("");
}

function isHeaderRow(row: JsonNode): boolean {
  const cells = row.content ?? [];
  return (
    row.type === "tableRow" &&
    cells.length > 0 &&
    cells.every((cell) => cell.type === "tableHeader")
  );
}

function cellText(row: JsonNode, column: number): string {
  return plainText(row.content?.[column]);
}

/** A body cell counts as a number only when the whole cell is one. */
export function parseSortNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

export function columnHeaderName(rows: JsonNode[], column: number): string {
  const header = rows.find((row) => isHeaderRow(row));
  return header ? cellText(header, column).trim() : "";
}

export function columnSortsAsNumber(rows: JsonNode[], column: number): boolean {
  const body = rows.filter(
    (row) => row.type === "tableRow" && !isHeaderRow(row),
  );
  return (
    body.length > 0 &&
    body.every((row) => parseSortNumber(cellText(row, column)) !== null)
  );
}

function compareCells(a: string, b: string, numeric: boolean): number {
  if (numeric) return parseSortNumber(a)! - parseSortNumber(b)!;
  return a.trim().localeCompare(b.trim(), undefined, { sensitivity: "base" });
}

/** Header rows stay at the top, in their original order. Only body rows move. */
export function sortTableRows(
  rows: JsonNode[],
  column: number,
  ascending: boolean,
): JsonNode[] {
  const headers = rows.filter((row) => isHeaderRow(row));
  const body = rows.filter(
    (row) => row.type === "tableRow" && !isHeaderRow(row),
  );
  const rest = rows.filter((row) => row.type !== "tableRow");
  const numeric = columnSortsAsNumber(rows, column);
  const sorted = [...body].sort((a, b) => {
    const cmp = compareCells(cellText(a, column), cellText(b, column), numeric);
    return ascending ? cmp : -cmp;
  });
  return [...headers, ...sorted, ...rest];
}

/** Reorder the first table. Everything outside it, including the next paragraph, stays put. */
export function sortDocumentTable(
  doc: JsonNode,
  column: number,
  ascending: boolean,
): JsonNode {
  let sorted = false;
  return {
    ...doc,
    content: (doc.content ?? []).map((node) => {
      if (sorted || node.type !== "table") return node;
      sorted = true;
      return {
        ...node,
        content: sortTableRows(node.content ?? [], column, ascending),
      };
    }),
  };
}
