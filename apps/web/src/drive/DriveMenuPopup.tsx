import type { RefObject } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, FolderInput, Pencil, Trash2 } from "lucide-react";

export interface DriveMenuPopupProps {
  item: { id: string; name: string; kind?: string; role?: string | null };
  mode: "open" | "save";
  busy: boolean;
  popupRef: RefObject<HTMLDivElement | null>;
  onOpenInNewTab?: () => void;
  onMove?: () => void;
  onRename?: () => void;
  onMoveToTrash?: () => void;
  onClose: () => void;
}

export function DriveMenuPopup({
  item,
  mode,
  busy,
  popupRef,
  onOpenInNewTab,
  onMove,
  onRename,
  onMoveToTrash,
  onClose,
}: DriveMenuPopupProps) {
  return createPortal(
    <div
      ref={popupRef}
      className="drive-menu-popup"
      role="menu"
      aria-label={`Actions for ${item.name}`}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        onClose();
      }}
    >
      {item.kind === "file" && mode === "open" && onOpenInNewTab ? (
        <button
          type="button"
          className="drive-menu-item"
          title="Open in new tab"
          aria-label={`Open ${item.name} in a new tab`}
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
            onOpenInNewTab();
          }}
        >
          <ExternalLink size={15} />
          <span>Open in new tab</span>
        </button>
      ) : null}
      {onMove && item.kind === "file" ? (
        <button
          type="button"
          className="drive-menu-item"
          title="Move"
          aria-label={`Move ${item.name}`}
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
            onMove();
          }}
        >
          <FolderInput size={15} />
          <span>Move</span>
        </button>
      ) : null}
      {onRename ? (
        <button
          type="button"
          className="drive-menu-item"
          title="Rename"
          aria-label={`Rename ${item.name}`}
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
            onRename();
          }}
        >
          <Pencil size={15} />
          <span>Rename</span>
        </button>
      ) : null}
      {onMoveToTrash ? (
        <button
          type="button"
          className="drive-menu-item drive-menu-danger"
          title="Move to trash"
          aria-label={`Move ${item.name} to trash`}
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
            onMoveToTrash();
          }}
        >
          <Trash2 size={15} />
          <span>Move to trash</span>
        </button>
      ) : null}
    </div>,
    document.body,
  );
}
