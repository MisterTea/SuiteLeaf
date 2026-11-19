import { useLayoutEffect, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  Copy,
  Download,
  ExternalLink,
  FolderInput,
  FolderOpen,
  Pencil,
  Share2,
  Trash2,
} from "lucide-react";

export interface DriveMenuPopupProps {
  item: { id: string; name: string; kind?: string; role?: string | null };
  mode: "open" | "save";
  busy: boolean;
  popupRef: RefObject<HTMLDivElement | null>;
  /** Where a right-click opened the menu. The three-dot menu is positioned by its caller. */
  point?: { x: number; y: number } | null;
  onOpen?: () => void;
  onOpenInNewTab?: () => void;
  onDownload?: () => void;
  onRename?: () => void;
  onMove?: () => void;
  onCopy?: () => void;
  onShare?: () => void;
  onMoveToTrash?: () => void;
  onClose: () => void;
}

export function DriveMenuPopup({
  item,
  mode,
  busy,
  popupRef,
  point,
  onOpen,
  onOpenInNewTab,
  onDownload,
  onRename,
  onMove,
  onCopy,
  onShare,
  onMoveToTrash,
  onClose,
}: DriveMenuPopupProps) {
  const file = item.kind !== "folder";
  useLayoutEffect(() => {
    const popup = popupRef.current;
    if (!popup || !point) return;
    const { width, height } = popup.getBoundingClientRect();
    const gap = 6;
    const top =
      point.y + height <= window.innerHeight - gap
        ? point.y
        : Math.max(gap, point.y - height);
    const left =
      point.x + width <= window.innerWidth - gap
        ? point.x
        : Math.max(gap, point.x - width);
    popup.style.top = `${top}px`;
    popup.style.left = `${left}px`;
    popup.querySelector("button")?.focus({ preventScroll: true });
    const onPointerDown = (event: PointerEvent) => {
      if (!popup.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, point, popupRef]);
  const choose = (action?: () => void) => (event: { stopPropagation(): void }) => {
    event.stopPropagation();
    onClose();
    action?.();
  };
  const entry = (
    label: string,
    detail: string,
    icon: ReactNode,
    action?: () => void,
    danger = false,
  ) =>
    action ? (
      <button
        type="button"
        className={danger ? "drive-menu-item drive-menu-danger" : "drive-menu-item"}
        title={label}
        aria-label={detail}
        disabled={busy}
        onClick={choose(action)}
      >
        {icon}
        <span>{label}</span>
      </button>
    ) : null;
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
      {file && mode === "open" ? entry("Open", `Open ${item.name}`, <FolderOpen size={15} />, onOpen) : null}
      {file && mode === "open"
        ? entry(
            "Open in a new tab",
            `Open ${item.name} in a new tab`,
            <ExternalLink size={15} />,
            onOpenInNewTab,
          )
        : null}
      {file ? entry("Download", `Download ${item.name}`, <Download size={15} />, onDownload) : null}
      {entry("Rename", `Rename ${item.name}`, <Pencil size={15} />, onRename)}
      {file ? entry("Move", `Move ${item.name}`, <FolderInput size={15} />, onMove) : null}
      {file ? entry("Copy", `Copy ${item.name}`, <Copy size={15} />, onCopy) : null}
      {file ? entry("Share", `Share ${item.name}`, <Share2 size={15} />, onShare) : null}
      {entry(
        "Move to trash",
        `Move ${item.name} to trash`,
        <Trash2 size={15} />,
        onMoveToTrash,
        true,
      )}
    </div>,
    document.body,
  );
}
