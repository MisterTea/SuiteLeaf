import { X } from "lucide-react";
import { suggestionsFor, type SpellHit } from "./grid-spelling";

export function SpellingPanel({
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
