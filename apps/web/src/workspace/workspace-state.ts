import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { FileRecord, RegionTouch, SuiteFile } from "@suiteleaf/core";
import type * as Y from "yjs";
import { SaveQueue } from "../storage";
import type { EditorActions } from "../ui";
import { type RemoteSheetSelection, type RemoteSlideSelection } from "../collab/selection";
import type { DriveItem, DriveRole, FilePresence } from "../node-client";
import type { HistoryPreview } from "../editors/version-compare";
import { useMode } from "../mode";
import { presentationSlidePath } from "../slide-location";
import { driveQueueFor } from "../drive/drive-files";

export function useWorkspaceState() {
  const { id, slideId } = useParams();
  const navigate = useNavigate();
  const slideInUrl = useRef(slideId);
  slideInUrl.current = slideId;
  const showSlide = useCallback(
    (slide: string) => {
      if (!id || !slide || slideInUrl.current === slide) return;
      navigate(presentationSlidePath(id, slide), { replace: true });
    },
    [id, navigate],
  );
  const location = useLocation();
  const [record, setRecord] = useState<FileRecord>(),
    [error, setError] = useState(""),
    [status, setStatus] = useState("Opening…"),
    [syncRemedy, setSyncRemedy] = useState<string | null>(null),
    [locked, setLocked] = useState(false),
    [templateDraft, setTemplateDraft] = useState<SuiteFile | null>(null);
  const [actionsReady, setActionsReady] = useState(false);
  const current = useRef<FileRecord>(undefined),
    version = useRef(0),
    savedVersion = useRef(0),
    queue = useRef(new SaveQueue()),
    timer = useRef<ReturnType<typeof setTimeout>>(undefined),
    historyTimer = useRef<ReturnType<typeof setTimeout>>(undefined),
    actions = useRef<EditorActions>(undefined),
    alive = useRef(true),
    saveError = useRef(""),
    driveQueue = useRef(driveQueueFor(id!)),
    driveTimer = useRef<ReturnType<typeof setTimeout>>(undefined),
    driveConflictRef = useRef<DriveItem | null>(null),
    /** The last file body that matched SuiteDrive, used to combine later edits. */
    agreedContent = useRef<SuiteFile | null>(null),
    /** True while this tab is uploading, so the remote poll ignores our own head. */
    driveSyncing = useRef(false),
    /** Bumped when a remote save replaces the open file, so a queued upload of the old bytes is dropped. */
    driveGeneration = useRef(0),
    snapshotExplicit = useRef(false),
    /** Folder of the open SuiteDrive file. `null` is the top of My Drive. */
    driveParentId = useRef<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  /** The file whose import notes were closed. Opening another file brings them back. */
  const [importNotesClosed, setImportNotesClosed] = useState<string | null>(null);
  const [sidePaneSlot, setSidePaneSlot] = useState<HTMLElement | null>(null);
  const [menusOpen, setMenusOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const menuBar = useRef<HTMLDivElement>(null);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [historyPreview, setHistoryPreview] = useState<HistoryPreview | null>(
    null,
  );
  const restoreParagraph = useRef<(key: string) => void>(() => {});
  const [driveConflict, setDriveConflictState] = useState<DriveItem | null>(
      null,
    ),
    [driveDialog, setDriveDialog] = useState<"open" | "save" | null>(null),
    [shareOpen, setShareOpen] = useState(false),
    [signUpOpen, setSignUpOpen] = useState(false),
    [driveRole, setDriveRole] = useState<DriveRole | "local" | null>(null),
    [othersHere, setOthersHere] = useState<FilePresence[]>([]),
    { mode } = useMode(),
    cluster = mode.kind === "cluster";
  useEffect(() => {
    if (!menusOpen) return;
    const position = () => {
      const button = menuButton.current;
      const menu = menuBar.current;
      if (!button?.closest(".editor-toolbar-navigation") || !menu) return;
      const bounds = button.getBoundingClientRect();
      const top = Math.min(bounds.bottom + 4, Math.max(8, window.innerHeight - 120));
      menu.style.top = `${top}px`;
      menu.style.left = `${Math.max(8, Math.min(bounds.left, window.innerWidth - menu.offsetWidth - 8))}px`;
      menu.style.maxHeight = `${Math.min(520, window.innerHeight * 0.7, window.innerHeight - top - 8)}px`;
    };
    position();
    const positionedMenu = menuBar.current;
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    const close = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setMenusOpen(false);
        return;
      }
      if (menuButton.current?.contains(target) || menuBar.current?.contains(target))
        return;
      if (target instanceof Element && target.closest(".menu-content")) return;
      setMenusOpen(false);
    };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      positionedMenu?.style.removeProperty("top");
      positionedMenu?.style.removeProperty("left");
      positionedMenu?.style.removeProperty("max-height");
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", close);
    };
  }, [menusOpen]);
  const canEditRef = useRef(true);
  const canSaveRef = useRef(true);
  const canEdit =
    driveRole === "local" || driveRole === "editor" || driveRole === "owner";
  const canSave =
    canEdit || (driveRole === "responder" && record?.file.kind === "form");
  const collabTouch = useRef({ unit: "paragraph", key: "0" });
  const sendSelection = useRef<(anchor: number, head: number) => void>(() => {});
  const sendSheetSelection = useRef<(selection: {
    sheetId: string;
    startRow: number;
    startColumn: number;
    endRow: number;
    endColumn: number;
  }) => void>(() => {});
  const [remoteCarets, setRemoteCarets] = useState<{ name: string; anchor: number; head: number }[]>(
    [],
  );
  const [remoteSheetSelections, setRemoteSheetSelections] = useState<RemoteSheetSelection[]>([]);
  const sendSlideSelection = useRef<(selection: { slideId: string; elementId?: string }) => void>(
    () => {},
  );
  const [remoteSlideSelections, setRemoteSlideSelections] = useState<RemoteSlideSelection[]>([]);
  const collabLog = useRef<RegionTouch[]>([]);
  const collabBaseline = useRef<SuiteFile | null>(null);
  const describeRef = useRef<(id: string) => void>(() => {});
  const [collabDoc, setCollabDoc] = useState<Y.Doc | null>(null);
  const [roomNotice, setRoomNotice] = useState<string | null>(null);
  const collabDocRef = useRef<Y.Doc | null>(null);
  collabDocRef.current = collabDoc;
  const setDriveConflict = (item: DriveItem | null) => {
    driveConflictRef.current = item;
    setDriveConflictState(item);
  };
  return {
    id, slideId, navigate, showSlide, location, record, setRecord, error, setError,
    status, setStatus, syncRemedy, setSyncRemedy, locked, setLocked, templateDraft,
    setTemplateDraft, actionsReady, setActionsReady, current, version,
    savedVersion, queue, timer, historyTimer, actions, alive, saveError,
    driveQueue, driveTimer, driveConflictRef, agreedContent, driveSyncing,
    driveGeneration, snapshotExplicit, driveParentId, historyOpen, setHistoryOpen,
    importNotesClosed, setImportNotesClosed, sidePaneSlot, setSidePaneSlot,
    menusOpen, setMenusOpen, menuButton, menuBar, editorEpoch, setEditorEpoch,
    historyPreview, setHistoryPreview, restoreParagraph, driveConflict,
    driveDialog, setDriveDialog, shareOpen, setShareOpen, signUpOpen,
    setSignUpOpen, driveRole, setDriveRole, othersHere, setOthersHere, mode,
    cluster, canEditRef, canSaveRef, canEdit, canSave, collabTouch, sendSelection,
    sendSheetSelection, remoteCarets, setRemoteCarets, remoteSheetSelections,
    setRemoteSheetSelections, sendSlideSelection, remoteSlideSelections,
    setRemoteSlideSelections, collabLog, collabBaseline, describeRef, collabDoc,
    setCollabDoc, roomNotice, setRoomNotice, collabDocRef, setDriveConflict,
  };
}

export type WorkspaceState = ReturnType<typeof useWorkspaceState>;
