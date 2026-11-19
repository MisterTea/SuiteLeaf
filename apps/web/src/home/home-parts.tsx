import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Leaf,
  FileText,
  Sheet,
  Presentation,
  ClipboardList,
  Plus,
  CircleAlert,
  Trash2,
  FolderOpen,
  Star,
  Clock,
  LogIn,
  Unplug,
  X,
} from "lucide-react";
import { SettingsButton } from "../document-settings";
import { DrawingIcon, NewDrawingCard, type NewKind } from "../drawing-home";
import { formsEnabled } from "../flags";
import { forgetLeftServer, leftServer } from "../mode";
import type { LibraryFilter } from "../library-trash";

export function Logo() {
  return (
    <span className="logo">
      <span className="logo-mark">
        <Leaf size={23} />
      </span>
      SuiteLeaf
    </span>
  );
}
export function NewMenu({
  onCreate,
  folder,
}: {
  onCreate: (kind: NewKind) => void;
  /** The SuiteDrive folder new files go in, when it isn't the top level. */
  folder?: string;
}) {
  const [open, setOpen] = useState(false);
  const where = folder ? <small>In {folder}</small> : null;
  const pick = (kind: NewKind) => {
    setOpen(false);
    onCreate(kind);
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button
        type="button"
        className="new-menu-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Plus size={16} />
        New
      </button>
      {open
        ? createPortal(
            <div
              className="modal-overlay"
              onClick={(event) => {
                if (event.target === event.currentTarget) setOpen(false);
              }}
            >
              <div
                className="gdocs-dialog new-kind-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="new-kind-title"
              >
                <div className="dialog-header">
                  <h2 id="new-kind-title">What do you want to make?</h2>
                  <button
                    type="button"
                    className="dialog-close-btn"
                    aria-label="Close"
                    onClick={() => setOpen(false)}
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="new-kind-list">
                  <button type="button" className="new-card" onClick={() => pick("doc")}>
                    <span className="app-icon doc">
                      <FileText size={22} />
                    </span>
                    <span>
                      <strong>New document</strong>
                      {where ?? <small>A fresh page for your next idea</small>}
                    </span>
                  </button>
                  <button type="button" className="new-card" onClick={() => pick("sheet")}>
                    <span className="app-icon sheet">
                      <Sheet size={22} />
                    </span>
                    <span>
                      <strong>New spreadsheet</strong>
                      {where ?? <small>A little structure for the big picture</small>}
                    </span>
                  </button>
                  <button type="button" className="new-card" onClick={() => pick("slide")}>
                    <span className="app-icon slide">
                      <Presentation size={22} />
                    </span>
                    <span>
                      <strong>New presentation</strong>
                      {where ?? <small>A clean canvas for your next pitch</small>}
                    </span>
                  </button>
                  <button type="button" className="new-card" onClick={() => pick("marp")}>
                    <span className="app-icon slide">
                      <FileText size={22} />
                    </span>
                    <span>
                      <strong>New MARP deck</strong>
                      {where ?? <small>A markdown presentation, in one or two columns</small>}
                    </span>
                  </button>
                  <NewDrawingCard onCreate={pick} where={where} />
                  {formsEnabled ? (
                    <button type="button" className="new-card" onClick={() => pick("form")}>
                      <span className="app-icon form">
                        <ClipboardList size={22} />
                      </span>
                      <span>
                        <strong>New form</strong>
                        {where ?? <small>Questions and answers in one file</small>}
                      </span>
                    </button>
                  ) : null}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
export function ErrorBanner({
  error,
  onDismiss,
}: {
  error: string;
  onDismiss: () => void;
}) {
  return error ? (
    <div className="error" role="alert">
      <CircleAlert size={18} />
      {error}
      <button aria-label="Dismiss error" onClick={onDismiss}>
        ×
      </button>
    </div>
  ) : null;
}
/** One-time confirmation after disconnecting, like a "signed out" page. */
export function LeftServerNotice() {
  const [host, setHost] = useState(leftServer);
  useEffect(forgetLeftServer, []);
  return host ? (
    <div className="notice" role="status">
      <Unplug size={18} />
      <span>
        Disconnected from {host} and signed out. Files in SuiteDrive stay on the
        server; connect again to open them.
      </span>
      <button aria-label="Dismiss" onClick={() => setHost(null)}>
        ×
      </button>
    </div>
  ) : null;
}
export function LocalSidebar({
  filter,
  setFilter,
  setSort,
  demo,
  locked,
  setConnecting,
}: {
  filter: LibraryFilter;
  setFilter: (filter: LibraryFilter) => void;
  setSort: (sort: { by: "name" | "edited"; desc: boolean }) => void;
  demo: boolean;
  locked: boolean;
  setConnecting: (connecting: boolean) => void;
}) {
  return (
    <aside className="sidebar">
      <Logo />
      <div className="sidebar-links">
        <SettingsButton />
        <button
          className={filter === "recent" ? "selected" : ""}
          onClick={() => setFilter("recent")}
        >
          <Clock size={18} />
          Recents
        </button>
        <button
          className={filter === "all" ? "selected" : ""}
          onClick={() => setFilter("all")}
        >
          <FolderOpen size={18} />
          All files
        </button>
        <button
          className={filter === "starred" ? "selected" : ""}
          onClick={() => {
            setFilter("starred");
            setSort({ by: "edited", desc: true });
          }}
        >
          <Star size={18} />
          Starred
        </button>
        <button
          className={filter === "doc" ? "selected" : ""}
          onClick={() => setFilter("doc")}
        >
          <FileText size={18} />
          Documents
        </button>
        <button
          className={filter === "sheet" ? "selected" : ""}
          onClick={() => setFilter("sheet")}
        >
          <Sheet size={18} />
          Spreadsheets
        </button>
        <button
          className={filter === "slide" ? "selected" : ""}
          onClick={() => setFilter("slide")}
        >
          <Presentation size={18} />
          Presentations
        </button>
        <button
          className={filter === "drawing" ? "selected" : ""}
          onClick={() => setFilter("drawing")}
        >
          <DrawingIcon size={18} />
          Drawings
        </button>
        {formsEnabled ? (
        <button
          className={filter === "form" ? "selected" : ""}
          onClick={() => setFilter("form")}
        >
          <ClipboardList size={18} />
          Forms
        </button>
        ) : null}
        <button
          className={filter === "trash" ? "selected" : ""}
          onClick={() => setFilter("trash")}
        >
          <Trash2 size={18} />
          Trash
        </button>
      </div>
      <div className="local-note">
        <span className="local-dot" />
        {demo
          ? "Demo: files are saved in this browser."
          : window.suiteleaf
            ? "Your files, on this computer."
            : "Your workspace, in this browser."}
        <small>
          {demo
            ? "Download a copy to keep your work."
            : window.suiteleaf
              ? "Offline ready. No account needed."
              : "Offline ready. Download a file to back it up or move it."}
        </small>
        {locked ? null : (
          <button
            className="sign-in-link"
            onClick={() => setConnecting(true)}
          >
            <LogIn size={14} />
            Connect to a server
          </button>
        )}
      </div>
    </aside>
  );
}
