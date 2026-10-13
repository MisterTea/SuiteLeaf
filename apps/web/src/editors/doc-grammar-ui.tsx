import { useEditorState, type Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import type { JsonNode } from "@suiteleaf/core";
import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import {
  grammarHighlight,
  grammarHit,
  grammarKey,
  grammarRanges,
  withIgnoredGrammar,
  withoutIgnoredGrammar,
  type GrammarIssue,
  type GrammarMenuHit,
} from "./doc-grammar";
import { readProofing, type ProofingSettings } from "./doc-word-count";
import type { ProofingContext } from "./doc-proofing";

function writeProofing(editor: Editor, settings: ProofingSettings) {
  editor.view.dispatch(
    editor.state.tr.setDocAttribute("proofing", settings).setMeta("addToHistory", false),
  );
}

function refreshGrammar(editor: Editor, from = -1, to = -1) {
  if (editor.isDestroyed) return;
  editor.view.dispatch(
    editor.state.tr
      .setMeta(grammarKey, grammarHighlight(from, to))
      .setMeta("addToHistory", false),
  );
}

function replaceWord(editor: Editor, from: number, to: number, text: string) {
  const cleaned = text.trim();
  if (!cleaned) return to;
  const marks =
    editor.state.doc.resolve(from).marksAcross(editor.state.doc.resolve(to)) ??
    editor.state.doc.resolve(from).marks();
  let tr = editor.state.tr.replaceWith(from, to, editor.state.schema.text(cleaned, marks));
  const cursor = from + cleaned.length;
  tr = tr.setSelection(TextSelection.create(tr.doc, cursor)).scrollIntoView();
  editor.view.dispatch(tr);
  return cursor;
}

export function useDocGrammar(
  editor: Editor | null,
  onContext: MutableRefObject<ProofingContext>,
) {
  const [dialog, setDialog] = useState<"grammar" | "ignored" | null>(null);
  const [menu, setMenu] = useState<GrammarMenuHit | null>(null);
  const [session, setSession] = useState<{ total: number; step: number; after: number } | null>(
    null,
  );
  const [draft, setDraft] = useState<{ id: string; value: string } | null>(null);
  const settings = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      current ? readProofing(current.getJSON() as JsonNode) : readProofing(null),
  }) ?? readProofing(null);
  const ranges: GrammarIssue[] =
    editor && !editor.isDestroyed ? grammarRanges(editor.state.doc, settings.ignoredGrammar) : [];
  const issue =
    dialog === "grammar" && session
      ? (ranges.find((range) => range.from >= session.after) ?? null)
      : null;
  const issueId = issue ? `${issue.from}:${issue.to}:${issue.key}` : "";
  const suggestion = draft?.id === issueId ? draft.value : (issue?.suggestion ?? "");
  const issueRef = useRef(issue);
  issueRef.current = issue;

  onContext.current = (view, event) => {
    const hit = grammarHit(view, event);
    if (!hit) return false;
    event.preventDefault();
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, hit.from, hit.to)),
    );
    setMenu(hit);
    setDialog(null);
    return true;
  };

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const current = issueRef.current;
    if (dialog !== "grammar" || !current) {
      if (dialog !== "grammar") refreshGrammar(editor);
      return;
    }
    editor.view.dispatch(
      editor.state.tr
        .setSelection(TextSelection.create(editor.state.doc, current.from, current.to))
        .scrollIntoView()
        .setMeta(grammarKey, grammarHighlight(current.from, current.to))
        .setMeta("addToHistory", false),
    );
  }, [editor, dialog, issueId]);

  const close = () => setDialog(null);
  const advance = (after: number) =>
    setSession((current) => (current ? { ...current, step: current.step + 1, after } : current));
  const changeIssue = () => {
    if (!editor || !issue || !suggestion.trim()) return;
    advance(replaceWord(editor, issue.from, issue.to, suggestion));
  };
  const ignoreIssue = (target: GrammarIssue) => {
    if (!editor) return;
    writeProofing(editor, withIgnoredGrammar(readProofing(editor.getJSON() as JsonNode), target));
    if (issue && issue.key === target.key) advance(target.to);
  };

  const openGrammar = useCallback(() => {
    setMenu(null);
    const ignored =
      editor && !editor.isDestroyed
        ? readProofing(editor.getJSON() as JsonNode).ignoredGrammar
        : [];
    const found =
      editor && !editor.isDestroyed ? grammarRanges(editor.state.doc, ignored) : [];
    setSession({ total: found.length, step: 1, after: 0 });
    setDraft(null);
    setDialog("grammar");
  }, [editor]);
  const openIgnoredGrammar = useCallback(() => {
    setMenu(null);
    setDialog("ignored");
  }, []);

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
        aria-label={`Grammar for ${menu.text}`}
        style={{
          left: Math.min(Math.max(12, menu.x - 12), window.innerWidth - 220),
          top: Math.min(menu.y + 22, window.innerHeight - 140),
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
        <button
          type="button"
          role="menuitem"
          className="menu-item grammar-suggestion"
          autoFocus
          onClick={() => {
            if (editor) replaceWord(editor, menu.from, menu.to, menu.suggestion);
            setMenu(null);
          }}
        >
          {menu.suggestion}
        </button>
        <div className="menu-separator" role="separator" />
        <button
          type="button"
          role="menuitem"
          className="menu-item"
          onClick={() => {
            ignoreIssue(menu);
            setMenu(null);
          }}
        >
          Ignore
        </button>
      </div>
    </div>
  ) : null;

  const grammarDialog =
    dialog === "grammar" && session ? (
      <div className="gdocs-modal-overlay spelling-layer">
        <form
          className="gdocs-dialog spelling-panel grammar-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="grammar-title"
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
          }}
          onSubmit={(event) => {
            event.preventDefault();
            changeIssue();
          }}
        >
          <div className="dialog-header">
            <h2 id="grammar-title">Grammar</h2>
            <button
              type="button"
              className="dialog-close-btn"
              aria-label="Close grammar"
              onClick={close}
            >
              <X size={18} />
            </button>
          </div>
          {issue ? (
            <>
              <p className="spelling-progress">
                {session.step} of {session.total} · {issue.text} → {suggestion || issue.suggestion}
              </p>
              <label className="word-count-stop">
                Suggestion
                <input
                  aria-label="Suggestion"
                  autoFocus
                  value={suggestion}
                  onChange={(event) => setDraft({ id: issueId, value: event.target.value })}
                />
              </label>
              <p className="word-count-hint">
                Enter changes this word. Tab reaches Ignore. Spelling stays in Tools › Spelling,
                and this check stays on this computer.
              </p>
              <div className="spelling-actions">
                <button type="submit" className="dialog-primary-btn" disabled={!suggestion.trim()}>
                  Change
                </button>
                <button
                  type="button"
                  className="dialog-text-btn"
                  onClick={() => ignoreIssue(issue)}
                >
                  Ignore
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="spelling-progress">
                {session.total ? "Grammar check finished" : "No grammar issues"}
              </p>
              <p className="word-count-hint">
                {session.total
                  ? "Nothing left to change. Spelling issues are still under Tools › Spelling."
                  : "No agreement or its/it's issues. Spelling is a separate check."}
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

  const ignoredDialog =
    dialog === "ignored" ? (
      <div className="gdocs-modal-overlay spelling-layer">
        <div
          className="gdocs-dialog spelling-panel grammar-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="ignored-grammar-title"
          onKeyDown={(event) => {
            if (event.key === "Escape") close();
          }}
        >
          <div className="dialog-header">
            <h2 id="ignored-grammar-title">Ignored grammar</h2>
            <button
              type="button"
              className="dialog-close-btn"
              aria-label="Close ignored grammar"
              onClick={close}
            >
              <X size={18} />
            </button>
          </div>
          <p className="word-count-hint">
            Remove a row to bring its blue underline back. This list is saved in the document,
            separate from your spelling dictionary.
          </p>
          {settings.ignoredGrammar.length ? (
            <div className="dictionary-section">
              <ul>
                {settings.ignoredGrammar.map((entry, index) => (
                  <li key={entry}>
                    <span>{entry}</span>
                    <button
                      type="button"
                      autoFocus={index === 0}
                      onClick={() => {
                        if (!editor) return;
                        writeProofing(
                          editor,
                          withoutIgnoredGrammar(readProofing(editor.getJSON() as JsonNode), entry),
                        );
                      }}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="word-count-hint">No ignored grammar. A blue underline comes back when you remove one.</p>
          )}
          <div className="dialog-footer">
            <button
              type="button"
              className="dialog-primary-btn"
              onClick={close}
              autoFocus={settings.ignoredGrammar.length === 0}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    ) : null;

  const ui: ReactNode = (
    <>
      {menuUi}
      {grammarDialog}
      {ignoredDialog}
    </>
  );

  return { openGrammar, openIgnoredGrammar, ui };
}
