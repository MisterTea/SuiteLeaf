/**
 * Fakes for the workspace tests. Each test file mocks a module by importing
 * the matching object from here, so the editor, network, storage and side
 * panels are replaced the same way everywhere.
 */
import { useEffect } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { vi } from "vitest";
import { parseFile, type AppMode, type FileRecord, type SuiteFile } from "../../packages/core/src";

const memory = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, String(value)),
    removeItem: (key: string) => void memory.delete(key),
    clear: () => memory.clear(),
    key: (i: number) => [...memory.keys()][i] ?? null,
    get length() {
      return memory.size;
    },
  },
});

type Props = Record<string, unknown>;
type Build = () => {
  kind: string;
  place: () => string;
  snapshot: () => string;
  tools: { name: string }[];
};

export const fake = {
  records: new Map<string, FileRecord>(),
  saves: [] as FileRecord[],
  failSave: null as null | string,
  opened: null as null | FileRecord,
  saveAsResult: undefined as undefined | null | FileRecord,
  session: null as null | { url: string; user: { id: string; name?: string } },
  editor: null as null | Props,
  actions: null as null | ReturnType<typeof makeActions>,
  hosts: {} as Record<string, Build>,
  wsCtx: null as null | Record<string, never>,
  conflictCtx: null as null | Record<string, never>,
  room: null as null | Props,
  seed: true,
  summary: "A short summary." as string | null,
  localVersions: [] as { id: string; createdAt: string; authorName: string; name: string | null; native: string }[],
  history: null as null | Props,
  browser: null as null | Props,
  moveDialog: null as null | Props,
  shareNotices: null as null | Props,
  reset() {
    this.records.clear();
    this.saves = [];
    this.failSave = null;
    this.opened = null;
    this.saveAsResult = undefined;
    this.session = null;
    this.editor = null;
    this.actions = makeActions();
    this.hosts = {};
    this.wsCtx = null;
    this.conflictCtx = null;
    this.room = null;
    this.seed = true;
    this.summary = "A short summary.";
    this.localVersions = [];
    this.history = null;
    this.browser = null;
    this.moveDialog = null;
    this.shareNotices = null;
    memory.clear();
    for (const group of [driveApi, nodeExtras, storageExtras, editorExtras])
      for (const fn of Object.values(group)) fn.mockReset();
    driveApi.get.mockImplementation(async (id: string) => driveItem(id));
    driveApi.listFolders.mockResolvedValue([]);
    driveApi.presence.mockResolvedValue([]);
    driveApi.reportPresence.mockResolvedValue(undefined);
    storageExtras.exportText.mockResolvedValue(undefined);
    editorExtras.noteLocalSnapshot.mockResolvedValue(undefined);
    editorExtras.frogSummary.mockImplementation(async () => fake.summary);
    editorExtras.localVersions.mockImplementation(async () => fake.localVersions);
    editorExtras.restoreLocalVersion.mockImplementation(async (snap: { native: string }) =>
      parseFile(snap.native),
    );
  },
};

export function makeActions() {
  const actions = {
    flush: vi.fn(async () => {}),
    export: vi.fn(async () => undefined),
    print: vi.fn(async () => {}),
    present: vi.fn(),
    docActions: { toggleComments: vi.fn(), openPageSetup: vi.fn() },
    sheetActions: {
      openComments: vi.fn() as undefined | (() => void),
      openPrintSettings: vi.fn(),
      view: () => ({
        frozenRows: 0,
        frozenColumns: 0,
        row: 1,
        column: 1,
        maxFrozenRows: 10,
        maxFrozenColumns: 10,
        gridlines: true,
        formulaBar: true,
      }),
    },
    slideActions: { toggleComments: vi.fn() },
  };
  return actions;
}

export function driveItem(id: string, extra: Props = {}) {
  return {
    id,
    parentId: null,
    name: "Plan.sldoc",
    kind: "file",
    ownerId: "ada",
    mime: null,
    size: 1,
    headVersionId: "v1",
    contentHash: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    trashed: false,
    role: "owner",
    available: true,
    ...extra,
  };
}

class DriveConflict extends Error {
  constructor(public item: { id: string }) {
    super("This file was changed in SuiteDrive after you opened it.");
  }
}

export const driveApi = {
  get: vi.fn(),
  read: vi.fn(),
  versions: vi.fn(),
  readVersion: vi.fn(),
  restoreVersion: vi.fn(),
  copyVersion: vi.fn(),
  reportPresence: vi.fn(),
  presence: vi.fn(),
  listFolders: vi.fn(),
  update: vi.fn(),
};
export const nodeExtras = {
  uploadDriveFile: vi.fn(),
  openDriveFile: vi.fn(),
  saveNewDriveFile: vi.fn(),
  signOut: vi.fn(),
  uploadDriveSpan: vi.fn(),
  retryOtherDueUploads: vi.fn(),
};
export const storageExtras = {
  exportText: vi.fn(),
  saveAs: vi.fn(),
};
export const editorExtras = {
  frogSummary: vi.fn(),
  mirrorLiveEdit: vi.fn(),
  localVersions: vi.fn(),
  restoreLocalVersion: vi.fn(),
  noteLocalSnapshot: vi.fn(),
  rememberDriveFolder: vi.fn(),
  combineDocuments: vi.fn(),
  keepBothSheets: vi.fn(),
  keepBothSlides: vi.fn(),
  keepBothForms: vi.fn(),
  keepBothDrawings: vi.fn(),
  keepSelectedCells: vi.fn(),
};

export const nodeClientModule = {
  drive: driveApi,
  getSession: () => fake.session,
  DriveConflict,
  uploadDriveFile: nodeExtras.uploadDriveFile,
  openDriveFile: nodeExtras.openDriveFile,
  saveNewDriveFile: nodeExtras.saveNewDriveFile,
  signOut: nodeExtras.signOut,
};

class SaveQueue {
  private tail: Promise<unknown> = Promise.resolve();
  enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.catch(() => {}).then(work);
    this.tail = next.then(() => {});
    this.tail.catch(() => {});
    return next;
  }
  async flush() {
    await this.tail;
  }
}

export const storageModule = {
  SaveQueue,
  exportText: storageExtras.exportText,
  storage: {
    list: async () => [...fake.records.values()],
    get: async (id: string) => structuredClone(fake.records.get(id)),
    reload: async (id: string) => structuredClone(fake.records.get(id)),
    save: async (record: FileRecord) => {
      if (fake.failSave) throw new Error(fake.failSave);
      const copy = structuredClone(record);
      fake.records.set(copy.file.id, copy);
      fake.saves.push(copy);
      return structuredClone(copy);
    },
    remove: async (id: string) => void fake.records.delete(id),
    open: async () => fake.opened,
    saveAs: async (record: FileRecord) => {
      storageExtras.saveAs(record);
      return fake.saveAsResult === undefined ? record : fake.saveAsResult;
    },
  },
};

function FakeEditor(props: Props) {
  fake.editor = props;
  const onActions = props.onActions as (a: unknown) => void;
  useEffect(() => onActions(fake.actions), [onActions]);
  const file = props.file as SuiteFile;
  return (
    <div data-testid="editor">
      {file.kind}:{file.title}:{props.readOnly ? "read-only" : "editable"}
    </div>
  );
}
export const editorModule = { default: FakeEditor };

export const versionHistoryModule = {
  VersionHistory: (props: Props) => {
    fake.history = props;
    return <aside aria-label="Version history panel" />;
  },
  VersionPreview: (props: { label: string; onRestoreParagraph: (key: string) => void }) => (
    <section aria-label="Version preview">
      {props.label}
      <button type="button" onClick={() => props.onRestoreParagraph("p1")}>
        Restore paragraph
      </button>
    </section>
  ),
};
export const versionCompareModule = {
  SheetVersionPreview: ({ label }: { label: string }) => <section aria-label="Sheet preview">{label}</section>,
  SlideVersionPreview: ({ label }: { label: string }) => <section aria-label="Slide preview">{label}</section>,
};
export const galleryModule = {
  SaveTemplateDialog: ({ onSaved, onClose }: { onSaved: (name: string) => void; onClose: () => void }) => (
    <div role="dialog" aria-label="Save template">
      <button type="button" onClick={() => onSaved("Weekly")}>
        Save template
      </button>
      <button type="button" onClick={onClose}>
        Close template
      </button>
    </div>
  ),
};
export const aiHostModule = {
  useAgentHost: (id: string, build: Build) => {
    fake.hosts[id] = build;
  },
};
export const aiFilesModule = {
  versionPreview: (native: string) => `preview of ${native.length} characters`,
  workspaceSnapshot: () => "workspace snapshot.",
  workspaceTools: (ctx: Record<string, never>) => {
    fake.wsCtx = ctx;
    return [{ name: "workspace-tool" }];
  },
};
export const aiClusterModule = {
  conflictTools: (input: Record<string, never>) => {
    fake.conflictCtx = input;
    return [{ name: "conflict-tool" }];
  },
};
export const collabSessionModule = {
  useDocumentRoom: (options: Props) => {
    fake.room = options;
  },
  shouldSeedDocument: () => fake.seed,
  mirrorLiveEdit: editorExtras.mirrorLiveEdit,
};
export const summarizeModule = { frogSummary: editorExtras.frogSummary };
export const localVersionsModule = {
  localVersions: editorExtras.localVersions,
  restoreLocalVersion: editorExtras.restoreLocalVersion,
  noteLocalSnapshot: editorExtras.noteLocalSnapshot,
};
export const driveBrowserModule = {
  DriveBrowser: (props: Props) => {
    fake.browser = props;
    return <div role="dialog" aria-label={`Drive ${String(props.mode)}`} />;
  },
  rememberDriveFolder: editorExtras.rememberDriveFolder,
};
export const shareDialogModule = {
  ShareDialog: ({ onClose, itemName }: { onClose: () => void; itemName: string }) => (
    <div role="dialog" aria-label={`Share ${itemName}`}>
      <button type="button" onClick={onClose}>
        Close share
      </button>
    </div>
  ),
};
export const signUpLinkModule = {
  SignUpLinkDialog: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="Sign-up link dialog">
      <button type="button" onClick={onClose}>
        Close sign-up
      </button>
    </div>
  ),
};
export const moveDialogModule = {
  MoveDialog: (props: Props) => {
    fake.moveDialog = props;
    return <div role="dialog" aria-label="Move dialog" />;
  },
};
export const shareNoticesModule = {
  ShareNotices: (props: Props) => {
    fake.shareNotices = props;
    return null;
  },
};
export const lastEditedModule = { LastEdited: () => null };
export const fileCommentsModule = {
  FileComments: ({ canPost, wordingStays, onClose }: { canPost: boolean; wordingStays: boolean; onClose?: () => void }) => (
    <section aria-label="File comments">
      {canPost ? "can post" : "read only"}
      {wordingStays ? " · wording stays" : ""}
      {onClose ? <button aria-label="Close comments" onClick={onClose} /> : null}
    </section>
  ),
};
export const failedUploadsModule = {
  EditorFailedUploads: () => null,
  retryOtherDueUploads: nodeExtras.retryOtherDueUploads,
};
export const uploadSpanModule = { uploadDriveSpan: nodeExtras.uploadDriveSpan };
export const conflictMergeModule = {
  combineDocuments: editorExtras.combineDocuments,
  keepBothSheets: editorExtras.keepBothSheets,
  keepBothSlides: editorExtras.keepBothSlides,
  keepBothForms: editorExtras.keepBothForms,
  keepBothDrawings: editorExtras.keepBothDrawings,
  keepSelectedCells: editorExtras.keepSelectedCells,
  keptLocalCopy: (file: SuiteFile) => ({ ...file, id: `${file.id}-kept`, title: `${file.title} (kept)` }),
};
export const conflictCellsModule = {
  ConflictCells: ({ onTake }: { onTake: (cells: string[]) => void }) => (
    <button type="button" onClick={() => onTake(["A1"])}>
      Take cells
    </button>
  ),
};
export const agentSidebarModule = { AiButton: () => null };

/**
 * Run a menu command through the command palette, as Option+/ search does.
 * `path` is the menu path, such as "File › Make a copy".
 */
export async function runMenu(path: string) {
  const label = path.split(" › ").pop()!;
  fireEvent.keyDown(window, { key: "/", code: "Slash", altKey: true });
  const input = screen.getByPlaceholderText("Search the menus");
  fireEvent.change(input, { target: { value: label } });
  const options = screen.queryAllByRole("option");
  const option = options.find((o) => o.querySelector(".command-path")?.textContent === path);
  if (!option)
    throw new Error(
      `No command "${path}" among: ${options.map((o) => o.querySelector(".command-path")?.textContent).join(" | ")}`,
    );
  if (option.getAttribute("aria-disabled") === "true") throw new Error(`"${path}" is disabled`);
  fireEvent.mouseDown(option);
  await act(() => new Promise((done) => setTimeout(done, 0)));
}

export const paths: string[] = [];
function Probe() {
  const location = useLocation();
  paths.push(location.pathname + location.search);
  return <span data-testid="path">{location.pathname + location.search}</span>;
}

/** Render the workspace at `/file/:id`, with the given mode. */
export async function renderWorkspace(
  Workspace: () => React.ReactNode,
  ModeContext: React.Context<{ mode: AppMode; locked: boolean; demo: boolean }>,
  id: string,
  mode: AppMode = { kind: "single" },
  state?: unknown,
) {
  paths.length = 0;
  return render(
    <ModeContext.Provider value={{ mode, locked: false, demo: false }}>
      <MemoryRouter initialEntries={[{ pathname: `/file/${id}`, state }]}>
        <Routes>
          <Route path="/file/:id/:slideId?" element={<Workspace />} />
          <Route path="*" element={<p>Somewhere else</p>} />
        </Routes>
        <Probe />
      </MemoryRouter>
    </ModeContext.Provider>,
  );
}
