/**
 * Dropdowns whose options are the cells of a range.
 * Colours follow the option's name, and a blank cell is not an option.
 */

import {
  DROPDOWN_COLORS,
  trimmedText,
  type DropdownOption,
} from "./sheet-dropdowns";

export type SourceCell = {
  row: number;
  column: number;
  label: string;
  color: string;
};

/** Previous names and the colours attached to them, stored in the rule. */
export type DropdownMeta = {
  colors: Record<string, string>;
  sources: { row: number; column: number; label: string }[];
};

export type ParsedRef = {
  sheet: string | null;
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
};

const CELL = /^([A-Za-z]{1,3})(\d+)$/;

function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function columnLetters(index: number): string {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

export function cellRef(row: number, column: number): string {
  return `${columnLetters(column)}${row + 1}`;
}

function parseCell(token: string): { row: number; column: number } | null {
  const match = CELL.exec(token.trim());
  if (!match) return null;
  const row = Number(match[2]) - 1;
  if (row < 0) return null;
  return { row, column: columnIndex(match[1]) };
}

/** Statuses!$A$2:$A$5, 'Food bank'!A2:A5, or A2:A5. */
export function parseA1Ref(input: string): ParsedRef | null {
  let text = input.trim().replace(/^=/, "").replace(/\$/g, "");
  text = text.replace(/^\[[^\]]+\]/, "");
  if (!text) return null;
  let sheet: string | null = null;
  const bang = text.lastIndexOf("!");
  if (bang >= 0) {
    sheet = text.slice(0, bang);
    if (sheet.startsWith("'") && sheet.endsWith("'"))
      sheet = sheet.slice(1, -1).replace(/''/g, "'");
    // A row insert rewrites the ref as [workbookId]Statuses!A2:A6.
    sheet = sheet.replace(/^\[[^\]]+\]/, "");
    text = text.slice(bang + 1);
    if (!sheet) return null;
  }
  const [start, end] = text.split(":");
  const a = parseCell(start ?? "");
  const b = parseCell(end ?? start ?? "");
  if (!a || !b) return null;
  return {
    sheet,
    startRow: Math.min(a.row, b.row),
    endRow: Math.max(a.row, b.row),
    startColumn: Math.min(a.column, b.column),
    endColumn: Math.max(a.column, b.column),
  };
}

function quoteSheet(name: string): string {
  return /^[A-Za-z0-9_]+$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

/** Absolute reference Univer and Excel both read as a list source. */
export function formatRangeFormula(ref: ParsedRef): string {
  const start = `$${columnLetters(ref.startColumn)}$${ref.startRow + 1}`;
  const end = `$${columnLetters(ref.endColumn)}$${ref.endRow + 1}`;
  const body = start === end ? start : `${start}:${end}`;
  return ref.sheet ? `=${quoteSheet(ref.sheet)}!${body}` : `=${body}`;
}

/** The range as a person would type it: Statuses!A2:A5. */
export function displayRangeRef(formula: string): string {
  const parsed = parseA1Ref(formula);
  if (!parsed) return formula.trim().replace(/^=/, "").replace(/\$/g, "");
  const start = `${columnLetters(parsed.startColumn)}${parsed.startRow + 1}`;
  const end = `${columnLetters(parsed.endColumn)}${parsed.endRow + 1}`;
  const body = start === end ? start : `${start}:${end}`;
  return parsed.sheet ? `${parsed.sheet}!${body}` : body;
}

export function parseDropdownMeta(formula2: string | undefined): DropdownMeta | null {
  const raw = String(formula2 ?? "").trim();
  if (!raw.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(raw) as DropdownMeta;
    if (!parsed || typeof parsed !== "object" || !parsed.colors) return null;
    return {
      colors: parsed.colors,
      sources: Array.isArray(parsed.sources) ? parsed.sources : [],
    };
  } catch {
    return null;
  }
}

export function nextChipColor(used: string[]): string {
  const taken = new Set(used.map((color) => color.toLowerCase()));
  const free = DROPDOWN_COLORS.find((color) => !taken.has(color.value));
  return free?.value ?? DROPDOWN_COLORS[used.length % DROPDOWN_COLORS.length].value;
}

/**
 * The next row of a single-column source, when someone types a new name
 * directly under the range. A blank cell does not extend it.
 */
export function extendRef(
  ref: ParsedRef,
  below: unknown,
): ParsedRef | null {
  if (ref.startColumn !== ref.endColumn) return null;
  if (!trimmedText(below)) return null;
  return { ...ref, endRow: ref.endRow + 1 };
}

/**
 * Options currently in the range.
 * A rename is the same cell with new text: chips follow it and keep the colour.
 * A blank is skipped. A name that only moved keeps the colour it had.
 */
export function reconcileSource(
  previous: SourceCell[],
  current: { row: number; column: number; value: unknown }[],
): { options: DropdownOption[]; renames: { from: string; to: string }[]; sources: SourceCell[] } {
  const prevByAddress = new Map(
    previous.map((cell) => [`${cell.row},${cell.column}`, cell]),
  );
  const colorByLabel = new Map(
    previous.map((cell) => [cell.label.toLowerCase(), cell.color]),
  );
  const filled = current.flatMap((cell) => {
    const label = trimmedText(cell.value);
    return label ? [{ row: cell.row, column: cell.column, label }] : [];
  });
  const renames: { from: string; to: string }[] = [];
  for (const cell of filled) {
    const prev = prevByAddress.get(`${cell.row},${cell.column}`);
    if (!prev || prev.label.toLowerCase() === cell.label.toLowerCase()) continue;
    const stillThere = filled.some(
      (other) =>
        other.label.toLowerCase() === prev.label.toLowerCase() &&
        (other.row !== cell.row || other.column !== cell.column),
    );
    if (stillThere) continue;
    renames.push({ from: prev.label, to: cell.label });
    const color = colorByLabel.get(prev.label.toLowerCase());
    colorByLabel.delete(prev.label.toLowerCase());
    if (color && !colorByLabel.has(cell.label.toLowerCase()))
      colorByLabel.set(cell.label.toLowerCase(), color);
  }
  const options: DropdownOption[] = [];
  const seen = new Set<string>();
  const sources: SourceCell[] = [];
  for (const cell of filled) {
    const key = cell.label.toLowerCase();
    let color = colorByLabel.get(key);
    if (!color) {
      color = nextChipColor([...colorByLabel.values()]);
      colorByLabel.set(key, color);
    }
    sources.push({ ...cell, color });
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({ id: `src-${options.length}`, label: cell.label, color });
  }
  return { options, renames, sources };
}

/** Colours for the labels Univer is about to draw, skipping blanks. */
export function colorsForLabels(
  labels: string[],
  formula2: string | undefined,
  stored?: DropdownMeta | null,
): Record<string, string> {
  const meta = stored ?? parseDropdownMeta(formula2);
  const positional = meta ? [] : String(formula2 ?? "").split(",");
  const map: Record<string, string> = {};
  const seen = new Set<string>();
  let index = 0;
  for (const raw of labels) {
    const label = raw.trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const stored =
      meta?.colors[label] ??
      meta?.colors[key] ??
      Object.entries(meta?.colors ?? {}).find(
        ([name]) => name.toLowerCase() === key,
      )?.[1];
    const positionalColor = positional[index] ?? "";
    map[label] = /^#[\da-f]{6}$/i.test(stored ?? "")
      ? stored!
      : /^#[\da-f]{6}$/i.test(positionalColor)
        ? positionalColor
        : DROPDOWN_COLORS[index % DROPDOWN_COLORS.length].value;
    index += 1;
  }
  return map;
}
