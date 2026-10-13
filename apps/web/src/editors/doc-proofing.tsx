import { useEditorState, type Editor } from "@tiptap/react";
import type { EditorView } from "@tiptap/pm/view";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { JsonNode } from "@suiteleaf/core";
import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import {
  countDocument,
  exclusionNotes,
  formatWordCount,
  readProofing,
  selectionPages,
  selectionSnapshot,
  setWordCountVisible,
  stopPosition,
  wordCountIsVisible,
  type ProofingSettings,
} from "./doc-word-count";
import {
  addToPersonalDictionary,
  flagWord,
  ignoreWord,
  misspelledRanges,
  readPersonalDictionary,
  removePersonalWord,
  spellingHighlight,
  spellingHit,
  spellingKey,
  spellingSuggestions,
  unignoreWord,
  writePersonalDictionary,
  type PersonalDictionary,
  type SpellingMenuHit,
  type SpellingRange,
} from "./doc-spelling";

export type ProofingContext = (view: EditorView, event: Event) => boolean;

const formatNumber = (value: number) => value.toLocaleString("en-US");

function writeProofing(editor: Editor, settings: ProofingSettings) {
  editor.view.dispatch(
    editor.state.tr
      .setDocAttribute("proofing", settings)
      .setMeta("addToHistory", false),
  );
}

function refreshSpelling(editor: Editor, from = -1, to = -1) {
  if (editor.isDestroyed) return;
  editor.view.dispatch(
    editor.state.tr
      .setMeta(spellingKey, spellingHighlight(from, to))
      .setMeta("addToHistory", false),
  );
}

function replaceWord(editor: Editor, from: number, to: number, text: string) {
  const cleaned = text.trim();
  if (!cleaned) return to;
  const marks =
    editor.state.doc.resolve(from).marksAcross(editor.state.doc.resolve(to)) ??
    editor.state.doc.resolve(from).marks();
  let tr = editor.state.tr.replaceWith(
    from,
    to,
    editor.state.schema.text(cleaned, marks),
  );
  const cursor = from + cleaned.length;
  tr = tr.setSelection(TextSelection.create(tr.doc, cursor)).scrollIntoView();
  editor.view.dispatch(tr);
  return cursor;
}

export function useDocProofing(
  editor: Editor | null,
  pageCount: number,
  onContext: MutableRefObject<ProofingContext>,
  grammarContext?: MutableRefObject<ProofingContext>,
) {
  const [dialog, setDialog] = useState<"count" | "spelling" | "dictionary" | null>(null);
  const [menu, setMenu] = useState<SpellingMenuHit | null>(null);
  const [visible, setVisible] = useState(wordCountIsVisible);
  const [personal, setPersonal] = useState(readPersonalDictionary);
  const [session, setSession] = useState<{ total: number; step: number; after: number } | null>(
    null,
  );
  const [choice, setChoice] = useState("");
  const [flagDraft, setFlagDraft] = useState("");
  const personalRef = useRef(personal);
  personalRef.current = personal;
  const snapshot = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current) return null;
      const json = current.getJSON() as JsonNode;
      const settings = readProofing(json);
      const selection = current.state.selection;
      const { from, to, empty } = selection;
      // A selected photo is not a text selection. Counting it says "0 of N words".
      const image =
        selection instanceof NodeSelection && selection.node.type.name === "image";
      return {
        settings,
        counts: countDocument(json, settings),
        selection: empty || image
          ? null
          : selectionSnapshot(
              current.state.doc,
              from,
              to,
              stopPosition(current.state.doc, settings.stopAtHeading),
            ),
      };
    },
  });
  const settings = snapshot?.settings ?? readProofing(null);
  const ranges: SpellingRange[] =
    editor && !editor.isDestroyed
      ? misspelledRanges(editor.state.doc, personal, settings.ignored)
      : [];
  const issue =
    dialog === "spelling" && session
      ? (ranges.find((range) => range.from >= session.after) ?? null)
      : null;
  const issueId = issue ? `${issue.from}:${issue.to}:${issue.word}` : "";
  const suggestions = issue ? spellingSuggestions(issue.word) : [];
  const issueRef = useRef(issue);
  issueRef.current = issue;

  useEffect(() => {
    onContext.current = (view, event) => {
      if (grammarContext?.current(view, event)) return true;
      const hit = spellingHit(view, event, personalRef.current);
      if (!hit) return false;
      event.preventDefault();
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, hit.from, hit.to)),
      );
      setMenu(hit);
      setDialog(null);
      return true;
    };
  });

  useEffect(() => {
    if (!editor) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.repeat) return;
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
      if (event.key.toLowerCase() !== "c") return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      )
        return;
      event.preventDefault();
      setMenu(null);
      setDialog("count");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor]);

  useEffect(() => {
    if (!issue) return;
    setChoice(spellingSuggestions(issue.word)[0] ?? "");
    // Suggestions depend only on the current misspelling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueId]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const current = issueRef.current;
    if (dialog !== "spelling" || !current) {
      if (dialog !== "spelling") refreshSpelling(editor);
      return;
    }
    editor.view.dispatch(
      editor.state.tr
        .setSelection(TextSelection.create(editor.state.doc, current.from, current.to))
        .scrollIntoView()
        .setMeta(spellingKey, spellingHighlight(current.from, current.to))
        .setMeta("addToHistory", false),
    );
  }, [editor, dialog, issueId]);

  const updatePersonal = (next: PersonalDictionary) => {
    writePersonalDictionary(next);
    setPersonal(next);
    if (editor) refreshSpelling(editor);
  };
  const openWordCount = useCallback(() => {
    setMenu(null);
    setDialog("count");
  }, []);
  const openSpelling = useCallback(() => {
    setMenu(null);
    const ignored =
      editor && !editor.isDestroyed
        ? readProofing(editor.getJSON() as JsonNode).ignored
        : [];
    const found =
      editor && !editor.isDestroyed
        ? misspelledRanges(editor.state.doc, personalRef.current, ignored)
        : [];
    setSession({ total: found.length, step: 1, after: 0 });
    setDialog("spelling");
  }, [editor]);
  const openDictionary = useCallback(() => {
    setMenu(null);
    setDialog("dictionary");
  }, []);
  const close = () => setDialog(null);
  const notes = snapshot ? exclusionNotes(snapshot.counts, snapshot.settings) : [];
  const label =
    visible && snapshot
      ? formatWordCount({
          totalWords: snapshot.counts.words,
          selectionWords: snapshot.selection ? snapshot.selection.stats.words : null,
          excludes: notes,
        })
      : "";
  const headings = [
    ...new Set(
      (snapshot?.counts.headings ?? []).filter((heading) => heading.trim()),
    ),
  ];
  if (settings.stopAtHeading && !headings.includes(settings.stopAtHeading))
    headings.push(settings.stopAtHeading);

  const updateSettings = (next: ProofingSettings) => {
    if (editor) writeProofing(editor, next);
  };
  const advance = (after: number) =>
    setSession((current) =>
      current ? { ...current, step: current.step + 1, after } : current,
    );
  const changeIssue = () => {
    if (!editor || !issue || !choice.trim()) return;
    advance(replaceWord(editor, issue.from, issue.to, choice));
  };
  const ignoreIssue = () => {
    if (!editor || !issue) return;
    updateSettings(ignoreWord(settings, issue.word));
    advance(issue.to);
  };
  const addIssue = () => {
    if (!issue) return;
    updatePersonal(addToPersonalDictionary(personal, issue.word));
    advance(issue.to);
  };

  const selectionStats = snapshot?.selection?.stats ?? null;
  const selectionParagraphs = snapshot?.selection?.paragraphs ?? null;
  const selectedPages =
    snapshot?.selection == null
      ? null
      : selectionPages(snapshot.selection.fraction, pageCount);
  const stat = (
    name: string,
    selected: number | null,
    total: number,
  ) => (
    <tr key={name}>
      <th scope="row">{name}</th>
      <td>{selected === null ? "—" : formatNumber(selected)}</td>
      <td>{formatNumber(total)}</td>
    </tr>
  );

  let ui: ReactNode = null;
  const menuUi = menu ? (
    <div
      className="context-menu-backdrop"
      onMouseDown={() => setMenu(null)}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenu(null);
      }}
    >
      <div
        className="menu-content table-context-menu spelling-menu"
        role="menu"
        aria-label={`Spelling for ${menu.word}`}
        style={{
          left: Math.min(menu.x, window.innerWidth - 240),
          top: Math.min(menu.y, window.innerHeight - 280),
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          const items = [
            ...event.currentTarget.querySelectorAll<HTMLElement>("[role=menuitem]"),
          ];
          const at = items.indexOf(document.activeElement as HTMLElement);
          if (event.key === "Escape") {
            event.preventDefault();
            setMenu(null);
            editor?.commands.focus();
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
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              key={suggestion}
              autoFocus={index === 0}
              onClick={() => {
                if (editor) replaceWord(editor, menu.from, menu.to, suggestion);
                setMenu(null);
              }}
            >
              {suggestion}
            </button>
          ))
        ) : (
          <div className="menu-item" aria-disabled="true">
            No suggestions
          </div>
        )}
        <div className="menu-separator" role="separator" />
        <button
          type="button"
          role="menuitem"
          className="menu-item"
          autoFocus={menu.suggestions.length === 0}
          onClick={() => {
            updatePersonal(addToPersonalDictionary(personal, menu.word));
            setMenu(null);
          }}
        >
          Add to dictionary
        </button>
        <button
          type="button"
          role="menuitem"
          className="menu-item"
          onClick={() => {
            if (editor) updateSettings(ignoreWord(settings, menu.word));
            setMenu(null);
          }}
        >
          Ignore
        </button>
      </div>
    </div>
  ) : null;

  const countDialog =
    dialog === "count" && snapshot ? (
      <div className="gdocs-modal-overlay page-setup-overlay" onMouseDown={close}>
        <form
          className="gdocs-dialog word-count-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="word-count-title"
          onMouseDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
          }}
          onSubmit={(event) => {
            event.preventDefault();
            close();
          }}
        >
          <div className="dialog-header">
            <h2 id="word-count-title">Word count</h2>
            <button
              type="button"
              className="dialog-close-btn"
              aria-label="Close word count"
              onClick={close}
            >
              <X size={18} />
            </button>
          </div>
          <table className="word-count-table">
            <thead>
              <tr>
                <th scope="col"></th>
                <th scope="col">Selection</th>
                <th scope="col">Document</th>
              </tr>
            </thead>
            <tbody>
              {stat("Words", selectionStats?.words ?? null, snapshot.counts.words)}
              {stat(
                "Characters",
                selectionStats?.characters ?? null,
                snapshot.counts.characters,
              )}
              {stat(
                "Characters (no spaces)",
                selectionStats?.charactersWithoutSpaces ?? null,
                snapshot.counts.charactersWithoutSpaces,
              )}
              {stat("Paragraphs", selectionParagraphs, snapshot.counts.paragraphs)}
              {stat("Pages", selectedPages, pageCount)}
            </tbody>
          </table>
          <div className="word-count-options">
            <label>
              <input
                type="checkbox"
                checked={settings.countFootnotes}
                onChange={(event) =>
                  updateSettings({ ...settings, countFootnotes: event.target.checked })
                }
              />
              Count footnotes
            </label>
            <p className="word-count-hint">
              {snapshot.counts.hasFootnotes
                ? "Footnotes stay out of the count until you tick this."
                : "This document has no footnotes. The choice is saved for when it does."}
            </p>
            <label className="word-count-stop">
              Stop counting at heading
              <select
                aria-label="Stop counting at heading"
                autoFocus
                value={settings.stopAtHeading ?? ""}
                onChange={(event) =>
                  updateSettings({
                    ...settings,
                    stopAtHeading: event.target.value || null,
                  })
                }
              >
                <option value="">Don't stop</option>
                {headings.map((heading) => (
                  <option key={heading} value={heading}>
                    {heading}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={visible}
                onChange={(event) => {
                  setWordCountVisible(event.target.checked);
                  setVisible(event.target.checked);
                }}
              />
              Show word count while typing
            </label>
            <p className="word-count-hint">
              Headers and footers are never counted. Exclusions are saved in the
              file. Showing or hiding the status count stays on this device.
            </p>
          </div>
          <div className="dialog-footer">
            <button type="submit" className="dialog-primary-btn">
              Done
            </button>
          </div>
        </form>
      </div>
    ) : null;

  const spellingDialog =
    dialog === "spelling" && session ? (
      <div className="gdocs-modal-overlay spelling-layer">
        <form
          className="gdocs-dialog spelling-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="spelling-title"
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
          }}
          onSubmit={(event) => {
            event.preventDefault();
            changeIssue();
          }}
        >
          <div className="dialog-header">
            <h2 id="spelling-title">Spelling</h2>
            <button
              type="button"
              className="dialog-close-btn"
              aria-label="Close spelling"
              onClick={close}
            >
              <X size={18} />
            </button>
          </div>
          {issue ? (
            <>
              <p className="spelling-progress">
                {session.step} of {session.total} · {issue.word} → {choice || "…"}
              </p>
              <label className="word-count-stop">
                Correction
                <input
                  aria-label="Correction"
                  autoFocus
                  value={choice}
                  onChange={(event) => setChoice(event.target.value)}
                />
              </label>
              {suggestions.length ? (
                <div className="spelling-suggestions" role="listbox" aria-label="Suggestions">
                  {suggestions.map((suggestion) => (
                    <button
                      type="button"
                      key={suggestion}
                      className={suggestion === choice ? "active" : ""}
                      aria-selected={suggestion === choice}
                      onClick={() => setChoice(suggestion)}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="word-count-hint">No suggestion. Type a correction, or add the word to your dictionary.</p>
              )}
              <p className="word-count-hint">Enter changes the word. Tab to Ignore or Add to dictionary.</p>
              <div className="spelling-actions">
                <button type="submit" className="dialog-primary-btn" disabled={!choice.trim()}>
                  Change
                </button>
                <button type="button" className="dialog-text-btn" onClick={ignoreIssue}>
                  Ignore
                </button>
                <button type="button" className="dialog-text-btn" onClick={addIssue}>
                  Add to dictionary
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="spelling-progress">
                {session.total ? "Spelling check finished" : "No spelling issues"}
              </p>
              <p className="word-count-hint">
                {session.total
                  ? "Nothing left to change. Remove a word from the personal dictionary if you want it underlined again."
                  : "Every word is in the dictionary, ignored, or a name you added."}
              </p>
              <div className="dialog-footer">
                <button type="button" className="dialog-primary-btn" onClick={close} autoFocus>
                  Done
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    ) : null;

  const dictionaryDialog =
    dialog === "dictionary" ? (
      <div className="gdocs-modal-overlay page-setup-overlay" onMouseDown={close}>
        <div
          className="gdocs-dialog dictionary-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dictionary-title"
          onMouseDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
          }}
        >
          <div className="dialog-header">
            <h2 id="dictionary-title">Personal dictionary</h2>
            <button
              type="button"
              className="dialog-close-btn"
              aria-label="Close personal dictionary"
              onClick={close}
            >
              <X size={18} />
            </button>
          </div>
          <section className="dictionary-section">
            <h3>Added words</h3>
            {personal.added.length ? (
              <ul>
                {personal.added.map((word) => (
                  <li key={word}>
                    <span>{word}</span>
                    <button
                      type="button"
                      onClick={() => updatePersonal(removePersonalWord(personal, word, "added"))}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="word-count-hint">
                No added words yet. Right-click a name and choose Add to dictionary.
              </p>
            )}
          </section>
          <section className="dictionary-section">
            <h3>Ignored in this document</h3>
            {settings.ignored.length ? (
              <ul>
                {settings.ignored.map((word) => (
                  <li key={word}>
                    <span>{word}</span>
                    <button
                      type="button"
                      onClick={() => editor && updateSettings(unignoreWord(settings, word))}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="word-count-hint">
                No ignored words. Removing one here underlines it again.
              </p>
            )}
          </section>
          <section className="dictionary-section">
            <h3>Always flag as misspelled</h3>
            <p className="word-count-hint">
              Use this when a rare real word, such as “wer”, should stay wrong.
            </p>
            <form
              className="dictionary-flag"
              onSubmit={(event) => {
                event.preventDefault();
                if (!flagDraft.trim()) return;
                updatePersonal(flagWord(personal, flagDraft));
                setFlagDraft("");
              }}
            >
              <input
                aria-label="Word to flag"
                value={flagDraft}
                onChange={(event) => setFlagDraft(event.target.value)}
                placeholder="wer"
              />
              <button type="submit" className="dialog-text-btn">
                Flag word
              </button>
            </form>
            {personal.flagged.length ? (
              <ul>
                {personal.flagged.map((word) => (
                  <li key={word}>
                    <span>{word}</span>
                    <button
                      type="button"
                      onClick={() =>
                        updatePersonal(removePersonalWord(personal, word, "flagged"))
                      }
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
          <div className="dialog-footer">
            <button type="button" className="dialog-primary-btn" onClick={close}>
              Done
            </button>
          </div>
        </div>
      </div>
    ) : null;

  ui = (
    <>
      {menuUi}
      {countDialog}
      {spellingDialog}
      {dictionaryDialog}
    </>
  );

  return { label, openWordCount, openSpelling, openDictionary, ui };
}
