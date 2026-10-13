import { X } from "lucide-react";
import type { FileRecord } from "@suiteleaf/core";

/** A note the editor puts in its save status when it next opens a file, by file ID. */
export const openNotices = new Map<string, string>();

function edited(iso: string, seconds = false) {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? "at an unknown time"
    : at.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: seconds ? "2-digit" : undefined,
      });
}

/** Opening a SuiteLeaf file whose copy in the library has different content. */
export function SameFileDialog({
  name,
  existing,
  incoming,
  where,
  onReplace,
  onKeepBoth,
  onClose,
}: {
  /** The chosen file's name, such as "Trip.sldoc". */
  name: string;
  existing: FileRecord;
  incoming: FileRecord;
  /** "in this browser" or "on this computer". */
  where: string;
  onReplace: () => void;
  onKeepBoth: () => void;
  onClose: () => void;
}) {
  const newerHere = existing.file.updatedAt > incoming.file.updatedAt;
  const seconds =
    edited(existing.file.updatedAt) === edited(incoming.file.updatedAt);
  const replace = (
    <button
      type="button"
      className={newerHere ? "dialog-text-btn" : "dialog-primary-btn"}
      autoFocus={!newerHere}
      onClick={onReplace}
    >
      Replace
    </button>
  );
  const keepBoth = (
    <button
      type="button"
      className={newerHere ? "dialog-primary-btn" : "dialog-text-btn"}
      autoFocus={newerHere}
      onClick={onKeepBoth}
    >
      Keep both
    </button>
  );
  return (
    <div className="modal-overlay" onClick={onClose}>
      <section
        className="gdocs-dialog same-file-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="same-file-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <div className="dialog-header">
          <h2 id="same-file-title">
            “{existing.file.title}” is already {where}
          </h2>
          <button
            type="button"
            className="dialog-close-btn"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="dialog-body">
          <p className="dialog-note">
            “{name}” holds a copy of the same file. The one here was last
            edited {edited(existing.file.updatedAt, seconds)}; the file&apos;s
            copy was saved {edited(incoming.file.updatedAt, seconds)}.
          </p>
          <p className="dialog-note">
            Replace the one here with the file, or keep both and open the file
            as “{incoming.file.title.slice(0, 190)} copy”.
          </p>
          {newerHere ? (
            <p className="dialog-note same-file-warning">
              The one here has newer changes. Replacing it discards them.
            </p>
          ) : null}
        </div>
        <div className="dialog-footer">
          <button type="button" className="dialog-text-btn" onClick={onClose}>
            Cancel
          </button>
          {newerHere ? replace : keepBoth}
          {newerHere ? keepBoth : replace}
        </div>
      </section>
    </div>
  );
}
