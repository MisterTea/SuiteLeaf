import { useEffect, useState } from "react";
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
export function NewCards({
  onCreate,
  folder,
}: {
  onCreate: (kind: NewKind) => void;
  /** The SuiteDrive folder new files go in, when it isn't the top level. */
  folder?: string;
}) {
  const where = folder ? <small>In {folder}</small> : null;
  return (
    <div className="new-cards">
      <button className="new-card" onClick={() => onCreate("doc")}>
        <span className="app-icon doc">
          <FileText size={30} />
        </span>
        <span>
          <strong>New document</strong>
          {where ?? <small>A fresh page for your next idea</small>}
        </span>
        <Plus size={22} />
      </button>
      <button className="new-card" onClick={() => onCreate("sheet")}>
        <span className="app-icon sheet">
          <Sheet size={30} />
        </span>
        <span>
          <strong>New spreadsheet</strong>
          {where ?? <small>A little structure for the big picture</small>}
        </span>
        <Plus size={22} />
      </button>
      <button className="new-card" onClick={() => onCreate("slide")}>
        <span className="app-icon slide">
          <Presentation size={30} />
        </span>
        <span>
          <strong>New presentation</strong>
          {where ?? <small>A clean canvas for your next pitch</small>}
        </span>
        <Plus size={22} />
      </button>
      <button className="new-card" onClick={() => onCreate("marp")}>
        <span className="app-icon slide">
          <FileText size={30} />
        </span>
        <span>
          <strong>New MARP deck</strong>
          {where ?? <small>A markdown presentation, in one or two columns</small>}
        </span>
        <Plus size={22} />
      </button>
      <NewDrawingCard onCreate={onCreate} where={where} />
      {formsEnabled ? (
      <button className="new-card" onClick={() => onCreate("form")}>
        <span className="app-icon form">
          <ClipboardList size={30} />
        </span>
        <span>
          <strong>New form</strong>
          {where ?? <small>Questions and answers in one file</small>}
        </span>
        <Plus size={22} />
      </button>
      ) : null}
    </div>
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
