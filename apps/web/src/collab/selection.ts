export type RemoteCaret = { name: string; anchor: number; head: number };

const LIMIT = 1_000_000;

function offset(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) return;
  if (value < 0 || value > LIMIT) return;
  return value;
}

/** A caret position. Document text is not included. */
export function localSelectionMessage(
  anchor: number,
  head: number,
): { type: "selection"; anchor: number; head: number } | null {
  const start = offset(anchor);
  const end = offset(head);
  if (start === undefined || end === undefined) return null;
  return { type: "selection", anchor: start, head: end };
}

export type SheetSelection = {
  sheetId: string;
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
};

export type RemoteSheetSelection = SheetSelection & { name: string };

function sheetLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > 80 || /[\u0000-\u001f]/.test(text)) return null;
  return text;
}

function sheetSelection(row: {
  sheetId?: unknown;
  startRow?: unknown;
  startColumn?: unknown;
  endRow?: unknown;
  endColumn?: unknown;
}): SheetSelection | null {
  const sheetId = sheetLabel(row.sheetId);
  const startRow = offset(row.startRow);
  const startColumn = offset(row.startColumn);
  const endRow = offset(row.endRow);
  const endColumn = offset(row.endColumn);
  if (
    !sheetId ||
    startRow === undefined ||
    startColumn === undefined ||
    endRow === undefined ||
    endColumn === undefined ||
    endRow < startRow ||
    endColumn < startColumn
  ) {
    return null;
  }
  return { sheetId, startRow, startColumn, endRow, endColumn };
}

/** A worksheet range. Cell values are not included. */
export function localSheetSelectionMessage(
  selection: SheetSelection,
): ({ type: "selection" } & SheetSelection) | null {
  const range = sheetSelection(selection);
  if (!range) return null;
  return { type: "selection", ...range };
}

/** Another person's worksheet range. A message that carries cell text is ignored. */
export function remoteSheetSelection(message: unknown, selfName: string): RemoteSheetSelection | null {
  if (!message || typeof message !== "object") return null;
  const row = message as Record<string, unknown>;
  if (row.type !== "selection") return null;
  if ("text" in row || "update" in row || "anchor" in row || "head" in row) return null;
  if (typeof row.name !== "string" || !row.name || row.name === selfName) return null;
  const range = sheetSelection(row);
  if (!range) return null;
  return { name: row.name, ...range };
}

function columnName(column: number): string {
  let current = column + 1;
  let name = "";
  while (current > 0) {
    const rem = (current - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}

/** A person's name and the range address, such as Maya A1:B2. */
export function sheetSelectionLabel(selection: RemoteSheetSelection): string {
  const start = `${columnName(selection.startColumn)}${selection.startRow + 1}`;
  const end = `${columnName(selection.endColumn)}${selection.endRow + 1}`;
  return `${selection.name} ${start === end ? start : `${start}:${end}`}`;
}

export type SlideSelection = { slideId: string; elementId?: string };

export type RemoteSlideSelection = SlideSelection & { name: string };

/** The slide this person is viewing. Slide text is not included. */
export function localSlideSelectionMessage(
  selection: SlideSelection,
): ({ type: "selection" } & SlideSelection) | null {
  const slideId = sheetLabel(selection.slideId);
  if (!slideId) return null;
  const elementId = selection.elementId == null ? undefined : sheetLabel(selection.elementId);
  if (selection.elementId != null && !elementId) return null;
  return { type: "selection", slideId, ...(elementId ? { elementId } : {}) };
}

/** Another person's slide. A message that carries slide text does not change this person's slide. */
export function remoteSlideSelection(message: unknown, selfName: string): RemoteSlideSelection | null {
  if (!message || typeof message !== "object") return null;
  const row = message as Record<string, unknown>;
  if (row.type !== "selection") return null;
  if (
    "text" in row ||
    "title" in row ||
    "notes" in row ||
    "update" in row ||
    "anchor" in row ||
    "head" in row ||
    "sheetId" in row
  ) {
    return null;
  }
  if (typeof row.name !== "string" || !row.name || row.name === selfName) return null;
  const slideId = sheetLabel(row.slideId);
  if (!slideId) return null;
  const elementId = row.elementId == null ? undefined : sheetLabel(row.elementId);
  if (row.elementId != null && !elementId) return null;
  return { name: row.name, slideId, ...(elementId ? { elementId } : {}) };
}

/** A person's name and the slide they are on. The slide body is not included. */
export function slideSelectionLabel(selection: RemoteSlideSelection, title?: string): string {
  const name = title && sheetLabel(title) ? title.trim() : "a slide";
  const object = selection.elementId ? `, object ${selection.elementId}` : "";
  return `${selection.name} is on ${name}${object}`;
}

/** Another person's caret. A message that carries document text is ignored. */
export function remoteCaret(message: unknown, selfName: string): RemoteCaret | null {
  if (!message || typeof message !== "object") return null;
  const row = message as Record<string, unknown>;
  if (row.type !== "selection") return null;
  if ("text" in row || "update" in row) return null;
  if (typeof row.name !== "string" || !row.name || row.name === selfName) return null;
  const anchor = offset(row.anchor);
  const head = offset(row.head);
  if (anchor === undefined || head === undefined) return null;
  return { name: row.name, anchor, head };
}
