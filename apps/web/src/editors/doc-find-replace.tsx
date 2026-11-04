import { useEffect, useLayoutEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { X } from "lucide-react";
import { documentMatches, searchKey } from "./doc-search-plugin";
import { clampToView, matchCounter, positionClearOf, type Point } from "./doc-find";
import type { DocTabs } from "./doc-tabs";

export function useDocFindEffects({
  editor,
  findOpen,
  query,
  replacement,
  matchCase,
  useRegex,
  ignoreDiacritics,
  revision,
  setFindSpot,
  setQuery,
  setReplacedCount,
  findDialog,
  findAvoided,
  findInput,
  firstBody,
  extrasRef,
  activeRef,
  showTabRef,
}: {
  editor: Editor | null;
  findOpen: boolean;
  query: string;
  replacement: string;
  matchCase: boolean;
  useRegex: boolean;
  ignoreDiacritics: boolean;
  revision: number | undefined;
  setFindSpot: Dispatch<SetStateAction<Point | null>>;
  setQuery: Dispatch<SetStateAction<string>>;
  setReplacedCount: Dispatch<SetStateAction<number | null>>;
  findDialog: RefObject<HTMLDivElement | null>;
  findAvoided: RefObject<string>;
  findInput: RefObject<HTMLInputElement | null>;
  firstBody: DocTabs["firstBody"];
  extrasRef: DocTabs["extrasRef"];
  activeRef: DocTabs["activeRef"];
  showTabRef: DocTabs["showTabRef"];
}) {
  useEffect(() => {
    if (!findOpen) {
      setFindSpot(null);
      return;
    }
    if (!editor?.schema) return;
    const { from, to, empty } = editor.state.selection;
    const selected = empty ? "" : editor.state.doc.textBetween(from, to, "\n");
    if (selected.trim() && !selected.includes("\n") && selected.length <= 200)
      setQuery(selected);
    // Only when the dialog opens: later selections are the matches themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findOpen]);

  useEffect(
    () => setReplacedCount(null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the editor's refs and setters are stable
    [findOpen, query, replacement, matchCase, useRegex, ignoreDiacritics],
  );

  // Step the dialog aside whenever a newly selected match would sit under it.
  useLayoutEffect(() => {
    const dialog = findDialog.current;
    if (!dialog || !editor?.schema) {
      findAvoided.current = "";
      return;
    }
    const parts = [
      ...editor.view.dom.querySelectorAll(".doc-search-current"),
    ].map((part) => part.getBoundingClientRect());
    const key = parts.length
      ? `${editor.state.selection.from}:${editor.state.selection.to}`
      : "";
    if (key === findAvoided.current) return;
    findAvoided.current = key;
    if (!parts.length) return;
    const spot = positionClearOf(
      dialog.getBoundingClientRect(),
      {
        left: Math.min(...parts.map((r) => r.left)),
        top: Math.min(...parts.map((r) => r.top)),
        right: Math.max(...parts.map((r) => r.right)),
        bottom: Math.max(...parts.map((r) => r.bottom)),
      },
      { width: window.innerWidth, height: window.innerHeight },
    );
    if (spot) setFindSpot(spot);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the editor's refs and setters are stable
  }, [editor, findOpen, revision]);

  useEffect(() => {
    if (!editor?.schema) return;
    const options = { matchCase, regex: useRegex, ignoreDiacritics };
    const activeQuery = findOpen ? query : "";
    // A query missing from this tab is looked up on the others, in order.
    // Typing again is what moves; clicking a tab leaves that page in place.
    let switched = false;
    if (activeQuery) {
      const here = documentMatches(editor.state.doc, activeQuery, options);
      if (!here.error && !here.matches.length) {
        const bodies = [
          firstBody.current,
          ...extrasRef.current.map((tab) => tab.content),
        ];
        for (let index = 0; index < bodies.length; index++) {
          if (index === activeRef.current) continue;
          let node;
          try {
            node = editor.schema.nodeFromJSON(bodies[index]);
          } catch {
            continue;
          }
          const found = documentMatches(node, activeQuery, options);
          if (found.error) break;
          if (!found.matches.length) continue;
          showTabRef.current(index, "find");
          switched = true;
          break;
        }
      }
    }
    const result = documentMatches(editor.state.doc, activeQuery, options);
    let transaction = editor.state.tr.setMeta(searchKey, {
      query: activeQuery,
      options,
    });
    const next =
      result.matches.find((m) => m.to > editor.state.selection.from) ??
      result.matches[0];
    if (next)
      transaction = transaction
        .setSelection(TextSelection.create(transaction.doc, next.from, next.to))
        .scrollIntoView();
    editor.view.dispatch(transaction);
    if (!switched) return;
    const restoreFind = () => {
      const input = findInput.current;
      if (!input || document.activeElement === input) return;
      const pos = input.value.length;
      input.focus();
      input.setSelectionRange(pos, pos);
    };
    restoreFind();
    requestAnimationFrame(restoreFind);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the editor's refs and setters are stable
  }, [editor, findOpen, query, matchCase, useRegex, ignoreDiacritics]);
}

export function DocFindDialog({
  editor,
  query,
  setQuery,
  replacement,
  setReplacement,
  matchCase,
  setMatchCase,
  useRegex,
  setUseRegex,
  ignoreDiacritics,
  setIgnoreDiacritics,
  replacedCount,
  setReplacedCount,
  findSpot,
  setFindSpot,
  findDialog,
  findInput,
  findDrag,
  tabNames,
  active,
  closeFind,
}: {
  editor: Editor;
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  replacement: string;
  setReplacement: Dispatch<SetStateAction<string>>;
  matchCase: boolean;
  setMatchCase: Dispatch<SetStateAction<boolean>>;
  useRegex: boolean;
  setUseRegex: Dispatch<SetStateAction<boolean>>;
  ignoreDiacritics: boolean;
  setIgnoreDiacritics: Dispatch<SetStateAction<boolean>>;
  replacedCount: number | null;
  setReplacedCount: Dispatch<SetStateAction<number | null>>;
  findSpot: Point | null;
  setFindSpot: Dispatch<SetStateAction<Point | null>>;
  findDialog: RefObject<HTMLDivElement | null>;
  findInput: RefObject<HTMLInputElement | null>;
  findDrag: RefObject<Point | null>;
  tabNames: string[];
  active: number;
  closeFind: () => void;
}) {
  const search = documentMatches(editor.state.doc, query, {
    matchCase,
    regex: useRegex,
    ignoreDiacritics,
  });

  const selectedMatch = search.matches.findIndex(
    (m) =>
      m.from === editor.state.selection.from &&
      m.to === editor.state.selection.to,
  );

  const findMatch = (backward = false) => {
    const all = search.matches;
    const next = backward
      ? ([...all].reverse().find((m) => m.from < editor.state.selection.from) ??
        all.at(-1))
      : (all.find((m) => m.from > editor.state.selection.from) ?? all[0]);
    if (next) editor.chain().setTextSelection(next).scrollIntoView().run();
  };

  const replaceOne = () => {
    const match =
      search.matches[selectedMatch] ??
      search.matches.find((m) => m.from >= editor.state.selection.from) ??
      search.matches[0];
    if (!match) return;
    let transaction = editor.state.tr.insertText(
      replacement,
      match.from,
      match.to,
    );
    const remaining = documentMatches(transaction.doc, query, {
      matchCase,
      regex: useRegex,
      ignoreDiacritics,
    }).matches;
    const next =
      remaining.find((m) => m.from >= match.from + replacement.length) ??
      remaining[0];
    if (next)
      transaction = transaction.setSelection(
        TextSelection.create(transaction.doc, next.from, next.to),
      );
    editor.view.dispatch(transaction.scrollIntoView());
  };

  const replaceAll = () => {
    if (!search.matches.length) return;
    let tr = editor.state.tr;
    for (const m of [...search.matches].reverse())
      tr = tr.insertText(replacement, m.from, m.to);
    editor.view.dispatch(tr);
    setReplacedCount(search.matches.length);
  };

  const matchTab =
    query && !search.error && search.matches.length > 0 && tabNames.length > 1
      ? tabNames[active]
      : "";

  const dragFind = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = findDialog.current?.getBoundingClientRect();
    if (!box || !findDrag.current) return;
    setFindSpot(
      clampToView(
        {
          left: event.clientX - findDrag.current.left,
          top: event.clientY - findDrag.current.top,
        },
        box,
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  };

  return (
    <div className="gdocs-modal-overlay" onClick={closeFind}>
      <div
        ref={findDialog}
        className="gdocs-dialog find-replace-dialog"
        role="search"
        aria-label="Find and replace"
        style={
          findSpot
            ? { position: "fixed", margin: 0, ...findSpot }
            : undefined
        }
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") closeFind();
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
            e.preventDefault();
            findInput.current?.focus();
            findInput.current?.select();
          }
        }}
      >
        <div
          className="dialog-header"
          onPointerDown={(e) => {
            const box = findDialog.current?.getBoundingClientRect();
            if (!box || e.button || (e.target as Element).closest("button"))
              return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            findDrag.current = {
              left: e.clientX - box.left,
              top: e.clientY - box.top,
            };
          }}
          onPointerMove={dragFind}
          onPointerUp={() => (findDrag.current = null)}
          onPointerCancel={() => (findDrag.current = null)}
        >
          <h2>Find and replace</h2>
          <button
            type="button"
            className="dialog-close-btn"
            aria-label="Close find"
            onClick={closeFind}
          >
            <X size={18} />
          </button>
        </div>

        <div className="dialog-body">
          <div className="form-field-group">
            <div className="floating-field">
              <label htmlFor="gdocs-find-input">Find</label>
              <div className="field-input-row">
                <input
                  ref={findInput}
                  id="gdocs-find-input"
                  autoFocus
                  aria-label="Find text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    findMatch(e.shiftKey);
                  }}
                />
                <span className="match-counter" role="status">
                  {search.error ??
                    matchCounter(
                      query,
                      search.matches.length,
                      selectedMatch,
                    )}
                </span>
              </div>
              {matchTab ? (
                <p className="find-tab-place">on {matchTab}</p>
              ) : null}
            </div>

            <div className="floating-field">
              <label htmlFor="gdocs-replace-input">Replace with</label>
              <input
                id="gdocs-replace-input"
                aria-label="Replacement text"
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
              />
            </div>
          </div>

          <div className="options-checkbox-group">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={matchCase}
                onChange={(e) => setMatchCase(e.target.checked)}
              />
              <span>Match case</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={useRegex}
                onChange={(e) => setUseRegex(e.target.checked)}
              />
              <span>
                Use regular expressions{" "}
                <a
                  className="field-help-link"
                  href="https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions/Cheatsheet"
                  target="_blank"
                  rel="noreferrer"
                >
                  Help
                </a>
              </span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={ignoreDiacritics}
                onChange={(e) => setIgnoreDiacritics(e.target.checked)}
              />
              <span>Ignore diacritics (e.g. ä = a, E = É, א = אַ)</span>
            </label>
          </div>
          {replacedCount !== null ? (
            <p className="find-summary">
              Replaced {replacedCount}{" "}
              {replacedCount === 1 ? "instance" : "instances"} of “{query}”
              with “{replacement}”.
            </p>
          ) : null}
        </div>

        <div className="dialog-footer">
          <button
            type="button"
            className="dialog-text-btn"
            disabled={!search.matches.length}
            onClick={replaceOne}
          >
            Replace
          </button>
          <button
            type="button"
            className="dialog-text-btn"
            disabled={!search.matches.length}
            onClick={replaceAll}
          >
            Replace all
          </button>
          <button
            type="button"
            className="dialog-text-btn"
            disabled={!search.matches.length}
            onClick={() => findMatch(true)}
          >
            Previous
          </button>
          <button
            type="button"
            className="dialog-primary-btn"
            disabled={!search.matches.length}
            onClick={() => findMatch()}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
