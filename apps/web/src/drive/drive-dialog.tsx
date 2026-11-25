import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/** A small in-app dialog over everything else, including other dialogs. */
export function DriveDialog({
  title,
  submitLabel,
  canSubmit = true,
  onSubmit,
  onClose,
  children,
}: {
  title: string;
  submitLabel: string;
  canSubmit?: boolean;
  onSubmit: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return createPortal(
    <div
      className="modal-overlay"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onClose();
      }}
    >
      <form
        className="gdocs-dialog node-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) onSubmit();
        }}
      >
        <div className="dialog-header">
          <h2>{title}</h2>
          <button
            type="button"
            className="dialog-close-btn"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        <div className="dialog-footer">
          <button type="button" className="dialog-text-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="dialog-primary-btn"
            disabled={!canSubmit}
            autoFocus
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

/** Modal popover shown while a SuiteDrive file is being downloaded and opened. */
export function OpeningDialog({
  name,
  onCancel,
}: {
  name: string;
  onCancel: () => void;
}) {
  return createPortal(
    <div
      className="modal-overlay"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onCancel();
      }}
    >
      <div
        className="gdocs-dialog node-dialog drive-opening-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Opening ${name}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-body drive-opening">
          <label>
            Opening {name}…
            <progress />
          </label>
        </div>
        <div className="dialog-footer">
          <button
            type="button"
            className="dialog-text-btn"
            onClick={onCancel}
            autoFocus
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export interface BulkProgressState {
  label: string;
  completed: number;
  total: number;
  currentName?: string;
}

/** Modal popover with a determinate progress bar shown during multi-file SuiteDrive operations. */
export function BulkProgressDialog({
  label,
  completed,
  total,
  currentName,
  onCancel,
}: BulkProgressState & {
  onCancel?: () => void;
}) {
  return createPortal(
    <div
      className="modal-overlay"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" && onCancel) onCancel();
      }}
    >
      <div
        className="gdocs-dialog node-dialog drive-opening-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-body drive-opening">
          <label>
            <span>{label}…</span>
            <progress value={completed} max={total} aria-label={label} />
          </label>
          <p className="drive-progress-detail" aria-live="polite">
            {completed} of {total}
            {currentName ? ` — ${currentName}` : ""}
          </p>
        </div>
        {onCancel ? (
          <div className="dialog-footer">
            <button
              type="button"
              className="dialog-text-btn"
              onClick={onCancel}
              autoFocus
            >
              Cancel
            </button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
