import { X } from "lucide-react";
import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import {
  addToPersonalDictionary,
  readPersonalDictionary,
  SPELLING_CHANGED_EVENT,
  writePersonalDictionary,
  type PersonalDictionary,
} from "./doc-spelling";
import {
  collectSheetIssues,
  collectSlideIssues,
  misspellingsInText,
  plainCellText,
  readIgnoredWords,
  replaceWordAt,
  suggestionsFor,
  withIgnored,
  wordBand,
  writeIgnoredWords,
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

function SpellingPanel({
  issue,
  index,
  count,
  onReplace,
  onIgnore,
  onAdd,
  onClose,
  hadIssues,
}: {
  issue: SpellHit | null;
  index: number;
  count: number;
  onReplace: (replacement: string) => void;
  onIgnore: () => void;
  onAdd: () => void;
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
              One click replaces this word. The rest stays as it is. Checked on this computer.
            </p>
            <div className="spelling-actions">
              <button type="submit" className="dialog-primary-btn" disabled={!first}>
                Change
              </button>
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

const measureCanvas = typeof document === "undefined" ? null : document.createElement("canvas");

function measureWith(font: string) {
  const context = measureCanvas?.getContext("2d");
  if (!context) return () => 0;
  context.font = font;
  return (value: string) => context.measureText(value).width;
}

function cellFont(sheet: any, row: number, column: number) {
  let style: { fs?: number; ff?: string; it?: number; bl?: number; ht?: number; pd?: { l?: number; r?: number } } = {};
  try {
    style = sheet.getRange(row, column, 1, 1).getCellStyleData?.() ?? {};
  } catch {
    style = {};
  }
  const size = typeof style.fs === "number" && style.fs > 0 ? style.fs : 11;
  const family = typeof style.ff === "string" && style.ff ? style.ff : "Arial";
  const italic = style.it === 1 ? "italic" : "normal";
  const weight = style.bl === 1 ? "bold" : "normal";
  const align = style.ht === 2 ? "center" : style.ht === 3 ? "right" : "left";
  const padLeft = typeof style.pd?.l === "number" ? style.pd.l : 2;
  const padRight = typeof style.pd?.r === "number" ? style.pd.r : 2;
  return {
    font: `${italic} ${weight} ${size}pt ${family}`,
    align,
    padLeft,
    padRight,
  } as const;
}

type Mark = { key: string; word: string; label: string; left: number; top: number; width: number };

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
    const font = cellFont(sheet, issue.row, issue.column);
    const band = wordBand(
      issue.text,
      issue.from,
      issue.to,
      measureWith(font.font),
      font.align,
      Math.max(0, rect.width - font.padLeft - font.padRight),
      font.padLeft,
    );
    const left = box.left + rect.left + band.x;
    const top = box.top + rect.top + rect.height - 5;
    if (left + band.width < box.left + 40 || left > box.right) continue;
    if (top < box.top + 16 || top > box.bottom) continue;
    marks.push({
      key: issue.key,
      word: issue.word,
      label: issue.label,
      left,
      top,
      width: band.width,
    });
  }
  return marks;
}

function SheetMarks({ marks, activeKey }: { marks: Mark[]; activeKey: string | null }) {
  return (
    <>
      {marks.map((mark) => (
        <div
          key={mark.key}
          className={`sheet-spell-mark${mark.key === activeKey ? " current" : ""}`}
          data-spell-word={mark.word}
          data-spell-cell={mark.label}
          style={{ left: mark.left, top: mark.top, width: mark.width }}
        />
      ))}
    </>
  );
}

function focusSheetIssue(workbook: any, issue: SheetIssue) {
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

export function SheetSpelling({
  bookRef,
  hostRef,
  fileId,
  ready,
  persist,
  ref,
}: {
  bookRef: RefObject<any>;
  hostRef: RefObject<HTMLElement | null>;
  fileId: string;
  ready: boolean;
  persist: () => void;
  ref?: Ref<SpellingHandle>;
}) {
  const personal = usePersonalDictionary();
  const ignored = useIgnoredWords(fileId);
  const [open, setOpen] = useState(false);
  const [hadIssues, setHadIssues] = useState(false);
  const [tick, setTick] = useState(0);
  const [marks, setMarks] = useState<Mark[]>([]);
  const personalRef = useRef(personal);
  personalRef.current = personal;
  const ignoredRef = useRef(ignored);
  ignoredRef.current = ignored;

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
    return collectSheetIssues(bookRef.current, personal, ignored);
  }, [ready, personal, ignored, tick, bookRef]);
  const { index, restart } = useSpellCursor(issues.length, open);
  const issue = open && issues.length ? issues[index] : null;

  useEffect(() => {
    if (!open || !issue) return;
    focusSheetIssue(bookRef.current, issue);
  }, [open, issue, bookRef]);

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
    return () => {
      cancelAnimationFrame(frame);
      host?.removeEventListener("wheel", update);
      host?.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [ready, issues, bookRef, hostRef]);

  const openSession = () => {
    restart();
    setHadIssues(collectSheetIssues(bookRef.current, personalRef.current, ignoredRef.current).length > 0);
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

  return (
    <>
      <SheetMarks marks={marks} activeKey={issue?.key ?? null} />
      {open ? (
        <SpellingPanel
          key={issue?.key ?? "done"}
          issue={issue}
          index={index}
          count={issues.length}
          hadIssues={hadIssues}
          onReplace={replace}
          onIgnore={ignore}
          onAdd={add}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

export function SlideSpellMirror({ text, fileId }: { text: string; fileId: string }) {
  const personal = usePersonalDictionary();
  const ignored = useIgnoredWords(fileId);
  const hits = misspellingsInText(text, personal, ignored);
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
