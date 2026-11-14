import {
  DRAWING_SOURCE_CHARS,
  duplicateFile,
  mergeDocumentBlocks,
  type DrawingFile,
  type FormFile,
  type SheetFile,
  type SlideFile,
  type SuiteFile,
} from "@suiteleaf/core";

export type CombinePlan = {
  /** A copy of the local file. Its title marks it as the edits from this device. */
  localCopy: SuiteFile;
  /** Present only when the two sides changed different blocks. */
  merged?: SuiteFile;
  reason?: string;
};

function tabsSame(left: SuiteFile, right: SuiteFile): boolean {
  if (left.kind !== "doc" || right.kind !== "doc") return false;
  return (
    left.tabTitle === right.tabTitle &&
    JSON.stringify(left.tabs ?? null) === JSON.stringify(right.tabs ?? null)
  );
}

/**
 * Plan a conflict resolution. `localCopy` is always a separate file, and
 * `merged` is omitted when the edits overlap or the file is not a document.
 */
/** A separate local file holding the edits from this device. It is not linked to SuiteDrive. */
export function keptLocalCopy(file: SuiteFile): SuiteFile {
  return duplicateFile(file, `${file.title} (your edits)`.slice(0, 200));
}

/**
 * Keep every remote sheet that is not already the same in the local workbook.
 * A sheet both sides changed is added under a new id. Cells are not merged.
 * The files passed in are not changed.
 */
export function keepBothSheets(local: SuiteFile, remote: SuiteFile): CombinePlan {
  const localCopy = keptLocalCopy(local);
  if (local.kind !== "sheet" || remote.kind !== "sheet") {
    return { localCopy, reason: "Combining sheets is available for a spreadsheet." };
  }
  const merged = structuredClone(local) as SheetFile;
  const book = merged.content.workbook;
  const other = remote.content.workbook;
  const placed = new Map<string, string>();
  for (const id of other.sheetOrder) {
    const sheet = other.sheets[id];
    if (!sheet) continue;
    const current = book.sheets[id];
    if (current && JSON.stringify(current) === JSON.stringify(sheet)) {
      placed.set(id, id);
      continue;
    }
    if (!current && !book.sheets[id]) {
      book.sheets[id] = structuredClone(sheet);
      if (!book.sheetOrder.includes(id)) book.sheetOrder.push(id);
      placed.set(id, id);
      continue;
    }
    const incoming = structuredClone(sheet);
    const body = (item: typeof sheet) => {
      const copy = structuredClone(item) as { id?: string; name?: string };
      delete copy.id;
      delete copy.name;
      return JSON.stringify(copy);
    };
    const sameBody = Object.entries(book.sheets).find(
      ([, item]) => item && body(item) === body(incoming),
    );
    if (sameBody) {
      placed.set(id, sameBody[0]);
      continue;
    }
    const base = `other-${id}`.slice(0, 70);
    let copyId = "";
    let copyNumber = 0;
    for (let n = 0; n < 50; n += 1) {
      const candidate = (n === 0 ? base : `${base}-${n + 1}`).slice(0, 80);
      if (!book.sheets[candidate]) {
        copyId = candidate;
        copyNumber = n;
        break;
      }
    }
    if (!copyId) {
      return { localCopy, reason: "A changed sheet could not be kept as another sheet." };
    }
    const label =
      copyNumber === 0 ? `${sheet.name} (other copy)` : `${sheet.name} (other copy ${copyNumber + 1})`;
    book.sheets[copyId] = {
      ...incoming,
      id: copyId,
      name: label.slice(0, 100),
    };
    book.sheetOrder.push(copyId);
    placed.set(id, copyId);
  }
  const charts = [...(merged.content.charts ?? [])];
  for (const chart of remote.content.charts ?? []) {
    const target = placed.get(chart.sheetId);
    if (!target) continue;
    const next = { ...structuredClone(chart), sheetId: target };
    if (next.source.sheetId === chart.sheetId) next.source = { ...next.source, sheetId: target };
    const same = charts.find((item) => JSON.stringify(item) === JSON.stringify(next));
    if (same) continue;
    if (charts.some((item) => item.id === next.id)) {
      const base = `other-${chart.id}`.slice(0, 70);
      let copyId = "";
      for (let n = 0; n < 50; n += 1) {
        const candidate = (n === 0 ? base : `${base}-${n + 1}`).slice(0, 80);
        if (!charts.some((item) => item.id === candidate)) {
          copyId = candidate;
          break;
        }
      }
      if (!copyId) return { localCopy, reason: "A chart could not be kept." };
      next.id = copyId;
    }
    charts.push(next);
  }
  merged.content.charts = charts;
  const pivots = [...(merged.content.pivots ?? [])];
  for (const pivot of remote.content.pivots ?? []) {
    const sourceSheet = placed.get(pivot.source.sheetId);
    const outputSheet = placed.get(pivot.targetSheetId);
    if (!sourceSheet || !outputSheet) continue;
    const next = {
      ...structuredClone(pivot),
      targetSheetId: outputSheet,
      source: { ...pivot.source, sheetId: sourceSheet },
    };
    if (pivots.some((item) => JSON.stringify(item) === JSON.stringify(next))) continue;
    if (pivots.some((item) => item.id === next.id)) {
      const base = `other-${pivot.id}`.slice(0, 70);
      let copyId = "";
      for (let n = 0; n < 50; n += 1) {
        const candidate = (n === 0 ? base : `${base}-${n + 1}`).slice(0, 80);
        if (!pivots.some((item) => item.id === candidate)) {
          copyId = candidate;
          break;
        }
      }
      if (!copyId) return { localCopy, reason: "A pivot could not be kept." };
      next.id = copyId;
    }
    pivots.push(next);
  }
  merged.content.pivots = pivots;
  return { localCopy, merged };
}

const CELL_ADDRESS = /^([A-Z]+)([1-9]\d*)$/;
const SHEET_CELL =
  /^(?:'((?:[^']|'')*)'|([A-Za-z_][A-Za-z0-9_-]*))!(\$?[A-Za-z]+)(\$?[1-9]\d*)$/;
const PLAIN_RANGE = /^([A-Z]+)([1-9]\d*):([A-Z]+)([1-9]\d*)$/;
const SHEET_RANGE =
  /^(?:'((?:[^']|'')*)'|([A-Za-z_][A-Za-z0-9_-]*))!(\$?[A-Za-z]+)(\$?[1-9]\d*):(\$?[A-Za-z]+)(\$?[1-9]\d*)$/;
const MAX_RANGE_CELLS = 256;

type CellPick = { sheetName?: string; row: string; column: string };

function cellPick(address: string): CellPick | null {
  const text = address.trim();
  const qualified = SHEET_CELL.exec(text);
  let sheetName: string | undefined;
  let letters = "";
  let digits = "";
  if (qualified) {
    sheetName = (qualified[1] ?? qualified[2] ?? "").replaceAll("''", "'").trim();
    if (!sheetName || /[\r\n]/.test(sheetName)) return null;
    letters = qualified[3].replaceAll("$", "");
    digits = qualified[4].replaceAll("$", "");
  } else {
    const match = CELL_ADDRESS.exec(text.toUpperCase());
    if (!match) return null;
    letters = match[1] ?? "";
    digits = match[2] ?? "";
  }
  const column = columnIndex(letters.toUpperCase());
  const row = Number(digits) - 1;
  if (column < 0 || column > 16_383 || row < 0 || row > 1_048_575) return null;
  return { sheetName, row: String(row), column: String(column) };
}

function sheetIdByName(file: SheetFile, name?: string): string | undefined {
  const order = file.content.workbook.sheetOrder;
  if (!name) return order[0];
  return order.find((id) => file.content.workbook.sheets[id]?.name === name);
}

function columnIndex(letters: string): number {
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

/** Cells in one range, or a refusal when the span is too wide. Not a range returns null. */
function rangePicks(address: string): CellPick[] | "smaller" | null {
  const text = address.trim();
  const qualified = SHEET_RANGE.exec(text);
  let sheetName: string | undefined;
  let letters: string[] = [];
  let digits: string[] = [];
  if (qualified) {
    sheetName = (qualified[1] ?? qualified[2] ?? "").replaceAll("''", "'").trim();
    if (!sheetName || /[\r\n]/.test(sheetName)) return null;
    letters = [qualified[3].replaceAll("$", ""), qualified[5].replaceAll("$", "")];
    digits = [qualified[4].replaceAll("$", ""), qualified[6].replaceAll("$", "")];
  } else {
    const plain = PLAIN_RANGE.exec(text.toUpperCase());
    if (!plain) return null;
    letters = [plain[1], plain[3]];
    digits = [plain[2], plain[4]];
  }
  const ends = [0, 1].map((index) => {
    const column = columnIndex(letters[index].toUpperCase());
    const row = Number(digits[index]) - 1;
    if (column < 0 || column > 16_383 || row < 0 || row > 1_048_575) return null;
    return { row, column };
  });
  if (ends[0] == null || ends[1] == null) return null;
  const rowLo = Math.min(ends[0].row, ends[1].row);
  const rowHi = Math.max(ends[0].row, ends[1].row);
  const columnLo = Math.min(ends[0].column, ends[1].column);
  const columnHi = Math.max(ends[0].column, ends[1].column);
  if ((rowHi - rowLo + 1) * (columnHi - columnLo + 1) > MAX_RANGE_CELLS) return "smaller";
  const picks: CellPick[] = [];
  for (let row = rowLo; row <= rowHi; row += 1) {
    for (let column = columnLo; column <= columnHi; column += 1) {
      picks.push({ sheetName, row: String(row), column: String(column) });
    }
  }
  return picks;
}

/**
 * Copy named cells from the other spreadsheet onto the open sheet.
 * Every other cell stays local. The files passed in are not changed.
 * A bad address is refused without repeating it.
 */
export function keepSelectedCells(
  local: SuiteFile,
  remote: SuiteFile,
  addresses: readonly string[],
): CombinePlan {
  const localCopy = keptLocalCopy(local);
  if (local.kind !== "sheet" || remote.kind !== "sheet") {
    return { localCopy, reason: "Choosing cells is available for a spreadsheet." };
  }
  if (addresses.length === 0) {
    return { localCopy, reason: "Name the cells to take from the other copy." };
  }
  const picks: CellPick[] = [];
  for (const address of addresses) {
    const range = rangePicks(address);
    if (range === "smaller") return { localCopy, reason: "Name a smaller range." };
    if (range) {
      picks.push(...range);
      continue;
    }
    const pick = cellPick(address);
    if (!pick) return { localCopy, reason: "Name a cell, such as B2." };
    picks.push(pick);
  }
  const merged = structuredClone(local) as SheetFile;
  const otherFile = remote as SheetFile;
  for (const pick of picks) {
    const sheetId = sheetIdByName(merged, pick.sheetName);
    const otherId = sheetIdByName(otherFile, pick.sheetName);
    if (pick.sheetName && !otherId) return { localCopy, reason: "That sheet is not in the other copy." };
    if (pick.sheetName && !sheetId) return { localCopy, reason: "That sheet is not in this copy." };
    const sheet = sheetId ? merged.content.workbook.sheets[sheetId] : undefined;
    const other = otherId ? otherFile.content.workbook.sheets[otherId] : undefined;
    if (!sheet || !other) return { localCopy, reason: "That spreadsheet has no sheet." };
    const grid = (sheet.cellData ??= {}) as Record<string, Record<string, unknown>>;
    const source = (other.cellData ?? {}) as Record<string, Record<string, unknown> | undefined>;
    const row = (grid[pick.row] ??= {});
    const value = source[pick.row]?.[pick.column];
    if (value === undefined) delete row[pick.column];
    else row[pick.column] = structuredClone(value);
  }
  return { localCopy, merged };
}

/**
 * Keep every remote slide that is not already the same in the local deck.
 * A slide both sides changed is added under a new id. Objects are not merged.
 * The files passed in are not changed.
 */
export function keepBothSlides(local: SuiteFile, remote: SuiteFile): CombinePlan {
  const localCopy = keptLocalCopy(local);
  if (local.kind !== "slide" || remote.kind !== "slide") {
    return { localCopy, reason: "Combining slides is available for a presentation." };
  }
  const merged = structuredClone(local) as SlideFile;
  const deck = merged.content;
  const other = remote.content;
  for (const id of other.slideOrder) {
    const slide = other.slides[id];
    if (!slide) continue;
    const current = deck.slides[id];
    if (current && JSON.stringify(current) === JSON.stringify(slide)) continue;
    if (!current) {
      deck.slides[id] = structuredClone(slide);
      if (!deck.slideOrder.includes(id)) deck.slideOrder.push(id);
      continue;
    }
    const incoming = structuredClone(slide);
    const body = (item: typeof slide) => {
      const copy = structuredClone(item) as { id?: string; title?: string };
      delete copy.id;
      delete copy.title;
      return JSON.stringify(copy);
    };
    if (Object.values(deck.slides).some((item) => item && body(item) === body(incoming))) continue;
    const base = `other-${id}`.slice(0, 70);
    let copyId = "";
    let copyNumber = 0;
    for (let n = 0; n < 50; n += 1) {
      const candidate = (n === 0 ? base : `${base}-${n + 1}`).slice(0, 80);
      if (!deck.slides[candidate]) {
        copyId = candidate;
        copyNumber = n;
        break;
      }
    }
    if (!copyId) {
      return { localCopy, reason: "A changed slide could not be kept as another slide." };
    }
    const title = slide.title?.trim() || "Slide";
    const label = copyNumber === 0 ? `${title} (other copy)` : `${title} (other copy ${copyNumber + 1})`;
    deck.slides[copyId] = {
      ...incoming,
      id: copyId,
      title: label.slice(0, 100),
    };
    deck.slideOrder.push(copyId);
  }
  const remoteMaster = other.master;
  if (remoteMaster) {
    const localMaster = deck.master;
    const elements = [...(localMaster?.elements ?? [])];
    const body = (item: (typeof elements)[number]) => {
      const copy = structuredClone(item) as { id?: string };
      delete copy.id;
      return JSON.stringify(copy);
    };
    for (const element of remoteMaster.elements ?? []) {
      const next = structuredClone(element);
      if (elements.some((item) => body(item) === body(next))) continue;
      if (elements.some((item) => item.id === next.id)) {
        const base = `other-${element.id}`.slice(0, 70);
        let copyId = "";
        for (let n = 0; n < 50; n += 1) {
          const candidate = (n === 0 ? base : `${base}-${n + 1}`).slice(0, 80);
          if (!elements.some((item) => item.id === candidate)) {
            copyId = candidate;
            break;
          }
        }
        if (!copyId || elements.length >= 30) {
          return { localCopy, reason: "A master object could not be kept." };
        }
        next.id = copyId;
      } else if (elements.length >= 30) {
        return { localCopy, reason: "A master object could not be kept." };
      }
      elements.push(next);
    }
    const background = localMaster?.background?.color ? localMaster.background : remoteMaster.background;
    const layouts = localMaster?.layouts ?? remoteMaster.layouts;
    deck.master = {
      ...(background ? { background } : {}),
      elements,
      ...(layouts?.length ? { layouts } : {}),
    };
  }
  return { localCopy, merged };
}

/**
 * Keep every remote response that is not already the same in the local form.
 * A response both sides changed is added under a new id. Questions are not merged.
 * The files passed in are not changed.
 */
export function keepBothForms(local: SuiteFile, remote: SuiteFile): CombinePlan {
  const localCopy = keptLocalCopy(local);
  if (local.kind !== "form" || remote.kind !== "form") {
    return { localCopy, reason: "Combining responses is available for a form." };
  }
  if (JSON.stringify(local.content.questions) !== JSON.stringify(remote.content.questions)) {
    return { localCopy, reason: "The questions changed, so both versions stay separate." };
  }
  const merged = structuredClone(local) as FormFile;
  const seen = new Set(merged.content.responses.map((row) => row.id));
  const answersOf = (row: { answers: Record<string, string> }) => JSON.stringify(row.answers);
  const localAnswers = new Map(merged.content.responses.map((row) => [row.id, answersOf(row)]));
  for (const response of remote.content.responses) {
    const current = localAnswers.get(response.id);
    if (current === answersOf(response)) continue;
    if (current === undefined && !seen.has(response.id)) {
      if (merged.content.responses.length >= 5000) {
        return { localCopy, reason: "A response could not be kept." };
      }
      merged.content.responses.push(structuredClone(response));
      seen.add(response.id);
      continue;
    }
    const incoming = structuredClone(response);
    if (merged.content.responses.some((row) => answersOf(row) === answersOf(incoming))) continue;
    const base = `other-${response.id}`.slice(0, 70);
    let copyId = "";
    for (let n = 0; n < 50; n += 1) {
      const candidate = (n === 0 ? base : `${base}-${n + 1}`).slice(0, 80);
      if (!seen.has(candidate)) {
        copyId = candidate;
        break;
      }
    }
    if (!copyId || merged.content.responses.length >= 5000) {
      return { localCopy, reason: "A response could not be kept." };
    }
    incoming.id = copyId;
    merged.content.responses.push(incoming);
    seen.add(copyId);
  }
  return { localCopy, merged };
}

function drawingInner(source: string): string | null {
  const match = /^<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/i.exec(source.trim());
  if (!match) return null;
  if (/<script|javascript:|\son[a-z]+\s*=/i.test(source)) return null;
  return match[1];
}

function joinDrawings(format: "svg" | "mermaid" | "graphviz", local: string, remote: string): string | null {
  let joined = "";
  if (format === "svg") {
    const left = drawingInner(local);
    const right = drawingInner(remote);
    if (left == null || right == null) return null;
    joined = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="820" viewBox="0 0 640 820"><svg x="0" y="0" width="640" height="400">${left}</svg><svg x="0" y="420" width="640" height="400">${right}</svg></svg>`;
  } else if (format === "mermaid") {
    joined = `${local.trimEnd()}\n%% other copy\n${remote.trim()}\n`;
  } else {
    joined = `${local.trimEnd()}\n// other copy\n${remote.trim()}\n`;
  }
  if (joined.length > DRAWING_SOURCE_CHARS) return null;
  return joined;
}

/**
 * Keep the other drawing under the local one when the kind matches.
 * A script in an SVG is not copied. The files passed in are not changed.
 */
export function keepBothDrawings(local: SuiteFile, remote: SuiteFile): CombinePlan {
  const localCopy = keptLocalCopy(local);
  if (local.kind !== "drawing" || remote.kind !== "drawing") {
    return { localCopy, reason: "Combining drawings is available for a drawing." };
  }
  if (local.content.format !== remote.content.format) {
    return { localCopy, reason: "The drawing kinds differ, so both versions stay separate." };
  }
  if (local.content.source === remote.content.source) return { localCopy, merged: structuredClone(local) };
  const source = joinDrawings(local.content.format, local.content.source, remote.content.source);
  if (!source) return { localCopy, reason: "The other drawing could not be kept." };
  const merged = structuredClone(local) as DrawingFile;
  merged.content = { ...merged.content, source };
  return { localCopy, merged };
}

export function combineDocuments(
  base: SuiteFile,
  local: SuiteFile,
  remote: SuiteFile,
  options?: { keepBoth?: boolean },
): CombinePlan {
  const localCopy = keptLocalCopy(local);
  if (base.kind !== "doc" || local.kind !== "doc" || remote.kind !== "doc") {
    return {
      localCopy,
      reason: "Combining is available for a document. Both versions stay separate.",
    };
  }
  if (!tabsSame(base, local) || !tabsSame(base, remote)) {
    return {
      localCopy,
      reason: "Extra tabs changed, so both versions stay separate.",
    };
  }
  const result = mergeDocumentBlocks(
    base.content,
    local.content,
    remote.content,
    options?.keepBoth ? "stack" : "separate",
  );
  if (!result.merged) return { localCopy, reason: result.reason };
  return {
    localCopy,
    merged: { ...structuredClone(local), content: result.merged },
  };
}
