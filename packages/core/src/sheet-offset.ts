/**
 * `=OFFSET(A1, 1, 0)` and `=INDIRECT(A1)`.
 * One cell is returned. A range height or width is not calculated.
 */

import { cellAddress } from "./sheet-audit";

type Cell = { f?: string | null; v?: unknown } | null;

function columnIndex(letters: string): number {
  let column = 0;
  for (const char of letters.toUpperCase()) column = column * 26 + (char.charCodeAt(0) - 64);
  return column - 1;
}

function parseCell(token: string): { sheet: string | null; address: string; row: number; column: number } | null {
  const qualified = /^(?:'((?:[^']|'')*)'|([A-Za-z_][A-Za-z0-9_-]*))!(\$?[A-Z]+)\$?(\d+)$/i.exec(token.trim());
  const local = /^\$?([A-Z]+)\$?(\d+)$/i.exec(token.trim());
  const sheet = qualified ? (qualified[1] ?? qualified[2] ?? "").replaceAll("''", "'").trim() : null;
  const letters = qualified ? qualified[3] : local?.[1];
  const rowText = qualified ? qualified[4] : local?.[2];
  if (!letters || !rowText || (qualified && !sheet)) return null;
  const row = Number(rowText) - 1;
  if (!Number.isInteger(row) || row < 0) return null;
  return { sheet, address: `${letters.toUpperCase()}${rowText}`, row, column: columnIndex(letters) };
}

function whole(token: string, read: (address: string) => unknown): number | null {
  if (/^-?\d+$/.test(token.trim())) return Number(token.trim());
  const cell = parseCell(token);
  if (!cell) return null;
  const value = read(cell.sheet ? `${cell.sheet}!${cell.address}` : cell.address);
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function moved(start: { row: number; column: number; sheet: string | null }, rowDelta: number, columnDelta: number): string | null {
  const row = start.row + rowDelta;
  const column = start.column + columnDelta;
  if (row < 0 || column < 0) return null;
  const address = cellAddress(row, column);
  return start.sheet ? `${start.sheet}!${address}` : address;
}

/** The cell value, `#REF!`, `#VALUE!`, or null when this is not an offset formula. */
export function redirectResult(formula: string, read: (address: string) => unknown): unknown {
  const offset = /^=\s*OFFSET\s*\((.+)\)\s*$/i.exec(formula.trim());
  if (offset) {
    const parts = offset[1].split(",").map((item) => item.trim());
    if (parts.length !== 3) return null;
    const start = parseCell(parts[0]);
    const rowDelta = whole(parts[1], read);
    const columnDelta = whole(parts[2], read);
    if (!start) return "#REF!";
    if (rowDelta === null || columnDelta === null) return "#VALUE!";
    const address = moved(start, rowDelta, columnDelta);
    return address ? read(address) : "#REF!";
  }
  const indirect = /^=\s*INDIRECT\s*\((.+)\)\s*$/i.exec(formula.trim());
  if (!indirect) return null;
  const parts = indirect[1].split(",").map((item) => item.trim());
  if (parts.length !== 1) return null;
  const quoted = /^"([^"]*)"$/.exec(parts[0]);
  const text = quoted ? quoted[1] : read(parseCell(parts[0])?.sheet ? `${parseCell(parts[0])?.sheet}!${parseCell(parts[0])?.address}` : (parseCell(parts[0])?.address ?? ""));
  if (!quoted && !parseCell(parts[0])) return "#REF!";
  if (typeof text !== "string") return "#REF!";
  const target = parseCell(text);
  if (!target) return "#REF!";
  return read(target.sheet ? `${target.sheet}!${target.address}` : target.address);
}

/** Writes every offset formula on the sheet. */
export function applyOffset(
  rows: Record<string, Record<string, Cell> | undefined>,
  readValue?: (address: string) => unknown,
): string[] {
  const read =
    readValue ??
    ((address: string): unknown => {
      const cell = parseCell(address);
      if (!cell || cell.sheet) return undefined;
      return rows[String(cell.row)]?.[String(cell.column)]?.v;
    });
  const calculated: string[] = [];
  for (const [rowKey, row] of Object.entries(rows)) {
    for (const [columnKey, cell] of Object.entries(row ?? {})) {
      if (!cell || typeof cell.f !== "string") continue;
      const next = redirectResult(cell.f, read);
      if (next === null) continue;
      if (cell.v !== next) cell.v = next;
      const address = cellAddress(Number(rowKey), Number(columnKey));
      if (address) calculated.push(address);
    }
  }
  return calculated;
}
