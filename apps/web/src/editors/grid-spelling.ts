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
