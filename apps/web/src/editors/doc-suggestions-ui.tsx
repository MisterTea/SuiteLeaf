import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import type { Editor } from "@tiptap/react";
import { Check, X } from "lucide-react";
import {
  acceptSuggestions,
  listSuggestions,
  rejectSuggestions,
  type SuggestionInfo,
} from "@suiteleaf/core/suggestions";
import type { JsonNode } from "@suiteleaf/core";
import { liveSuggestion, replaceDocument, type SuggestionMode } from "./doc-suggestions";

const authorStorage = "suiteleaf-author";

type PlainExport = "accepted" | "original";
type Preview = "accepted" | "original" | null;

type SuggestionContextValue = {
  mode: SuggestionMode;
  setMode: (mode: SuggestionMode) => void;
  author: string;
  setAuthor: (author: string) => void;
  suggestions: SuggestionInfo[];
  accept: (ids: string[] | "all") => void;
  reject: (ids: string[] | "all") => void;
  preview: Preview;
  setPreview: (preview: Preview) => void;
  reviewOpen: boolean;
  setReviewOpen: (open: boolean) => void;
  askPlainExport: () => Promise<PlainExport | null>;
};

const SuggestionContext = createContext<SuggestionContextValue | null>(null);
function useSuggestions() {
  const value = useContext(SuggestionContext);
  if (!value) throw new Error("Suggestions are only available in the document editor.");
  return value;
}

export function suggestionLabel(suggestion: SuggestionInfo): string {
  const quoted = suggestion.text.replace(/\s+/g, " ").trim();
  const clip = quoted.length > 48 ? `${quoted.slice(0, 45)}…` : quoted;
  if (suggestion.kind === "insert") return `Add “${clip}”`;
  if (suggestion.kind === "delete") return `Delete “${clip}”`;
  if (suggestion.kind === "heading") {
    const level = suggestion.after === "0" ? "Normal text" : `Heading ${suggestion.after}`;
    return `Format: ${level}`;
  }
  return `Format: ${suggestion.property ?? "formatting"}`;
}

export function suggestionWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return time;
  return `${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

export function SuggestionProvider({
  editor,
  children,
}: {
  editor: Editor;
  children: ReactNode;
}) {
  const [mode, setModeState] = useState<SuggestionMode>(
    editor.state.doc.attrs.editingMode === "suggesting" ? "suggesting" : "editing",
  );
  const [author, setAuthorState] = useState(
    () => localStorage.getItem(authorStorage) ?? "",
  );
  const [suggestions, setSuggestions] = useState(() =>
    listSuggestions(editor.getJSON() as JsonNode),
  );
  const authorRef = useRef(author);
  const modeRef = useRef(mode);
  authorRef.current = author;
  modeRef.current = mode;
  const [preview, setPreview] = useState<Preview>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [exportChoice, setExportChoice] = useState<{
    resolve: (choice: PlainExport | null) => void;
  } | null>(null);
  const exportChoiceRef = useRef(exportChoice);
  exportChoiceRef.current = exportChoice;

  useEffect(() => {
    const refresh = () => setSuggestions(listSuggestions(editor.getJSON() as JsonNode));
    editor.on("update", refresh);
    return () => {
      editor.off("update", refresh);
    };
  }, [editor]);

  useEffect(() => {
    const stored = editor.state.doc.attrs.editingMode === "suggesting" ? "suggesting" : "editing";
    modeRef.current = stored;
    setModeState(stored);
    editor.commands.setSuggestionState({ mode: stored, author: authorRef.current });
  }, [editor]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.altKey &&
        event.shiftKey &&
        event.key.toLowerCase() === "x"
      ) {
        event.preventDefault();
        const next = modeRef.current === "suggesting" ? "editing" : "suggesting";
        modeRef.current = next;
        liveSuggestion.mode = next;
        liveSuggestion.author = authorRef.current;
        setModeState(next);
        editor.commands.setSuggestionState({ mode: next, author: authorRef.current });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor]);

  useEffect(() => {
    const root = editor.view.dom.closest(".docs-editor");
    root?.classList.toggle("suggestions-preview-accepted", preview === "accepted");
    root?.classList.toggle("suggestions-preview-original", preview === "original");
    return () => {
      root?.classList.remove("suggestions-preview-accepted", "suggestions-preview-original");
    };
  }, [editor, preview]);

  const apply = (ids: string[] | "all", op: "accept" | "reject") => {
    setPreview(null);
    const json = editor.getJSON() as JsonNode;
    const next =
      op === "accept" ? acceptSuggestions(json, ids) : rejectSuggestions(json, ids);
    editor.view.dispatch(replaceDocument(editor.state, next));
    editor.commands.focus();
  };

  const value: SuggestionContextValue = {
    mode,
    setMode: (next) => {
      modeRef.current = next;
      liveSuggestion.mode = next;
      liveSuggestion.author = authorRef.current;
      setModeState(next);
      editor.commands.setSuggestionState({ mode: next, author: authorRef.current });
    },
    author,
    setAuthor: (next) => {
      authorRef.current = next;
      liveSuggestion.author = next;
      liveSuggestion.mode = modeRef.current;
      setAuthorState(next);
      localStorage.setItem(authorStorage, next);
      editor.commands.setSuggestionState({ mode: modeRef.current, author: next });
    },
    suggestions,
    accept: (ids) => apply(ids, "accept"),
    reject: (ids) => apply(ids, "reject"),
    preview,
    setPreview,
    reviewOpen,
    setReviewOpen,
    askPlainExport: () =>
      new Promise((resolve) => {
        exportChoiceRef.current?.resolve(null);
        setExportChoice({ resolve });
      }),
  };

  return (
    <SuggestionContext.Provider value={value}>
      {children}
      {preview ? (
        <div className="suggestion-preview-banner" role="status">
          {preview === "accepted"
            ? "Preview: suggestions accepted"
            : "Preview: original text"}
        </div>
      ) : null}
      {reviewOpen ? (
        <div className="gdocs-modal-overlay" onClick={() => setReviewOpen(false)}>
          <div
            className="gdocs-dialog suggestion-review"
            role="dialog"
            aria-label="Review suggestions"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-header">
              <h2>Review suggestions</h2>
              <button
                type="button"
                className="dialog-close-btn"
                aria-label="Close review"
                onClick={() => setReviewOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="dialog-body">
              <p className="suggestion-count">
                {suggestions.length} suggestion{suggestions.length === 1 ? "" : "s"}
              </p>
              <SuggestionActions />
              <ul className="suggestion-review-list">
                {suggestions.map((suggestion) => (
                  <li key={suggestion.id}>{suggestionLabel(suggestion)}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}
      {exportChoice ? (
        <div
          className="gdocs-modal-overlay"
          onClick={() => {
            exportChoice.resolve(null);
            setExportChoice(null);
          }}
        >
          <div
            className="gdocs-dialog suggestion-export"
            role="dialog"
            aria-label="Pending suggestions"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-header">
              <h2>Pending suggestions</h2>
            </div>
            <div className="dialog-body">
              <p>
                This document still has {suggestions.length} suggestion
                {suggestions.length === 1 ? "" : "s"}. Export the text with them
                accepted, or export the original text from before those suggestions.
              </p>
            </div>
            <div className="dialog-footer">
              <button
                type="button"
                className="dialog-text-btn"
                onClick={() => {
                  exportChoice.resolve(null);
                  setExportChoice(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="dialog-text-btn"
                onClick={() => {
                  exportChoice.resolve("original");
                  setExportChoice(null);
                }}
              >
                Original text
              </button>
              <button
                type="button"
                className="dialog-primary-btn"
                onClick={() => {
                  exportChoice.resolve("accepted");
                  setExportChoice(null);
                }}
              >
                Suggestions accepted
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </SuggestionContext.Provider>
  );
}

function SuggestionActions() {
  const { suggestions, accept, reject, setPreview } = useSuggestions();
  if (!suggestions.length) return null;
  return (
    <div className="suggestion-actions">
      <button
        type="button"
        className="dialog-text-btn"
        onMouseEnter={() => setPreview("original")}
        onMouseLeave={() => setPreview(null)}
        onFocus={() => setPreview("original")}
        onBlur={() => setPreview(null)}
        onClick={() => reject("all")}
      >
        Reject all
      </button>
      <button
        type="button"
        className="dialog-primary-btn"
        onMouseEnter={() => setPreview("accepted")}
        onMouseLeave={() => setPreview(null)}
        onFocus={() => setPreview("accepted")}
        onBlur={() => setPreview(null)}
        onClick={() => accept("all")}
      >
        Accept all
      </button>
    </div>
  );
}

export function SuggestionModeSwitch() {
  const { mode, setMode, author, setAuthor } = useSuggestions();
  return (
    <div className={`mode-switch ${mode}`} role="group" aria-label="Editing mode">
      <button
        type="button"
        aria-pressed={mode === "editing"}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setMode("editing")}
      >
        Editing
      </button>
      <button
        type="button"
        aria-pressed={mode === "suggesting"}
        title="Suggesting (Ctrl+Alt+Shift+X)"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setMode("suggesting")}
      >
        Suggesting
      </button>
      <label className="mode-author">
        as
        <input
          aria-label="Your name"
          value={author}
          placeholder="Your name"
          maxLength={80}
          onChange={(event) => setAuthor(event.target.value)}
        />
      </label>
    </div>
  );
}

export function SuggestionFlag() {
  const { mode } = useSuggestions();
  if (mode !== "suggesting") return null;
  return (
    <div className="suggesting-flag" role="status">
      Suggesting
    </div>
  );
}

export function SuggestionRail() {
  const { suggestions, accept, reject } = useSuggestions();
  if (!suggestions.length) return null;
  return (
    <aside className="suggestion-rail" aria-label="Suggestions">
      <div className="suggestion-rail-head">
        <span>
          {suggestions.length} suggestion{suggestions.length === 1 ? "" : "s"}
        </span>
        <SuggestionActions />
      </div>
      {suggestions.map((suggestion) => {
        const label = suggestionLabel(suggestion);
        return (
          <article
            key={suggestion.id}
            className={`suggestion-card suggestion-card-${suggestion.kind}`}
            data-suggestion-card={suggestion.id}
          >
            <header>
              {suggestion.author || "Someone"}
              {suggestion.time ? ` · ${suggestionWhen(suggestion.time)}` : ""}
            </header>
            <p>{label}</p>
            <div className="suggestion-card-actions">
              <button
                type="button"
                aria-label={`Accept ${label}`}
                onClick={() => accept([suggestion.id])}
              >
                <Check size={15} />
              </button>
              <button
                type="button"
                aria-label={`Reject ${label}`}
                onClick={() => reject([suggestion.id])}
              >
                <X size={15} />
              </button>
            </div>
          </article>
        );
      })}
    </aside>
  );
}

export function SuggestionBridge({
  api,
}: {
  api: MutableRefObject<{
    askPlainExport: () => Promise<"accepted" | "original" | null>;
    openReview: () => void;
  } | null>;
}) {
  const value = useSuggestions();
  api.current = {
    askPlainExport: value.askPlainExport,
    openReview: () => value.setReviewOpen(true),
  };
  return null;
}

