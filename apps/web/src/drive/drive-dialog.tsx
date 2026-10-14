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
