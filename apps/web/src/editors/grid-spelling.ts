import {
  isMisspelling,
  SPELLING_CHANGED_EVENT,
  spellingSuggestions,
  spellingTokens,
  type PersonalDictionary,
} from "./doc-spelling";
import { columnLabel } from "./sheet-cleanup";

export type SpellHit = {
  key: string;
  label: string;
  text: string;
  word: string;
  from: number;
  to: number;
};

export type SheetIssue = SpellHit & {
  sheetId: string;
  row: number;
  column: number;
};

export type SlideIssue = SpellHit & {
  slideId: string;
  elementId: string;
};

type CellRecord = { v?: unknown; f?: unknown; p?: unknown } | null | undefined;

/** Plain text only. A formula stays a formula; spelling must not rewrite it. */
export function plainCellText(cell: CellRecord): string | null {
  if (!cell || cell.f || cell.p) return null;
  if (typeof cell.v !== "string" || !cell.v.trim()) return null;
  return cell.v;
}

export function misspellingsInText(
  text: string,
  personal: PersonalDictionary,
  ignored: readonly string[],
) {
  return spellingTokens(text).filter((token) => isMisspelling(token.word, personal, ignored));
}

export function replaceWordAt(text: string, from: number, to: number, replacement: string) {
  return text.slice(0, from) + replacement + text.slice(to);
}

export function sameMisspelling(left: string, right: string) {
  return left.toLowerCase().replace(/’/g, "'") === right.toLowerCase().replace(/’/g, "'");
}

/** "Recieve" becomes "Receive"; a fully capital word stays capital. */
export function applySuggestionCase(sample: string, replacement: string) {
  if (!sample) return replacement;
  if (sample === sample.toUpperCase()) return replacement.toUpperCase();
  const head = sample.charAt(0);
  const tail = sample.slice(1);
  if (head === head.toUpperCase() && head !== head.toLowerCase() && tail === tail.toLowerCase())
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  return replacement;
}

export type ChangeAllHit = { from: number; to: number; word: string };

export type ChangeAllCell = {
  key: string;
  label: string;
  text: string;
  sheetId: string;
  row: number;
  column: number;
  hits: ChangeAllHit[];
};

/** Every cell that contains this misspelling, one entry per cell. */
export function changeAllCells(issues: readonly SheetIssue[], word: string): ChangeAllCell[] {
  const grouped = new Map<string, ChangeAllCell>();
  for (const issue of issues) {
    if (!sameMisspelling(issue.word, word)) continue;
    const key = `${issue.sheetId}:${issue.row}:${issue.column}`;
    const hit = { from: issue.from, to: issue.to, word: issue.word };
    const existing = grouped.get(key);
    if (existing) existing.hits.push(hit);
    else
      grouped.set(key, {
        key,
        label: issue.label,
        text: issue.text,
        sheetId: issue.sheetId,
        row: issue.row,
        column: issue.column,
        hits: [hit],
      });
  }
  return [...grouped.values()];
}

/** Null when a hit no longer matches the cell, so a stale preview cannot rewrite it. */
export function textAfterChangeAll(
  text: string,
  hits: readonly ChangeAllHit[],
  replacement: string,
) {
  let next = text;
  for (const hit of [...hits].sort((a, b) => b.from - a.from)) {
    if (next.slice(hit.from, hit.to) !== hit.word) return null;
    next = replaceWordAt(next, hit.from, hit.to, applySuggestionCase(hit.word, replacement));
  }
  return next;
}

export function changeAllValues(
  cells: readonly ChangeAllCell[],
  readText: (cell: ChangeAllCell) => string | null,
  replacement: string,
) {
  const bySheet = new Map<string, Record<number, Record<number, string>>>();
  for (const cell of cells) {
    const text = readText(cell);
    if (text == null) continue;
    const next = textAfterChangeAll(text, cell.hits, replacement);
    if (next == null || next === text) continue;
    const matrix = bySheet.get(cell.sheetId) ?? {};
    (matrix[cell.row] ??= {})[cell.column] = next;
    bySheet.set(cell.sheetId, matrix);
  }
  return bySheet;
}

export type IgnoredCell = {
  sheetId: string;
  row: number;
  column: number;
  word: string;
};

export function cellIsIgnored(
  cells: readonly IgnoredCell[],
  issue: { sheetId: string; row: number; column: number; word: string },
) {
  return cells.some(
    (cell) =>
      cell.sheetId === issue.sheetId &&
      cell.row === issue.row &&
      cell.column === issue.column &&
      sameMisspelling(cell.word, issue.word),
  );
}

export function withoutIgnoredCells(issues: SheetIssue[], cells: readonly IgnoredCell[]) {
  if (!cells.length) return issues;
  return issues.filter((issue) => !cellIsIgnored(cells, issue));
}

export function suggestionsFor(word: string) {
  return spellingSuggestions(word);
}

/** Where a word sits inside a cell, in pixels from the cell's left edge. */
export function wordBand(
  text: string,
  from: number,
  to: number,
  measure: (value: string) => number,
  align: "left" | "center" | "right",
  contentWidth: number,
  padLeft: number,
) {
  const prefix = measure(text.slice(0, from));
  const width = Math.max(8, measure(text.slice(from, to)));
  const full = measure(text);
  let origin = padLeft;
  if (align === "center") origin = padLeft + Math.max(0, (contentWidth - full) / 2);
  if (align === "right") origin = padLeft + Math.max(0, contentWidth - full);
  return { x: origin + prefix, width };
}

export type Box = { left: number; top: number; width: number; height: number };

export function boxesOverlap(a: Box, b: Box) {
  return (
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top
  );
}

/**
 * The menu sits beside the cell, then below it, and never on the underlined word.
 * A clamped fallback still prefers a side that leaves the word visible.
 */
export function spellingMenuPosition(
  cell: Box,
  word: Box,
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const gap = 8;
  const margin = 8;
  const asBox = (left: number, top: number): Box => ({
    left,
    top,
    width: menu.width,
    height: menu.height,
  });
  const onScreen = (left: number, top: number) => {
    const box = asBox(left, top);
    return (
      box.left >= margin &&
      box.top >= margin &&
      box.left + box.width <= viewport.width - margin &&
      box.top + box.height <= viewport.height - margin
    );
  };
  const clear = (left: number, top: number) => !boxesOverlap(asBox(left, top), word);
  const candidates = [
    { left: cell.left + cell.width + gap, top: cell.top },
    { left: cell.left - menu.width - gap, top: cell.top },
    { left: cell.left, top: cell.top + cell.height + gap },
    { left: word.left, top: word.top - menu.height - gap },
  ];
  for (const candidate of candidates) {
    if (onScreen(candidate.left, candidate.top) && clear(candidate.left, candidate.top))
      return candidate;
  }
  let left = Math.min(
    Math.max(margin, cell.left),
    Math.max(margin, viewport.width - margin - menu.width),
  );
  let top = cell.top + cell.height + gap;
  if (!onScreen(left, top)) top = word.top - menu.height - gap;
  if (!clear(left, top)) {
    const right = word.left + word.width + gap;
    const leftSide = word.left - menu.width - gap;
    if (onScreen(right, word.top)) return { left: right, top: word.top };
    if (onScreen(leftSide, word.top)) return { left: leftSide, top: word.top };
    top = word.top + word.height + gap;
  }
  left = Math.min(Math.max(margin, left), Math.max(margin, viewport.width - margin - menu.width));
  top = Math.min(Math.max(margin, top), Math.max(margin, viewport.height - margin - menu.height));
  return { left, top };
}

type CellSource = {
  sheetId: string;
  sheetName: string;
  row: number;
  column: number;
  text: string;
};

export function issuesFromCells(
  cells: CellSource[],
  personal: PersonalDictionary,
  ignored: readonly string[],
): SheetIssue[] {
  const several = new Set(cells.map((cell) => cell.sheetName)).size > 1;
  const issues: SheetIssue[] = [];
  for (const cell of cells) {
    const a1 = `${columnLabel(cell.column)}${cell.row + 1}`;
    for (const hit of misspellingsInText(cell.text, personal, ignored)) {
      issues.push({
        ...hit,
        key: `${cell.sheetId}:${cell.row}:${cell.column}:${hit.from}`,
        label: several ? `${cell.sheetName}!${a1}` : a1,
        text: cell.text,
        sheetId: cell.sheetId,
        row: cell.row,
        column: cell.column,
      });
    }
  }
  return issues;
}

type SheetLike = {
  getSheetId: () => string;
  getSheetName?: () => string;
  getDataRange?: () => {
    getRange?: () => { startRow?: number; startColumn?: number };
    getCellDatas?: () => CellRecord[][];
  };
};

/** Live text cells. Formulas and rich text are left alone. */
export function collectSheetIssues(
  workbook: { getSheets?: () => SheetLike[] } | null | undefined,
  personal: PersonalDictionary,
  ignored: readonly string[],
): SheetIssue[] {
  if (!workbook?.getSheets) return [];
  const cells: CellSource[] = [];
  for (const sheet of workbook.getSheets()) {
    let range: ReturnType<NonNullable<SheetLike["getDataRange"]>> | undefined;
    try {
      range = sheet.getDataRange?.();
    } catch {
      continue;
    }
    const datas = range?.getCellDatas?.();
    if (!datas) continue;
    const box = range?.getRange?.() ?? {};
    const startRow = box.startRow ?? 0;
    const startColumn = box.startColumn ?? 0;
    datas.forEach((row, r) => {
      (row ?? []).forEach((cell, c) => {
        const text = plainCellText(cell);
        if (!text) return;
        cells.push({
          sheetId: sheet.getSheetId(),
          sheetName: sheet.getSheetName?.() ?? "Sheet",
          row: startRow + r,
          column: startColumn + c,
          text,
        });
      });
    });
  }
  return issuesFromCells(cells, personal, ignored);
}

type DeckLike = {
  slideOrder: string[];
  slides: Record<
    string,
    { elements: Array<{ id: string; type: string; content?: string }> }
  >;
};

export function collectSlideIssues(
  deck: DeckLike,
  personal: PersonalDictionary,
  ignored: readonly string[],
): SlideIssue[] {
  const issues: SlideIssue[] = [];
  deck.slideOrder.forEach((slideId, index) => {
    const slide = deck.slides[slideId];
    if (!slide) return;
    for (const element of slide.elements) {
      if (element.type !== "text" || !element.content) continue;
      for (const hit of misspellingsInText(element.content, personal, ignored)) {
        issues.push({
          ...hit,
          key: `${slideId}:${element.id}:${hit.from}`,
          label: deck.slideOrder.length > 1 ? `Slide ${index + 1}` : "Text box",
          text: element.content,
          slideId,
          elementId: element.id,
        });
      }
    }
  });
  return issues;
}

export function replaceSlideWord<T extends DeckLike>(
  deck: T,
  slideId: string,
  elementId: string,
  from: number,
  to: number,
  replacement: string,
): T {
  const slide = deck.slides[slideId];
  if (!slide) return deck;
  return {
    ...deck,
    slides: {
      ...deck.slides,
      [slideId]: {
        ...slide,
        elements: slide.elements.map((element) => {
          if (element.id !== elementId || typeof element.content !== "string") return element;
          if (element.content.slice(from, to) === "") return element;
          return { ...element, content: replaceWordAt(element.content, from, to, replacement) };
        }),
      },
    },
  };
}

const IGNORED_KEY = "suiteleaf.spelling-ignored";

export function readIgnoredWords(fileId: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(IGNORED_KEY) || "null") as
      | Record<string, unknown>
      | null;
    const list = raw?.[fileId];
    return Array.isArray(list)
      ? list.filter((word): word is string => typeof word === "string" && word.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

export function writeIgnoredWords(fileId: string, words: string[]) {
  try {
    const raw = JSON.parse(localStorage.getItem(IGNORED_KEY) || "{}") as Record<string, unknown>;
    const store = raw && typeof raw === "object" ? raw : {};
    store[fileId] = words;
    localStorage.setItem(IGNORED_KEY, JSON.stringify(store));
    if (typeof window !== "undefined")
      window.dispatchEvent(new Event(SPELLING_CHANGED_EVENT));
  } catch {
    /* private mode */
  }
}

export function withIgnored(words: readonly string[], word: string) {
  const cleaned = word.trim();
  if (!cleaned || words.some((item) => item.toLowerCase() === cleaned.toLowerCase()))
    return [...words];
  return [...words, cleaned];
}

const IGNORED_CELLS_KEY = "suiteleaf.spelling-ignored-cells";

function isIgnoredCell(value: unknown): value is IgnoredCell {
  if (!value || typeof value !== "object") return false;
  const cell = value as IgnoredCell;
  return (
    typeof cell.sheetId === "string" &&
    typeof cell.row === "number" &&
    typeof cell.column === "number" &&
    typeof cell.word === "string" &&
    cell.word.trim().length > 0
  );
}

/** A cell the user left on purpose. The word stays flagged everywhere else. */
export function readIgnoredCells(fileId: string): IgnoredCell[] {
  try {
    const raw = JSON.parse(localStorage.getItem(IGNORED_CELLS_KEY) || "null") as
      | Record<string, unknown>
      | null;
    const list = raw?.[fileId];
    return Array.isArray(list) ? list.filter(isIgnoredCell) : [];
  } catch {
    return [];
  }
}

export function writeIgnoredCells(fileId: string, cells: IgnoredCell[]) {
  try {
    const raw = JSON.parse(localStorage.getItem(IGNORED_CELLS_KEY) || "{}") as Record<
      string,
      unknown
    >;
    const store = raw && typeof raw === "object" ? raw : {};
    store[fileId] = cells;
    localStorage.setItem(IGNORED_CELLS_KEY, JSON.stringify(store));
    if (typeof window !== "undefined")
      window.dispatchEvent(new Event(SPELLING_CHANGED_EVENT));
  } catch {
    /* private mode */
  }
}

export function withIgnoredCell(cells: readonly IgnoredCell[], cell: IgnoredCell) {
  const word = cell.word.trim();
  if (!word || cellIsIgnored(cells, { ...cell, word })) return [...cells];
  return [...cells, { ...cell, word }];
}
