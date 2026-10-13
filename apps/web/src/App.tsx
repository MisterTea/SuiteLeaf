import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  Component,
  type ReactNode,
} from "react";
import {
  HashRouter,
  Link,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
  type NavigateFunction,
} from "react-router-dom";
import {
  Leaf,
  FileText,
  Sheet,
  Presentation,
  Plus,
  Upload,
  Search,
  ArrowLeft,
  Check,
  CircleAlert,
  Trash2,
  FolderOpen,
  Download,
  Star,
  Clock,
  MessageSquare,
  Cloud,
  LogIn,
  LogOut,
  Unplug,
  ArrowDown,
  ArrowUp,
} from "lucide-react";
import {
  createFile,
  duplicateFile,
  extensionFor,
  hasUnsyncedEdits,
  kindFromName,
  nativeFilename,
  mimeFor,
  readLibraryMarks,
  serializeFile,
  type SuiteFile,
  type FileRecord,
  type DocFile,
  type SheetFile,
  type SlideFile,
  type JsonNode,
} from "@suiteleaf/core";
import { storage, SaveQueue, exportText } from "./storage";
import { importFile, type DelimitedDraft } from "./imports";
import { CsvImportDialog } from "./csv-import";
import type { DelimitedOptions } from "./csv";
import { SameFileDialog, openNotices } from "./same-file";
import { sampleDoc, sampleSheet, sampleSlide } from "./samples";
import {
  Menu,
  MenuItem,
  SubMenu,
  TableMenuItems,
  type EditorActions,
} from "./ui";
import { FunctionMenu } from "./editors/function-help-ui";
import { SheetViewMenu } from "./editors/SheetViewMenu";
import { CommandPalette, useCommandPalette } from "./command-palette";
import {
  DriveConflict,
  drive,
  finishSignOut,
  getSession,
  openDriveFile,
  pendingHandoffUrl,
  saveNewDriveFile,
  signOut,
  uploadDriveFile,
  type DriveItem,
  type DriveRole,
} from "./node-client";
import { DriveBrowser, DriveDialog, NameDialog } from "./drive/DriveBrowser";
import { ShareDialog } from "./drive/ShareDialog";
import { searchFile } from "./library-search";
import { FileLibraryRow, TrashToast } from "./library-trash-ui";
import {
  deleteForeverCopy,
  emptyTrashCopy,
  isTrashExpired,
  movedToTrashText,
  restoreRecord,
  starRecord,
  trashRecord,
  trashViewNote,
  TRASH_TOAST_MS,
  viewHeading,
  visibleRecords,
  type LibraryFilter,
} from "./library-trash";
import { ConnectDialog, SignInScreen, useNodeSession } from "./drive/SignIn";
import { syncSummary, useServerSync } from "./drive/status";
import {
  VersionHistory,
  VersionPreview,
  type ParagraphRestoreControl,
} from "./editors/version-history";
import { noteLocalSnapshot } from "./editors/local-versions";
import { completeHandoff } from "./node-client";
import {
  ModeContext,
  disconnect,
  forgetLeftServer,
  leftServer,
  resolveMode,
  useMode,
  type ResolvedMode,
} from "./mode";
import {
  SaveTemplateDialog,
  TemplateGallery,
  TemplateHome,
} from "./templates/gallery";
const Docs = lazy(() => import("./editors/Docs")),
  Sheets = lazy(() => import("./editors/Sheets")),
  Slides = lazy(() => import("./editors/Slides"));
function message(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
function isImportFeature(warning: string): boolean {
  return (
    /^\d+ (?:footnote|endnote|table)/.test(warning) ||
    /^\d+ comment threads? imported$/.test(warning) ||
    /^\d+ suggestions? imported$/.test(warning)
  );
}
function importFeatureLine(warnings: string[]): string {
  return warnings.filter(isImportFeature).join(" · ");
}
function importCompatibilityNotes(warnings: string[]): string[] {
  return warnings.filter((warning) => !isImportFeature(warning));
}
/** SuiteDrive uploads by file ID, shared by every editor of a file so one
 * opened while an earlier editor's upload is in flight reads the version that
 * upload produces instead of uploading on top of the same base again. */
const driveQueues = new Map<string, SaveQueue>();
function driveQueueFor(id: string) {
  let queue = driveQueues.get(id);
  if (!queue) driveQueues.set(id, (queue = new SaveQueue()));
  return queue;
}
/** Each open editor's "save and upload now". */
const openEditors = new Set<() => Promise<void>>();
/** Remove cached SuiteDrive files from this device once open editors and
 * pending uploads finish. Resolves false if edits never reached SuiteDrive
 * and the user chooses to keep them. */
async function forgetDriveFiles() {
  const flushed = await Promise.all(
    [...openEditors].map((flush) =>
      flush().then(
        () => true,
        () => false,
      ),
    ),
  );
  await Promise.all(
    [...driveQueues.values()].map((q) => q.flush().catch(() => {})),
  );
  const cached = (await storage.list()).filter((r) => r.drive);
  if (
    (flushed.includes(false) || cached.some(hasUnsyncedEdits)) &&
    !window.confirm(
      "Some changes haven't reached SuiteDrive and are only saved on this device. Remove them from this device anyway?",
    )
  )
    return false;
  for (const r of cached) await storage.remove(r.file.id);
  return true;
}
/** Purge this device's SuiteDrive cache, sign out, and return to single-node mode. */
async function disconnectFromServer(serverUrl: string) {
  if (!(await forgetDriveFiles())) return;
  await disconnect(serverUrl);
}
/** Cache a SuiteDrive file locally and open it in the editor. A local file
 * that merely shares the ID gets a fresh one instead of being replaced, and
 * a cached copy with unuploaded edits is kept so the editor can resolve them. */
async function openFromDrive(item: DriveItem, navigate: NavigateFunction) {
  // An upload finishing after the read below would be replaced by the older version.
  await Promise.all(
    [...driveQueues.values()].map((q) => q.flush().catch(() => {})),
  );
  const record = await openDriveFile(item);
  const existing = await storage.get(record.file.id);
  if (existing?.drive?.itemId === item.id) {
    if (
      existing.drive.versionId === record.drive?.versionId ||
      hasUnsyncedEdits(existing)
    ) {
      navigate(`/file/${existing.file.id}`);
      return;
    }
  } else if (existing)
    record.file = duplicateFile(record.file, record.file.title);
  const saved = await storage.save(record);
  navigate(`/file/${saved.file.id}`);
}
/** Use the file's native extension unless the user typed it. */
function driveName(name: string, kind: SuiteFile["kind"]) {
  return kindFromName(name) === kind ? name : `${name}.${extensionFor(kind)}`;
}
/** "A newer version was saved at 2:14 PM." (or "on Oct 12 at 2:14 PM."). */
function savedWhen(iso: string) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const time = at.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const day =
    at.toDateString() === new Date().toDateString()
      ? ""
      : `on ${at.toLocaleDateString(undefined, { month: "short", day: "numeric" })} `;
  return `A newer version was saved ${day}at ${time}.`;
}
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: string }
> {
  state = { error: "" };
  static getDerivedStateFromError(e: Error) {
    return { error: e.message };
  }
  render() {
    return this.state.error ? (
      <div className="loading">
        <h2>Could not open the editor</h2>
        <p>{this.state.error}</p>
        <a href="#/">Return to files</a>
      </div>
    ) : (
      this.props.children
    );
  }
}
/** Menu content mounts each time the menu opens, so this label reads current state. */
function LiveLabel({ text }: { text: () => string }) {
  return <>{text()}</>;
}
function EditorHelp() {
  const { openSearch, openShortcuts } = useCommandPalette();
  return (
    <Menu label="Help">
      <MenuItem onSelect={openSearch}>Search the menus</MenuItem>
      <MenuItem shortcut="Mod+/" onSelect={openShortcuts}>
        Keyboard shortcuts
      </MenuItem>
    </Menu>
  );
}
function Logo() {
  return (
    <span className="logo">
      <span className="logo-mark">
        <Leaf size={23} />
      </span>
      SuiteLeaf
    </span>
  );
}
function ImportButton({
  onImport,
  onError,
  filePicker = false,
}: {
  /** `name` is the chosen file's name when it came from the file picker. */
  onImport: (r: FileRecord, name?: string) => Promise<void>;
  onError: (s: string) => void;
  /** Always use the browser file picker, even on desktop. */
  filePicker?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [review, setReview] = useState<{
    draft: DelimitedDraft;
    resolve: (options: DelimitedOptions | null) => void;
  } | null>(null);
  const open = async () => {
    setImporting(true);
    try {
      if (window.suiteleaf && !filePicker) {
        const r = await storage.open();
        if (r) await onImport(r);
      } else input.current?.click();
    } catch (e) {
      onError(message(e));
    } finally {
      setImporting(false);
    }
  };
  return (
    <>
      <button disabled={importing} onClick={() => void open()}>
        <Upload size={16} />
        {importing ? "Importing…" : "Open / import"}
      </button>
      <input
        hidden
        type="file"
        ref={input}
        accept=".sldoc,.slsheet,.slslides,.suiteleaf,.docx,.xlsx,.xls,.xlsm,.xlsb,.xltx,.pptx,.ppt,.ppsx,.pptm,.potx,.ppsm,.html,.htm,.txt,.csv,.tsv"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setImporting(true);
          try {
            const file = await importFile(
              f,
              (draft) =>
                new Promise((resolve) => setReview({ draft, resolve })),
            );
            if (file) await onImport({ file }, f.name);
          } catch (e) {
            onError(message(e));
          } finally {
            setImporting(false);
          }
        }}
      />
      {window.suiteleaf && !filePicker ? (
        <button onClick={() => input.current?.click()}>
          Import Office / HTML / CSV
        </button>
      ) : null}
      {review ? (
        <CsvImportDialog
          draft={review.draft}
          onDone={(options) => {
            setReview(null);
            review.resolve(options);
          }}
        />
      ) : null}
    </>
  );
}
/** Upload a new file to SuiteDrive, cache it locally, and open it. */
async function createInDrive(
  file: SuiteFile,
  folderId: string | null,
  navigate: NavigateFunction,
) {
  if (await storage.get(file.id)) file = duplicateFile(file, file.title);
  const drive = await saveNewDriveFile(file, folderId, nativeFilename(file));
  const saved = await storage.save({ file, drive });
  navigate(`/file/${saved.file.id}`);
}
function NewCards({
  onCreate,
  folder,
}: {
  onCreate: (kind: SuiteFile["kind"]) => void;
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
    </div>
  );
}
function ErrorBanner({
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
function Home() {
  const { mode } = useMode();
  return mode.kind === "cluster" ? (
    <ClusterHome serverUrl={mode.serverUrl} />
  ) : (
    <LocalHome />
  );
}
/** Single-node mode: files on this computer (or, for the web app, in this
 * browser's storage). */
function LocalHome() {
  const navigate = useNavigate();
  const { locked, demo } = useMode();
  const [connecting, setConnecting] = useState(false);
  const [records, setRecords] = useState<FileRecord[]>([]),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [filter, setFilter] = useState<LibraryFilter>("all"),
    [sort, setSort] = useState<{ by: "name" | "edited"; desc: boolean }>({
      by: "edited",
      desc: true,
    }),
    [renaming, setRenaming] = useState<FileRecord | null>(null),
    [forever, setForever] = useState<FileRecord | null>(null),
    [emptying, setEmptying] = useState(false),
    [undo, setUndo] = useState<{ id: string; title: string } | null>(null),
    [sameFile, setSameFile] = useState<{
      name: string;
      existing: FileRecord;
      incoming: FileRecord;
    } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const refresh = useCallback(
    () =>
      storage
        .list()
        // Cached copies of server files belong to cluster mode.
        .then(async (all) => {
          const local = all.filter((r) => !r.drive);
          const now = new Date();
          const expired = local.filter((r) => isTrashExpired(r, now));
          if (expired.length)
            await Promise.all(expired.map((r) => storage.remove(r.file.id)));
          setRecords(local.filter((r) => !isTrashExpired(r, now)));
        })
        .catch((e) => setError(message(e))),
    [],
  );
  useEffect(() => {
    void refresh();
    return () => clearTimeout(undoTimer.current);
  }, [refresh]);
  const open = useCallback(
    async (r: FileRecord, notice?: string) => {
      if (!r.path && !r.recovery && (await storage.get(r.file.id)))
        r = { file: duplicateFile(r.file) };
      const saved = r.path ? r : await storage.save(r);
      if (notice) openNotices.set(saved.file.id, notice);
      navigate(`/file/${saved.file.id}`);
    },
    [navigate],
  );
  /** A SuiteLeaf file carries its ID, so opening one already in the library
   * opens that copy if it is the same, and otherwise asks what to keep. */
  const importRecord = useCallback(
    async (r: FileRecord, name?: string) => {
      if (!name) return open(r);
      const existing =
        r.path || r.recovery ? undefined : await storage.get(r.file.id);
      if (!existing || existing.drive || existing.path)
        return open(r, `Opened “${name}”`);
      if (
        existing.trashedAt &&
        serializeFile(existing.file) === serializeFile(r.file)
      ) {
        await storage.save(restoreRecord(existing));
        openNotices.set(r.file.id, `Restored “${name}” from Trash`);
        navigate(`/file/${r.file.id}`);
        return;
      }
      if (serializeFile(existing.file) !== serializeFile(r.file)) {
        setSameFile({ name, existing, incoming: r });
        return;
      }
      openNotices.set(r.file.id, `“${name}” matches the copy here`);
      navigate(`/file/${r.file.id}`);
    },
    [open, navigate],
  );
  const replaceWith = async (name: string, incoming: FileRecord) => {
    const id = incoming.file.id;
    const held = navigator.locks ? (await navigator.locks.query()).held : [];
    if (held?.some((lock) => lock.name === `suiteleaf:${id}`))
      throw new Error(
        `“${incoming.file.title}” is open in another tab. Close it there, then try again.`,
      );
    await storage.save({ file: incoming.file });
    openNotices.set(id, `Replaced with “${name}”`);
    navigate(`/file/${id}`);
  };
  const make = useCallback(
    (kind: SuiteFile["kind"]) =>
      void open({ file: createFile(kind) }).catch((e) => setError(message(e))),
    [open],
  );
  const menu = useCallback(
    (action: string) => {
      if (action === "new-doc") make("doc");
      if (action === "new-sheet") make("sheet");
      if (action === "new-slide") make("slide");
      if (action === "connect-server") setConnecting(true);
      if (action === "open")
        void storage
          .open()
          .then((r) => r && open(r))
          .catch((e) => setError(message(e)));
    },
    [make, open],
  );
  useEffect(() => window.suiteleaf?.onMenu(menu), [menu]);
  const rename = async (r: FileRecord, title: string) => {
    const write = async () => {
      const latest = (await storage.get(r.file.id)) ?? r;
      await storage.save({
        ...latest,
        file: {
          ...latest.file,
          title: title.slice(0, 200),
          updatedAt: new Date().toISOString(),
        },
      });
      return true;
    };
    // An editor holding the file would save its old title over the new one.
    const done = navigator.locks
      ? await navigator.locks.request(
          `suiteleaf:${r.file.id}`,
          { ifAvailable: true },
          (lock) => (lock ? write() : false),
        )
      : await write();
    if (!done)
      throw new Error(
        `"${r.file.title}" is open in another tab. Rename it there, or close it first.`,
      );
    await refresh();
  };
  const desktop = !!window.suiteleaf;
  const rememberUndo = (record: FileRecord) => {
    clearTimeout(undoTimer.current);
    setUndo({ id: record.file.id, title: record.file.title });
    undoTimer.current = setTimeout(() => setUndo(null), TRASH_TOAST_MS);
  };
  const moveToTrash = (record: FileRecord) => {
    void (async () => {
      const latest = (await storage.get(record.file.id)) ?? record;
      await storage.save(trashRecord(latest));
      rememberUndo(latest);
      await refresh();
    })().catch((e) => setError(message(e)));
  };
  const undoTrash = () => {
    if (!undo) return;
    const id = undo.id;
    clearTimeout(undoTimer.current);
    setUndo(null);
    void (async () => {
      const latest = await storage.get(id);
      if (latest?.trashedAt) await storage.save(restoreRecord(latest));
      await refresh();
    })().catch((e) => setError(message(e)));
  };
  const restore = (record: FileRecord) => {
    void (async () => {
      const latest = (await storage.get(record.file.id)) ?? record;
      await storage.save(restoreRecord(latest));
      if (undo?.id === record.file.id) {
        clearTimeout(undoTimer.current);
        setUndo(null);
      }
      setFilter("all");
      setQuery("");
      await refresh();
    })().catch((e) => setError(message(e)));
  };
  const toggleStarred = (record: FileRecord) => {
    void (async () => {
      const latest = (await storage.get(record.file.id)) ?? record;
      await storage.save(starRecord(latest, !latest.starred));
      await refresh();
    })().catch((e) => setError(message(e)));
  };
  const removeForever = async (ids: string[]) => {
    if (undo && ids.includes(undo.id)) {
      clearTimeout(undoTimer.current);
      setUndo(null);
    }
    await Promise.all(ids.map((id) => storage.remove(id)));
    await refresh();
  };
  const searching = query.trim() !== "",
    kindLabel = viewHeading(filter),
    heading = !searching
      ? kindLabel
      : filter === "all"
        ? `Results for “${query.trim()}”`
        : `${kindLabel} matching “${query.trim()}”`,
    kept = records.filter((r) => !r.trashedAt),
    trashed = records.filter((r) => r.trashedAt),
    focused = searching || filter === "trash" || filter === "starred";
  const shown = visibleRecords(records, filter, query)
    .flatMap((r) => {
      const hit = searchFile(r.file, query);
      return hit ? [{ r, snippet: hit.snippet }] : [];
    })
    .sort((a, b) => {
      const order =
        sort.by === "name"
          ? a.r.file.title.localeCompare(b.r.file.title, undefined, {
              numeric: true,
              sensitivity: "base",
            })
          : a.r.file.updatedAt.localeCompare(b.r.file.updatedAt);
      return sort.desc ? -order : order;
    });
  const sortBy = (by: "name" | "edited", label: string) => (
    <button
      className={`sort-head ${sort.by === by ? "active" : ""}`}
      aria-label={`Sort by ${label.toLowerCase()}`}
      title={`Sort by ${label.toLowerCase()}`}
      onClick={() =>
        setSort(
          sort.by === by
            ? { by, desc: !sort.desc }
            : { by, desc: by === "edited" },
        )
      }
    >
      {label}
      {sort.by === by ? (
        sort.desc ? (
          <ArrowDown size={12} />
        ) : (
          <ArrowUp size={12} />
        )
      ) : null}
    </button>
  );
  const samples = (
    [
      ["Sample document", sampleDoc],
      ["Sample budget", sampleSheet],
      ["Sample presentation", sampleSlide],
    ] as const
  ).map(([label, sample]) => (
    <button
      key={label}
      onClick={() =>
        void open({ file: sample() }).catch((e) => setError(message(e)))
      }
    >
      {label}
    </button>
  ));
  return (
    <div className="home">
      <aside className="sidebar">
        <Logo />
        <div className="sidebar-links">
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
      <main className="home-main">
        <header className="home-top">
          <label className="search">
            <Search size={18} />
            <input
              aria-label="Search files"
              placeholder="Search your files"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setQuery("");
              }}
            />
          </label>
          <span className="version">OPEN SOURCE · v0.1</span>
        </header>
        <LeftServerNotice />
        {focused ? null : (
          <>
            <section className="welcome">
              <p className="eyebrow">YOUR EVERYDAY WORKSPACE</p>
              <h1>Good ideas start here.</h1>
              <p>Write something. Work out the numbers. Make it yours.</p>
            </section>
            <NewCards onCreate={make} />
            <TemplateHome />
          </>
        )}
        <ErrorBanner error={error} onDismiss={() => setError("")} />
        {connecting ? (
          <ConnectDialog onClose={() => setConnecting(false)} />
        ) : null}
        <section className={`file-section ${focused ? "searching" : ""}`}>
          <header>
            <h2>{heading}</h2>
            {searching ? (
              <button onClick={() => setQuery("")}>Clear search</button>
            ) : (
              <ImportButton onImport={importRecord} onError={setError} />
            )}
          </header>
          {filter === "trash" ? (
            <div className="trash-banner">
              <p>{trashViewNote(desktop)}</p>
              {trashed.length > 0 ? (
                <button type="button" onClick={() => setEmptying(true)}>
                  Empty trash
                </button>
              ) : null}
            </div>
          ) : null}
          {sameFile ? (
            <SameFileDialog
              {...sameFile}
              where={window.suiteleaf ? "on this computer" : "in this browser"}
              onClose={() => setSameFile(null)}
              onReplace={() => {
                setSameFile(null);
                void replaceWith(sameFile.name, sameFile.incoming).catch((e) =>
                  setError(message(e)),
                );
              }}
              onKeepBoth={() => {
                setSameFile(null);
                void open(
                  { file: duplicateFile(sameFile.incoming.file) },
                  `Opened “${sameFile.name}” as a copy`,
                ).catch((e) => setError(message(e)));
              }}
            />
          ) : null}
          {filter === "all" && !searching && kept.length === 0 ? (
            <div className="empty">
              <FolderOpen size={34} />
              <h3>A workspace waiting for you</h3>
              <p>
                Create your first file, or explore a sample.
                {trashed.length > 0
                  ? " Anything you deleted is in Trash."
                  : ""}
              </p>
              <div>{samples}</div>
            </div>
          ) : shown.length === 0 ? (
            <div className="empty">
              {searching ? <Search size={30} /> : <FolderOpen size={34} />}
              <h3>
                {searching
                  ? `No files match “${query.trim()}”`
                  : filter === "trash"
                    ? "Trash is empty"
                    : filter === "starred"
                      ? "No starred files"
                      : `No ${kindLabel.toLowerCase()} yet`}
              </h3>
              <p>
                {searching
                  ? "Search looks at file names and the words inside them, including Trash."
                  : filter === "trash"
                    ? "Files you delete wait here for 30 days."
                    : filter === "starred"
                      ? "Star a file on its row, or beside its title, and it stays here."
                      : "Files you create or import appear here."}
              </p>
            </div>
          ) : (
            <div className="file-list">
              <div className="file-list-head">
                {sortBy("name", "Name")}
                {sortBy("edited", "Last edited")}
                <span />
              </div>
              {shown.map(({ r, snippet }) => (
                <FileLibraryRow
                  key={r.file.id}
                  record={r}
                  snippet={snippet}
                  view={filter}
                  desktop={desktop}
                  onRename={() => setRenaming(r)}
                  onDuplicate={() =>
                    void storage
                      .save({ file: duplicateFile(r.file) })
                      .then(refresh)
                      .catch((e) => setError(message(e)))
                  }
                  onMoveToTrash={() => moveToTrash(r)}
                  onRestore={() => restore(r)}
                  onDeleteForever={() => setForever(r)}
                  onToggleStar={() => toggleStarred(r)}
                />
              ))}
            </div>
          )}
          {kept.length > 0 && !focused ? (
            <p className="sample-strip">Explore a sample: {samples}</p>
          ) : null}
          {renaming ? (
            <NameDialog
              title="Rename"
              submitLabel="OK"
              initial={renaming.file.title}
              onClose={() => setRenaming(null)}
              onSubmit={(title) => {
                const record = renaming;
                setRenaming(null);
                if (title !== record.file.title)
                  void rename(record, title).catch((e) => setError(message(e)));
              }}
            />
          ) : null}
          {forever
            ? (() => {
                const copy = deleteForeverCopy(forever, desktop);
                return (
                  <DriveDialog
                    title={copy.title}
                    submitLabel="Delete forever"
                    onClose={() => setForever(null)}
                    onSubmit={() => {
                      const id = forever.file.id;
                      setForever(null);
                      void removeForever([id]).catch((e) =>
                        setError(message(e)),
                      );
                    }}
                  >
                    {copy.paragraphs.map((paragraph) => (
                      <p className="dialog-note" key={paragraph}>
                        {paragraph}
                      </p>
                    ))}
                  </DriveDialog>
                );
              })()
            : null}
          {emptying
            ? (() => {
                const copy = emptyTrashCopy(trashed.length, desktop);
                return (
                  <DriveDialog
                    title={copy.title}
                    submitLabel="Delete forever"
                    onClose={() => setEmptying(false)}
                    onSubmit={() => {
                      const ids = trashed.map((r) => r.file.id);
                      setEmptying(false);
                      void removeForever(ids).catch((e) =>
                        setError(message(e)),
                      );
                    }}
                  >
                    {copy.paragraphs.map((paragraph) => (
                      <p className="dialog-note" key={paragraph}>
                        {paragraph}
                      </p>
                    ))}
                    <ul className="trash-name-list">
                      {trashed.map((r) => (
                        <li key={r.file.id}>{r.file.title}</li>
                      ))}
                    </ul>
                  </DriveDialog>
                );
              })()
            : null}
        </section>
        <footer className="home-footer">
          A calmer place to get things done.<span>SuiteLeaf · Apache-2.0</span>
        </footer>
      </main>
      {undo ? (
        <TrashToast
          text={movedToTrashText(undo.title, desktop)}
          onUndo={undoTrash}
          onDismiss={() => {
            clearTimeout(undoTimer.current);
            setUndo(null);
          }}
        />
      ) : null}
    </div>
  );
}
function AccountChip({
  serverUrl,
  onError,
}: {
  serverUrl: string;
  onError: (error: string) => void;
}) {
  const session = useNodeSession();
  const { locked } = useMode();
  const [busy, setBusy] = useState(false);
  const leave = (work: () => Promise<unknown>) => {
    setBusy(true);
    void work()
      .catch((e) => onError(message(e)))
      .finally(() => setBusy(false));
  };
  if (!session) return null;
  const name =
    session.user.name || session.user.username || session.user.email || "";
  const host = new URL(serverUrl).host;
  return (
    <div className="account-chip">
      <div
        className="account-who"
        title={`${name}${session.user.email ? ` (${session.user.email})` : ""} on ${host}`}
      >
        <span className="account-avatar" aria-hidden="true">
          {(name || "?").slice(0, 1).toUpperCase()}
        </span>
        <span className="account-name">
          {name}
          <small>{host}</small>
        </span>
      </div>
      <div className="account-actions">
        <button
          title={`Sign out of ${host}`}
          aria-label="Sign out"
          disabled={busy}
          onClick={() =>
            leave(async () => {
              if (await forgetDriveFiles()) await signOut();
            })
          }
        >
          <LogOut size={14} />
          <span className="account-action-label">Sign out</span>
        </button>
        {locked ? null : (
          <button
            title="Sign out and work on this computer without a server"
            aria-label="Disconnect from server"
            disabled={busy}
            onClick={() => leave(() => disconnectFromServer(serverUrl))}
          >
            <Unplug size={14} />
            <span className="account-action-label">Disconnect</span>
          </button>
        )}
      </div>
    </div>
  );
}
/** One-time confirmation after disconnecting, like a "signed out" page. */
function LeftServerNotice() {
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
/** Cluster mode: a signed-in client of a SuiteLeaf server, with SuiteDrive
 * as the file list. */
function ClusterHome({ serverUrl }: { serverUrl: string }) {
  const navigate = useNavigate();
  const { locked } = useMode();
  const [error, setError] = useState("");
  const folder = useRef<string | null>(null);
  const [folderName, setFolderName] = useState<string>();
  const onFolderChange = useCallback((id: string | null, name: string) => {
    folder.current = id;
    setFolderName(id ? name : undefined);
  }, []);
  const sync = useServerSync(serverUrl);
  const summary = syncSummary(sync);
  const make = useCallback(
    (kind: SuiteFile["kind"]) =>
      void createInDrive(createFile(kind), folder.current, navigate).catch(
        (e) => setError(message(e)),
      ),
    [navigate],
  );
  const menu = useCallback(
    (action: string) => {
      if (action === "new-doc") make("doc");
      if (action === "new-sheet") make("sheet");
      if (action === "new-slide") make("slide");
    },
    [make],
  );
  useEffect(() => window.suiteleaf?.onMenu(menu), [menu]);
  return (
    <div className="home">
      <aside className="sidebar">
        <Logo />
        <div className="local-note cluster-note">
          <Cloud size={16} />
          Your organization&apos;s workspace.
          <small>
            Files are saved to SuiteDrive on {new URL(serverUrl).host}.
            {locked
              ? null
              : " Your files on this computer are kept for when you disconnect."}
          </small>
          {summary ? (
            <small
              className={`cluster-sync ${sync?.replicating ? "copying" : ""}`}
              aria-live="polite"
            >
              <span className="local-dot" />
              {summary}
            </small>
          ) : null}
        </div>
        <AccountChip serverUrl={serverUrl} onError={setError} />
      </aside>
      <main className="home-main">
        <header className="home-top">
          <span />
          <span className="version">OPEN SOURCE · v0.1</span>
        </header>
        <section className="welcome">
          <p className="eyebrow">YOUR TEAM WORKSPACE</p>
          <h1>Good ideas start here.</h1>
          <p>
            Everything you create is saved to SuiteDrive, on your team&apos;s
            server.
          </p>
        </section>
        <NewCards onCreate={make} folder={folderName} />
        <ErrorBanner error={error} onDismiss={() => setError("")} />
        <section className="file-section">
          <header>
            <h2>SuiteDrive</h2>
            <ImportButton
              filePicker
              onImport={(r) => createInDrive(r.file, folder.current, navigate)}
              onError={setError}
            />
          </header>
          <DriveBrowser
            inline
            mode="open"
            onFolderChange={onFolderChange}
            onOpen={(item) => openFromDrive(item, navigate)}
            refreshKey={sync ? `${sync.heads}:${sync.replicating}` : undefined}
          />
        </section>
        <footer className="home-footer">
          A calmer place to get things done.<span>SuiteLeaf · Apache-2.0</span>
        </footer>
      </main>
    </div>
  );
}
function Workspace() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [record, setRecord] = useState<FileRecord>(),
    [error, setError] = useState(""),
    [status, setStatus] = useState("Opening…"),
    [locked, setLocked] = useState(false),
    [templateDraft, setTemplateDraft] = useState<SuiteFile | null>(null);
  const [actionsReady, setActionsReady] = useState(false);
  const current = useRef<FileRecord>(undefined),
    version = useRef(0),
    savedVersion = useRef(0),
    queue = useRef(new SaveQueue()),
    timer = useRef<ReturnType<typeof setTimeout>>(undefined),
    actions = useRef<EditorActions>(undefined),
    alive = useRef(true),
    saveError = useRef(""),
    driveQueue = useRef(driveQueueFor(id!)),
    driveTimer = useRef<ReturnType<typeof setTimeout>>(undefined),
    driveConflictRef = useRef<DriveItem | null>(null),
    snapshotExplicit = useRef(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [historyPreview, setHistoryPreview] = useState<{
    content: JsonNode;
    label: string;
    offers: (ParagraphRestoreControl | null)[] | null;
  } | null>(null);
  const restoreParagraph = useRef<(key: string) => void>(() => {});
  const [driveConflict, setDriveConflictState] = useState<DriveItem | null>(
      null,
    ),
    [driveDialog, setDriveDialog] = useState<"open" | "save" | null>(null),
    [shareOpen, setShareOpen] = useState(false),
    [driveRole, setDriveRole] = useState<DriveRole | "local" | null>(null),
    { mode } = useMode(),
    cluster = mode.kind === "cluster";
  const canEditRef = useRef(true);
  const canEdit =
    driveRole === "local" || driveRole === "editor" || driveRole === "owner";
  const setDriveConflict = (item: DriveItem | null) => {
    driveConflictRef.current = item;
    setDriveConflictState(item);
  };
  const selectTitle = useRef(
    !!(location.state as { selectTitle?: boolean } | null)?.selectTitle,
  );
  useEffect(() => {
    if (!record || !selectTitle.current) return;
    selectTitle.current = false;
    let stop = false;
    const focus = () => {
      if (stop) return;
      const input = document.querySelector<HTMLInputElement>(
        '[aria-label="File title"]',
      );
      input?.focus();
      input?.select();
    };
    focus();
    const timers = [120, 500].map((ms) => setTimeout(focus, ms));
    const input = document.querySelector('[aria-label="File title"]');
    const halt = () => {
      stop = true;
    };
    input?.addEventListener("keydown", halt, { once: true });
    navigate(`/file/${record.file.id}`, { replace: true, state: null });
    return () => {
      stop = true;
      timers.forEach(clearTimeout);
      input?.removeEventListener("keydown", halt);
    };
  }, [record, navigate]);
  /** Upload the current file to SuiteDrive as a new version. */
  const syncDrive = useCallback(async () => {
    clearTimeout(driveTimer.current);
    driveTimer.current = undefined;
    if (!canEditRef.current) return;
    if (!current.current?.drive || driveConflictRef.current) return;
    if (!getSession()) {
      setStatus("Saved on this device · sign in to sync with SuiteDrive");
      return;
    }
    const at = version.current;
    const snapshot = structuredClone(current.current.file);
    try {
      await driveQueue.current.enqueue(async () => {
        const base = current.current!.drive!;
        const link = await uploadDriveFile(snapshot, base);
        // Saving to a new SuiteDrive item may have relinked the file meanwhile.
        if (current.current!.drive?.itemId !== base.itemId) return;
        current.current = { ...current.current!, drive: link };
        await storage.save(current.current);
      });
      if (alive.current && version.current === at)
        setStatus("Saved to SuiteDrive");
    } catch (e) {
      if (e instanceof DriveConflict) {
        if (e.item.id !== current.current?.drive?.itemId) return;
        setDriveConflict(e.item);
        setStatus("SuiteDrive has a newer version");
      } else setStatus(`Saved on this device · ${message(e)}`);
    }
  }, []);
  const save = useCallback(async () => {
    if (!canEditRef.current) return;
    clearTimeout(timer.current);
    try {
      await actions.current?.flush();
    } catch (e) {
      setError(message(e));
      throw e;
    }
    clearTimeout(timer.current);
    if (!current.current) return;
    const at = version.current;
    const snapshot = structuredClone(current.current.file);
    setStatus("Saving…");
    try {
      await queue.current.enqueue(async () => {
        const marks = readLibraryMarks(current.current!);
        const saved = await storage.save({
          ...current.current!,
          file: snapshot,
          ...marks,
        });
        // A star or restore clicked while this write was in flight wins.
        const after = readLibraryMarks(current.current!);
        current.current = {
          ...saved,
          file: current.current!.file,
          drive: current.current!.drive,
          ...after,
        };
        if (!after.starred) delete current.current.starred;
        if (!after.trashedAt) delete current.current.trashedAt;
        if (alive.current) setRecord(current.current);
      });
      savedVersion.current = Math.max(savedVersion.current, at);
      // Once unmounted, the cleanup has already uploaded the latest content
      // and a reopened editor may hold the link a later upload would replace.
      const explicit = snapshotExplicit.current;
      snapshotExplicit.current = false;
      if (alive.current && current.current.drive && !driveConflictRef.current) {
        clearTimeout(driveTimer.current);
        driveTimer.current = setTimeout(() => void syncDrive(), 1500);
      } else if (alive.current && !current.current.drive) {
        void noteLocalSnapshot(snapshot, explicit).catch(() => {});
      }
      if (version.current === at) {
        setStatus(
          current.current.drive
            ? driveConflictRef.current
              ? "SuiteDrive has a newer version"
              : "Saving to SuiteDrive…"
            : current.current.path
              ? "Saved to file"
              : window.suiteleaf
                ? "Draft saved · choose Save As"
                : "Saved on this device",
        );
        window.suiteleaf?.setDirty(false);
        setError((previous) =>
          previous === saveError.current ? "" : previous,
        );
        saveError.current = "";
      }
    } catch (e) {
      setStatus("Save failed");
      saveError.current = message(e);
      setError(saveError.current);
      throw e;
    }
  }, [syncDrive]);
  useEffect(() => {
    alive.current = true;
    setActionsReady(false);
    setDriveRole(null);
    setShareOpen(false);
    canEditRef.current = false;
    actions.current = undefined;
    const saveQueue = queue.current;
    let release: (() => void) | undefined,
      cancel = false;
    const load = async () => {
      try {
        const r = await driveQueue.current.enqueue(() => storage.get(id!));
        if (cancel) return;
        if (!r) throw new Error("This file could not be found.");
        let role: DriveRole | "local" = "local";
        if (r.drive && getSession()) {
          try {
            role = (await drive.get(r.drive.itemId)).role ?? "viewer";
          } catch {
            role = "viewer";
          }
        }
        if (cancel) return;
        canEditRef.current =
          role === "local" || role === "editor" || role === "owner";
        setDriveRole(role);
        current.current = r;
        setRecord(r);
        if (canEditRef.current && hasUnsyncedEdits(r)) {
          setStatus("Saving to SuiteDrive…");
          void syncDrive();
          return;
        }
        const saved = r.drive
          ? "Saved to SuiteDrive"
          : r.recovery
            ? "Recovered draft · review and save"
            : r.path
              ? "Saved to file"
              : window.suiteleaf
                ? "Draft saved · choose Save As"
                : "Saved on this device";
        const notice = openNotices.get(id!);
        openNotices.delete(id!);
        setStatus(notice ? `${notice} · ${saved}` : saved);
      } catch (e) {
        if (!cancel) setError(message(e));
      }
    };
    if (navigator.locks) {
      void navigator.locks.request(
        `suiteleaf:${id}`,
        { ifAvailable: true },
        async (lock) => {
          if (!lock) {
            setLocked(true);
            return;
          }
          await load();
          await new Promise<void>((resolve) => {
            release = resolve;
            if (cancel) resolve();
          });
        },
      );
    } else void load();
    return () => {
      cancel = true;
      alive.current = false;
      clearTimeout(timer.current);
      const unsaved =
        !!current.current && version.current > savedVersion.current;
      if (unsaved) {
        const file = structuredClone(current.current!.file);
        void saveQueue
          .enqueue(() => storage.save({ ...current.current!, file }))
          .catch(() => {});
      }
      // Queued before the next editor of this file can read the cached record.
      if (unsaved || driveTimer.current) void syncDrive();
      release?.();
    };
  }, [id, syncDrive]);
  useEffect(() => {
    const flush = async () => {
      await save();
      if (alive.current) await syncDrive();
    };
    openEditors.add(flush);
    return () => void openEditors.delete(flush);
  }, [save, syncDrive]);
  const update = useCallback(
    (content: SuiteFile["content"]) => {
      if (!canEditRef.current || !current.current) return;
      current.current = {
        ...current.current,
        file: {
          ...current.current.file,
          content,
          updatedAt: new Date().toISOString(),
        } as SuiteFile,
      };
      version.current++;
      window.suiteleaf?.setDirty(true);
      setStatus("Unsaved changes");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void save().catch(() => {}), 500);
    },
    [save],
  );
  const changeTitle = (title: string) => {
    if (!canEditRef.current || !current.current) return;
    current.current.file.title = title || "Untitled";
    setRecord({ ...current.current });
    update(current.current.file.content);
  };
  const toggleStar = () => {
    if (!current.current) return;
    const next = starRecord(current.current, !current.current.starred);
    current.current = next;
    setRecord(next);
    void queue.current
      .enqueue(() => storage.save(current.current!))
      .catch((e) => setError(message(e)));
  };
  const saveAs = useCallback(async () => {
    if (!current.current) return;
    clearTimeout(timer.current);
    try {
      await actions.current?.flush();
      clearTimeout(timer.current);
      await queue.current.flush().catch(() => {});
      const at = version.current;
      const saved = await storage.saveAs(structuredClone(current.current));
      if (saved) {
        current.current = {
          ...saved,
          file: current.current.file,
          drive: current.current.drive,
        };
        setRecord(current.current);
        if (at === version.current) await save();
        else void save().catch(() => {});
      }
      return !!saved;
    } catch (e) {
      setError(message(e));
      return false;
    }
  }, [save]);
  const doAction = useCallback(
    async (action: string) => {
      try {
        if (action === "save") {
          snapshotExplicit.current = true;
          await save();
          if (alive.current) await syncDrive();
        } else if (action === "save-as") {
          if (cluster) setDriveDialog("save");
          else await saveAs();
        } else if (action === "print") await actions.current?.print();
        else if (action === "open") {
          await save();
          if (cluster) setDriveDialog("open");
          else {
            const r = await storage.open();
            if (r) navigate(`/file/${r.file.id}`);
          }
        } else if (action === "from-template") {
          await save();
          navigate(`/templates?kind=${current.current?.file.kind ?? "doc"}`);
        } else if (
          action === "new-doc" ||
          action === "new-sheet" ||
          action === "new-slide"
        ) {
          await save();
          const file = createFile(
            action === "new-doc"
              ? "doc"
              : action === "new-sheet"
                ? "sheet"
                : "slide",
          );
          if (cluster) await createInDrive(file, null, navigate);
          else navigate(`/file/${(await storage.save({ file })).file.id}`);
        }
      } catch (e) {
        setError(message(e));
      }
    },
    [save, saveAs, navigate, syncDrive, cluster],
  );
  const saveToDrive = async (folderId: string | null, name: string) => {
    await actions.current?.flush();
    const named = driveName(name, current.current!.file.kind);
    current.current!.file.title =
      named.replace(/\.[^.]+$/, "").slice(0, 200) || "Untitled";
    await save();
    const file = current.current!.file;
    const link = await saveNewDriveFile(file, folderId, named);
    current.current = { ...current.current!, drive: link };
    await storage.save(current.current);
    setDriveConflict(null);
    setRecord(current.current);
    setDriveDialog(null);
    setStatus("Saved to SuiteDrive");
  };
  const reloadFromDrive = async () => {
    const conflict = driveConflictRef.current;
    if (!conflict || !current.current) return;
    const fresh = await openDriveFile(conflict);
    const file = { ...fresh.file, id: current.current.file.id } as SuiteFile;
    version.current = savedVersion.current = 0;
    await storage.save({ ...current.current, file, drive: fresh.drive });
    window.location.reload();
  };
  const saveDriveCopy = async () => {
    const conflict = driveConflictRef.current;
    if (!conflict) return;
    // Uploads rename SuiteDrive files after their title, so the copy gets its own.
    const title = `${current.current!.file.title} (copy)`.slice(0, 200);
    const file = { ...current.current!.file, title } as SuiteFile;
    setDriveConflict(null);
    const link = await saveNewDriveFile(
      file,
      conflict.parentId,
      nativeFilename(file),
    );
    current.current = {
      ...current.current!,
      file: { ...current.current!.file, title } as SuiteFile,
      drive: link,
    };
    await storage.save(current.current);
    setRecord(current.current);
    setStatus("Saved a copy to SuiteDrive");
  };
  useEffect(() => {
    const unsub = window.suiteleaf?.onMenu((a) => void doAction(a));
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void doAction(e.shiftKey ? "save-as" : "save");
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.altKey &&
        e.shiftKey &&
        e.key.toLowerCase() === "h"
      ) {
        e.preventDefault();
        setHistoryOpen((open) => !open);
        setHistoryPreview(null);
      }
    };
    const unload = (e: BeforeUnloadEvent) => {
      if (version.current > savedVersion.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("keydown", key);
    window.addEventListener("beforeunload", unload);
    return () => {
      unsub?.();
      window.removeEventListener("keydown", key);
      window.removeEventListener("beforeunload", unload);
    };
  }, [doAction]);
  const exportNative = async () => {
    await actions.current?.flush();
    await exportText(
      nativeFilename(current.current!.file),
      serializeFile(current.current!.file),
      mimeFor(current.current!.file.kind),
    );
  };
  const makeCopy = async () => {
    await actions.current?.flush();
    await save();
    const copy = duplicateFile(current.current!.file);
    if (cluster) await createInDrive(copy, null, navigate);
    else navigate(`/file/${(await storage.save({ file: copy })).file.id}`);
  };
  /** In cluster mode files live in SuiteDrive, so downloads are copies. */
  const download = () =>
    void (cluster ? exportNative().then(() => true) : saveAs())
      .then((done) => {
        if (done && !cluster && !window.suiteleaf && alive.current)
          setStatus(`Downloaded “${nativeFilename(current.current!.file)}”`);
      })
      .catch((e) => setError(message(e)));
  const onActions = useCallback((a: EditorActions) => {
    actions.current = a;
    setActionsReady(true);
  }, []);
  if (locked)
    return (
      <div className="loading">
        <h2>Already open in another tab</h2>
        <p>Close the other editor before opening this file here.</p>
        <Link to="/">Return to files</Link>
      </div>
    );
  if (!record)
    return (
      <div className="loading">
        {error || "Opening your file…"}
        <p>
          <Link to="/">Return to files</Link>
        </p>
      </div>
    );
  const f = record.file;
  const starred = !!record.starred;
  return (
    <CommandPalette kind={f.kind}>
    <div className="workspace">
      <header className="workspace-header">
        <button
          className="back"
          aria-label="Back to files"
          onClick={() =>
            void save()
              .then(() => navigate("/"))
              .catch(() => {})
          }
        >
          <ArrowLeft size={20} />
        </button>
        <span className={`file-icon ${f.kind}`}>
          {f.kind === "doc" ? (
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z"
                fill="#4285F4"
              />
              <path d="M14 2V8H20L14 2Z" fill="#A1C2FA" />
              <path
                d="M8 12H16V13.6H8V12ZM8 15.2H16V16.8H8V15.2ZM8 18.4H13V20H8V18.4Z"
                fill="#FFFFFF"
              />
            </svg>
          ) : f.kind === "sheet" ? (
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z"
                fill="#0F9D58"
              />
              <path d="M14 2V8H20L14 2Z" fill="#87CEAC" />
              <path d="M8 11.5H16V18.5H8V11.5Z" fill="#0F9D58" />
              <path
                d="M8 11.5H16V18.5H8V11.5ZM8 13.8H16M8 16.2H16M12 11.5V18.5"
                stroke="#FFFFFF"
                strokeWidth="1.2"
              />
            </svg>
          ) : (
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z"
                fill="#F4B400"
              />
              <path d="M14 2V8H20L14 2Z" fill="#FCE293" />
              <rect
                x="7.5"
                y="11.5"
                width="9"
                height="7"
                rx="0.5"
                fill="#FFFFFF"
              />
            </svg>
          )}
        </span>
        <div className="title-block">
          <div className="title-top-row">
            <input
              aria-label="File title"
              value={f.title}
              maxLength={200}
              readOnly={!canEdit}
              onChange={(e) => changeTitle(e.target.value)}
            />
            {driveRole === "viewer" ? (
              <span className="view-only-badge">View only</span>
            ) : driveRole === "commenter" ? (
              <span className="view-only-badge">Can comment</span>
            ) : null}
            <button
              type="button"
              className={`doc-icon-btn star-btn ${starred ? "starred" : ""}`}
              aria-label={starred ? "Starred" : "Star document"}
              aria-pressed={starred}
              onClick={toggleStar}
              title={starred ? "Unstar" : "Star"}
            >
              <Star
                size={16}
                fill={starred ? "#fbbc04" : "none"}
                color={starred ? "#fbbc04" : "#5f6368"}
              />
            </button>
            <span className="save-status" role="status">
              {status.includes("Saved") ? <Check size={13} /> : null}
              {status}
            </span>
          </div>
          <div className="file-menu" role="menubar">
            <Menu label="File">
              <SubMenu label="New">
                <MenuItem onSelect={() => void doAction("new-doc")}>
                  Document
                </MenuItem>
                <MenuItem onSelect={() => void doAction("new-sheet")}>
                  Spreadsheet
                </MenuItem>
                <MenuItem onSelect={() => void doAction("new-slide")}>
                  Presentation
                </MenuItem>
                <MenuItem onSelect={() => void doAction("from-template")}>
                  From template
                </MenuItem>
              </SubMenu>
              {cluster ? (
                <>
                  <MenuItem onSelect={() => void doAction("open")}>
                    Open…
                  </MenuItem>
                  <MenuItem onSelect={() => setDriveDialog("save")}>
                    Save as…
                  </MenuItem>
                  <MenuItem disabled={!actionsReady} onSelect={download}>
                    Download a copy
                  </MenuItem>
                </>
              ) : (
                <MenuItem disabled={!actionsReady} onSelect={download}>
                  {window.suiteleaf
                    ? "Save As…"
                    : `Download SuiteLeaf file (.${extensionFor(f.kind)})`}
                </MenuItem>
              )}
              <MenuItem onSelect={() => void doAction("save")}>
                Save now
              </MenuItem>
              <MenuItem
                shortcut="Cmd+Alt+Shift+H"
                onSelect={() => {
                  setHistoryOpen((open) => !open);
                  setHistoryPreview(null);
                }}
              >
                Version history
              </MenuItem>
              <MenuItem
                disabled={!actionsReady}
                focusesTarget
                onSelect={() => {
                  void (async () => {
                    await actions.current?.flush();
                    await save();
                    if (current.current)
                      setTemplateDraft(structuredClone(current.current.file));
                  })().catch((e) => setError(message(e)));
                }}
              >
                Save as template
              </MenuItem>
              {window.suiteleaf && !cluster ? (
                <MenuItem
                  onSelect={() =>
                    void exportNative().catch((e) => setError(message(e)))
                  }
                  disabled={!actionsReady}
                >
                  Export native copy
                </MenuItem>
              ) : null}
              {(f.kind === "doc"
                ? ["docx", "html", "txt"]
                : f.kind === "sheet"
                  ? ["xlsx", "csv", "tsv"]
                  : ["txt", "html"]
              ).map((format) => (
                <MenuItem
                  key={format}
                  disabled={!actionsReady}
                  onSelect={() =>
                    void actions.current
                      ?.export(format)
                      .catch((e) => setError(message(e)))
                  }
                >
                  Export {format.toUpperCase()}
                </MenuItem>
              ))}
              <MenuItem
                onSelect={() =>
                  void makeCopy().catch((e) => setError(message(e)))
                }
              >
                Make a copy
              </MenuItem>
              {f.kind === "doc" ? (
                <MenuItem
                  disabled={!actionsReady}
                  focusesTarget
                  onSelect={() => actions.current?.docActions?.openPageSetup()}
                >
                  Page setup…
                </MenuItem>
              ) : null}
              <MenuItem onSelect={() => void doAction("print")}>
                Print / Save as PDF
              </MenuItem>
            </Menu>
            {f.kind === "doc" ? (
              <>
                <Menu label="Edit">
                  <MenuItem
                    shortcut="Cmd+Z"
                    onSelect={() => actions.current?.docActions?.undo()}
                  >
                    Undo
                  </MenuItem>
                  <MenuItem
                    shortcut="Cmd+Y"
                    onSelect={() => actions.current?.docActions?.redo()}
                  >
                    Redo
                  </MenuItem>
                  <MenuItem
                    shortcut="Cmd+Shift+H"
                    onSelect={() => actions.current?.docActions?.openFind()}
                  >
                    Find and replace
                  </MenuItem>
                  <MenuItem
                    shortcut="Cmd+A"
                    onSelect={() => actions.current?.docActions?.selectAll()}
                  >
                    Select all
                  </MenuItem>
                </Menu>
                <Menu label="View">
                  <MenuItem onSelect={() => void doAction("print")}>
                    Print layout
                  </MenuItem>
                </Menu>
                <Menu label="Insert">
                  <MenuItem
                    onSelect={() => actions.current?.docActions?.insertImage()}
                  >
                    Image
                  </MenuItem>
                  <MenuItem
                    onSelect={() => actions.current?.docActions?.insertTable()}
                  >
                    Table
                  </MenuItem>
                  <MenuItem
                    onSelect={() =>
                      actions.current?.docActions?.insertHorizontalRule()
                    }
                  >
                    Horizontal line
                  </MenuItem>
                  <MenuItem
                    shortcut="Cmd+Enter"
                    focusesTarget
                    onSelect={() =>
                      actions.current?.docActions?.insertPageBreak()
                    }
                  >
                    Page break
                  </MenuItem>
                  <SubMenu label="Table of contents">
                    <MenuItem
                      synonyms={[
                        "table of contents",
                        "toc",
                        "contents",
                        "insert table of contents",
                      ]}
                      focusesTarget
                      onSelect={() =>
                        actions.current?.docActions?.insertTableOfContents(true)
                      }
                    >
                      With page numbers
                    </MenuItem>
                    <MenuItem
                      focusesTarget
                      onSelect={() =>
                        actions.current?.docActions?.insertTableOfContents(
                          false,
                        )
                      }
                    >
                      With links
                    </MenuItem>
                  </SubMenu>
                  <MenuItem
                    shortcut="Cmd+Alt+F"
                    synonyms={["footnote", "footnotes", "insert footnote"]}
                    focusesTarget
                    onSelect={() =>
                      actions.current?.docActions?.insertFootnote()
                    }
                  >
                    Footnote
                  </MenuItem>
                  <MenuItem
                    focusesTarget
                    onSelect={() =>
                      actions.current?.docActions?.insertEndnote()
                    }
                  >
                    Endnote
                  </MenuItem>
                  <MenuItem
                    shortcut="Cmd+K"
                    availability={() => {
                      const state = actions.current?.docActions?.linkState?.();
                      return !state || state.ok ? true : state.reason;
                    }}
                    onSelect={() => actions.current?.docActions?.insertLink()}
                  >
                    Link
                  </MenuItem>
                  <MenuItem
                    shortcut="Cmd+Alt+M"
                    synonyms={["comment", "comments", "document comments"]}
                    focusesTarget
                    onSelect={() => actions.current?.docActions?.insertComment?.()}
                  >
                    Comment
                  </MenuItem>
                </Menu>
                <Menu label="Format">
                  <MenuItem
                    shortcut="Cmd+B"
                    onSelect={() => actions.current?.docActions?.toggleBold()}
                  >
                    Bold
                  </MenuItem>
                  <MenuItem
                    shortcut="Cmd+I"
                    onSelect={() => actions.current?.docActions?.toggleItalic()}
                  >
                    Italic
                  </MenuItem>
                  <MenuItem
                    shortcut="Cmd+U"
                    onSelect={() =>
                      actions.current?.docActions?.toggleUnderline()
                    }
                  >
                    Underline
                  </MenuItem>
                  <MenuItem
                    shortcut="Cmd+Shift+X"
                    onSelect={() => actions.current?.docActions?.toggleStrike()}
                  >
                    Strikethrough
                  </MenuItem>
                  <MenuItem
                    shortcut="Cmd+."
                    onSelect={() =>
                      actions.current?.docActions?.toggleSuperscript()
                    }
                  >
                    Superscript
                  </MenuItem>
                  <MenuItem
                    shortcut="Cmd+,"
                    onSelect={() =>
                      actions.current?.docActions?.toggleSubscript()
                    }
                  >
                    Subscript
                  </MenuItem>
                  <MenuItem
                    onSelect={() => actions.current?.docActions?.align("left")}
                  >
                    Align left
                  </MenuItem>
                  <MenuItem
                    onSelect={() =>
                      actions.current?.docActions?.align("center")
                    }
                  >
                    Align center
                  </MenuItem>
                  <MenuItem
                    onSelect={() => actions.current?.docActions?.align("right")}
                  >
                    Align right
                  </MenuItem>
                  <MenuItem
                    onSelect={() =>
                      actions.current?.docActions?.align("justify")
                    }
                  >
                    Justify
                  </MenuItem>
                  <MenuItem
                    onSelect={() =>
                      actions.current?.docActions?.toggleBulletList()
                    }
                  >
                    Bulleted list
                  </MenuItem>
                  <MenuItem
                    onSelect={() =>
                      actions.current?.docActions?.toggleOrderedList()
                    }
                  >
                    Numbered list
                  </MenuItem>
                  <SubMenu label="Table">
                    <TableMenuItems
                      actions={() =>
                        actions.current?.docActions?.tableActions() ?? []
                      }
                    />
                  </SubMenu>
                  <MenuItem
                    shortcut="Cmd+\"
                    onSelect={() =>
                      actions.current?.docActions?.clearFormatting()
                    }
                  >
                    Clear formatting
                  </MenuItem>
                </Menu>
                <Menu label="Tools">
                  <MenuItem
                    shortcut="Cmd+Shift+C"
                    synonyms={[
                      "count",
                      "word count",
                      "wordcount",
                      "count words",
                      "words",
                    ]}
                    focusesTarget
                    onSelect={() =>
                      actions.current?.docActions?.openWordCount()
                    }
                  >
                    Word count
                  </MenuItem>
                  <MenuItem
                    synonyms={["spelling", "spell check", "spellcheck"]}
                    focusesTarget
                    onSelect={() => actions.current?.docActions?.openSpelling()}
                  >
                    Spelling
                  </MenuItem>
                  <MenuItem
                    focusesTarget
                    onSelect={() =>
                      actions.current?.docActions?.openDictionary()
                    }
                  >
                    Personal dictionary
                  </MenuItem>
                  <MenuItem
                    onSelect={() => actions.current?.docActions?.openFind()}
                  >
                    Find and replace
                  </MenuItem>
                  <MenuItem
                    onSelect={() =>
                      actions.current?.docActions?.openSuggestions?.()
                    }
                  >
                    Review suggestions
                  </MenuItem>
                </Menu>
                <EditorHelp />
              </>
            ) : null}
            {f.kind === "sheet" ? (
              <>
                <Menu label="Edit">
                  <MenuItem
                    shortcut="Cmd+Z"
                    onSelect={() => actions.current?.sheetActions?.undo()}
                  >
                    Undo
                  </MenuItem>
                  <MenuItem
                    shortcut="Cmd+Y"
                    onSelect={() => actions.current?.sheetActions?.redo()}
                  >
                    Redo
                  </MenuItem>
                  <MenuItem
                    shortcut="Cmd+X"
                    onSelect={() => actions.current?.sheetActions?.cut()}
                  >
                    Cut
                  </MenuItem>
                  <MenuItem
                    shortcut="Cmd+C"
                    onSelect={() => actions.current?.sheetActions?.copy()}
                  >
                    Copy
                  </MenuItem>
                  <MenuItem
                    shortcut="Cmd+V"
                    onSelect={() => actions.current?.sheetActions?.paste()}
                  >
                    Paste
                  </MenuItem>
                  <MenuItem
                    shortcut="Delete"
                    onSelect={() =>
                      actions.current?.sheetActions?.deleteValues()
                    }
                  >
                    Delete values
                  </MenuItem>
                </Menu>
                <Menu label="View">
                  <SheetViewMenu
                    actions={actions}
                    onPrint={() => void doAction("print")}
                  />
                </Menu>
                <Menu label="Insert">
                  <MenuItem
                    onSelect={() =>
                      actions.current?.sheetActions?.insertImage?.()
                    }
                  >
                    Image
                  </MenuItem>
                  <MenuItem
                    onSelect={() =>
                      actions.current?.sheetActions?.insertChart()
                    }
                  >
                    Chart
                  </MenuItem>
                  <MenuItem
                    onSelect={() =>
                      actions.current?.sheetActions?.insertPivot()
                    }
                  >
                    Pivot table
                  </MenuItem>
                  <SubMenu label="Function">
                    <MenuItem
                      synonyms={["function", "formula", "insert function", "sum"]}
                      onSelect={() =>
                        actions.current?.sheetActions?.insertFunction?.("SUM")
                      }
                    >
                      Insert function
                    </MenuItem>
                    <FunctionMenu
                      onInsert={(name) =>
                        actions.current?.sheetActions?.insertFunction?.(name)
                      }
                    />
                  </SubMenu>
                  <MenuItem shortcut="Cmd+K" onSelect={() => {}}>
                    Link
                  </MenuItem>
                  <MenuItem
                    onSelect={() =>
                      actions.current?.sheetActions?.insertCheckbox?.()
                    }
                  >
                    Checkbox
                  </MenuItem>
                  <MenuItem
                    onSelect={() =>
                      actions.current?.sheetActions?.insertDropdown?.()
                    }
                  >
                    Dropdown
                  </MenuItem>
                  <MenuItem
                    onSelect={() =>
                      actions.current?.sheetActions?.insertComment?.()
                    }
                  >
                    Cell comment
                  </MenuItem>
                </Menu>
                <Menu label="Format">
                  <MenuItem
                    onSelect={() =>
                      actions.current?.sheetActions?.formatCurrency()
                    }
                  >
                    Currency ($)
                  </MenuItem>
                  <MenuItem
                    onSelect={() =>
                      actions.current?.sheetActions?.formatPercent()
                    }
                  >
                    Percent (%)
                  </MenuItem>
                  <MenuItem
                    shortcut="Cmd+B"
                    onSelect={() => actions.current?.sheetActions?.toggleBold()}
                  >
                    Bold
                  </MenuItem>
                  <MenuItem
                    shortcut="Cmd+I"
                    onSelect={() =>
                      actions.current?.sheetActions?.toggleItalic()
                    }
                  >
                    Italic
                  </MenuItem>
                  <MenuItem
                    shortcut="Cmd+Shift+X"
                    onSelect={() =>
                      actions.current?.sheetActions?.toggleStrike()
                    }
                  >
                    Strikethrough
                  </MenuItem>
                  <MenuItem
                    onSelect={() =>
                      actions.current?.sheetActions?.align("left")
                    }
                  >
                    Align left
                  </MenuItem>
                  <MenuItem
                    onSelect={() =>
                      actions.current?.sheetActions?.align("center")
                    }
                  >
                    Align center
                  </MenuItem>
                  <MenuItem
                    onSelect={() =>
                      actions.current?.sheetActions?.align("right")
                    }
                  >
                    Align right
                  </MenuItem>
                  <MenuItem
                    shortcut="Cmd+\"
                    onSelect={() =>
                      actions.current?.sheetActions?.clearFormatting()
                    }
                  >
                    Clear formatting
                  </MenuItem>
                  <MenuItem
                    onSelect={() =>
                      actions.current?.sheetActions?.conditionalFormatting?.()
                    }
                  >
                    Conditional formatting
                  </MenuItem>
                </Menu>
                <Menu label="Data">
                  <MenuItem
                    searchLabel="Create a filter"
                    onSelect={() =>
                      actions.current?.sheetActions?.toggleFilter()
                    }
                  >
                    <LiveLabel
                      text={() =>
                        actions.current?.sheetActions?.hasFilter?.()
                          ? "Remove filter"
                          : "Create a filter"
                      }
                    />
                  </MenuItem>
                  <MenuItem
                    onSelect={() =>
                      actions.current?.sheetActions?.insertPivot()
                    }
                  >
                    Pivot table
                  </MenuItem>
                  <MenuItem
                    onSelect={() =>
                      actions.current?.sheetActions?.sortRange?.()
                    }
                  >
                    Sort range
                  </MenuItem>
                  <SubMenu label="Data cleanup">
                    <MenuItem
                      onSelect={() =>
                        actions.current?.sheetActions?.trimWhitespace?.()
                      }
                    >
                      Trim whitespace
                    </MenuItem>
                    <MenuItem
                      synonyms={[
                        "remove duplicates",
                        "dedupe",
                        "duplicates",
                        "unique",
                      ]}
                      focusesTarget
                      onSelect={() =>
                        actions.current?.sheetActions?.removeDuplicates?.()
                      }
                    >
                      Remove duplicates
                    </MenuItem>
                  </SubMenu>
                  <MenuItem
                    focusesTarget
                    onSelect={() =>
                      actions.current?.sheetActions?.splitTextToColumns?.()
                    }
                  >
                    Split text to columns
                  </MenuItem>
                  <MenuItem
                    onSelect={() =>
                      actions.current?.sheetActions?.dataValidation?.()
                    }
                  >
                    Data validation
                  </MenuItem>
                  <MenuItem
                    onSelect={() =>
                      actions.current?.sheetActions?.tabsProtection?.()
                    }
                  >
                    Protect sheets and ranges
                  </MenuItem>
                </Menu>
                <Menu label="Tools">
                  <MenuItem onSelect={() => {}}>Spelling</MenuItem>
                </Menu>
                <EditorHelp />
              </>
            ) : null}
            {f.kind === "slide" ? (
              <>
                <Menu label="Edit">
                  <MenuItem
                    shortcut="Cmd+Z"
                    availability={() =>
                      actions.current?.slideActions?.undoReason?.() ?? true
                    }
                    onSelect={() => actions.current?.slideActions?.undo()}
                  >
                    Undo
                  </MenuItem>
                  <MenuItem
                    shortcut="Cmd+Y"
                    availability={() =>
                      actions.current?.slideActions?.redoReason?.() ?? true
                    }
                    onSelect={() => actions.current?.slideActions?.redo()}
                  >
                    Redo
                  </MenuItem>
                  <MenuItem
                    shortcut="Cmd+X"
                    onSelect={() => actions.current?.slideActions?.cut()}
                  >
                    Cut
                  </MenuItem>
                  <MenuItem
                    shortcut="Cmd+C"
                    onSelect={() => actions.current?.slideActions?.copy()}
                  >
                    Copy
                  </MenuItem>
                  <MenuItem
                    shortcut="Cmd+V"
                    onSelect={() => actions.current?.slideActions?.paste()}
                  >
                    Paste
                  </MenuItem>
                </Menu>
                <Menu label="View">
                  <MenuItem
                    shortcut="Cmd+Enter"
                    onSelect={() => void actions.current?.present?.()}
                  >
                    Slideshow
                  </MenuItem>
                  <MenuItem onSelect={() => void actions.current?.print()}>
                    Print preview
                  </MenuItem>
                </Menu>
                <Menu label="Insert">
                  <MenuItem
                    synonyms={["text box", "insert text box", "textbox"]}
                    focusesTarget
                    onSelect={() =>
                      actions.current?.slideActions?.insertTextBox()
                    }
                  >
                    Text box
                  </MenuItem>
                  <MenuItem
                    synonyms={["image", "insert image", "picture", "photo"]}
                    onSelect={() =>
                      actions.current?.slideActions?.insertImage()
                    }
                  >
                    Image
                  </MenuItem>
                  <SubMenu label="Shape">
                    <MenuItem
                      synonyms={["shape", "insert shape", "rectangle"]}
                      onSelect={() =>
                        actions.current?.slideActions?.insertShape("rect")
                      }
                    >
                      Rectangle
                    </MenuItem>
                    <MenuItem
                      onSelect={() =>
                        actions.current?.slideActions?.insertShape("roundRect")
                      }
                    >
                      Rounded rectangle
                    </MenuItem>
                    <MenuItem
                      onSelect={() =>
                        actions.current?.slideActions?.insertShape("ellipse")
                      }
                    >
                      Ellipse
                    </MenuItem>
                  </SubMenu>
                  <MenuItem
                    shortcut="Cmd+M"
                    onSelect={() => actions.current?.slideActions?.newSlide()}
                  >
                    New slide
                  </MenuItem>
                </Menu>
                <Menu label="Format">
                  <SubMenu label="Text">
                    <MenuItem
                      shortcut="Cmd+B"
                      onSelect={() =>
                        actions.current?.slideActions?.toggleBold()
                      }
                    >
                      Bold
                    </MenuItem>
                    <MenuItem
                      shortcut="Cmd+I"
                      onSelect={() =>
                        actions.current?.slideActions?.toggleItalic()
                      }
                    >
                      Italic
                    </MenuItem>
                  </SubMenu>
                  <SubMenu label="Align & indent">
                    <MenuItem
                      onSelect={() =>
                        actions.current?.slideActions?.align("left")
                      }
                    >
                      Align left
                    </MenuItem>
                    <MenuItem
                      onSelect={() =>
                        actions.current?.slideActions?.align("center")
                      }
                    >
                      Center
                    </MenuItem>
                    <MenuItem
                      onSelect={() =>
                        actions.current?.slideActions?.align("right")
                      }
                    >
                      Align right
                    </MenuItem>
                  </SubMenu>
                </Menu>
                <Menu label="Slide">
                  <MenuItem
                    shortcut="Cmd+M"
                    onSelect={() => actions.current?.slideActions?.newSlide()}
                  >
                    New slide
                  </MenuItem>
                  <MenuItem
                    shortcut="Cmd+D"
                    onSelect={() => actions.current?.slideActions?.duplicate()}
                  >
                    Duplicate slide
                  </MenuItem>
                  <MenuItem
                    shortcut="Delete"
                    availability={() =>
                      actions.current?.slideActions?.deleteReason?.() ?? true
                    }
                    onSelect={() =>
                      actions.current?.slideActions?.deleteSlides()
                    }
                  >
                    Delete slide
                  </MenuItem>
                  <MenuItem
                    shortcut="Cmd+Up"
                    onSelect={() =>
                      actions.current?.slideActions?.move("up")
                    }
                  >
                    Move up
                  </MenuItem>
                  <MenuItem
                    shortcut="Cmd+Down"
                    onSelect={() =>
                      actions.current?.slideActions?.move("down")
                    }
                  >
                    Move down
                  </MenuItem>
                  <MenuItem
                    shortcut="Cmd+Shift+Up"
                    onSelect={() =>
                      actions.current?.slideActions?.move("start")
                    }
                  >
                    Move to start
                  </MenuItem>
                  <MenuItem
                    shortcut="Cmd+Shift+Down"
                    onSelect={() =>
                      actions.current?.slideActions?.move("end")
                    }
                  >
                    Move to end
                  </MenuItem>
                  <SubMenu label="Apply layout">
                    <MenuItem
                      onSelect={() =>
                        actions.current?.slideActions?.applyLayout("title")
                      }
                    >
                      Title slide
                    </MenuItem>
                    <MenuItem
                      onSelect={() =>
                        actions.current?.slideActions?.applyLayout("title-body")
                      }
                    >
                      Title & body
                    </MenuItem>
                    <MenuItem
                      onSelect={() =>
                        actions.current?.slideActions?.applyLayout("two-column")
                      }
                    >
                      Two columns
                    </MenuItem>
                    <MenuItem
                      onSelect={() =>
                        actions.current?.slideActions?.applyLayout("section")
                      }
                    >
                      Section header
                    </MenuItem>
                    <MenuItem
                      onSelect={() =>
                        actions.current?.slideActions?.applyLayout("blank")
                      }
                    >
                      Blank slide
                    </MenuItem>
                  </SubMenu>
                  <MenuItem
                    onSelect={() => actions.current?.slideActions?.openTheme()}
                  >
                    Change theme
                  </MenuItem>
                  <MenuItem
                    onSelect={() =>
                      actions.current?.slideActions?.openTransition()
                    }
                  >
                    Transition
                  </MenuItem>
                </Menu>
                <Menu label="Tools">
                  <MenuItem onSelect={() => {}}>Spelling</MenuItem>
                </Menu>
                <EditorHelp />
              </>
            ) : null}
          </div>
        </div>
        <div className="header-right-tools">
          <button
            type="button"
            className="doc-icon-btn"
            title="Version history"
            aria-label="Version history"
            aria-expanded={historyOpen}
            aria-keyshortcuts="Control+Alt+Shift+H"
            onClick={() => {
              setHistoryOpen((open) => !open);
              setHistoryPreview(null);
            }}
          >
            <Clock size={18} />
          </button>
          <button
            type="button"
            className="doc-icon-btn"
            title="Comments"
            aria-label="Comments"
            onClick={() => {
              actions.current?.docActions?.openComments?.();
              actions.current?.sheetActions?.openComments?.();
            }}
          >
            <MessageSquare size={18} />
          </button>
          {cluster && record.drive ? (
            <button
              type="button"
              className="share-btn"
              onClick={() => setShareOpen(true)}
            >
              Share
            </button>
          ) : null}
          {mode.kind === "cluster" ? (
            <span
              className="workspace-brand workspace-server"
              title={`Saving to SuiteDrive on ${new URL(mode.serverUrl).host}`}
            >
              <Cloud size={16} />
              {new URL(mode.serverUrl).host}
            </span>
          ) : (
            <span className="workspace-brand">
              <Leaf size={16} />
              SuiteLeaf
            </span>
          )}
          <button
            className="save-copy"
            disabled={!actionsReady}
            onClick={download}
            title={
              window.suiteleaf && !cluster
                ? `Save to a .${extensionFor(f.kind)} file`
                : `Download “${nativeFilename(f)}”, a SuiteLeaf file you can open again with Open / import`
            }
          >
            <Download size={16} />
            {window.suiteleaf && !cluster ? "Save As" : "Download"}
          </button>
        </div>
      </header>
      {error ? (
        <div className="error" role="alert">
          <CircleAlert size={18} />
          {error}
          <button onClick={() => void save().catch(() => {})}>
            Retry save
          </button>
          {cluster ? null : (
            <button onClick={() => void saveAs()}>Save As</button>
          )}
          <button
            onClick={() => {
              if (
                window.confirm(
                  "Reload the saved file and discard unsaved edits?",
                )
              )
                void storage
                  .reload(id!)
                  .then((r) => {
                    if (r) {
                      current.current = r;
                      version.current = savedVersion.current = 0;
                      window.location.reload();
                    }
                  })
                  .catch((e) => setError(message(e)));
            }}
          >
            Reload saved
          </button>
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            ×
          </button>
        </div>
      ) : null}
      {driveConflict ? (
        <div className="error drive-conflict" role="alert">
          <CircleAlert size={18} />
          <span className="drive-conflict-text">
            <strong>
              This file was changed in SuiteDrive after you opened it.
            </strong>{" "}
            {savedWhen(driveConflict.updatedAt)} Your edits weren't uploaded and
            are safe on this device. Save them as a copy to keep both versions,
            or reload the SuiteDrive version and discard your edits.
          </span>
          <span className="drive-conflict-actions">
            <button
              title="Upload your edits as a new file and leave the SuiteDrive version as it is"
              onClick={() =>
                void saveDriveCopy().catch((e) => setError(message(e)))
              }
            >
              Save as copy
            </button>
            <button
              title="Discard your edits and open the newer SuiteDrive version"
              onClick={() => {
                if (
                  window.confirm(
                    "Discard your edits and open the newer version from SuiteDrive? Your edits will be lost.",
                  )
                )
                  void reloadFromDrive().catch((e) => setError(message(e)));
              }}
            >
              Reload from SuiteDrive
            </button>
          </span>
        </div>
      ) : null}
      {shareOpen && record.drive ? (
        <ShareDialog
          itemId={record.drive.itemId}
          itemName={f.title}
          onClose={() => setShareOpen(false)}
        />
      ) : null}
      {templateDraft ? (
        <SaveTemplateDialog
          file={templateDraft}
          onClose={() => setTemplateDraft(null)}
          onSaved={(name) => {
            setTemplateDraft(null);
            setStatus(`Saved as template “${name}”`);
          }}
        />
      ) : null}
      {driveDialog ? (
        <DriveBrowser
          mode={driveDialog}
          defaultName={driveName(f.title, f.kind)}
          onClose={() => setDriveDialog(null)}
          onOpen={async (item) => {
            await save();
            setDriveDialog(null);
            await openFromDrive(item, navigate);
          }}
          onSave={(folderId, name) =>
            saveToDrive(folderId, name).catch((e) => {
              setError(message(e));
              setDriveDialog(null);
            })
          }
        />
      ) : null}
      {f.importInfo ? (
        <details className="import-notes">
          <summary>
            Imported {f.importInfo.sourceFormat.toUpperCase()}:{" "}
            {f.importInfo.sourceName}
            {importFeatureLine(f.importInfo.warnings)
              ? ` · ${importFeatureLine(f.importInfo.warnings)}`
              : ""}
            {importCompatibilityNotes(f.importInfo.warnings).length
              ? ` · ${importCompatibilityNotes(f.importInfo.warnings).length} compatibility ${importCompatibilityNotes(f.importInfo.warnings).length === 1 ? "note" : "notes"}`
              : ""}
          </summary>
          {importCompatibilityNotes(f.importInfo.warnings).length ? (
            <ul>
              {importCompatibilityNotes(f.importInfo.warnings).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          ) : (
            <p>
              Supported content was imported into an editable SuiteLeaf copy.
            </p>
          )}
        </details>
      ) : null}
      <div className={`editor-and-history${historyOpen ? " history-open" : ""}`}>
        <div className="editor-and-history-main">
          {historyPreview ? (
            <VersionPreview
              key={JSON.stringify(historyPreview.content)}
              content={historyPreview.content}
              label={historyPreview.label}
              offers={historyPreview.offers}
              onRestoreParagraph={(key) => restoreParagraph.current(key)}
            />
          ) : null}
          <div
            className={`live-editor${historyPreview ? " previewing" : ""}`}
            inert={historyPreview ? true : undefined}
          >
            <ErrorBoundary>
              <Suspense
                fallback={
                  <div className="loading">
                    Opening{" "}
                    {f.kind === "doc"
                      ? "document"
                      : f.kind === "sheet"
                        ? "spreadsheet"
                        : "presentation"}{" "}
                    editor…
                  </div>
                }
              >
                {f.kind === "doc" ? (
                  <Docs
                    key={`${id}:${editorEpoch}`}
                    file={f as DocFile}
                    readOnly={!canEdit}
                    onChange={update}
                    onActions={onActions}
                    onError={setError}
                  />
                ) : f.kind === "sheet" ? (
                  <Sheets
                    key={`${id}:${editorEpoch}`}
                    file={f as SheetFile}
                    onChange={update}
                    onActions={onActions}
                    onError={setError}
                  />
                ) : (
                  <Slides
                    key={`${id}:${editorEpoch}`}
                    file={f as SlideFile}
                    onChange={update}
                    onActions={onActions}
                    onError={setError}
                  />
                )}
              </Suspense>
            </ErrorBoundary>
          </div>
        </div>
        {historyOpen ? (
          <VersionHistory
            record={record}
            getFile={() => current.current?.file ?? record.file}
            onClose={() => {
              setHistoryOpen(false);
              setHistoryPreview(null);
            }}
            onPreview={(content, label, offers) =>
              setHistoryPreview(
                content ? { content, label, offers: offers ?? null } : null,
              )
            }
            bindParagraphRestore={restoreParagraph}
            onStatus={setStatus}
            onRestored={(next) => {
              clearTimeout(timer.current);
              clearTimeout(driveTimer.current);
              current.current = next;
              version.current = 0;
              savedVersion.current = 0;
              setRecord(next);
              setEditorEpoch((epoch) => epoch + 1);
              setHistoryPreview(null);
              setHistoryOpen(false);
              setStatus(
                next.drive ? "Saved to SuiteDrive" : "Saved on this device",
              );
              void storage.save(next).catch((e) => setError(message(e)));
            }}
          />
        ) : null}
      </div>
    </div>
    </CommandPalette>
  );
}
const handledTokens = new Set<string>();
function AuthComplete() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { mode } = useMode();
  const [error, setError] = useState("");
  useEffect(() => {
    const token = params.get("token");
    if (!token) {
      void navigate("/", { replace: true });
      return;
    }
    if (handledTokens.has(token)) return;
    handledTokens.add(token);
    const server =
      pendingHandoffUrl() ?? (mode.kind === "cluster" ? mode.serverUrl : null);
    if (!server) {
      setError("This app is not connected to a SuiteLeaf server.");
      return;
    }
    completeHandoff(server, token)
      .then(() => navigate("/", { replace: true }))
      .catch((e) => setError(message(e)));
  }, [params, navigate, mode]);
  return (
    <div className="loading">
      {error ? (
        <>
          <h2>Sign-in did not complete</h2>
          <p>{error}</p>
          <Link to="/">Return to files</Link>
        </>
      ) : (
        "Signing you in…"
      )}
    </div>
  );
}
function FileRoute() {
  const { id } = useParams();
  return <Workspace key={id} />;
}
/** Cluster mode requires a session with this server. */
function ClusterGate({ children }: { children: ReactNode }) {
  const { mode, locked } = useMode();
  const session = useNodeSession();
  const cluster = mode.kind === "cluster";
  useEffect(
    () =>
      cluster
        ? window.suiteleaf?.onMenu((action) => {
            if (action === "disconnect" && mode.kind === "cluster")
              void disconnectFromServer(mode.serverUrl).catch((e) =>
                window.alert(message(e)),
              );
          })
        : undefined,
    [cluster],
  );
  if (mode.kind !== "cluster" || session?.url === mode.serverUrl)
    return <>{children}</>;
  return (
    <SignInScreen
      serverUrl={mode.serverUrl}
      onDisconnect={
        locked || mode.kind !== "cluster"
          ? undefined
          : () => disconnectFromServer(mode.serverUrl)
      }
    />
  );
}
export default function App() {
  const [mode, setMode] = useState<ResolvedMode>();
  useEffect(() => {
    void finishSignOut();
    void resolveMode().then(setMode);
  }, []);
  if (!mode) return <div className="loading">Opening SuiteLeaf…</div>;
  return (
    <ModeContext.Provider value={mode}>
      <HashRouter>
        <Routes>
          <Route path="/auth-complete" element={<AuthComplete />} />
          <Route
            path="/templates"
            element={
              <ClusterGate>
                <TemplateGallery />
              </ClusterGate>
            }
          />
          <Route
            path="/file/:id"
            element={
              <ClusterGate>
                <FileRoute />
              </ClusterGate>
            }
          />
          <Route
            path="*"
            element={
              <ClusterGate>
                <Home />
              </ClusterGate>
            }
          />
        </Routes>
      </HashRouter>
    </ModeContext.Provider>
  );
}
