import { X } from "lucide-react";
import type { CopyPreview } from "./doc-change-all";

export function ChangeAllDialog({
  word,
  replacement,
  copies,
  onConfirm,
  onCancel,
}: {
  word: string;
  replacement: string;
  copies: readonly CopyPreview[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const count = copies.length;
  const noun = count === 1 ? "copy" : "copies";
  return (
    <div className="gdocs-modal-overlay spelling-layer">
      <form
        className="gdocs-dialog spelling-panel change-all-panel"
        role="dialog"
        aria-modal="false"
        aria-labelledby="change-all-title"
        aria-describedby="change-all-summary"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (count) onConfirm();
        }}
      >
        <div className="dialog-header">
          <h2 id="change-all-title">Change every copy?</h2>
          <button type="button" className="dialog-close-btn" aria-label="Cancel change all" onClick={onCancel}>
            <X size={18} />
          </button>
        </div>
        <p className="spelling-progress" id="change-all-summary" data-change-count={count}>
          {count} {noun} of “{word}” will become “{replacement}”.
        </p>
        <p className="word-count-hint">
          Nothing changes until you confirm. A different typo, and any copy you ignored, stays as it is.
        </p>
        <ul className="change-all-list">
          {copies.map((copy) => (
            <li key={`${copy.from}:${copy.to}`}>
              <p className="spelling-quote">
                {copy.before}
                <mark>{copy.word}</mark>
                {copy.after}
              </p>
              <span className="change-all-next">{copy.replacement}</span>
            </li>
          ))}
        </ul>
        <div className="dialog-footer">
          <button type="button" className="dialog-text-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="dialog-primary-btn" disabled={!count} autoFocus>
            Change {count} {noun}
          </button>
        </div>
      </form>
    </div>
  );
}
