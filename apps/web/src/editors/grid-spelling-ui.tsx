import { IUndoRedoService } from "@univerjs/core";
import { DEFAULT_PADDING_DATA, DocSimpleSkeleton, FontCache } from "@univerjs/engine-render";
import { X } from "lucide-react";
import {
  Fragment,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import {
  addToPersonalDictionary,
  isTypingWord,
  readPersonalDictionary,
  SPELLING_CHANGED_EVENT,
  writePersonalDictionary,
  type PersonalDictionary,
} from "./doc-spelling";
import {
  changeAllCells,
  changeAllValues,
  collectSheetIssues,
  collectSlideIssues,
  misspellingsInText,
  plainCellText,
  readIgnoredCells,
  readIgnoredWords,
  replaceWordAt,
  spellingMenuPosition,
  suggestionsFor,
  withIgnored,
  withIgnoredCell,
  withoutIgnoredCells,
  wordOnLine,
  writeIgnoredCells,
  writeIgnoredWords,
  type Box,
  type CellLayout,
  type ChangeAllCell,
  type TextLine,
  type SheetIssue,
  type SlideIssue,
  type SpellHit,
} from "./grid-spelling";

export type SpellingHandle = { open: () => void };

function usePersonalDictionary() {
  const [dictionary, setDictionary] = useState(readPersonalDictionary);
  useEffect(() => {
    const sync = () => setDictionary(readPersonalDictionary());
    window.addEventListener(SPELLING_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(SPELLING_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return dictionary;
}

function useIgnoredWords(fileId: string) {
  const [words, setWords] = useState(() => readIgnoredWords(fileId));
  useEffect(() => {
    const sync = () => setWords(readIgnoredWords(fileId));
    window.addEventListener(SPELLING_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(SPELLING_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [fileId]);
  return words;
}

function useIgnoredCells(fileId: string) {
  const [cells, setCells] = useState(() => readIgnoredCells(fileId));
  useEffect(() => {
    const sync = () => setCells(readIgnoredCells(fileId));
    window.addEventListener(SPELLING_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(SPELLING_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [fileId]);
  return cells;
}

function markedText(text: string, hits: { from: number; to: number }[]) {
  const ordered = [...hits].sort((a, b) => a.from - b.from);
  const parts: ReactNode[] = [];
  let cursor = 0;
  ordered.forEach((hit, index) => {
    if (hit.from > cursor) parts.push(text.slice(cursor, hit.from));
    parts.push(<mark key={index}>{text.slice(hit.from, hit.to)}</mark>);
    cursor = hit.to;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

function SpellingPanel({
  issue,
  index,
  count,
  onReplace,
  onIgnore,
  onAdd,
  onChangeAll,
  onClose,
  hadIssues,
}: {
  issue: SpellHit | null;
  index: number;
  count: number;
  onReplace: (replacement: string) => void;
  onIgnore: () => void;
  onAdd: () => void;
  onChangeAll?: () => void;
  onClose: () => void;
  hadIssues: boolean;
}) {
  const suggestions = issue ? suggestionsFor(issue.word) : [];
  const first = suggestions[0] ?? "";
  return (
    <div className="gdocs-modal-overlay spelling-layer">
      <form
        className="gdocs-dialog spelling-panel"
        role="dialog"
        aria-modal="false"
        aria-labelledby="grid-spelling-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (first) onReplace(first);
        }}
      >
        <div className="dialog-header">
          <h2 id="grid-spelling-title">Spelling</h2>
          <button type="button" className="dialog-close-btn" aria-label="Close spelling" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {issue ? (
          <>
            <p className="spelling-progress">
              {index + 1} of {count} · {issue.label} · {issue.word} → {first || "…"}
            </p>
            <p className="spelling-quote">
              {issue.text.slice(0, issue.from)}
              <mark>{issue.word}</mark>
              {issue.text.slice(issue.to)}
            </p>
            {suggestions.length ? (
              <div className="spelling-suggestions" role="group" aria-label="Suggestions">
                {suggestions.map((suggestion, suggestionIndex) => (
                  <button
                    type="button"
                    key={suggestion}
                    className={suggestionIndex === 0 ? "active" : ""}
                    autoFocus={suggestionIndex === 0}
                    onClick={() => onReplace(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            ) : (
              <p className="word-count-hint">No suggestion. Add the word to your dictionary if it is a name.</p>
            )}
            <p className="word-count-hint">
              {onChangeAll
                ? "Change replaces this word. Change all lists every matching cell before editing."
                : "One click replaces this word. The rest stays as it is. Checked on this computer."}
            </p>
            <div className="spelling-actions">
              <button type="submit" className="dialog-primary-btn" disabled={!first}>
                Change
              </button>
              {onChangeAll && first ? (
                <button type="button" className="dialog-text-btn" onClick={onChangeAll}>
                  Change all
                </button>
              ) : null}
              <button type="button" className="dialog-text-btn" onClick={onIgnore}>
                Ignore
              </button>
              <button type="button" className="dialog-text-btn" autoFocus={!first} onClick={onAdd}>
                Add to dictionary
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="spelling-progress">{hadIssues ? "Spelling check finished" : "No spelling issues"}</p>
            <p className="word-count-hint">
              {hadIssues
                ? "Nothing left to change. Names you added stay on this computer."
                : "Every word is in the dictionary, ignored, or a name you added."}
            </p>
            <div className="dialog-footer">
              <button type="button" className="dialog-primary-btn" onClick={onClose} autoFocus>
                Done
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

function useSpellCursor(count: number, open: boolean) {
  const [cursor, setCursor] = useState(0);
  const index = count ? Math.min(cursor, count - 1) : 0;
  const restart = () => setCursor(0);
  return { index: open ? index : 0, restart };
}

type Rect = { left: number; top: number; width: number; height: number };

function readRect(sheet: any, row: number, column: number): Rect | null {
  try {
    const raw = JSON.parse(sheet.getRange(row, column, 1, 1).getCellRect().toJSON());
    return { left: raw.left, top: raw.top, width: raw.width, height: raw.height };
  } catch {
    return null;
  }
}

function viewportRect(sheet: any, row: number, column: number): Rect | null {
  const cell = readRect(sheet, row, column);
  if (!cell) return null;
  let scrollX = 0;
  let scrollY = 0;
  try {
    const freeze = sheet.getFreeze?.() ?? {};
    const frozenRows = freeze.ySplit ? (freeze.startRow ?? 0) : 0;
    const frozenColumns = freeze.xSplit ? (freeze.startColumn ?? 0) : 0;
    const state = sheet.getScrollState?.() ?? {};
    const base = readRect(sheet, frozenRows, frozenColumns);
    const start = readRect(
      sheet,
      (state.sheetViewStartRow ?? 0) + frozenRows,
      (state.sheetViewStartColumn ?? 0) + frozenColumns,
    );
    if (base && start) {
      if (column >= frozenColumns) scrollX = start.left - base.left + (state.offsetX ?? 0);
      if (row >= frozenRows) scrollY = start.top - base.top + (state.offsetY ?? 0);
    }
  } catch {
    /* The first paint can happen before the grid can scroll. */
  }
  return { ...cell, left: cell.left - scrollX, top: cell.top - scrollY };
}

type CellStyle = {
  fs?: number;
  ff?: string;
  it?: number;
  bl?: number;
  ht?: number;
  vt?: number;
  tb?: number;
  pd?: { t?: number; b?: number; l?: number; r?: number };
};

/** Univer's alignment and wrap numbers: 2 is center and middle, 3 is right, bottom, and wrap. */
const WRAP = 3;
const TOP = 1;
const MIDDLE = 2;

/**
 * The cell's font, padding, alignment, and lines, read the way the grid paints
 * them. The painted font cache wins over the stored style when it has the cell.
 */
function cellLayout(sheet: any, row: number, column: number, text: string, rect: Rect) {
  let style: CellStyle = {};
  try {
    style = sheet.getRange(row, column, 1, 1).getCellStyleData?.() ?? {};
  } catch {
    style = {};
  }
  let painted: { fontString?: string; wrapStrategy?: number; verticalAlign?: number; horizontalAlign?: number; resolvedHorizontalAlign?: number } | null = null;
  try {
    painted = sheet.getSkeleton?.()?.getFont?.(row, column) ?? null;
  } catch {
    painted = null;
  }
  const size = typeof style.fs === "number" && style.fs > 0 ? style.fs : 11;
  const family = typeof style.ff === "string" && style.ff ? style.ff : "Arial";
  const italic = style.it === 1 ? "italic" : "normal";
  const weight = style.bl === 1 ? "bold" : "normal";
  const font = painted?.fontString || `${italic} ${weight} ${size}pt ${family}`;
  const ht = painted?.resolvedHorizontalAlign ?? painted?.horizontalAlign ?? style.ht;
  const vt = painted?.verticalAlign ?? style.vt;
  const wrap = (painted?.wrapStrategy ?? style.tb) === WRAP;
  const cell: CellLayout = {
    width: rect.width,
    height: rect.height,
    padLeft: style.pd?.l ?? DEFAULT_PADDING_DATA.l,
    padRight: style.pd?.r ?? DEFAULT_PADDING_DATA.r,
    padTop: style.pd?.t ?? DEFAULT_PADDING_DATA.t,
    padBottom: style.pd?.b ?? DEFAULT_PADDING_DATA.b,
    align: ht === 2 ? "center" : ht === 3 ? "right" : "left",
    vAlign: vt === TOP ? "top" : vt === MIDDLE ? "middle" : "bottom",
  };
  const contentWidth = Math.max(0, cell.width - cell.padLeft - cell.padRight);
  const contentHeight = Math.max(0, cell.height - cell.padTop - cell.padBottom);
  const lines: TextLine[] = new DocSimpleSkeleton(
    text,
    font,
    wrap,
    contentWidth,
    cell.vAlign === "top" ? contentHeight : Infinity,
  ).calculate();
  const measure = (value: string) => FontCache.getMeasureText(value, font).width;
  return { cell, lines, measure };
}

type Mark = {
  key: string;
  cellKey: string;
  word: string;
  label: string;
  left: number;
  top: number;
  width: number;
  hitLeft: number;
  hitTop: number;
  hitWidth: number;
  hitHeight: number;
  cell: Box;
};

function placeMarks(workbook: any, host: HTMLElement, issues: SheetIssue[]): Mark[] {
  const sheet = workbook?.getActiveSheet?.();
  if (!sheet) return [];
  const canvas = [...host.querySelectorAll("canvas")]
    .filter((node) => {
      const box = node.getBoundingClientRect();
      return box.width > 80 && box.height > 80;
    })
    .sort((a, b) => {
      const left = a.getBoundingClientRect();
      const right = b.getBoundingClientRect();
      return right.width * right.height - left.width * left.height;
    })[0];
  if (!canvas) return [];
  const box = canvas.getBoundingClientRect();
  const marks: Mark[] = [];
  for (const issue of issues) {
    if (issue.sheetId !== sheet.getSheetId()) continue;
    const rect = viewportRect(sheet, issue.row, issue.column);
    if (!rect) continue;
    const layout = cellLayout(sheet, issue.row, issue.column, issue.text, rect);
    const band = wordOnLine(issue.text, issue.from, issue.to, layout.lines, layout.measure, layout.cell);
    if (!band) continue;
    const left = box.left + rect.left + band.x;
    const top = box.top + rect.top + band.y;
    if (left + band.width < box.left + 40 || left > box.right) continue;
    if (top < box.top + 16 || top > box.bottom) continue;
    const cellLeft = Math.max(box.left, box.left + rect.left);
    const cellTop = Math.max(box.top, box.top + rect.top);
    const cellRight = Math.min(box.right, box.left + rect.left + rect.width);
    const cellBottom = Math.min(box.bottom, box.top + rect.top + rect.height);
    const cell = {
      left: cellLeft,
      top: cellTop,
      width: Math.max(0, cellRight - cellLeft),
      height: Math.max(0, cellBottom - cellTop),
    };
    const hitLeft = Math.max(left, cell.left);
    const hitWidth = Math.min(left + band.width, cell.left + cell.width) - hitLeft;
    if (hitWidth < 4 || cell.height < 4) continue;
    marks.push({
      key: issue.key,
      cellKey: `${issue.sheetId}:${issue.row}:${issue.column}`,
      word: issue.word,
      label: issue.label,
      left,
      top,
      width: band.width,
      hitLeft,
      hitTop: cell.top,
      hitWidth,
      hitHeight: cell.height,
      cell,
    });
  }
  return marks;
}

function SheetMarks({ marks, activeKey }: { marks: Mark[]; activeKey: string | null }) {
  return (
    <>
      {marks.map((mark) => (
        <Fragment key={mark.key}>
          <div
            className="sheet-spell-hit"
            data-spell-key={mark.key}
            data-spell-word={mark.word}
            data-spell-cell={mark.label}
            style={{
              left: mark.hitLeft,
              top: mark.hitTop,
              width: mark.hitWidth,
              height: mark.hitHeight,
            }}
          />
          <div
            className={`sheet-spell-mark${mark.key === activeKey ? " current" : ""}`}
            data-spell-word={mark.word}
            data-spell-cell={mark.label}
            style={{ left: mark.left, top: mark.top, width: mark.width }}
          />
        </Fragment>
      ))}
    </>
  );
}

function focusSheetIssue(workbook: any, issue: { sheetId: string; row: number; column: number }) {
  const sheet = workbook.getSheetBySheetId?.(issue.sheetId);
  if (!sheet) return;
  if (workbook.getActiveSheet?.()?.getSheetId() !== issue.sheetId)
    workbook.setActiveSheet?.(sheet);
  sheet.getRange(issue.row, issue.column, 1, 1).activate();
  const visible = sheet.getVisibleRange?.();
  const seen =
    visible &&
    issue.row >= visible.startRow &&
    issue.row <= visible.endRow &&
    issue.column >= visible.startColumn &&
    issue.column <= visible.endColumn;
  if (!seen) sheet.scrollToCell?.(issue.row, Math.max(0, issue.column - 1));
}

function replaceSheetIssue(workbook: any, issue: SheetIssue, replacement: string) {
  const sheet = workbook.getSheetBySheetId?.(issue.sheetId);
  if (!sheet) return false;
  const range = sheet.getRange(issue.row, issue.column, 1, 1);
  const text = plainCellText(range.getCellData?.());
  if (text == null || text.slice(issue.from, issue.to) !== issue.word) return false;
  range.setValue(replaceWordAt(text, issue.from, issue.to, replacement));
  return true;
}

type SpellMenu = {
  key: string;
  word: string;
  suggestions: string[];
  wordBox: Box;
  cellBox: Box;
};

function editingText(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable ||
    !!target.closest("input, textarea, [contenteditable='true']")
  );
}

function SpellContextMenu({
  menu,
  onReplace,
  onChangeAll,
  onIgnore,
  onIgnoreCell,
  onAdd,
  onClose,
}: {
  menu: SpellMenu;
  onReplace: (replacement: string) => void;
  onChangeAll: (replacement: string) => void;
  onIgnore: () => void;
  onIgnoreCell: () => void;
  onAdd: () => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 240, height: 220 });
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);
    setSize((current) =>
      Math.abs(current.width - width) > 1 || Math.abs(current.height - height) > 1
        ? { width, height }
        : current,
    );
  }, [menu.suggestions, menu.word]);
  const pos = spellingMenuPosition(menu.cellBox, menu.wordBox, size, {
    width: window.innerWidth,
    height: window.innerHeight,
  });
  return (
    <div
      className="context-menu-backdrop"
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        onClose();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div
        ref={menuRef}
        className="menu-content table-context-menu spelling-menu"
        role="menu"
        aria-label={`Spelling for ${menu.word}`}
        style={{ left: pos.left, top: pos.top }}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          const items = [...event.currentTarget.querySelectorAll<HTMLElement>("[role=menuitem]")];
          const at = items.indexOf(document.activeElement as HTMLElement);
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const next =
              event.key === "ArrowDown"
                ? items[(at + 1) % items.length]
                : items[(at - 1 + items.length) % items.length];
            next?.focus();
          }
        }}
      >
        {menu.suggestions.length ? (
          menu.suggestions.map((suggestion, index) => (
            <Fragment key={suggestion}>
              <button
                type="button"
                role="menuitem"
                className="menu-item spelling-suggestion"
                autoFocus={index === 0}
                onClick={() => onReplace(suggestion)}
              >
                {suggestion}
              </button>
              {index === 0 ? (
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => onChangeAll(suggestion)}
                >
                  Change all to {suggestion}
                </button>
              ) : null}
            </Fragment>
          ))
        ) : (
          <div className="menu-item" data-disabled="true" aria-disabled="true">
            No suggestions
          </div>
        )}
        <div className="menu-separator" role="separator" />
        <button type="button" role="menuitem" className="menu-item" onClick={onIgnore}>
          Ignore
        </button>
        <button type="button" role="menuitem" className="menu-item" onClick={onIgnoreCell}>
          Ignore this cell
        </button>
        <button
          type="button"
          role="menuitem"
          className="menu-item"
          autoFocus={menu.suggestions.length === 0}
          onClick={onAdd}
        >
          Add to dictionary
        </button>
      </div>
    </div>
  );
}

let changeAllSteps = 0;

/** One set of cell writes, so Undo restores every cell Change all edited. */
function applyChangeAll(workbook: any, engine: any, cells: ChangeAllCell[], replacement: string) {
  const values = changeAllValues(
    cells,
    (cell) => {
      const sheet = workbook?.getSheetBySheetId?.(cell.sheetId);
      if (!sheet) return null;
      try {
        return plainCellText(sheet.getRange(cell.row, cell.column, 1, 1).getCellData?.());
      } catch {
        return null;
      }
    },
    replacement,
  );
  if (!values.size) return false;
  const write = () => {
    for (const [sheetId, matrix] of values)
      workbook.getSheetBySheetId?.(sheetId)?.getRange(0, 0).setValues(matrix);
  };
  const unitId = workbook?.getId?.();
  if (engine?.get && unitId) {
    const undo = engine.get(IUndoRedoService);
    const group = undo.beginUndoRedoGroup(
      unitId,
      `suiteleaf.sheet.change-all.${++changeAllSteps}`,
      "append",
    );
    try {
      write();
    } finally {
      group.dispose();
    }
  } else write();
  return true;
}

function previewHighlights(marks: Mark[], cells: ChangeAllCell[]) {
  const wanted = new Set(cells.map((cell) => cell.key));
  const seen = new Set<string>();
  const boxes: { key: string; label: string; box: Box }[] = [];
  for (const mark of marks) {
    if (!wanted.has(mark.cellKey) || seen.has(mark.cellKey)) continue;
    seen.add(mark.cellKey);
    boxes.push({ key: mark.cellKey, label: mark.label, box: mark.cell });
  }
  return boxes;
}

function ChangeAllDialog({
  replacement,
  cells,
  onConfirm,
  onCancel,
  onFocusCell,
}: {
  replacement: string;
  cells: ChangeAllCell[];
  onConfirm: () => void;
  onCancel: () => void;
  onFocusCell: (cell: ChangeAllCell) => void;
}) {
  const title = `Change all to ${replacement}`;
  const count =
    cells.length === 1 ? "1 cell will change" : `${cells.length} cells will change`;
  return (
    <div className="gdocs-modal-overlay spelling-layer">
      <form
        className="gdocs-dialog spelling-panel change-all-panel"
        role="dialog"
        aria-modal="false"
        aria-labelledby="change-all-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (cells.length) onConfirm();
        }}
      >
        <div className="dialog-header">
          <h2 id="change-all-title">{title}</h2>
          <button type="button" className="dialog-close-btn" aria-label="Cancel change all" onClick={onCancel}>
            <X size={18} />
          </button>
        </div>
        <p className="spelling-progress" data-change-count={cells.length}>
          {count}
        </p>
        <p className="word-count-hint">
          Nothing changes until you confirm. Other spellings stay as they are.
        </p>
        <ul className="change-all-list">
          {cells.map((cell) => (
            <li key={cell.key}>
              <button
                type="button"
                className="change-all-cell"
                data-change-cell={cell.label}
                onClick={() => onFocusCell(cell)}
              >
                <span className="change-all-ref">{cell.label}</span>
                <span className="spelling-quote">{markedText(cell.text, cell.hits)}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="dialog-footer">
          <button type="button" className="dialog-text-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="dialog-primary-btn" disabled={!cells.length} autoFocus>
            Change all
          </button>
        </div>
      </form>
    </div>
  );
}

export function SheetSpelling({
  bookRef,
  hostRef,
  engineRef,
  fileId,
  ready,
  persist,
  ref,
}: {
  bookRef: RefObject<any>;
  hostRef: RefObject<HTMLElement | null>;
  engineRef: RefObject<any>;
  fileId: string;
  ready: boolean;
  persist: () => void;
  ref?: Ref<SpellingHandle>;
}) {
  const personal = usePersonalDictionary();
  const ignored = useIgnoredWords(fileId);
  const ignoredCells = useIgnoredCells(fileId);
  const [open, setOpen] = useState(false);
  const [hadIssues, setHadIssues] = useState(false);
  const [tick, setTick] = useState(0);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [menu, setMenu] = useState<SpellMenu | null>(null);
  const [preview, setPreview] = useState<{ replacement: string; cells: ChangeAllCell[] } | null>(
    null,
  );
  const personalRef = useRef(personal);
  personalRef.current = personal;
  const ignoredRef = useRef(ignored);
  ignoredRef.current = ignored;
  const ignoredCellsRef = useRef(ignoredCells);
  ignoredCellsRef.current = ignoredCells;

  useEffect(() => {
    if (!ready) return;
    const book = bookRef.current;
    let timer = 0;
    const sub = book?.onCommandExecuted?.((command: { id?: string }) => {
      // Formula results also emit mutations. Rescanning those keeps the
      // calculation from ever settling, and Back to files then never leaves.
      if (command.id !== "sheet.mutation.set-range-values") return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setTick((value) => value + 1), 80);
    });
    return () => {
      window.clearTimeout(timer);
      sub?.dispose?.();
    };
  }, [ready, bookRef]);

  const issues = useMemo(() => {
    if (!ready) return [];
    // `tick` reruns the scan after a cell edit. The workbook object itself does not change.
    void tick;
    return withoutIgnoredCells(
      collectSheetIssues(bookRef.current, personal, ignored),
      ignoredCells,
    );
  }, [ready, personal, ignored, ignoredCells, tick, bookRef]);
  const marksRef = useRef(marks);
  marksRef.current = marks;
  const issuesRef = useRef(issues);
  issuesRef.current = issues;
  const { index, restart } = useSpellCursor(issues.length, open);
  const issue = open && issues.length ? issues[index] : null;
  const focusedKey = useRef<string | null>(null);

  useLayoutEffect(() => {
    // Focus once per issue, before paint. A later rescan rebuilds the issue
    // object, and focusing again would undo a name-box selection.
    if (preview || !open || !issue) {
      if (!open || preview) focusedKey.current = null;
      return;
    }
    if (focusedKey.current === issue.key) return;
    focusedKey.current = issue.key;
    focusSheetIssue(bookRef.current, issue);
  }, [open, issue, preview, bookRef]);

  useLayoutEffect(() => {
    const first = preview?.cells[0];
    if (!first) return;
    focusSheetIssue(bookRef.current, first);
  }, [preview, bookRef]);

  useEffect(() => {
    if (!ready) return;
    const host = hostRef.current;
    let last = "";
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!host) return;
        const next = placeMarks(bookRef.current, host, issues);
        const signature = JSON.stringify(next);
        if (signature === last) return;
        last = signature;
        setMarks(next);
      });
    };
    update();
    host?.addEventListener("wheel", update, { passive: true });
    host?.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    // Switching sheets, zooming, and resizing rows or columns all move the words.
    const commands = bookRef.current?.onCommandExecuted?.(update);
    return () => {
      cancelAnimationFrame(frame);
      commands?.dispose?.();
      host?.removeEventListener("wheel", update);
      host?.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [ready, issues, bookRef, hostRef]);

  useEffect(() => {
    if (!menu) return;
    if (!issues.some((item) => item.key === menu.key)) setMenu(null);
  }, [issues, menu]);

  useEffect(() => {
    if (!ready) return;
    // The underline is painted over the canvas and does not take clicks, so the
    // grid still selects and edits. A right-click is claimed only on the word.
    const hitAt = (x: number, y: number) => {
      for (const node of document.querySelectorAll<HTMLElement>(".sheet-spell-hit")) {
        const rect = node.getBoundingClientRect();
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return node;
      }
      return null;
    };
    const wordAt = (event: MouseEvent) => {
      if (editingText(event.target)) return null;
      if (event.target instanceof HTMLElement && event.target.closest(".spelling-menu")) return null;
      if (hostRef.current?.closest(".view-locked")) return null;
      const node = hitAt(event.clientX, event.clientY);
      if (!node) return null;
      const key = node.dataset.spellKey;
      const found = key ? issuesRef.current.find((item) => item.key === key) : undefined;
      const mark = key ? marksRef.current.find((item) => item.key === key) : undefined;
      if (!found || !mark) return null;
      return { node, found, mark };
    };
    // Stop the grid menu on the way down. Open ours on contextmenu, after the
    // click's mousedown, so the backdrop does not dismiss itself.
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 2 || !wordAt(event)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const onContextMenu = (event: MouseEvent) => {
      const hit = wordAt(event);
      if (!hit) return;
      event.preventDefault();
      event.stopPropagation();
      focusSheetIssue(bookRef.current, hit.found);
      const rect = hit.node.getBoundingClientRect();
      setMenu({
        key: hit.found.key,
        word: hit.found.word,
        suggestions: suggestionsFor(hit.found.word),
        wordBox: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        cellBox: hit.mark.cell,
      });
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("contextmenu", onContextMenu, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("contextmenu", onContextMenu, true);
    };
  }, [ready, bookRef, hostRef]);

  const openSession = () => {
    setMenu(null);
    setPreview(null);
    restart();
    setHadIssues(
      withoutIgnoredCells(
        collectSheetIssues(bookRef.current, personalRef.current, ignoredRef.current),
        ignoredCellsRef.current,
      ).length > 0,
    );
    setOpen(true);
    setTick((value) => value + 1);
  };
  useImperativeHandle(ref, () => ({ open: openSession }));

  const remember = (next: PersonalDictionary) => writePersonalDictionary(next);
  const ignore = () => {
    if (!issue) return;
    writeIgnoredWords(fileId, withIgnored(ignoredRef.current, issue.word));
  };
  const add = () => {
    if (!issue) return;
    remember(addToPersonalDictionary(personalRef.current, issue.word));
  };
  const replace = (replacement: string) => {
    if (!issue || !replacement.trim()) return;
    if (replaceSheetIssue(bookRef.current, issue, replacement)) persist();
    setTick((value) => value + 1);
  };
  const menuIssue = () => (menu ? issuesRef.current.find((item) => item.key === menu.key) : undefined);
  const replaceFromMenu = (replacement: string) => {
    const current = menuIssue();
    if (!current || !replacement.trim()) return;
    if (replaceSheetIssue(bookRef.current, current, replacement)) persist();
    setMenu(null);
    setTick((value) => value + 1);
  };
  const ignoreFromMenu = () => {
    const current = menuIssue();
    if (!current) return;
    writeIgnoredWords(fileId, withIgnored(ignoredRef.current, current.word));
    setMenu(null);
  };
  const addFromMenu = () => {
    const current = menuIssue();
    if (!current) return;
    remember(addToPersonalDictionary(personalRef.current, current.word));
    setMenu(null);
  };
  const ignoreCellFromMenu = () => {
    const current = menuIssue();
    if (!current) return;
    writeIgnoredCells(
      fileId,
      withIgnoredCell(ignoredCellsRef.current, {
        sheetId: current.sheetId,
        row: current.row,
        column: current.column,
        word: current.word,
      }),
    );
    setMenu(null);
  };
  const openChangeAll = (word: string, replacement: string) => {
    const cells = changeAllCells(issuesRef.current, word);
    if (!cells.length || !replacement.trim()) return;
    setMenu(null);
    setPreview({ replacement, cells });
  };
  const confirmChangeAll = () => {
    if (!preview) return;
    if (applyChangeAll(bookRef.current, engineRef.current, preview.cells, preview.replacement))
      persist();
    setPreview(null);
    setTick((value) => value + 1);
  };
  const highlights = preview ? previewHighlights(marks, preview.cells) : [];

  return (
    <>
      {highlights.map((item) => (
        <div
          key={item.key}
          className="sheet-spell-preview"
          data-change-cell={item.label}
          style={{
            left: item.box.left,
            top: item.box.top,
            width: item.box.width,
            height: item.box.height,
          }}
        />
      ))}
      <SheetMarks marks={marks} activeKey={issue?.key ?? menu?.key ?? null} />
      {menu ? (
        <SpellContextMenu
          menu={menu}
          onReplace={replaceFromMenu}
          onChangeAll={(replacement) => {
            const current = menuIssue();
            if (current) openChangeAll(current.word, replacement);
          }}
          onIgnore={ignoreFromMenu}
          onIgnoreCell={ignoreCellFromMenu}
          onAdd={addFromMenu}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {open && !preview ? (
        <SpellingPanel
          key={issue?.key ?? "done"}
          issue={issue}
          index={index}
          count={issues.length}
          hadIssues={hadIssues}
          onReplace={replace}
          onIgnore={ignore}
          onAdd={add}
          onChangeAll={
            issue && suggestionsFor(issue.word)[0]
              ? () => openChangeAll(issue.word, suggestionsFor(issue.word)[0]!)
              : undefined
          }
          onClose={() => setOpen(false)}
        />
      ) : null}
      {preview ? (
        <ChangeAllDialog
          replacement={preview.replacement}
          cells={preview.cells}
          onConfirm={confirmChangeAll}
          onCancel={() => setPreview(null)}
          onFocusCell={(cell) => focusSheetIssue(bookRef.current, cell)}
        />
      ) : null}
    </>
  );
}

export function SlideSpellMirror({
  text,
  fileId,
  caret = null,
}: {
  text: string;
  fileId: string;
  /** While this box is being edited, the word at the caret is not underlined. */
  caret?: number | null;
}) {
  const personal = usePersonalDictionary();
  const ignored = useIgnoredWords(fileId);
  const hits = misspellingsInText(text, personal, ignored).filter(
    (hit) => !isTypingWord(hit.to, caret, text[hit.to]),
  );
  if (!hits.length) return null;
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const hit of hits) {
    if (hit.from > cursor) parts.push(text.slice(cursor, hit.from));
    parts.push(
      <span key={hit.from} className="spelling-misspelling">
        {hit.word}
      </span>,
    );
    cursor = hit.to;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return (
    <div className="slide-spell-mirror" aria-hidden="true">
      {parts}
    </div>
  );
}

export function SlideSpelling({
  deck,
  fileId,
  onFocus,
  onReplace,
  ref,
}: {
  deck: Parameters<typeof collectSlideIssues>[0];
  fileId: string;
  onFocus: (issue: SlideIssue) => void;
  onReplace: (issue: SlideIssue, replacement: string) => void;
  ref?: Ref<SpellingHandle>;
}) {
  const personal = usePersonalDictionary();
  const ignored = useIgnoredWords(fileId);
  const [open, setOpen] = useState(false);
  const [hadIssues, setHadIssues] = useState(false);
  const issues = useMemo(
    () => collectSlideIssues(deck, personal, ignored),
    [deck, personal, ignored],
  );
  const { index, restart } = useSpellCursor(issues.length, open);
  const issue = open && issues.length ? issues[index] : null;
  const focusRef = useRef(onFocus);
  focusRef.current = onFocus;
  const replaceRef = useRef(onReplace);
  replaceRef.current = onReplace;
  const deckRef = useRef(deck);
  deckRef.current = deck;
  const personalRef = useRef(personal);
  personalRef.current = personal;
  const ignoredRef = useRef(ignored);
  ignoredRef.current = ignored;

  useEffect(() => {
    if (!open || !issue) return;
    focusRef.current(issue);
  }, [open, issue]);

  const openSession = () => {
    restart();
    setHadIssues(
      collectSlideIssues(deckRef.current, personalRef.current, ignoredRef.current).length > 0,
    );
    setOpen(true);
  };
  useImperativeHandle(ref, () => ({ open: openSession }));

  const replace = (replacement: string) => {
    if (!issue || !replacement.trim()) return;
    const current = deckRef.current.slides[issue.slideId]?.elements.find(
      (element) => element.id === issue.elementId,
    );
    if (current?.content?.slice(issue.from, issue.to) !== issue.word) return;
    replaceRef.current(issue, replacement);
  };

  if (!open) return null;
  return (
    <SpellingPanel
      key={issue?.key ?? "done"}
      issue={issue}
      index={index}
      count={issues.length}
      hadIssues={hadIssues}
      onReplace={replace}
      onIgnore={() => issue && writeIgnoredWords(fileId, withIgnored(ignored, issue.word))}
      onAdd={() => issue && writePersonalDictionary(addToPersonalDictionary(personal, issue.word))}
      onClose={() => setOpen(false)}
    />
  );
}
