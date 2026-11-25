import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import {
  ChevronRight,
  CloudOff,
  FileText,
  Folder,
  FolderPlus,
  MoreVertical,
  Presentation,
  Sheet,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { isNativeName, kindFromName } from "@suiteleaf/core";
import {
  drive,
  type DriveItem,
  type DriveSearchHit,
} from "../node-client";
import {
  BulkProgressDialog,
  DriveDialog,
  OpeningDialog,
  type BulkProgressState,
} from "./drive-dialog";
import { NameDialog } from "./name-dialog";
export { NameDialog } from "./name-dialog";
import { MoveBanner, type MoveNotice } from "./file-folder";
import { MoveDialog } from "./MoveDialog";
import { versionWhen } from "../editors/version-history-model";
import { DRIVE_SAVED, lastEditOf } from "./last-edit";
import { visiblePoll } from "./visible-poll";
import { accessLabel } from "./roles";
import { ShareNotices } from "./share-notices";
import { formatModified } from "./status";
import {
  driveRoot as rootOf,
  type DriveCrumb as Crumb,
  type DrivePlace as Place,
} from "./drive-folder-url";
import {
  useDriveFolderRoute,
  type DriveFolderRoute,
} from "./use-drive-folder-route";
import { driveFileUrl } from "./drive-files";
import { place } from "./drive-place";
import { DriveMenuPopup } from "./DriveMenuPopup";
import { ShareDialog } from "./ShareDialog";
import { listedFileMenu, useDriveFileActions } from "./drive-file-actions";
import {
  DEFAULT_DRIVE_SORT,
  formatDriveSize,
  sortDriveItems,
  type DriveSort,
} from "./drive-sort";
import { DriveSelectionBar } from "./DriveSelectionBar";
import { MY_DRIVE, type MoveDestination } from "./folder-paths";
import { BulkMoveDialog } from "./BulkMoveDialog";
import { useDriveSelection } from "./drive-selection";
export { rememberDriveFolder } from "./drive-place";
export { DriveDialog } from "./drive-dialog";

/** The visible SuiteDrive folder and what can be done in it. */
export interface DriveControl {
  path: string[];
  items: DriveItem[];
  loading: boolean;
  /** Open a folder, or a file (in open mode), as clicking it does. */
  choose: (item: DriveItem) => void;
  /** Open a file in a new tab. */
  openInNewTab?: (item: DriveItem) => void;
  /** Go up to a folder in the path (1 = the top). */
  goTo: (depth: number) => void;
  switchView: (view: "mine" | "shared") => void;
  newFolder: (name: string) => Promise<void>;
}

function ItemIcon({ item }: { item: { name: string; kind: string } }) {
  if (item.kind === "folder") return <Folder size={18} className="drive-folder-icon" />;
  const kind = kindFromName(item.name);
  return (
    <span className={`file-icon ${kind ?? ""}`}>
      {kind === "sheet" ? (
        <Sheet size={15} />
      ) : kind === "slide" ? (
        <Presentation size={15} />
      ) : (
        <FileText size={15} />
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
  onOpenInNewTab,
  onSave,
  onClose,
  onFolderChange,
  refreshKey,
  control,
  startIn,
  folderRoute,
}: {
  mode: "open" | "save";
  /** Home's router location; dialogs keep their navigation local. */
  folderRoute?: DriveFolderRoute;
  defaultName?: string;
  inline?: boolean;
  /** Open this folder instead of the top of My Drive. Used by the editor's Open and Save as. */
  startIn?: { id: string; name: string } | null;
  onOpen?: (item: DriveItem, signal?: AbortSignal) => void | Promise<void>;
  /** Open a file in a new window or tab. */
  onOpenInNewTab?: (item: DriveItem) => void;
  onSave?: (folderId: string | null, name: string) => void | Promise<void>;
  onClose?: () => void;
  /** The folder new items should go in; `null` is the top of My Drive. */
  onFolderChange?: (folderId: string | null, name: string) => void;
  /** Changing this re-lists the folder in place, e.g. when replication
   * brings in changes from another server. */
  refreshKey?: string;
  /** Receives the browser's current folder and actions, for the assistant. */
  control?: RefObject<DriveControl | null>;
}) {
  const [initial] = useState(() =>
    startIn
      ? {
          view: "mine" as const,
          path: [
            { id: null, name: "My Drive" },
            { id: startIn.id, name: startIn.name },
          ],
        }
      : (inline && place.load()) || rootOf("mine"),
  );
  const [currentPlace, setPlace] = useState<Place>(initial);
  const { view, path } = currentPlace;
  const routing = useDriveFolderRoute(folderRoute, currentPlace, setPlace);
  const { visit } = routing;
  const setPath = useCallback(
    (next: Crumb[] | ((path: Crumb[]) => Crumb[])) =>
      visit({ view, path: typeof next === "function" ? next(path) : next }),
    [view, path, visit],
  );
  const [items, setItems] = useState<DriveItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<BulkProgressState | null>(null);
  const bulkCancelled = useRef(false);
  const openAbort = useRef<AbortController | null>(null);
  const openToken = useRef(0);
  const [error, setError] = useState("");
  const [name, setName] = useState(defaultName);
  const [kept, setKept] = useState("");
  const [asking, setAsking] = useState<
    | { action: "new-folder" }
    | { action: "rename" | "delete-forever"; item: DriveItem }
    | { action: "delete-forever-bulk"; items: DriveItem[] }
    | null
  >(null);
  const [notice, setNotice] = useState<{
    items: { id: string; name: string }[];
  } | null>(null);
  const [moving, setMoving] = useState<DriveItem | null>(null);
  const [bulkMoving, setBulkMoving] = useState<DriveItem[] | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const menuPopup = useRef<HTMLDivElement>(null);
  const shiftPressed = useRef(false);
  const [moveNotice, setMoveNotice] = useState<
    (MoveNotice & {
      items: { id: string; name: string; previousParentId: string | null }[];
    }) | null
  >(null);
  const restored = useRef(initial.path.length > 1);
  const seenEdit = useRef(new Map<string, string>());
  const flash = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [justEdited, setJustEdited] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<DriveSort>(DEFAULT_DRIVE_SORT);
  const [outcome, setOutcome] = useState<
    | { query: string; hits: DriveSearchHit[] }
    | { query: string; failed: true }
    | null
  >(null);
  const folder = path[path.length - 1];
  const shown = useRef(""),
    request = useRef(0);

  const refresh = useCallback(async () => {
    if (routing.pending || routing.error) return;
    const key = `${view}:${folder.id}`;
    const n = ++request.current;
    // Re-listing the folder already on screen keeps it there meanwhile.
    if (shown.current !== key) setLoading(true);
    try {
      const next =
        view === "trash"
          ? await drive.listTrashed()
          : view === "shared" && folder.id === null
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
  }, [folder.id, view, routing.pending, routing.error, setPath]);
  useEffect(() => {
    if (routing.pending || routing.error) request.current++;
    else void refresh();
  }, [refresh, refreshKey, routing.pending, routing.error]);
  useLayoutEffect(() => {
    const trigger = menuTrigger.current;
    const popup = menuPopup.current;
    if (!menuId || !popup || (!trigger && !menuPoint)) return;
    const position = () => {
      const { width, height } = popup.getBoundingClientRect();
      const gap = 6;
      if (menuPoint) {
        const top =
          menuPoint.y + height <= window.innerHeight - gap
            ? menuPoint.y
            : Math.max(gap, menuPoint.y - height);
        const left =
          menuPoint.x + width <= window.innerWidth - gap
            ? menuPoint.x
            : Math.max(gap, menuPoint.x - width);
        popup.style.top = `${top}px`;
        popup.style.left = `${left}px`;
      } else if (trigger) {
        const anchor = trigger.getBoundingClientRect();
        const below = anchor.bottom + gap;
        const above = anchor.top - height - gap;
        const top = below + height <= window.innerHeight - gap ? below : above;
        popup.style.top = `${Math.max(gap, top)}px`;
        popup.style.left = `${Math.max(gap, Math.min(anchor.right - width, window.innerWidth - width - gap))}px`;
      }
    };
    position();
    if (trigger && document.activeElement === trigger) popup.querySelector("button")?.focus({ preventScroll: true });

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if ((!trigger || !trigger.contains(target)) && !popup.contains(target)) {
        setMenuId(null);
        setMenuPoint(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenuId(null);
      setMenuPoint(null);
      trigger?.focus({ preventScroll: true });
    };
    const onScroll = (e: Event) => {
      if (!(e.target instanceof Node) || !popup.contains(e.target)) position();
    };
    const onResize = () => {
      setMenuId(null);
      setMenuPoint(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [menuId, menuPoint, items]);
  // An empty box stays on the folder. A short pause lets a recording type
  // the whole word before the list switches to results.
  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void drive.search(q).then(
        (hits) => {
          if (!cancelled) setOutcome({ query: q, hits });
        },
        (e) => {
          if (!cancelled) {
            setOutcome({ query: q, failed: true });
            setError(e instanceof Error ? e.message : String(e));
          }
        },
      );
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);
  useEffect(() => {
    const changed: string[] = [];
    const next = new Map<string, string>();
    for (const item of items) {
      const edit = lastEditOf(item);
      const label = edit ? `${edit.name}\n${edit.at}` : "";
      next.set(item.id, label);
      const previous = seenEdit.current.get(item.id);
      if (previous !== undefined && previous !== label) changed.push(item.id);
    }
    seenEdit.current = next;
    if (!changed.length) return;
    setJustEdited(new Set(changed));
    clearTimeout(flash.current);
    flash.current = setTimeout(() => setJustEdited(new Set()), 2400);
  }, [items]);
  useEffect(
    () => () => {
      clearTimeout(flash.current);
      openAbort.current?.abort();
    },
    [],
  );
  // Another person can save, or share, while this list is already open.
  useEffect(() => {
    return visiblePoll(refresh, 10_000, { immediate: false, events: [DRIVE_SAVED] });
  }, [refresh]);
  useEffect(() => {
    if (routing.pending || routing.error) return;
    onFolderChange?.(folder.id, folder.name);
    if (inline) place.save({ view, path });
  }, [folder.id, folder.name, onFolderChange, inline, view, path, routing.pending, routing.error]);

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
    routing.visit(rootOf(next));
    setKept("");
  };
  const openTrash = () => {
    routing.visit(rootOf("trash"));
    setKept("");
  };
  const runBulk = useCallback(
    async <T extends { name?: string }>(
      label: string,
      targets: readonly T[],
      step: (target: T) => Promise<void>,
    ): Promise<T[]> => {
      const showProgress = targets.length > 1;
      bulkCancelled.current = false;
      if (showProgress) {
        setBulkProgress({
          label,
          completed: 0,
          total: targets.length,
          currentName: targets[0]?.name,
        });
      }
      const processed: T[] = [];
      try {
        for (let i = 0; i < targets.length; i++) {
          if (bulkCancelled.current) break;
          const target = targets[i];
          if (showProgress) {
            setBulkProgress({
              label,
              completed: i,
              total: targets.length,
              currentName: target.name,
            });
          }
          await step(target);
          processed.push(target);
          if (showProgress) {
            setBulkProgress({
              label,
              completed: i + 1,
              total: targets.length,
              currentName: targets[i + 1]?.name,
            });
          }
        }
        return processed;
      } finally {
        if (showProgress) setBulkProgress(null);
        bulkCancelled.current = false;
      }
    },
    [],
  );

  const moveItemsToTrash = (targets: readonly DriveItem[], onDone?: () => void) => {
    if (targets.length === 0) return;
    void act(async () => {
      const trashed = await runBulk(
        `Moving ${targets.length} items to Trash`,
        targets,
        async (target) => {
          await drive.update(target.id, { trashed: true });
        },
      );
      if (trashed.length > 0) {
        setNotice({ items: trashed.map((t) => ({ id: t.id, name: t.name })) });
      }
      onDone?.();
      await refresh();
    });
  };
  const moveToTrash = (item: DriveItem) => moveItemsToTrash([item]);
  const restoreItems = (targets: readonly DriveItem[], onDone?: () => void) => {
    if (targets.length === 0) return;
    void act(async () => {
      const restored = await runBulk(
        `Restoring ${targets.length} items`,
        targets,
        async (target) => {
          await drive.update(target.id, { trashed: false });
        },
      );
      const restoredIds = new Set(restored.map((t) => t.id));
      if (restoredIds.size > 0) {
        setNotice((current) => {
          if (!current) return null;
          const remaining = current.items.filter((i) => !restoredIds.has(i.id));
          return remaining.length > 0 ? { items: remaining } : null;
        });
      }
      onDone?.();
      await refresh();
    });
  };
  const undoNotice = () => {
    if (!notice) return;
    const snapshot = notice;
    void act(async () => {
      await runBulk(
        `Restoring ${snapshot.items.length} items`,
        snapshot.items,
        async (item) => {
          await drive.update(item.id, { trashed: false });
        },
      );
      setNotice((current) => (current === snapshot ? null : current));
      await refresh();
    });
  };
  const undoMove = () => {
    if (!moveNotice) return;
    const snapshot = moveNotice;
    void act(async () => {
      await runBulk(
        `Moving ${snapshot.items.length} files`,
        snapshot.items,
        async (moved) => {
          await drive.update(moved.id, { parentId: moved.previousParentId });
        },
      );
      setMoveNotice((current) => (current === snapshot ? null : current));
      await refresh();
    });
  };
  const moveMultipleFiles = (
    targets: readonly DriveItem[],
    destination: MoveDestination,
  ) => {
    const toMove = targets.filter((item) => item.parentId !== destination.id);
    if (toMove.length === 0) return;
    void act(async () => {
      let folderName = destination.id == null ? MY_DRIVE : destination.name;
      const moved: { id: string; name: string; previousParentId: string | null }[] = [];
      await runBulk(`Moving ${toMove.length} files`, toMove, async (item) => {
        const updated = await drive.update(item.id, { parentId: destination.id });
        if (destination.id != null && updated.parentName) {
          folderName = updated.parentName;
        }
        moved.push({
          id: item.id,
          name: item.name,
          previousParentId: item.parentId,
        });
      });
      if (moved.length > 0) {
        setMoveNotice({
          items: moved,
          fileName: moved.length === 1 ? moved[0].name : `${moved.length} files`,
          folderName,
          previousParentId: moved[0].previousParentId,
        });
      }
      selection.clear();
      await refresh();
    });
  };

  const cancelOpen = () => {
    openToken.current++;
    openAbort.current?.abort();
    openAbort.current = null;
    setOpening(null);
    setBusy(false);
  };

  const open = (name: string, work: (signal: AbortSignal) => Promise<void>) => {
    if (busy) return;
    const controller = new AbortController();
    const token = ++openToken.current;
    openAbort.current = controller;
    setOpening(name);
    setError("");
    setBusy(true);
    return work(controller.signal)
      .catch((e) => {
        if (controller.signal.aborted || openToken.current !== token) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (openToken.current === token) {
          openAbort.current = null;
          setOpening(null);
          setBusy(false);
        }
      });
  };

  const select = async (item: DriveItem, signal?: AbortSignal) => {
    if (signal?.aborted) return;
    if (item.kind === "folder")
      setPath((p) => [...p, { id: item.id, name: item.name }]);
    else if (mode === "open" && isNativeName(item.name))
      await onOpen?.(item, signal);
    else if (mode === "save") setName(item.name);
  };
  const openInNewTab = useCallback(
    (target: { id: string; name: string }) => {
      const tabs = window.suiteleaf?.tabs;
      if (tabs) {
        void tabs.open(`/shared/${target.id}`, target.name).catch(() => {
          window.open(driveFileUrl(target.id), "_blank");
        });
        return;
      }
      if (onOpenInNewTab) onOpenInNewTab(target as DriveItem);
      else window.open(driveFileUrl(target.id), "_blank");
    },
    [onOpenInNewTab],
  );
  const choose = (item: DriveItem) => {
    if (item.kind === "file" && mode === "open" && isNativeName(item.name)) {
      void open(item.name, (signal) => select(item, signal));
    } else {
      void select(item);
    }
  };
  const {
    sharing,
    setSharing,
    downloadDriveFile,
    downloadDriveFiles,
    copyDriveFile,
    copyDriveFiles,
    shareDriveFile,
    renameLoaded,
    moveLoaded,
  } = useDriveFileActions(act, refresh, setKept, setAsking, setMoving, runBulk);

  // The shared root is a list, not a folder; the node enforces folder roles.
  const canWrite = view === "mine" || folder.id !== null;
  const canSelect = mode === "open";

  const visible = sortDriveItems(
    items.filter(
      (i) => !routing.error && (i.kind === "folder" || mode === "save" || isNativeName(i.name)),
    ),
    sort,
  );
  const typed = query.trim();
  const selection = useDriveSelection(
    visible,
    `${view}:${folder.id ?? "root"}:${typed ? "search" : "list"}`,
  );
  if (control)
    control.current = {
      path: path.map((c) => c.name),
      items: visible,
      loading: loading || routing.pending,
      choose,
      openInNewTab,
      goTo: (depth) => setPath(path.slice(0, Math.max(1, depth))),
      switchView,
      newFolder: async (folderName) => {
        await drive.create({
          name: folderName,
          parentId: folder.id,
          kind: "folder",
        });
        await refresh();
      },
    };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) void act(async () => onSave?.(folder.id, name.trim()));
  };

  const found =
    typed && outcome && outcome.query === typed && !("failed" in outcome)
      ? outcome.hits
      : null;
  const body = (
    <div className={`drive-browser ${inline ? "inline" : ""}`}>
      <div className="drive-search">
        <label htmlFor="drive-search">Search SuiteDrive</label>
        <input
          id="drive-search"
          type="search"
          placeholder="Search names and words"
          value={query}
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="drive-toolbar">
        <div className="drive-tabs">
          <div className="drive-tablist" role="tablist">
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
          <button
            type="button"
            aria-pressed={view === "trash"}
            className={view === "trash" ? "selected" : ""}
            onClick={openTrash}
          >
            <Trash2 size={16} />
            Trash
          </button>
        </div>
        {canWrite ? (
          <button
            className="drive-new-folder"
            disabled={busy || routing.pending || !!routing.error}
            onClick={() => setAsking({ action: "new-folder" })}
          >
            <FolderPlus size={16} />
            New folder
          </button>
        ) : null}
      </div>
      {view === "trash" ? (
        <h2 className="drive-trash-heading">Trash</h2>
      ) : (
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
      )}
      {routing.error || error ? (
        <p className="dialog-error" role="alert">
          {routing.error || error}
        </p>
      ) : null}
      {opening !== null ? (
        <OpeningDialog name={opening} onCancel={cancelOpen} />
      ) : null}
      {bulkProgress !== null ? (
        <BulkProgressDialog
          {...bulkProgress}
          onCancel={() => {
            bulkCancelled.current = true;
          }}
        />
      ) : null}
      {inline && mode === "open" && onOpen ? (
        <ShareNotices
          onOpen={(item) => open(item.name, async (signal) => onOpen(item, signal))}
        />
      ) : null}
      {kept ? (
        <p className="drive-kept" role="status">
          {kept}
        </p>
      ) : null}
      {notice ? (
        <div className="drive-trash-banner" role="status">
          <p>
            {notice.items.length === 1
              ? `${notice.items[0].name} is in Trash.`
              : `${notice.items.length} items are in Trash.`}
          </p>
          <span className="drive-trash-banner-actions">
            <button type="button" onClick={undoNotice} disabled={busy}>
              Undo
            </button>
            <button
              type="button"
              onClick={() => setNotice(null)}
              disabled={busy}
            >
              Dismiss
            </button>
          </span>
        </div>
      ) : null}
      {moveNotice ? (
        <MoveBanner
          notice={moveNotice}
          busy={busy}
          onUndo={undoMove}
          onDismiss={() => setMoveNotice(null)}
        />
      ) : null}
      {!typed && !routing.error ? (
        <DriveSelectionBar
          selectable={canSelect}
          view={view}
          sort={sort}
          onSortChange={setSort}
          totalCount={visible.length}
          selected={selection.selected}
          allSelected={selection.allSelected}
          someSelected={selection.someSelected}
          disabled={busy || loading || routing.pending}
          onToggleAll={selection.toggleAll}
          onClearSelection={selection.clear}
          onDownload={(files) => downloadDriveFiles(files)}
          onMove={(files) => {
            if (files.length === 1) setMoving(files[0]);
            else if (files.length > 1) setBulkMoving(files);
          }}
          onCopy={(files) => copyDriveFiles(files, selection.clear)}
          onTrash={(targets) => moveItemsToTrash(targets, selection.clear)}
          onRestore={(targets) => restoreItems(targets, selection.clear)}
          onDeleteForever={(targets) => {
            if (targets.length === 1)
              setAsking({ action: "delete-forever", item: targets[0] });
            else if (targets.length > 1)
              setAsking({ action: "delete-forever-bulk", items: targets });
          }}
        />
      ) : null}
      <div
        className="drive-list"
        role="list"
        aria-busy={loading || (!!typed && found === null && !error)}
      >
        {typed ? (
          found === null ? (
            <p className="drive-empty">{error ? "" : "Searching…"}</p>
          ) : found.length === 0 ? (
            <p className="drive-empty" role="status">
              No files match.
            </p>
          ) : (
            found.map((hit) => (
              <div
                className="drive-row"
                role="listitem"
                key={hit.id}
                onContextMenu={(e) => {
                  if (mode !== "open") return;
                  e.preventDefault();
                  menuTrigger.current = null;
                  setMenuPoint({ x: e.clientX, y: e.clientY });
                  setMenuId(hit.id);
                }}
              >
                <button
                  type="button"
                  className="drive-item drive-search-hit"
                  disabled={busy}
                  onClick={(e) => {
                    if (mode === "open" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      openInNewTab(hit);
                      return;
                    }
                    const resolveHit = async (signal?: AbortSignal) => {
                      const loaded = await drive.get(hit.id, signal);
                      await select(loaded, signal);
                    };
                    void (mode === "open" && isNativeName(hit.name)
                      ? open(hit.name, resolveHit)
                      : act(() => resolveHit()));
                  }}
                  onAuxClick={(e) => {
                    if (mode === "open" && e.button === 1) {
                      e.preventDefault();
                      openInNewTab(hit);
                    }
                  }}
                >
                  <ItemIcon item={{ name: hit.name, kind: "file" }} />
                  <span className="drive-item-label">
                    <span className="drive-item-name">{hit.name}</span>
                    <small className="drive-share-meta">{hit.parentName}</small>
                    <small className="drive-search-snippet">{hit.snippet}</small>
                  </span>
                </button>
                {mode === "open" && menuId === hit.id ? (
                  <DriveMenuPopup
                    item={hit}
                    mode={mode}
                    busy={busy}
                    popupRef={menuPopup}
                    onOpen={() => {
                      void open(hit.name, async (signal) => {
                        const loaded = await drive.get(hit.id, signal);
                        await select(loaded, signal);
                      });
                    }}
                    onOpenInNewTab={() => openInNewTab(hit)}
                    onDownload={() => downloadDriveFile(hit)}
                    onRename={() => renameLoaded(hit.id)}
                    onMove={() => moveLoaded(hit.id)}
                    onCopy={() => copyDriveFile(hit)}
                    onShare={() => shareDriveFile(hit)}
                    onClose={() => {
                      setMenuId(null);
                      setMenuPoint(null);
                    }}
                  />
                ) : null}
              </div>
            ))
          )
        ) : routing.error ? null : loading || routing.pending ? (
          <p className="drive-empty">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="drive-empty">
            {view === "trash"
              ? "The trash is empty."
              : view === "shared" && folder.id === null
                ? "Nothing has been shared with you yet."
                : "This folder is empty."}
          </p>
        ) : (
          visible.map((item) => {
            const edit = lastEditOf(item);
            const edited = edit
              ? `Last edited by ${edit.name}, ${versionWhen(edit.at)}`
              : undefined;
            return (
              <div
                className={`drive-row${justEdited.has(item.id) ? " just-edited" : ""}${canSelect && selection.isSelected(item.id) ? " is-selected" : ""}`}
                role="listitem"
                key={item.id}
                onContextMenu={(e) => {
                  if (view === "trash") return;
                  e.preventDefault();
                  menuTrigger.current = null;
                  setMenuPoint({ x: e.clientX, y: e.clientY });
                  setMenuId(item.id);
                }}
              >
                {canSelect ? (
                  <label
                    className="drive-select-cell"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      className="drive-checkbox"
                      aria-label={`Select ${item.name}`}
                      checked={selection.isSelected(item.id)}
                      disabled={busy}
                      onMouseDown={(e) => {
                        shiftPressed.current = e.shiftKey;
                      }}
                      onClickCapture={(e) => {
                        shiftPressed.current = e.shiftKey;
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                      onChange={() => {
                        const shift = shiftPressed.current;
                        shiftPressed.current = false;
                        selection.toggle(item.id, shift);
                      }}
                    />
                  </label>
                ) : null}
                <button
                  className="drive-item"
                  aria-label={item.name}
                  aria-description={edited}
                  disabled={busy}
                  onClick={(e) => {
                    if (view !== "trash") {
                      if (item.kind === "file" && mode === "open" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        openInNewTab(item);
                        return;
                      }
                      choose(item);
                    }
                  }}
                  onAuxClick={(e) => {
                    if (view !== "trash" && item.kind === "file" && mode === "open" && e.button === 1) {
                      e.preventDefault();
                      openInNewTab(item);
                    }
                  }}
                  title={
                    item.available
                      ? edited || item.name
                      : `${item.name} (still replicating)`
                  }
                >
                  <ItemIcon item={item} />
                  <span className="drive-item-label">
                    <span className="drive-item-name">{item.name}</span>
                    {view === "shared" && folder.id === null ? (
                      <small className="drive-share-meta">
                        {item.ownerName || "Someone"} · {accessLabel(item.role)}
                      </small>
                    ) : null}
                    {view === "trash" ? (
                      <small className="drive-share-meta">
                        {item.parentName ||
                          (item.parentId ? "A folder" : "My Drive")}
                      </small>
                    ) : null}
                  </span>
                  {!item.available ? (
                    <small className="drive-copying">
                      <CloudOff size={14} aria-label="Replicating" />
                      Copying…
                    </small>
                  ) : null}
                  {sort.by === "size" && item.kind === "file" ? (
                    <span className="drive-item-size">
                      {formatDriveSize(item.size)}
                    </span>
                  ) : null}
                  {edit ? (
                    <time dateTime={edit.at} title={edited} aria-live="polite">
                      <span className="drive-editor">{edit.name}{" · "}</span>
                      {versionWhen(edit.at)}
                    </time>
                  ) : (
                    <time
                      dateTime={item.updatedAt}
                      title={new Date(item.updatedAt).toLocaleString()}
                    >
                      {formatModified(item.updatedAt)}
                    </time>
                  )}
                </button>
                {view === "shared" && item.kind === "file" ? (
                  <button
                    type="button"
                    className="drive-keep"
                    title="A copy you own in My Drive. It stays if access to the original is removed."
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await drive.keepCopy(item.id);
                        setKept(
                          `Kept a copy of ${item.name} in My Drive. This copy is yours.`,
                        );
                        await refresh();
                      })
                    }
                  >
                    Keep a copy
                  </button>
                ) : null}
                {view === "trash" ? (
                  <span className="drive-row-actions">
                    <button
                      type="button"
                      className="drive-keep"
                      aria-label={`Restore ${item.name}`}
                      disabled={busy}
                      onClick={() => restoreItems([item])}
                    >
                      Restore
                    </button>
                    <button
                      type="button"
                      className="drive-keep"
                      aria-label={`Delete ${item.name} forever`}
                      disabled={busy}
                      onClick={() =>
                        setAsking({ action: "delete-forever", item })
                      }
                    >
                      Delete forever
                    </button>
                  </span>
                ) : item.role === "owner" || item.role === "editor" || (item.kind === "file" && mode === "open") ? (
                  <span className="drive-row-actions">
                    <button
                      type="button"
                      className="drive-menu-trigger"
                      aria-label={`More actions for ${item.name}`}
                      title="More actions"
                      aria-haspopup="true"
                      aria-expanded={menuId === item.id}
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuPoint(null);
                        menuTrigger.current = e.currentTarget;
                        setMenuId((prev) => (prev === item.id ? null : item.id));
                      }}
                    >
                      <MoreVertical size={16} />
                    </button>
                    {menuId === item.id ? (
                      <DriveMenuPopup
                        item={item}
                        mode={mode}
                        busy={busy}
                        popupRef={menuPopup}
                        {...listedFileMenu(item, mode, {
                          choose,
                          openInNewTab,
                          download: downloadDriveFile,
                          copy: copyDriveFile,
                          share: shareDriveFile,
                          move: setMoving,
                          rename: (target) => setAsking({ action: "rename", item: target }),
                          trash: moveToTrash,
                        })}
                        onClose={() => {
                          setMenuId(null);
                          setMenuPoint(null);
                          menuTrigger.current?.focus({ preventScroll: true });
                        }}
                      />
                    ) : null}
                  </span>
                ) : null}
              </div>
            );
          })
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
      ) : asking?.action === "delete-forever" ? (
        <DriveDialog
          title="Delete forever"
          submitLabel="Delete forever"
          onClose={() => setAsking(null)}
          onSubmit={() => {
            const { item } = asking;
            setAsking(null);
            void act(async () => {
              await drive.deleteForever(item.id);
              setNotice((current) => {
                if (!current) return null;
                const remaining = current.items.filter((i) => i.id !== item.id);
                return remaining.length > 0 ? { items: remaining } : null;
              });
              selection.clear();
              await refresh();
            });
          }}
        >
          <p className="dialog-note">
            &ldquo;{asking.item.name}&rdquo;
            {asking.item.kind === "folder" ? " and everything inside it" : ""}{" "}
            will be deleted forever. This cannot be undone.
          </p>
        </DriveDialog>
      ) : asking?.action === "delete-forever-bulk" ? (
        <DriveDialog
          title="Delete forever"
          submitLabel="Delete forever"
          onClose={() => setAsking(null)}
          onSubmit={() => {
            const targets = asking.items;
            setAsking(null);
            void act(async () => {
              const deleted = await runBulk(
                `Deleting ${targets.length} items forever`,
                targets,
                async (target) => {
                  try {
                    await drive.deleteForever(target.id);
                  } catch (err) {
                    // A child item may already have been recursively deleted with its parent folder.
                    if (
                      err &&
                      typeof err === "object" &&
                      "status" in err &&
                      err.status === 404
                    ) {
                      return;
                    }
                    throw err;
                  }
                },
              );
              const deletedIds = new Set(deleted.map((t) => t.id));
              if (deletedIds.size > 0) {
                setNotice((current) => {
                  if (!current) return null;
                  const remaining = current.items.filter((i) => !deletedIds.has(i.id));
                  return remaining.length > 0 ? { items: remaining } : null;
                });
              }
              selection.clear();
              await refresh();
            });
          }}
        >
          <p className="dialog-note">
            {asking.items.length} items will be deleted forever. This cannot be
            undone.
          </p>
        </DriveDialog>
      ) : null}
      {sharing ? (
        <ShareDialog
          itemId={sharing.id}
          itemName={sharing.name}
          kind={sharing.kind}
          onClose={() => setSharing(null)}
        />
      ) : null}
      {moving ? (
        <MoveDialog
          item={moving}
          currentName={
            moving.parentId == null
              ? "My Drive"
              : moving.parentName ||
                (folder.id === moving.parentId ? folder.name : "A folder")
          }
          includeMyDrive={moving.role === "owner" && moving.parentId != null}
          onClose={() => setMoving(null)}
          onMoved={(result) => {
            setMoveNotice({
              items: [
                {
                  id: result.item.id,
                  name: result.item.name,
                  previousParentId: result.previousParentId,
                },
              ],
              fileName: result.item.name,
              folderName: result.folderName,
              previousParentId: result.previousParentId,
            });
            setMoving(null);
            selection.clear();
            void refresh();
          }}
        />
      ) : null}
      {bulkMoving ? (
        <BulkMoveDialog
          items={bulkMoving}
          onClose={() => setBulkMoving(null)}
          onConfirm={(destination) => {
            const targets = bulkMoving;
            setBulkMoving(null);
            moveMultipleFiles(targets, destination);
          }}
        />
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
