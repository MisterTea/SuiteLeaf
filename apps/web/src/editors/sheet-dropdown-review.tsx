import { X } from "lucide-react";
import { mismatchNotice, trimmedText, type Mismatch } from "./sheet-dropdowns";

export function DropdownReview({
  mismatches,
  reviewAt,
  setReviewAt,
  showMismatch,
  accept,
  skip,
}: {
  mismatches: Mismatch[];
  reviewAt: number | null;
  setReviewAt: (index: number | null) => void;
  showMismatch: (index: number) => void;
  accept: () => void;
  skip: () => void;
}) {
  const reviewing = reviewAt != null ? mismatches[reviewAt] : undefined;
  return (
    <>
    {mismatches.length && reviewAt == null ? (
      <div className="dropdown-notice" role="status">
        <span>{mismatchNotice(mismatches.length)}</span>
        <button type="button" onClick={() => showMismatch(0)}>
          Review
        </button>
      </div>
    ) : null}
    {reviewing ? (
      <aside className="dropdown-review" role="dialog" aria-label="Review values">
        <header>
          <h2>Review</h2>
          <button type="button" aria-label="Close review" onClick={() => setReviewAt(null)}>
            <X size={18} />
          </button>
        </header>
        <p className="dropdown-lead">
          {(reviewAt ?? 0) + 1} of {mismatches.length}
        </p>
        <p className="dropdown-bad">{trimmedText(reviewing.value) || cellText(reviewing.value)}</p>
        <p>
          Use <strong>{reviewing.suggestion}</strong>?
        </p>
        <div className="dropdown-review-actions">
          <button type="button" className="primary" onClick={accept} disabled={!reviewing.suggestion}>
            Accept
          </button>
          <button type="button" onClick={skip}>
            Skip
          </button>
        </div>
      </aside>
    ) : null}
    </>
  );
}

function cellText(value: unknown): string {
  return value == null ? "" : String(value);
}
