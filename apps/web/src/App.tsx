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
  useNavigate,
  useParams,
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
  Play,
} from "lucide-react";
import {
  createFile,
  duplicateFile,
  filename,
  serializeFile,
  type SuiteFile,
  type FileRecord,
  type DocFile,
  type SheetFile,
  type SlideFile,
} from "@suiteleaf/core";
import { storage, SaveQueue, exportText } from "./storage";
import { importFile } from "./imports";
import { sampleDoc, sampleSheet, sampleSlide } from "./samples";
import { Menu, MenuItem, type EditorActions } from "./ui";
const Docs = lazy(() => import("./editors/Docs")),
  Sheets = lazy(() => import("./editors/Sheets")),
  Slides = lazy(() => import("./editors/Slides"));
function message(e: unknown) {
  return e instanceof Error ? e.message : String(e);
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
}: {
  onImport: (r: FileRecord) => Promise<void>;
  onError: (s: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const open = async () => {
    setImporting(true);
    try {
      if (window.suiteleaf) {
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
        accept=".suiteleaf,.docx,.xlsx,.xls,.xlsm,.xlsb,.xltx,.pptx,.ppt,.ppsx,.pptm,.potx,.ppsm,.html,.htm,.txt,.csv,.tsv"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setImporting(true);
          try {
            await onImport({ file: await importFile(f) });
          } catch (e) {
            onError(message(e));
          } finally {
            setImporting(false);
          }
        }}
      />
      {window.suiteleaf ? (
        <button onClick={() => input.current?.click()}>
          Import Office / HTML / CSV
        </button>
      ) : null}
    </>
  );
}
function Home() {
  const navigate = useNavigate();
  const [records, setRecords] = useState<FileRecord[]>([]),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [filter, setFilter] = useState("all");
  const refresh = useCallback(
    () =>
      storage
        .list()
        .then(setRecords)
        .catch((e) => setError(message(e))),
    [],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const open = useCallback(
    async (r: FileRecord) => {
      if (!r.path && !r.recovery && (await storage.get(r.file.id)))
        r = { file: duplicateFile(r.file) };
      const saved = r.path ? r : await storage.save(r);
      navigate(`/file/${saved.file.id}`);
    },
    [navigate],
  );
  const make = useCallback(
    (kind: "doc" | "sheet" | "slide") =>
      void open({ file: createFile(kind) }).catch((e) => setError(message(e))),
    [open],
  );
  const menu = useCallback(
    (action: string) => {
      if (action === "new-doc") make("doc");
      if (action === "new-sheet") make("sheet");
      if (action === "new-slide") make("slide");
      if (action === "open")
        void storage
          .open()
          .then((r) => r && open(r))
          .catch((e) => setError(message(e)));
    },
    [make, open],
  );
  useEffect(() => window.suiteleaf?.onMenu(menu), [menu]);
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
          Your workspace, on this device.
          <small>Offline ready. No account needed.</small>
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
            />
          </label>
          <span className="version">OPEN SOURCE · v0.1</span>
        </header>
        <section className="welcome">
          <p className="eyebrow">YOUR EVERYDAY WORKSPACE</p>
          <h1>Good ideas start here.</h1>
          <p>Write something. Work out the numbers. Make it yours.</p>
        </section>
        <div className="new-cards">
          <button className="new-card" onClick={() => make("doc")}>
            <span className="app-icon doc">
              <FileText size={30} />
            </span>
            <span>
              <strong>New document</strong>
              <small>A fresh page for your next idea</small>
            </span>
            <Plus size={22} />
          </button>
          <button className="new-card" onClick={() => make("sheet")}>
            <span className="app-icon sheet">
              <Sheet size={30} />
            </span>
            <span>
              <strong>New spreadsheet</strong>
              <small>A little structure for the big picture</small>
            </span>
            <Plus size={22} />
          </button>
          <button className="new-card" onClick={() => make("slide")}>
            <span className="app-icon slide">
              <Presentation size={30} />
            </span>
            <span>
              <strong>New presentation</strong>
              <small>A clean canvas for your next pitch</small>
            </span>
            <Plus size={22} />
          </button>
        </div>
        {error ? (
          <div className="error" role="alert">
            <CircleAlert size={18} />
            {error}
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              ×
            </button>
          </div>
        ) : null}
        <section className="file-section">
          <header>
            <h2>
              {filter === "all"
                ? "Your files"
                : filter === "doc"
                  ? "Documents"
                  : filter === "sheet"
                    ? "Spreadsheets"
                    : "Presentations"}
            </h2>
            <ImportButton onImport={open} onError={setError} />
          </header>
          {records.length === 0 ? (
            <div className="empty">
              <FolderOpen size={34} />
              <h3>A workspace waiting for you</h3>
              <p>Create your first file, or explore a sample.</p>
              <div>
                <button
                  onClick={() =>
                    void open({ file: sampleDoc() }).catch((e) =>
                      setError(message(e)),
                    )
                  }
                >
                  Sample document
                </button>
                <button
                  onClick={() =>
                    void open({ file: sampleSheet() }).catch((e) =>
                      setError(message(e)),
                    )
                  }
                >
                  Sample budget
                </button>
                <button
                  onClick={() =>
                    void open({ file: sampleSlide() }).catch((e) =>
                      setError(message(e)),
                    )
                  }
                >
                  Sample presentation
                </button>
              </div>
            </div>
          ) : (
            <div className="file-list">
              <div className="file-list-head">
                <span>Name</span>
                <span>Last edited</span>
                <span />
              </div>
              {records
                .filter(
                  (r) =>
                    (filter === "all" || r.file.kind === filter) &&
                    r.file.title.toLowerCase().includes(query.toLowerCase()),
                )
                .sort((a, b) =>
                  b.file.updatedAt.localeCompare(a.file.updatedAt),
                )
                .map((r) => (
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
                        {r.recovery ? (
                          <small>Recovery draft available</small>
                        ) : r.path ? (
                          <small>{r.path}</small>
                        ) : null}
                      </span>
                    </Link>
                    <time>
                      {new Date(r.file.updatedAt).toLocaleDateString(
                        undefined,
                        { month: "short", day: "numeric" },
                      )}
                    </time>
                    <div className="file-controls">
                      <button
                        title="Duplicate"
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
                        onClick={() => {
                          if (
                            window.confirm(
                              window.suiteleaf
                                ? "Remove this entry and its recovery draft? Your saved file remains on disk."
                                : "Delete this file from this browser?",
                            )
                          )
                            void storage
                              .remove(r.file.id)
                              .then(refresh)
                              .catch((e) => setError(message(e)));
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          )}
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
  const current = useRef<FileRecord>(undefined),
    version = useRef(0),
    savedVersion = useRef(0),
    queue = useRef(new SaveQueue()),
    timer = useRef<ReturnType<typeof setTimeout>>(undefined),
    actions = useRef<EditorActions>(undefined),
    alive = useRef(true),
    saveError = useRef("");
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
    snapshot.updatedAt = new Date().toISOString();
    setStatus("Saving…");
    try {
      await queue.current.enqueue(async () => {
        const latest = current.current!;
        const saved = await storage.save({ ...latest, file: snapshot });
        current.current = { ...saved, file: current.current!.file };
        if (alive.current) setRecord(current.current);
      });
      savedVersion.current = Math.max(savedVersion.current, at);
      if (version.current === at) {
        setStatus(
          current.current.path
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
  }, []);
  useEffect(() => {
    alive.current = true;
    const saveQueue = queue.current;
    let release: (() => void) | undefined,
      cancel = false;
    const load = async () => {
      try {
        const r = await storage.get(id!);
        if (cancel) return;
        if (!r) throw new Error("This file could not be found.");
        current.current = r;
        setRecord(r);
        setStatus(
          r.recovery
            ? "Recovered draft · review and save"
            : r.path
              ? "Saved to file"
              : window.suiteleaf
                ? "Draft saved · choose Save As"
                : "Saved on this device",
        );
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
      if (current.current && version.current > savedVersion.current) {
        const snapshot = structuredClone(current.current);
        void saveQueue.enqueue(() => storage.save(snapshot)).catch(() => {});
      }
      release?.();
    };
  }, [id]);
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
        current.current = { ...saved, file: current.current.file };
        setRecord(current.current);
        if (at === version.current) await save();
        else void save().catch(() => {});
      }
    } catch (e) {
      setError(message(e));
    }
  }, [save]);
  const doAction = useCallback(
    async (action: string) => {
      try {
        if (action === "save") await save();
        else if (action === "save-as") await saveAs();
        else if (action === "print") await actions.current?.print();
        else if (action === "open") {
          await save();
          const r = await storage.open();
          if (r) navigate(`/file/${r.file.id}`);
        } else if (
          action === "new-doc" ||
          action === "new-sheet" ||
          action === "new-slide"
        ) {
          await save();
          const r = await storage.save({
            file: createFile(
              action === "new-doc"
                ? "doc"
                : action === "new-sheet"
                  ? "sheet"
                  : "slide",
            ),
          });
          navigate(`/file/${r.file.id}`);
        }
      } catch (e) {
        setError(message(e));
      }
    },
    [save, saveAs, navigate],
  );
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
      filename(current.current!.file.title),
      serializeFile(current.current!.file),
    );
  };
  const makeCopy = async () => {
    await actions.current?.flush();
    await save();
    const r = await storage.save({
      file: duplicateFile(current.current!.file),
    });
    navigate(`/file/${r.file.id}`);
  };
  const onActions = useCallback((a: EditorActions) => {
    actions.current = a;
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
              <MenuItem onSelect={() => void saveAs()}>
                {window.suiteleaf ? "Save As…" : "Download SuiteLeaf file"}
              </MenuItem>
              <MenuItem onSelect={() => void save().catch(() => {})}>
                Save now
              </MenuItem>
              <MenuItem
                onSelect={() =>
                  void exportNative().catch((e) => setError(message(e)))
                }
              >
                Export native copy
              </MenuItem>
              {(f.kind === "doc"
                ? ["html", "txt"]
                : f.kind === "sheet"
                  ? ["csv", "tsv"]
                  : ["txt", "html"]
              ).map((format) => (
                <MenuItem
                  key={format}
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
                    onSelect={() =>
                      actions.current?.docActions?.clearFormatting()
                    }
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
                    onSelect={() => actions.current?.sheetActions?.toggleBold()}
                  >
                    Cut
                  </MenuItem>
                  <MenuItem
                    shortcut="Cmd+C"
                    onSelect={() => actions.current?.sheetActions?.toggleBold()}
                  >
                    Copy
                  </MenuItem>
                  <MenuItem
                    shortcut="Cmd+V"
                    onSelect={() => actions.current?.sheetActions?.toggleBold()}
                  >
                    Paste
                  </MenuItem>
                  <MenuItem
                    shortcut="Delete"
                    onSelect={() =>
                      actions.current?.sheetActions?.clearFormatting()
                    }
                  >
                    Delete values
                  </MenuItem>
                </Menu>
                <Menu label="View">
                  <MenuItem onSelect={() => void doAction("print")}>
                    Print layout
                  </MenuItem>
                  <MenuItem
                    onSelect={() =>
                      actions.current?.sheetActions?.toggleFilter()
                    }
                  >
                    Toggle filter
                  </MenuItem>
                  <MenuItem onSelect={() => {}}>Show formula bar</MenuItem>
                  <MenuItem onSelect={() => {}}>Show gridlines</MenuItem>
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
                  <MenuItem onSelect={() => {}}>Checkbox</MenuItem>
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
                </Menu>
                <Menu label="Data">
                  <MenuItem
                    onSelect={() =>
                      actions.current?.sheetActions?.toggleFilter()
                    }
                  >
                    Create a filter
                  </MenuItem>
                  <MenuItem
                    onSelect={() =>
                      actions.current?.sheetActions?.insertPivot()
                    }
                  >
                    Pivot table
                  </MenuItem>
                  <MenuItem onSelect={() => {}}>Sort range</MenuItem>
                  <MenuItem onSelect={() => {}}>Data validation</MenuItem>
                  <MenuItem onSelect={() => {}}>
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
          >
            <MessageSquare size={18} />
          </button>
          {f.kind === "slide" ? (
            <button
              type="button"
              className="slideshow-header-btn"
              aria-label="Slideshow"
              title="Slideshow"
              onClick={() => void actions.current?.present?.()}
            >
              <Play size={14} fill="currentColor" />
              <span>Slideshow</span>
            </button>
          ) : null}
          <span className="workspace-brand">
            <Leaf size={16} />
            SuiteLeaf
          </span>
          <button className="save-copy" onClick={() => void saveAs()}>
            <Download size={16} />
            {window.suiteleaf ? "Save As" : "Download"}
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
          <button onClick={() => void saveAs()}>Save As</button>
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
      {f.importInfo ? (
        <details className="import-notes">
          <summary>
            Imported {f.importInfo.sourceFormat.toUpperCase()}:{" "}
            {f.importInfo.sourceName}
            {f.importInfo.warnings.length
              ? ` · ${f.importInfo.warnings.length} compatibility notes`
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
function FileRoute() {
  const { id } = useParams();
  return <Workspace key={id} />;
}
export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/file/:id" element={<FileRoute />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </HashRouter>
  );
}
