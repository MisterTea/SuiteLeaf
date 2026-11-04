import {
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
  writePersonalDictionary,
  type PersonalDictionary,
} from "./doc-spelling";
import type { ProofingLanguage } from "./proofing-language";
import {
  changeAllCells,
  collectSheetIssues,
  collectSlideIssues,
  misspellingsInText,
  plainCellText,
  replaceWordAt,
  suggestionsFor,
  withIgnored,
  withIgnoredCell,
  withoutIgnoredCells,
  writeIgnoredCells,
  writeIgnoredWords,
  type ChangeAllCell,
  type SheetIssue,
  type SlideIssue,
} from "./grid-spelling";
import { useIgnoredCells, useIgnoredWords, usePersonalDictionary, useSpellCursor } from "./grid-spelling-hooks";
import { SpellingPanel } from "./grid-spelling-panel";
import { placeMarks, SheetMarks, type Mark } from "./grid-spelling-marks";
import { SpellContextMenu, type SpellMenu } from "./grid-spelling-menu";
import { applyChangeAll, ChangeAllDialog, previewHighlights } from "./grid-spelling-change-all";

export type SpellingHandle = { open: () => void };

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

function editingText(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable ||
    !!target.closest("input, textarea, [contenteditable='true']")
  );
}

export function SheetSpelling({
  bookRef,
  hostRef,
  engineRef,
  fileId,
  ready,
  persist,
  language = "en",
  ref,
}: {
  bookRef: RefObject<any>;
  hostRef: RefObject<HTMLElement | null>;
  engineRef: RefObject<any>;
  fileId: string;
  ready: boolean;
  persist: () => void;
  language?: ProofingLanguage;
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
      collectSheetIssues(bookRef.current, personal, ignored, language),
      ignoredCells,
    );
  }, [ready, personal, ignored, ignoredCells, tick, bookRef, language]);
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
        collectSheetIssues(bookRef.current, personalRef.current, ignoredRef.current, language),
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
  language = "en",
}: {
  text: string;
  fileId: string;
  /** While this box is being edited, the word at the caret is not underlined. */
  caret?: number | null;
  language?: ProofingLanguage;
}) {
  const personal = usePersonalDictionary();
  const ignored = useIgnoredWords(fileId);
  const hits = misspellingsInText(text, personal, ignored, language).filter(
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
  language = "en",
  ref,
}: {
  deck: Parameters<typeof collectSlideIssues>[0];
  fileId: string;
  onFocus: (issue: SlideIssue) => void;
  onReplace: (issue: SlideIssue, replacement: string) => void;
  language?: ProofingLanguage;
  ref?: Ref<SpellingHandle>;
}) {
  const personal = usePersonalDictionary();
  const ignored = useIgnoredWords(fileId);
  const [open, setOpen] = useState(false);
  const [hadIssues, setHadIssues] = useState(false);
  const issues = useMemo(
    () => collectSlideIssues(deck, personal, ignored, language),
    [deck, personal, ignored, language],
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
      collectSlideIssues(deckRef.current, personalRef.current, ignoredRef.current, language).length > 0,
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