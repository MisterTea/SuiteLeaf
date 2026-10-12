import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  ChevronRight,
  CloudOff,
  FileText,
  Folder,
  FolderPlus,
  Pencil,
  Presentation,
  Sheet,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { isNativeName, kindFromName } from "@suiteleaf/core";
import { drive, getSession, type DriveItem } from "../node-client";
import { formatModified } from "./status";

type Crumb = { id: string | null; name: string };
type View = "mine" | "shared";
type Place = { view: View; path: Crumb[] };

const PLACE_KEY = "suiteleaf:drive-place";
const rootOf = (view: View): Place => ({
  view,
  path: [{ id: null, name: view === "mine" ? "My Drive" : "Shared with me" }],
});
/** Remembers the home screen's folder for this account, so leaving a file
 * returns to the folder it was opened from. */
const place = {
  owner() {
    const session = getSession();
    return session ? `${session.url}|${session.user.id}` : "";
  },
  load(): Place | null {
    try {
      const saved = JSON.parse(sessionStorage.getItem(PLACE_KEY) ?? "null");
      return saved?.owner === place.owner() && saved.path?.length
        ? { view: saved.view, path: saved.path }
        : null;
    } catch {
      return null;
    }
  },
  save(value: Place) {
    sessionStorage.setItem(
      PLACE_KEY,
      JSON.stringify({ owner: place.owner(), ...value }),
    );
  },
};

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

/** Ask for a folder or file name. Renaming a file selects the name without
 * its extension, so typing replaces just the title. */
export function NameDialog({
  title,
  submitLabel,
  initial,
  keepExtension = false,
  onSubmit,
  onClose,
}: {
  title: string;
  submitLabel: string;
  initial: string;
  keepExtension?: boolean;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const dot = initial.lastIndexOf(".");
    input.current?.focus();
    input.current?.setSelectionRange(
      0,
      keepExtension && dot > 0 ? dot : initial.length,
    );
  }, [initial, keepExtension]);
  const name = value.trim();
  return (
    <DriveDialog
      title={title}
      submitLabel={submitLabel}
      canSubmit={!!name}
      onSubmit={() => onSubmit(name)}
      onClose={onClose}
    >
      <div className="floating-field">
        <label htmlFor="drive-item-name">Name</label>
        <input
          id="drive-item-name"
          ref={input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
    </DriveDialog>
  );
}

function ItemIcon({ item }: { item: DriveItem }) {
  if (item.kind === "folder") return <Folder size={20} />;
  const kind = kindFromName(item.name);
  return (
    <span className={`file-icon ${kind ?? ""}`}>
      {kind === "sheet" ? (
        <Sheet size={20} />
      ) : kind === "slide" ? (
        <Presentation size={20} />
      ) : (
        <FileText size={20} />
      )}
    </span>
  );
}

/** Browse SuiteDrive folders. In `open` mode, choosing a SuiteLeaf file
 * calls `onOpen`; in `save` mode, the user picks a folder and a name. */
export function DriveBrowser({
  mode,
  defaultName = "",
  inline = false,
  onOpen,
  onSave,
  onClose,
  onFolderChange,
  refreshKey,
}: {
  mode: "open" | "save";
  defaultName?: string;
  inline?: boolean;
  onOpen?: (item: DriveItem) => void | Promise<void>;
  onSave?: (folderId: string | null, name: string) => void | Promise<void>;
  onClose?: () => void;
  /** The folder new items should go in; `null` is the top of My Drive. */
  onFolderChange?: (folderId: string | null, name: string) => void;
  /** Changing this re-lists the folder in place, e.g. when replication
   * brings in changes from another server. */
  refreshKey?: string;
}) {
  const [initial] = useState(() => (inline && place.load()) || rootOf("mine"));
  const [view, setView] = useState<View>(initial.view);
  const [path, setPath] = useState<Crumb[]>(initial.path);
  const [items, setItems] = useState<DriveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState(defaultName);
  const [asking, setAsking] = useState<
    | { action: "new-folder" }
    | { action: "rename" | "trash"; item: DriveItem }
    | null
  >(null);
  const restored = useRef(initial.path.length > 1);
  const folder = path[path.length - 1];
  const shown = useRef(""),
    request = useRef(0);

  const refresh = useCallback(async () => {
    const key = `${view}:${folder.id}`;
    const n = ++request.current;
    // Re-listing the folder already on screen keeps it there meanwhile.
    if (shown.current !== key) setLoading(true);
    try {
      const next =
        view === "shared" && folder.id === null
          ? await drive.shared()
          : await drive.list(folder.id);
      if (n !== request.current) return;
      setItems(next);
      shown.current = key;
      setError("");
    } catch (e) {
      if (n === request.current) {
        // A remembered folder may have gone; start from the top instead.
        if (restored.current) setPath(rootOf(view).path);
        else setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (n === request.current) {
        restored.current = false;
        setLoading(false);
      }
    }
  }, [folder.id, view]);
  useEffect(() => void refresh(), [refresh, refreshKey]);
  useEffect(() => {
    onFolderChange?.(folder.id, folder.name);
    if (inline) place.save({ view, path });
  }, [folder.id, folder.name, onFolderChange, inline, view, path]);

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const switchView = (next: View) => {
    setView(next);
    setPath(rootOf(next).path);
  };

  const choose = (item: DriveItem) => {
    if (item.kind === "folder")
      setPath((p) => [...p, { id: item.id, name: item.name }]);
    else if (mode === "open" && isNativeName(item.name))
      void act(async () => onOpen?.(item));
    else if (mode === "save") setName(item.name);
  };

  // The shared root is a list, not a folder; the node enforces folder roles.
  const canWrite = view === "mine" || folder.id !== null;

  const visible = items.filter(
    (i) => i.kind === "folder" || mode === "save" || isNativeName(i.name),
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) void act(async () => onSave?.(folder.id, name.trim()));
  };

  const body = (
    <div className={`drive-browser ${inline ? "inline" : ""}`}>
      <div className="drive-toolbar">
        <div className="drive-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={view === "mine"}
            className={view === "mine" ? "selected" : ""}
            onClick={() => switchView("mine")}
          >
            <Folder size={16} />
            My Drive
          </button>
          <button
            role="tab"
            aria-selected={view === "shared"}
            className={view === "shared" ? "selected" : ""}
            onClick={() => switchView("shared")}
          >
            <Users size={16} />
            Shared with me
          </button>
        </div>
        {canWrite ? (
          <button
            className="drive-new-folder"
            disabled={busy}
            onClick={() => setAsking({ action: "new-folder" })}
          >
            <FolderPlus size={16} />
            New folder
          </button>
        ) : null}
      </div>
      <nav className="drive-crumbs" aria-label="Folder path">
        {path.map((crumb, i) => (
          <span key={crumb.id ?? "root"}>
            {i ? <ChevronRight size={14} /> : null}
            <button
              disabled={i === path.length - 1}
              onClick={() => setPath(path.slice(0, i + 1))}
            >
              {crumb.name}
            </button>
          </span>
        ))}
      </nav>
      {error ? (
        <p className="dialog-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="drive-list" role="list" aria-busy={loading}>
        {loading ? (
          <p className="drive-empty">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="drive-empty">
            {view === "shared" && folder.id === null
              ? "Nothing has been shared with you yet."
              : "This folder is empty."}
          </p>
        ) : (
          visible.map((item) => (
            <div className="drive-row" role="listitem" key={item.id}>
              <button
                className="drive-item"
                aria-label={item.name}
                disabled={busy}
                onClick={() => choose(item)}
                title={
                  item.available
                    ? item.name
                    : `${item.name} (still replicating)`
                }
              >
                <ItemIcon item={item} />
                <span>{item.name}</span>
                {!item.available ? (
                  <small className="drive-copying">
                    <CloudOff size={14} aria-label="Replicating" />
                    Copying…
                  </small>
                ) : null}
                <time
                  dateTime={item.updatedAt}
                  title={new Date(item.updatedAt).toLocaleString()}
                >
                  {formatModified(item.updatedAt)}
                </time>
              </button>
              {item.role === "owner" || item.role === "editor" ? (
                <span className="drive-row-actions">
                  <button
                    title="Rename"
                    aria-label={`Rename ${item.name}`}
                    disabled={busy}
                    onClick={() => setAsking({ action: "rename", item })}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    title="Move to trash"
                    aria-label={`Move ${item.name} to trash`}
                    disabled={busy}
                    onClick={() => setAsking({ action: "trash", item })}
                  >
                    <Trash2 size={14} />
                  </button>
                </span>
              ) : null}
            </div>
          ))
        )}
      </div>
      {mode === "save" ? (
        <form className="drive-save" onSubmit={submit}>
          <div className="floating-field">
            <label htmlFor="drive-save-name">File name</label>
            <input
              id="drive-save-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="dialog-primary-btn"
            disabled={busy || !name.trim() || !canWrite}
          >
            Save here
          </button>
        </form>
      ) : null}
      {asking?.action === "new-folder" ? (
        <NameDialog
          title="New folder"
          submitLabel="Create"
          initial="Untitled folder"
          onClose={() => setAsking(null)}
          onSubmit={(folderName) => {
            setAsking(null);
            void act(async () => {
              await drive.create({
                name: folderName,
                parentId: folder.id,
                kind: "folder",
              });
              await refresh();
            });
          }}
        />
      ) : asking?.action === "rename" ? (
        <NameDialog
          title="Rename"
          submitLabel="OK"
          initial={asking.item.name}
          keepExtension={asking.item.kind === "file"}
          onClose={() => setAsking(null)}
          onSubmit={(next) => {
            const { item } = asking;
            setAsking(null);
            if (next !== item.name)
              void act(async () => {
                await drive.update(item.id, { name: next });
                await refresh();
              });
          }}
        />
      ) : asking?.action === "trash" ? (
        <DriveDialog
          title="Move to trash?"
          submitLabel="Move to trash"
          onClose={() => setAsking(null)}
          onSubmit={() => {
            const { item } = asking;
            setAsking(null);
            void act(async () => {
              await drive.update(item.id, { trashed: true });
              await refresh();
            });
          }}
        >
          <p className="dialog-note">
            &ldquo;{asking.item.name}&rdquo; will be moved to the trash.
          </p>
        </DriveDialog>
      ) : null}
    </div>
  );

  if (inline) return body;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="gdocs-dialog drive-dialog"
        role="dialog"
        aria-label={
          mode === "open" ? "Open from SuiteDrive" : "Save to SuiteDrive"
        }
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose?.()}
      >
        <div className="dialog-header">
          <h2>
            {mode === "open" ? "Open from SuiteDrive" : "Save to SuiteDrive"}
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
        {body}
      </div>
    </div>
  );
}
