import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  Component,
  type ReactNode,
  type RefObject,
} from "react";
import {
  HashRouter,
  Link,
  Route,
  Routes,
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
  Copy,
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
  Pencil,
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
  serializeFile,
  type SuiteFile,
  type FileRecord,
  type DocFile,
  type SheetFile,
  type SlideFile,
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
import { SheetViewMenu } from "./editors/SheetViewMenu";
import {
  DriveConflict,
  getSession,
  openDriveFile,
  pendingHandoffUrl,
  saveNewDriveFile,
  signOut,
  uploadDriveFile,
  type DriveItem,
} from "./node-client";
import { DriveBrowser, DriveDialog, NameDialog } from "./drive/DriveBrowser";
import { searchFile } from "./library-search";
import { ConnectDialog, SignInScreen, useNodeSession } from "./drive/SignIn";
import { formatModified, syncSummary, useServerSync } from "./drive/status";
import { completeHandoff } from "./node-client";
import {
  ModeContext,
  disconnect,
  forgetLeftServer,
  leftServer,
  resolveMode,
  useMode,
  probeServer,
  switchMode,
  type ResolvedMode,
} from "./mode";
import { useAgentHost } from "./ai/host";
import { AiButton, AgentLayer } from "./ai/AgentSidebar";
import {
  homeSnapshot,
  homeTools,
  workspaceSnapshot,
  workspaceTools,
  type HomeAgentContext,
  type WorkspaceAgentContext,
} from "./ai/tools/files";
import {
  conflictTools,
  connectTools,
  driveSnapshot,
  driveTools,
  type DriveAgentContext,
} from "./ai/tools/cluster";
import type { DriveControl } from "./drive/DriveBrowser";
const Docs = lazy(() => import("./editors/Docs")),
  Sheets = lazy(() => import("./editors/Sheets")),
  Slides = lazy(() => import("./editors/Slides"));
function message(e: unknown) {
  return e instanceof Error ? e.message : String(e);
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
  importer,
}: {
  /** `name` is the chosen file's name when it came from the file picker. */
  onImport: (r: FileRecord, name?: string) => Promise<void>;
  onError: (s: string) => void;
  /** Always use the browser file picker, even on desktop. */
  filePicker?: boolean;
  /** Receives a function that imports a chosen file the same way the picker does. */
  importer?: RefObject<((f: File) => Promise<void>) | null>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [review, setReview] = useState<{
    draft: DelimitedDraft;
    resolve: (options: DelimitedOptions | null) => void;
  } | null>(null);
  const importChosen = async (f: File) => {
    setImporting(true);
    try {
      const file = await importFile(
        f,
        (draft) => new Promise((resolve) => setReview({ draft, resolve })),
      );
      if (file) await onImport({ file }, f.name);
    } catch (e) {
      onError(message(e));
    } finally {
      setImporting(false);
    }
  };
  if (importer) importer.current = importChosen;
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
          if (f) await importChosen(f);
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
    [filter, setFilter] = useState("all"),
    [sort, setSort] = useState<{ by: "name" | "edited"; desc: boolean }>({
      by: "edited",
      desc: true,
    }),
    [asking, setAsking] = useState<{
      action: "rename" | "remove";
      record: FileRecord;
    } | null>(null),
    [sameFile, setSameFile] = useState<{
      name: string;
      existing: FileRecord;
      incoming: FileRecord;
    } | null>(null);
  const refresh = useCallback(
    () =>
      storage
        .list()
        // Cached copies of server files belong to cluster mode.
        .then((all) => setRecords(all.filter((r) => !r.drive)))
        .catch((e) => setError(message(e))),
    [],
  );
  useEffect(() => {
    void refresh();
    // The assistant's "Undo all of this" puts files back behind the list's back.
    const changed = () => void refresh();
    window.addEventListener("suiteleaf:library-changed", changed);
    return () => window.removeEventListener("suiteleaf:library-changed", changed);
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
      if (!name) {
        // The desktop store leaves a different version in the library alone.
        const existing = r.path ? await storage.get(r.file.id) : undefined;
        if (
          existing &&
          !existing.drive &&
          existing.path !== r.path &&
          serializeFile(existing.file) !== serializeFile(r.file)
        )
          setSameFile({
            name: r.path!.split(/[\\/]/).pop()!,
            existing,
            incoming: r,
          });
        else await open(r);
        return;
      }
      const existing =
        r.path || r.recovery ? undefined : await storage.get(r.file.id);
      if (!existing || existing.drive || existing.path)
        return open(r, `Opened “${name}”`);
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
          .then((r) => r && importRecord(r))
          .catch((e) => setError(message(e)));
    },
    [make, importRecord],
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
  const searching = query.trim() !== "",
    kindLabel =
      filter === "all"
        ? "Your files"
        : filter === "doc"
          ? "Documents"
          : filter === "sheet"
            ? "Spreadsheets"
            : "Presentations",
    heading = !searching
      ? kindLabel
      : filter === "all"
        ? `Results for “${query.trim()}”`
        : `${kindLabel} matching “${query.trim()}”`;
  const shown = records
    .filter((r) => filter === "all" || r.file.kind === filter)
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
  const importer = useRef<((f: File) => Promise<void>) | null>(null);
  useAgentHost("home", () => {
    const ctx: HomeAgentContext = {
      records,
      shown: shown.map((s) => s.r),
      query,
      filter,
      setQuery,
      setFilter,
      setSort,
      create: (kind, title) => open({ file: createFile(kind, title) }),
      open: (r) => navigate(`/file/${r.file.id}`),
      openSample: (kind) =>
        void open({
          file: (kind === "doc" ? sampleDoc : kind === "sheet" ? sampleSheet : sampleSlide)(),
        }),
      rename,
      duplicate: async (r) => {
        const copy = await storage.save({ file: duplicateFile(r.file) });
        await refresh();
        return copy;
      },
      showRemove: (record) => setAsking({ action: "remove", record }),
      remove: async (r) => {
        setAsking(null);
        await storage.remove(r.file.id);
        await refresh();
      },
      importFile: async (f) => {
        if (!importer.current) throw new Error("Clear the search to import a file.");
        await importer.current(f);
      },
    };
    return {
      kind: "home",
      snapshot: () => homeSnapshot(ctx),
      tools: [
        ...homeTools(ctx),
        ...(locked
          ? []
          : connectTools({
              probe: probeServer,
              connect: (serverUrl) => switchMode({ kind: "cluster", serverUrl }),
            })),
      ],
    };
  });
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
          <AiButton />
        </header>
        <LeftServerNotice />
        {searching ? null : (
          <>
            <section className="welcome">
              <p className="eyebrow">YOUR EVERYDAY WORKSPACE</p>
              <h1>Good ideas start here.</h1>
              <p>Write something. Work out the numbers. Make it yours.</p>
            </section>
            <NewCards onCreate={make} />
          </>
        )}
        <ErrorBanner error={error} onDismiss={() => setError("")} />
        {connecting ? (
          <ConnectDialog onClose={() => setConnecting(false)} />
        ) : null}
        <section className={`file-section ${searching ? "searching" : ""}`}>
          <header>
            <h2>{heading}</h2>
            {searching ? (
              <button onClick={() => setQuery("")}>Clear search</button>
            ) : (
              <ImportButton
                onImport={importRecord}
                onError={setError}
                importer={importer}
              />
            )}
          </header>
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
          {records.length === 0 && !searching ? (
            <div className="empty">
              <FolderOpen size={34} />
              <h3>A workspace waiting for you</h3>
              <p>Create your first file, or explore a sample.</p>
              <div>{samples}</div>
            </div>
          ) : shown.length === 0 ? (
            <div className="empty">
              {searching ? <Search size={30} /> : <FolderOpen size={34} />}
              <h3>
                {searching
                  ? `No files match “${query.trim()}”`
                  : `No ${kindLabel.toLowerCase()} yet`}
              </h3>
              <p>
                {searching
                  ? "Search looks at file names and the words inside them."
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
                <div className="file-row" key={r.file.id}>
                  <Link to={`/file/${r.file.id}`}>
                    <span className={`file-icon ${r.file.kind}`}>
                      {r.file.kind === "doc" ? (
                        <FileText size={21} />
                      ) : r.file.kind === "sheet" ? (
                        <Sheet size={21} />
                      ) : (
                        <Presentation size={21} />
                      )}
                    </span>
                    <span>
                      {r.file.title}
                      {snippet ? (
                        <small className="file-snippet">{snippet}</small>
                      ) : r.recovery && r.path ? (
                        <small>Recovery draft available</small>
                      ) : r.path ? (
                        <small>{r.path}</small>
                      ) : null}
                    </span>
                  </Link>
                  <time
                    dateTime={r.file.updatedAt}
                    title={new Date(r.file.updatedAt).toLocaleString()}
                  >
                    {formatModified(r.file.updatedAt)}
                  </time>
                  <div className="file-controls">
                    <button
                      title="Rename"
                      aria-label={`Rename ${r.file.title}`}
                      onClick={() => setAsking({ action: "rename", record: r })}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      title="Make a copy"
                      aria-label={`Duplicate ${r.file.title}`}
                      onClick={() =>
                        void storage
                          .save({ file: duplicateFile(r.file) })
                          .then(refresh)
                          .catch((e) => setError(message(e)))
                      }
                    >
                      <Copy size={16} />
                    </button>
                    <button
                      title="Remove from library"
                      aria-label={`Remove ${r.file.title}`}
                      onClick={() => setAsking({ action: "remove", record: r })}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {records.length > 0 && !searching ? (
            <p className="sample-strip">Explore a sample: {samples}</p>
          ) : null}
          {asking?.action === "rename" ? (
            <NameDialog
              title="Rename"
              submitLabel="OK"
              initial={asking.record.file.title}
              onClose={() => setAsking(null)}
              onSubmit={(title) => {
                const { record } = asking;
                setAsking(null);
                if (title !== record.file.title)
                  void rename(record, title).catch((e) => setError(message(e)));
              }}
            />
          ) : asking?.action === "remove" ? (
            <DriveDialog
              title={
                window.suiteleaf ? "Remove from library?" : "Delete this file?"
              }
              submitLabel={window.suiteleaf ? "Remove" : "Delete"}
              onClose={() => setAsking(null)}
              onSubmit={() => {
                const { record } = asking;
                setAsking(null);
                void storage
                  .remove(record.file.id)
                  .then(refresh)
                  .catch((e) => setError(message(e)));
              }}
            >
              <p className="dialog-note">
                {window.suiteleaf
                  ? asking.record.path
                    ? `“${asking.record.file.title}” and its recovery draft leave the library. Your saved file remains on disk.`
                    : `“${asking.record.file.title}” was never saved to a file, so it will be deleted. This can't be undone.`
                  : `“${asking.record.file.title}” will be deleted from this browser. This can't be undone.`}
              </p>
              {window.suiteleaf ? null : (
                <p className="dialog-note">
                  A copy you downloaded isn&apos;t affected: open it again with
                  Open / import.
                </p>
              )}
            </DriveDialog>
          ) : null}
        </section>
        <footer className="home-footer">
          A calmer place to get things done.<span>SuiteLeaf · Apache-2.0</span>
        </footer>
      </main>
    </div>
  );
}
/** Ask before leaving `serverUrl` while SuiteDrive edits exist only on this
 * device; with none, leaving needs no confirmation. */
async function confirmLeave(serverUrl: string, action: string) {
  await Promise.all(
    [...driveQueues.values()].map((q) => q.flush().catch(() => {})),
  );
  const unsynced = (await storage.list()).filter(
    (r) => r.drive?.nodeUrl === serverUrl && hasUnsyncedEdits(r),
  );
  if (!unsynced.length) return true;
  return window.confirm(
    `${unsynced.length === 1 ? "1 file has" : `${unsynced.length} files have`} changes that haven't reached SuiteDrive yet:\n\n` +
      unsynced.map((r) => `• ${r.file.title}`).join("\n") +
      `\n\nThe changes stay on this device and upload when you sign in again and open the file. ${action} anyway?`,
  );
}
function AccountChip({ serverUrl }: { serverUrl: string }) {
  const session = useNodeSession();
  const { locked } = useMode();
  const [error, setError] = useState("");
  if (!session) return null;
  const name =
    session.user.name || session.user.username || session.user.email || "";
  const host = new URL(serverUrl).host;
  const leave = (action: string, work: () => Promise<unknown>) =>
    void confirmLeave(serverUrl, action)
      .then((ok) => ok && work())
      .catch((e) => setError(message(e)));
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
          onClick={() => leave("Sign out", signOut)}
        >
          <LogOut size={14} />
          <span className="account-action-label">Sign out</span>
        </button>
        {locked ? null : (
          <button
            title="Sign out and work on this computer without a server"
            aria-label="Disconnect from server"
            onClick={() => leave("Disconnect", () => disconnect(serverUrl))}
          >
            <Unplug size={14} />
            <span className="account-action-label">Disconnect</span>
          </button>
        )}
      </div>
      {error ? (
        <p className="account-error" role="alert">
          {error}
        </p>
      ) : null}
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
  const driveControl = useRef<DriveControl | null>(null);
  const session = useNodeSession();
  useAgentHost("home", () => {
    const ctx: DriveAgentContext = {
      host: new URL(serverUrl).host,
      user: session?.user.name || session?.user.username || session?.user.email || "",
      drive: () => driveControl.current,
      create: (kind, title) =>
        createInDrive(createFile(kind, title), folder.current, navigate),
      open: (item) => openFromDrive(item, navigate),
      signOut: async () => {
        if (!(await confirmLeave(serverUrl, "Sign out"))) return false;
        await signOut();
        return true;
      },
      canDisconnect: !locked,
      mayDisconnect: () => confirmLeave(serverUrl, "Disconnect"),
      disconnect: () => disconnect(serverUrl),
    };
    return { kind: "home", snapshot: () => driveSnapshot(ctx), tools: driveTools(ctx) };
  });
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
        <AccountChip serverUrl={serverUrl} />
      </aside>
      <main className="home-main">
        <header className="home-top">
          <span />
          <span className="version">OPEN SOURCE · v0.1</span>
          <AiButton />
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
            control={driveControl}
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
  const [record, setRecord] = useState<FileRecord>(),
    [error, setError] = useState(""),
    [status, setStatus] = useState("Opening…"),
    [locked, setLocked] = useState(false),
    [starred, setStarred] = useState(false);
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
    driveConflictRef = useRef<DriveItem | null>(null);
  const [driveConflict, setDriveConflictState] = useState<DriveItem | null>(
      null,
    ),
    [driveDialog, setDriveDialog] = useState<"open" | "save" | null>(null),
    { mode } = useMode(),
    cluster = mode.kind === "cluster";
  const setDriveConflict = (item: DriveItem | null) => {
    driveConflictRef.current = item;
    setDriveConflictState(item);
  };
  /** Upload the current file to SuiteDrive as a new version. */
  const syncDrive = useCallback(async () => {
    clearTimeout(driveTimer.current);
    driveTimer.current = undefined;
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
        const saved = await storage.save({
          ...current.current!,
          file: snapshot,
        });
        // SuiteDrive uploads and copies replace `drive` while the write is in flight.
        current.current = {
          ...saved,
          file: current.current!.file,
          drive: current.current!.drive,
        };
        if (alive.current) setRecord(current.current);
      });
      savedVersion.current = Math.max(savedVersion.current, at);
      // Once unmounted, the cleanup has already uploaded the latest content
      // and a reopened editor may hold the link a later upload would replace.
      if (alive.current && current.current.drive && !driveConflictRef.current) {
        clearTimeout(driveTimer.current);
        driveTimer.current = setTimeout(() => void syncDrive(), 1500);
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
    actions.current = undefined;
    const saveQueue = queue.current;
    let release: (() => void) | undefined,
      cancel = false;
    const load = async () => {
      try {
        const r = await driveQueue.current.enqueue(() => storage.get(id!));
        if (cancel) return;
        if (!r) throw new Error("This file could not be found.");
        current.current = r;
        setRecord(r);
        if (hasUnsyncedEdits(r)) {
          setStatus("Saving to SuiteDrive…");
          void syncDrive();
          return;
        }
        const saved = r.drive
          ? "Saved to SuiteDrive"
          : r.recovery && r.path
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
  const update = useCallback(
    (content: SuiteFile["content"]) => {
      if (!current.current) return;
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
    if (!current.current) return;
    current.current.file.title = title || "Untitled";
    setRecord({ ...current.current });
    update(current.current.file.content);
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
    const file = current.current!.file;
    const name = conflict.name.replace(/(\.[^.]+)?$/, (ext) => ` (copy)${ext}`);
    setDriveConflict(null);
    const link = await saveNewDriveFile(
      file,
      conflict.parentId,
      driveName(name, file.kind),
    );
    current.current = { ...current.current!, drive: link };
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
  const downloadFile = () =>
    (cluster ? exportNative().then(() => true) : saveAs()).then((done) => {
      if (done && !cluster && !window.suiteleaf && alive.current)
        setStatus(`Downloaded “${nativeFilename(current.current!.file)}”`);
      return done;
    });
  const download = () => void downloadFile().catch((e) => setError(message(e)));
  const onActions = useCallback((a: EditorActions) => {
    actions.current = a;
    setActionsReady(true);
  }, []);
  useAgentHost("workspace", () => {
    const file = record?.file;
    const ctx: WorkspaceAgentContext | null = file
      ? {
          title: file.title,
          kind: file.kind,
          status,
          rename: changeTitle,
          download: () =>
            downloadFile().then((done) =>
              done
                ? {
                    name:
                      (!cluster && current.current?.path?.split(/[\\/]/).pop()) ||
                      nativeFilename(current.current!.file),
                    path: cluster ? undefined : current.current?.path,
                  }
                : null,
            ),
          saveAs: !!window.suiteleaf && !cluster,
          back: () => save().then(() => navigate("/")),
          create: async (kind, title) => {
            await save();
            const file = createFile(kind, title);
            if (cluster) await createInDrive(file, null, navigate);
            else navigate(`/file/${(await storage.save({ file })).file.id}`);
          },
        }
      : null;
    return {
      kind: file?.kind ?? "doc",
      snapshot: () =>
        ctx
          ? workspaceSnapshot(ctx) +
            (driveConflictRef.current
              ? " Someone else saved a newer version of this file in SuiteDrive; changes here are not being uploaded until the conflict is resolved."
              : "")
          : "",
      tools: ctx
        ? [
            ...workspaceTools(ctx),
            ...(driveConflict
              ? conflictTools({
                  conflict: () => !!driveConflictRef.current,
                  saveCopy: saveDriveCopy,
                  reload: reloadFromDrive,
                  title: () => current.current?.file.title ?? "",
                  rename: changeTitle,
                })
              : []),
          ]
        : [],
    };
  });
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
  return (
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
              onChange={(e) => changeTitle(e.target.value)}
            />
            <button
              type="button"
              className={`doc-icon-btn star-btn ${starred ? "starred" : ""}`}
              aria-label={starred ? "Starred" : "Star document"}
              onClick={() => setStarred(!starred)}
              title="Star"
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
          <div className="file-menu">
            <Menu label="File">
              <MenuItem onSelect={() => void doAction("new-doc")}>
                New document
              </MenuItem>
              <MenuItem onSelect={() => void doAction("new-sheet")}>
                New spreadsheet
              </MenuItem>
              <MenuItem onSelect={() => void doAction("new-slide")}>
                New presentation
              </MenuItem>
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
              <MenuItem onSelect={() => void save().catch(() => {})}>
                Save now
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
                  <MenuItem
                    shortcut="Cmd+K"
                    onSelect={() => actions.current?.docActions?.insertLink()}
                  >
                    Link
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
                    onSelect={() => actions.current?.docActions?.openFind()}
                  >
                    Find and replace
                  </MenuItem>
                  <MenuItem
                    onSelect={() => actions.current?.docActions?.openSpelling()}
                  >
                    Spelling and grammar
                  </MenuItem>
                </Menu>
                <Menu label="Help">
                  <MenuItem
                    onSelect={() => actions.current?.docActions?.openFind()}
                  >
                    Keyboard shortcuts
                  </MenuItem>
                </Menu>
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
                  <MenuItem onSelect={() => {}}>Function: SUM</MenuItem>
                  <MenuItem onSelect={() => {}}>Function: AVERAGE</MenuItem>
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
                  <MenuItem onSelect={() => {}}>Autocomplete</MenuItem>
                  <MenuItem onSelect={() => {}}>Notification settings</MenuItem>
                </Menu>
                <Menu label="Extensions">
                  <MenuItem onSelect={() => {}}>Add-ons</MenuItem>
                  <MenuItem onSelect={() => {}}>Apps Script</MenuItem>
                  <MenuItem onSelect={() => {}}>AppSheet</MenuItem>
                </Menu>
                <Menu label="Help">
                  <MenuItem onSelect={() => {}}>Sheets Help</MenuItem>
                  <MenuItem onSelect={() => {}}>Keyboard shortcuts</MenuItem>
                </Menu>
              </>
            ) : null}
            {f.kind === "slide" ? (
              <>
                <Menu label="Edit">
                  <MenuItem shortcut="Cmd+Z" onSelect={() => {}}>
                    Undo
                  </MenuItem>
                  <MenuItem shortcut="Cmd+Y" onSelect={() => {}}>
                    Redo
                  </MenuItem>
                  <MenuItem shortcut="Cmd+X" onSelect={() => {}}>
                    Cut
                  </MenuItem>
                  <MenuItem shortcut="Cmd+C" onSelect={() => {}}>
                    Copy
                  </MenuItem>
                  <MenuItem shortcut="Cmd+V" onSelect={() => {}}>
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
                  <MenuItem onSelect={() => {}}>Text box</MenuItem>
                  <MenuItem onSelect={() => {}}>Image</MenuItem>
                  <MenuItem onSelect={() => {}}>Shape</MenuItem>
                  <MenuItem onSelect={() => void doAction("new-slide")}>
                    New slide
                  </MenuItem>
                </Menu>
                <Menu label="Format">
                  <MenuItem shortcut="Cmd+B" onSelect={() => {}}>
                    Text: Bold
                  </MenuItem>
                  <MenuItem shortcut="Cmd+I" onSelect={() => {}}>
                    Text: Italic
                  </MenuItem>
                  <MenuItem onSelect={() => {}}>Align & indent</MenuItem>
                </Menu>
                <Menu label="Slide">
                  <MenuItem
                    shortcut="Cmd+M"
                    onSelect={() => void doAction("new-slide")}
                  >
                    New slide
                  </MenuItem>
                  <MenuItem onSelect={() => {}}>Duplicate slide</MenuItem>
                  <MenuItem onSelect={() => {}}>Delete slide</MenuItem>
                </Menu>
                <Menu label="Tools">
                  <MenuItem onSelect={() => {}}>Spelling</MenuItem>
                  <MenuItem onSelect={() => {}}>Preferences</MenuItem>
                </Menu>
                <Menu label="Help">
                  <MenuItem onSelect={() => {}}>Keyboard shortcuts</MenuItem>
                </Menu>
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
          >
            <Clock size={18} />
          </button>
          <button
            type="button"
            className="doc-icon-btn"
            title="Comments"
            aria-label="Comments"
            onClick={() => actions.current?.sheetActions?.openComments?.()}
          >
            <MessageSquare size={18} />
          </button>
          <AiButton />
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
            {savedWhen(driveConflict.updatedAt)} Your edits weren't uploaded and are safe on this device. Save them
            as a copy to keep both versions, or reload the SuiteDrive version
            and discard your edits.
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
            {f.importInfo.warnings.length
              ? ` · ${f.importInfo.warnings.length} compatibility ${f.importInfo.warnings.length === 1 ? "note" : "notes"}`
              : ""}
          </summary>
          {f.importInfo.warnings.length ? (
            <ul>
              {f.importInfo.warnings.map((w, i) => (
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
              key={id}
              file={f as DocFile}
              onChange={update}
              onActions={onActions}
              onError={setError}
            />
          ) : f.kind === "sheet" ? (
            <Sheets
              key={id}
              file={f as SheetFile}
              onChange={update}
              onActions={onActions}
              onError={setError}
            />
          ) : (
            <Slides
              key={id}
              file={f as SlideFile}
              onChange={update}
              onActions={onActions}
              onError={setError}
            />
          )}
        </Suspense>
      </ErrorBoundary>
    </div>
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
  if (mode.kind !== "cluster" || session?.url === mode.serverUrl)
    return <>{children}</>;
  return <SignInScreen serverUrl={mode.serverUrl} canDisconnect={!locked} />;
}
export default function App() {
  const [mode, setMode] = useState<ResolvedMode>();
  useEffect(() => {
    void resolveMode().then((resolved) => {
      // Disconnecting can happen outside the app (the desktop Server menu).
      if (resolved.mode.kind === "single" && getSession()) void signOut();
      setMode(resolved);
    });
  }, []);
  if (!mode) return <div className="loading">Opening SuiteLeaf…</div>;
  return (
    <ModeContext.Provider value={mode}>
      <HashRouter>
        <AgentLayer />
        <Routes>
          <Route path="/auth-complete" element={<AuthComplete />} />
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
