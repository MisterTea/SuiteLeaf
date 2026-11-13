import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useNavigationType, useSearchParams } from "react-router-dom";
import { Search, FolderOpen, FolderPlus, ArrowDown, ArrowUp } from "lucide-react";
import {
  createFile,
  duplicateFile,
  serializeFile,
  type FileRecord,
} from "@suiteleaf/core";
import { storage } from "../storage";
import { SameFileDialog, openNotices } from "../same-file";
import { sampleDoc, sampleSheet, sampleSlide } from "../samples";
import { drawingFromAction, newFile, type NewKind } from "../drawing-home";
import { DriveDialog, NameDialog } from "../drive/DriveBrowser";
import { searchFile } from "../library-search";
import { FileLibraryRow, TrashToast } from "../library-trash-ui";
import { childFolders, existingFolder, folderName, folderOfPath, isWithinFolder, parentFolder } from "../local-folders";
import { dragFile, LocalFolderCrumbs, LocalFolderRow, LocalMoveDialog, type DraggedItem } from "../local-folders-ui";
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
  readOpened,
  recentAt,
  visibleRecords,
  type LibraryFilter,
} from "../library-trash";
import { ConnectDialog } from "../drive/SignIn";
import { probeServer, switchMode, useMode } from "../mode";
import { formsEnabled } from "../flags";
import { useAgentHost } from "../ai/host";
import { InstallButton } from "../InstallButton";
import { AiButton } from "../ai/AgentSidebar";
import { homeSnapshot, homeTools, type HomeAgentContext } from "../ai/tools/files";
import { connectTools } from "../ai/tools/cluster";
import { TemplateHome } from "../templates/gallery";
import { message } from "../error-message";
import { useLibrarySelection } from "./use-library-selection";
import { driveFileDrop } from "./drive-file-drop";
import { ImportButton } from "./ImportButton";
import { ErrorBanner, LeftServerNotice, LocalSidebar, NewCards } from "./home-parts";

/** The documents folder the home screen showed last, so returning from a file reopens it. */
let lastLocalFolder = "";
/** Create each part of `directory` under `parent`. An existing folder is reused. */
async function ensureDesktopFolder(parent: string, directory: string) {
  const known = new Set((await window.suiteleaf?.listFolders?.()) ?? []);
  let current = parent;
  for (const part of directory.split("/").filter(Boolean)) {
    const next = current ? `${current}/${part}` : part;
    if (known.has(next)) {
      current = next;
      continue;
    }
    try {
      current = (await window.suiteleaf?.createFolder?.(current, part)) ?? next;
    } catch (error) {
      if (!message(error).includes("already")) throw error;
      current = next;
    }
    known.add(current);
  }
  return current;
}
/** Serverless mode and single-node mode: files in this browser, or on this
 * computer when the desktop app is running. */
export function LocalHome() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const [searchParams] = useSearchParams();
  const { locked, demo } = useMode();
  const [connecting, setConnecting] = useState(false);
  const [records, setRecords] = useState<FileRecord[]>([]),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [filter, setFilter] = useState<LibraryFilter>("all"),
    [opened, setOpened] = useState(readOpened),
    [sort, setSort] = useState<{ by: "name" | "edited"; desc: boolean }>({
      by: "edited",
      desc: true,
    }),
    [renaming, setRenaming] = useState<FileRecord | null>(null),
    [forever, setForever] = useState<FileRecord | null>(null),
    [emptying, setEmptying] = useState(false),
    [undo, setUndo] = useState<FileRecord[] | null>(null),
    [sameFile, setSameFile] = useState<{
      name: string;
      existing: FileRecord;
      incoming: FileRecord;
    } | null>(null);
  // Desktop only: "All files" browses the folders of the documents folder.
  const [folders, setFolders] = useState<string[] | null>(null),
    [root, setRoot] = useState(""),
    [folderDialog, setFolderDialog] = useState<
      | { kind: "new" }
      | { kind: "rename" | "move-folder"; folder: string }
      | { kind: "move-file"; record: FileRecord }
      | null
    >(null);
  const routeFolder = searchParams.get("localFolder");
  const folder = routeFolder ?? (navigationType === "POP" ? "" : lastLocalFolder);
  const setFolder = (next: string, replace = false) => {
    const params = new URLSearchParams(searchParams);
    params.set("localFolder", next);
    navigate({ pathname: "/", search: params.toString() }, { replace });
  };
  useEffect(() => {
    if (!folders || pathname !== "/") return;
    const next = existingFolder(folder, folders);
    lastLocalFolder = next;
    // Home links from editors omit the folder. Publish it again on return.
    if (routeFolder === null && next) {
      const params = new URLSearchParams(searchParams);
      params.set("localFolder", next);
      navigate({ pathname: "/", search: params.toString() }, { replace: true });
    }
  }, [folder, folders, navigate, pathname, routeFolder, searchParams]);
  /** The folder new and imported files are written into, when one is open. */
  const placeIn = useRef("");
  const undoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const refresh = useCallback(
    () =>
      Promise.all([
        storage.list(),
        window.suiteleaf?.listFolders?.() ?? null,
        window.suiteleaf?.getDocumentsDirectory?.() ?? "",
      ])
        // Cached copies of server files belong to cluster mode.
        .then(async ([all, nextFolders, documents]) => {
          const local = all.filter((r) => !r.drive);
          const now = new Date();
          const expired = local.filter((r) => isTrashExpired(r, now));
          if (expired.length)
            await Promise.all(expired.map((r) => storage.remove(r.file.id)));
          setRecords(local.filter((r) => !isTrashExpired(r, now)));
          setOpened(readOpened());
          setFolders(nextFolders);
          setRoot(documents);
        })
        .catch((e) => setError(message(e))),
    [],
  );
  useEffect(() => {
    void refresh();
    // The assistant's "Undo all of this" puts files back behind the list's back.
    const changed = () => void refresh();
    window.addEventListener("suiteleaf:library-changed", changed);
    const unsubscribe = window.suiteleaf?.onFilesChanged?.(changed);
    return () => {
      clearTimeout(undoTimer.current);
      window.removeEventListener("suiteleaf:library-changed", changed);
      unsubscribe?.();
    };
  }, [refresh]);
  const open = useCallback(
    async (r: FileRecord, notice?: string) => {
      if (!r.path && !r.recovery && (await storage.get(r.file.id)))
        r = { file: duplicateFile(r.file) };
      let saved = r.path ? r : await storage.save(r);
      if (!r.path && placeIn.current && window.suiteleaf?.moveFile)
        saved = await window.suiteleaf.moveFile(saved.file.id, placeIn.current);
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
    (kind: NewKind) =>
      void open({ file: newFile(kind) }).catch((e) =>
        setError(message(e)),
      ),
    [open],
  );
  const menu = useCallback(
    (action: string) => {
      if (action === "new-doc") make("doc");
      if (action === "new-sheet") make("sheet");
      if (action === "new-slide") make("slide");
      if (action === "new-marp") make("marp");
      if (action === "new-form" && formsEnabled) make("form");
      const drawing = drawingFromAction(action);
      if (drawing) make(drawing);
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
  const rememberUndo = (moved: FileRecord[]) => {
    clearTimeout(undoTimer.current);
    setUndo(moved);
    undoTimer.current = setTimeout(() => setUndo(null), TRASH_TOAST_MS);
  };
  const changeFiles = async (
    items: FileRecord[],
    change: (record: FileRecord) => Promise<unknown>,
    onProgress?: (completed: number) => void,
  ) => {
    const changed: FileRecord[] = [];
    const errors: string[] = [];
    for (const [index, record] of items.entries()) {
      try {
        await change(record);
        changed.push(record);
      } catch (error) {
        errors.push(`${record.file.title}: ${message(error)}`);
      }
      onProgress?.(index + 1);
    }
    if (errors.length) setError(errors.join("\n"));
    await refresh();
    return changed;
  };
  const changeTrash = async (
    items: FileRecord[],
    trashed: boolean,
    onProgress?: (completed: number) => void,
  ) => {
    if (window.suiteleaf?.setTrashed) {
      const ids = new Set(await window.suiteleaf.setTrashed(items.map(({ file }) => file.id), trashed));
      onProgress?.(items.length);
      await refresh();
      return items.filter(({ file }) => ids.has(file.id));
    }
    return changeFiles(items, async ({ file }) => {
      const latest = await storage.get(file.id);
      if (trashed) {
        if (!latest || latest.trashedAt) throw new Error("File is no longer available.");
        await storage.save(trashRecord(latest));
      } else if (latest?.trashedAt) {
        await storage.save(restoreRecord(latest));
      }
    }, onProgress);
  };
  const trashFiles = async (items: FileRecord[], onProgress?: (completed: number) => void) => {
    const moved = await changeTrash(items, true, onProgress);
    if (moved.length) rememberUndo(moved);
    return moved;
  };
  const moveToTrash = (record: FileRecord) =>
    void trashFiles([record]).catch((e) => setError(message(e)));
  const undoTrash = () => {
    if (!undo) return;
    clearTimeout(undoTimer.current);
    setUndo(null);
    void changeTrash(undo, false).catch((e) => setError(message(e)));
  };
  const forgetUndo = (ids: string[]) => {
    setUndo((current) => {
      const remaining = current?.filter(({ file }) => !ids.includes(file.id));
      return remaining?.length ? remaining : null;
    });
  };
  const restore = (record: FileRecord) => {
    void (async () => {
      if (window.suiteleaf?.setTrashed) {
        await window.suiteleaf.setTrashed([record.file.id], false);
      } else {
        const latest = (await storage.get(record.file.id)) ?? record;
        await storage.save(restoreRecord(latest));
      }
      forgetUndo([record.file.id]);
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
    forgetUndo(ids);
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
    focused = searching || filter === "recent" || filter === "trash" || filter === "starred";
  const browsing = !!folders && filter === "all" && !searching;
  /** The open folder, or the nearest one left if it moved or was deleted outside SuiteLeaf. */
  const here = folders ? existingFolder(folder, folders) : "";
  placeIn.current = here;
  const subfolders = browsing ? childFolders(folders, here) : [];
  const folderOf = (r: FileRecord) => folderOfPath(r.path, root);
  const itemsIn = (f: string) =>
    childFolders(folders ?? [], f).length + kept.filter((r) => folderOf(r) === f).length;
  const moveInto = (item: DraggedItem, target: string) => {
    void (async () => {
      if ("file" in item) await window.suiteleaf?.moveFile?.(item.file, target);
      else await window.suiteleaf?.moveFolder?.(item.folder, target);
      await refresh();
    })().catch((e) => setError(message(e)));
  };
  const shown = visibleRecords(records, filter, query, new Date(), {
    forms: formsEnabled,
    opened,
  })
    .flatMap((r) => {
      const hit = searchFile(r.file, query);
      return hit ? [{ r, snippet: hit.snippet }] : [];
    })
    .sort((a, b) => {
      if (filter === "recent")
        return recentAt(b.r, opened[b.r.file.id]) - recentAt(a.r, opened[a.r.file.id]);
      const order =
        sort.by === "name"
          ? a.r.file.title.localeCompare(b.r.file.title, undefined, {
              numeric: true,
              sensitivity: "base",
            })
          : a.r.file.updatedAt.localeCompare(b.r.file.updatedAt);
      return sort.desc ? -order : order;
    });
  const listed = browsing ? shown.filter(({ r }) => folderOf(r) === here) : shown;
  const selection = useLibrarySelection({
    files: listed.map(({ r }) => r), visibleFolders: subfolders, folders, root,
    scope: JSON.stringify([here, filter, query]), refresh, onError: setError, trashFiles,
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
  const dropImporter = useRef<((data: DataTransfer) => Promise<void>) | null>(null);
  const importer = useRef<((f: File) => Promise<void>) | null>(null);
  useAgentHost("home", () => {
    const ctx: HomeAgentContext = {
      records,
      shown: shown.map((s) => s.r),
      query,
      filter,
      setQuery,
      setFilter: (f) => setFilter(f as LibraryFilter),
      setSort,
      create: (kind, title) => open({ file: createFile(kind, title) }),
      openNew: (file) => open({ file }),
      open: (r) => navigate(`/file/${r.file.id}`),
      openSample: (kind) =>
        void open({
          file:
            kind === "doc"
              ? sampleDoc()
              : kind === "sheet"
                ? sampleSheet()
                : kind === "slide"
                  ? sampleSlide()
                  : createFile("form"),
        }),
      rename,
      duplicate: async (r) => {
        const copy = await storage.save({ file: duplicateFile(r.file) });
        await refresh();
        return copy;
      },
      showRemove: () => {},
      remove: async (r) => {
        const latest = (await storage.get(r.file.id)) ?? r;
        await storage.save(trashRecord(latest));
        rememberUndo([latest]);
        await refresh();
      },
      star: async (record, starred) => {
        const latest = (await storage.get(record.file.id)) ?? record;
        await storage.save(starRecord(latest, starred));
        await refresh();
      },
      restore: async (record) => {
        const latest = (await storage.get(record.file.id)) ?? record;
        if (latest.trashedAt) await storage.save(restoreRecord(latest));
        forgetUndo([record.file.id]);
        setFilter("all");
        setQuery("");
        await refresh();
      },
      fresh: async () => {
        const all = await storage.list();
        const now = new Date();
        return all.filter((r) => !r.drive && !isTrashExpired(r, now));
      },
      deleteForever: (ids) => removeForever(ids),
      importFile: async (f) => {
        if (!importer.current)
          throw new Error("Clear the search to import a file.");
        await importer.current(f);
      },
    };
    return {
      kind: "home",
      place: () => "No document open",
      snapshot: () => homeSnapshot(ctx),
      tools: [
        ...homeTools(ctx),
        ...(locked
          ? []
          : connectTools({
              probe: probeServer,
              connect: (serverUrl) =>
                switchMode({ kind: "cluster", serverUrl }),
            })),
      ],
    };
  });
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
    <div className="home" {...driveFileDrop(dropImporter)}>
      <LocalSidebar
        filter={filter}
        setFilter={setFilter}
        setSort={setSort}
        demo={demo}
        locked={locked}
        setConnecting={setConnecting}
      />
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
          <div className="home-app-buttons">
            <AiButton />
            <InstallButton />
          </div>
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
            {browsing ? (
              <button
                type="button"
                className="new-folder-btn"
                onClick={() => setFolderDialog({ kind: "new" })}
              >
                <FolderPlus size={16} />
                New folder
              </button>
            ) : null}
            {searching ? (
              <button onClick={() => setQuery("")}>Clear search</button>
            ) : null}
              <ImportButton
                onImport={importRecord}
                onError={setError}
                importer={importer}
                dropImporter={dropImporter}
                openDroppedFile={false}
                placeInFolder={
                  window.suiteleaf?.createFolder && window.suiteleaf.moveFile
                    ? async (file, folder) => {
                        const target = await ensureDesktopFolder(here, folder);
                        const saved = await storage.save({ file });
                        return (await window.suiteleaf?.moveFile?.(saved.file.id, target)) ?? saved;
                      }
                    : undefined
                }
                keepImported={async (file) => {
                  const saved = await storage.save({ file });
                  if (window.suiteleaf?.moveFile)
                    await window.suiteleaf.moveFile(saved.file.id, here);
                }}
                onBatchDone={() => refresh()}
              />
          </header>
          {browsing ? (
            <LocalFolderCrumbs folder={here} onOpen={setFolder} onDrop={moveInto} />
          ) : null}
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
          {selection.controls}
          {filter === "all" && !searching && kept.length === 0 && subfolders.length === 0 && !here ? (
            <div className="empty">
              <FolderOpen size={34} />
              <h3>A workspace waiting for you</h3>
              <p>
                Create your first file, or explore a sample.
                {trashed.length > 0 ? " Anything you deleted is in Trash." : ""}
              </p>
              <div>{samples}</div>
            </div>
          ) : listed.length === 0 && subfolders.length === 0 ? (
            <div className="empty">
              {searching ? <Search size={30} /> : <FolderOpen size={34} />}
              <h3>
                {browsing
                  ? "This folder is empty"
                  : searching
                  ? `No files match “${query.trim()}”`
                  : filter === "trash"
                    ? "Trash is empty"
                    : filter === "starred"
                      ? "No starred files"
                      : filter === "recent"
                        ? "No recent files"
                        : `No ${kindLabel.toLowerCase()} yet`}
              </h3>
              <p>
                {browsing
                  ? "Create a file or a folder here, or drop files anywhere on this page to import them."
                  : searching
                  ? "Search looks at file names and the words inside them, including Trash."
                  : filter === "trash"
                    ? "Files you delete wait here for 30 days."
                    : filter === "starred"
                      ? "Star a file on its row, or beside its title, and it stays here."
                      : filter === "recent"
                        ? "Files you open or change show up here."
                        : "Files you create or import appear here."}
              </p>
            </div>
          ) : (
            <>
              <div className="file-list">
                <div className="file-list-head">
                  <div className="file-name-heading">
                    {selection.heading}
                    {sortBy("name", "Name")}
                  </div>
                  {sortBy("edited", "Last edited")}
                  <span />
                </div>
                {subfolders.map((f) => (
                  <LocalFolderRow
                    key={f}
                    folder={f}
                    selection={selection.folder(f)}
                    count={itemsIn(f)}
                    onOpen={() => setFolder(f)}
                    onRename={() => setFolderDialog({ kind: "rename", folder: f })}
                    onMove={() => setFolderDialog({ kind: "move-folder", folder: f })}
                    onDrop={moveInto}
                  />
                ))}
                {listed.map(({ r, snippet }) => (
                  <FileLibraryRow
                    key={r.file.id}
                    record={r}
                    selection={selection.file(r)}
                    snippet={snippet}
                    view={filter}
                    desktop={desktop}
                    onMove={folders ? () => setFolderDialog({ kind: "move-file", record: r }) : undefined}
                    onDragStart={browsing ? (event) => dragFile(event, r.file.id) : undefined}
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
            </>
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
          {folderDialog?.kind === "new" ? (
            <NameDialog
              title="New folder"
              submitLabel="Create"
              initial="Untitled folder"
              onClose={() => setFolderDialog(null)}
              onSubmit={(name) => {
                setFolderDialog(null);
                void (async () => {
                  await window.suiteleaf?.createFolder?.(here, name);
                  await refresh();
                })().catch((e) => setError(message(e)));
              }}
            />
          ) : null}
          {folderDialog?.kind === "rename" ? (
            <NameDialog
              title="Rename folder"
              submitLabel="OK"
              initial={folderName(folderDialog.folder)}
              onClose={() => setFolderDialog(null)}
              onSubmit={(name) => {
                const renamed = folderDialog.folder;
                setFolderDialog(null);
                if (name === folderName(renamed)) return;
                void (async () => {
                  const next = await window.suiteleaf?.renameFolder?.(renamed, name);
                  if (next !== undefined && isWithinFolder(folder, renamed))
                    setFolder(next + folder.slice(renamed.length), true);
                  await refresh();
                })().catch((e) => setError(message(e)));
              }}
            />
          ) : null}
          {folderDialog?.kind === "move-folder" && folders ? (
            <LocalMoveDialog
              name={folderName(folderDialog.folder)}
              from={parentFolder(folderDialog.folder)}
              folders={folders}
              moving={folderDialog.folder}
              onClose={() => setFolderDialog(null)}
              onMove={(target) => {
                setFolderDialog(null);
                moveInto({ folder: folderDialog.folder }, target);
              }}
            />
          ) : null}
          {folderDialog?.kind === "move-file" && folders ? (
            <LocalMoveDialog
              name={folderDialog.record.file.title}
              from={folderOf(folderDialog.record)}
              folders={folders}
              onClose={() => setFolderDialog(null)}
              onMove={(target) => {
                setFolderDialog(null);
                moveInto({ file: folderDialog.record.file.id }, target);
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
          text={undo.length === 1
            ? movedToTrashText(undo[0].file.title, desktop)
            : `${undo.length} files moved to Trash`}
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
