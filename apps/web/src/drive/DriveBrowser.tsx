import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
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
import { drive, type DriveItem } from "../node-client";
import { formatModified } from "./status";

type Crumb = { id: string | null; name: string };

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
  onFolderChange?: (folderId: string | null) => void;
  /** Changing this re-lists the folder in place, e.g. when replication
   * brings in changes from another server. */
  refreshKey?: string;
}) {
  const [view, setView] = useState<"mine" | "shared">("mine");
  const [path, setPath] = useState<Crumb[]>([{ id: null, name: "My Drive" }]);
  const [items, setItems] = useState<DriveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState(defaultName);
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
      if (n === request.current)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (n === request.current) setLoading(false);
    }
  }, [folder.id, view]);
  useEffect(() => void refresh(), [refresh, refreshKey]);
  useEffect(() => {
    onFolderChange?.(folder.id);
  }, [folder.id, onFolderChange]);

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

  const switchView = (next: "mine" | "shared") => {
    setView(next);
    setPath([
      { id: null, name: next === "mine" ? "My Drive" : "Shared with me" },
    ]);
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
            onClick={() => {
              const folderName = window.prompt("Folder name", "New folder");
              if (folderName)
                void act(async () => {
                  await drive.create({
                    name: folderName,
                    parentId: folder.id,
                    kind: "folder",
                  });
                  await refresh();
                });
            }}
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
                    onClick={() => {
                      const next = window.prompt("Rename", item.name);
                      if (next && next !== item.name)
                        void act(async () => {
                          await drive.update(item.id, { name: next });
                          await refresh();
                        });
                    }}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    title="Move to trash"
                    aria-label={`Move ${item.name} to trash`}
                    onClick={() => {
                      if (window.confirm(`Move "${item.name}" to the trash?`))
                        void act(async () => {
                          await drive.update(item.id, { trashed: true });
                          await refresh();
                        });
                    }}
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
