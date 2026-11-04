type Axis = "row" | "column";

type CellKey = { sheetId: string; row: number; column: number };

/** Where a row or column index lands. The move is refused when the destination overlaps the source. */
export function movedByDrag(index: number, from: number, count: number, to: number): number | null {
  if (count < 1 || from < 0 || to < 0) return null;
  if (to >= from && to < from + count) return null;
  if (from < to && from + count > to) return null;
  if (index >= from && index < from + count) {
    return from < to ? to - count + (index - from) : to + (index - from);
  }
  if (from > to && index >= to && index < from) return index + count;
  if (from < to && index >= from + count && index < to) return index - count;
  return index;
}

function relocateFormula(formula: string, axis: Axis, from: number, count: number, to: number): string {
  const quoted: string[] = [];
  const hidden = formula.replace(/"(?:[^"]|"")*"/g, (match) => {
    quoted.push(match);
    return `"${quoted.length - 1}"`;
  });
  const shifted = hidden.replace(
    /(^|[^A-Za-z0-9_!])(\$?)([A-Za-z]+)(\$?)(\d+)/g,
    (whole, lead: string, columnLock: string, letters: string, rowLock: string, rowText: string) => {
      const row = Number(rowText) - 1;
      const column = columnIndex(letters);
      if (!Number.isInteger(row) || column < 0) return whole;
      const next = movedByDrag(axis === "row" ? row : column, from, count, to);
      if (next == null) return whole;
      if (axis === "row") return `${lead}${columnLock}${letters}${rowLock}${next + 1}`;
      return `${lead}${columnLock}${columnLetters(next)}${rowLock}${rowText}`;
    },
  );
  return shifted.replace(/"(\d+)"/g, (whole, index: string) => quoted[Number(index)] ?? whole);
}

function columnIndex(letters: string): number {
  let index = 0;
  for (const char of letters.toUpperCase()) {
    if (char < "A" || char > "Z") return -1;
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

function columnLetters(index: number): string {
  let current = index + 1;
  let letters = "";
  while (current > 0) {
    const remainder = (current - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    current = Math.floor((current - 1) / 26);
  }
  return letters;
}

function rewriteMoved(json: string, axis: Axis, from: number, count: number, to: number): string {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    return json;
  }
  if (typeof value === "string" && value.startsWith("=")) {
    return JSON.stringify(relocateFormula(value, axis, from, count, to));
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return json;
  const cell = value as { f?: unknown };
  if (typeof cell.f !== "string") return json;
  return JSON.stringify({ ...cell, f: relocateFormula(cell.f, axis, from, count, to) });
}

/** Move this worksheet's cells the way a row or column drag does. Other worksheets stay put. */
export function dragSheetCells(
  cells: Map<string, string>,
  sheetId: string,
  axis: Axis,
  from: number,
  count: number,
  to: number,
  keyOf: (sheetId: string, row: number, column: number) => string | null,
  parse: (key: string) => CellKey | null,
): void {
  if (movedByDrag(from, from, count, to) == null) return;
  const next = new Map<string, string>();
  for (const [key, json] of cells) {
    const parsed = parse(key);
    if (!parsed || parsed.sheetId !== sheetId) {
      next.set(key, json);
      continue;
    }
    const index = axis === "row" ? parsed.row : parsed.column;
    const landed = movedByDrag(index, from, count, to) ?? index;
    const row = axis === "row" ? landed : parsed.row;
    const column = axis === "column" ? landed : parsed.column;
    const dest = keyOf(sheetId, row, column);
    if (!dest) continue;
    next.set(dest, rewriteMoved(json, axis, from, count, to));
  }
  cells.clear();
  for (const [key, json] of next) cells.set(key, json);
}
