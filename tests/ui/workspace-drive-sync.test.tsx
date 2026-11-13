// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import * as Y from "yjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFile,
  recordEdit,
  sealIfIdle,
  serializeFile,
  type AppMode,
  type FileRecord,
  type SuiteFile,
} from "../../packages/core/src";
import {
  driveApi,
  driveItem,
  editorExtras,
  fake,
  nodeClientModule,
  nodeExtras,
  paths,
  renderWorkspace,
  runMenu,
  storageExtras,
} from "./workspace-fakes";

vi.mock("../../apps/web/src/storage", async () => (await import("./workspace-fakes")).storageModule);
vi.mock("../../apps/web/src/node-client", async () => (await import("./workspace-fakes")).nodeClientModule);
vi.mock("../../apps/web/src/editors/Docs", async () => (await import("./workspace-fakes")).editorModule);
vi.mock("../../apps/web/src/editors/Sheets", async () => (await import("./workspace-fakes")).editorModule);
vi.mock("../../apps/web/src/editors/Slides", async () => (await import("./workspace-fakes")).editorModule);
vi.mock("../../apps/web/src/editors/Form", async () => (await import("./workspace-fakes")).editorModule);
vi.mock("../../apps/web/src/editors/Drawing", async () => (await import("./workspace-fakes")).editorModule);
vi.mock("../../apps/web/src/editors/version-history", async () => (await import("./workspace-fakes")).versionHistoryModule);
vi.mock("../../apps/web/src/editors/version-compare", async () => (await import("./workspace-fakes")).versionCompareModule);
vi.mock("../../apps/web/src/templates/gallery", async () => (await import("./workspace-fakes")).galleryModule);
vi.mock("../../apps/web/src/ai/host", async () => (await import("./workspace-fakes")).aiHostModule);
vi.mock("../../apps/web/src/ai/tools/files", async () => (await import("./workspace-fakes")).aiFilesModule);
vi.mock("../../apps/web/src/ai/tools/cluster", async () => (await import("./workspace-fakes")).aiClusterModule);
vi.mock("../../apps/web/src/ai/AgentSidebar", async () => (await import("./workspace-fakes")).agentSidebarModule);
vi.mock("../../apps/web/src/collab/session", async () => (await import("./workspace-fakes")).collabSessionModule);
vi.mock("../../apps/web/src/ai/summarize", async () => (await import("./workspace-fakes")).summarizeModule);
vi.mock("../../apps/web/src/editors/local-versions", async () => (await import("./workspace-fakes")).localVersionsModule);
vi.mock("../../apps/web/src/drive/DriveBrowser", async () => (await import("./workspace-fakes")).driveBrowserModule);
vi.mock("../../apps/web/src/drive/ShareDialog", async () => (await import("./workspace-fakes")).shareDialogModule);
vi.mock("../../apps/web/src/drive/SignUpLinkDialog", async () => (await import("./workspace-fakes")).signUpLinkModule);
vi.mock("../../apps/web/src/drive/MoveDialog", async () => (await import("./workspace-fakes")).moveDialogModule);
vi.mock("../../apps/web/src/drive/share-notices", async () => (await import("./workspace-fakes")).shareNoticesModule);
vi.mock("../../apps/web/src/drive/LastEdited", async () => (await import("./workspace-fakes")).lastEditedModule);
vi.mock("../../apps/web/src/drive/file-comments", async () => (await import("./workspace-fakes")).fileCommentsModule);
vi.mock("../../apps/web/src/editor-failed-uploads", async () => (await import("./workspace-fakes")).failedUploadsModule);
vi.mock("../../apps/web/src/drive/upload-span", async () => (await import("./workspace-fakes")).uploadSpanModule);
vi.mock("../../apps/web/src/conflict-merge", async () => (await import("./workspace-fakes")).conflictMergeModule);
vi.mock("../../apps/web/src/conflict-cells", async () => (await import("./workspace-fakes")).conflictCellsModule);

import { Workspace } from "../../apps/web/src/workspace/Workspace";
import { ModeContext } from "../../apps/web/src/mode";
import { assistantAccessNow } from "../../apps/web/src/ai/tool-permission";
import { uploadQueue } from "../../apps/web/src/upload-queue";
import { noteUnackedEdits } from "../../apps/web/src/save-state";
import { DRIVE_SAVED } from "../../apps/web/src/drive/last-edit";

const cluster: AppMode = { kind: "cluster", serverUrl: "https://drive.example" };
const DriveConflict = nodeClientModule.DriveConflict;

function store(kind: SuiteFile["kind"] = "doc", title = "Plan", link: Partial<FileRecord["drive"]> = {}) {
  const file = { ...createFile(kind, title), updatedAt: "2026-10-01T10:00:00.000Z" } as SuiteFile;
  const record: FileRecord = {
    file,
    drive: {
      nodeUrl: "https://drive.example",
      itemId: "item-1",
      versionId: "v1",
      syncedAt: file.updatedAt,
      name: `${title}.sldoc`,
      ...link,
    },
  };
  fake.records.set(file.id, structuredClone(record));
  return record;
}
async function open(record: FileRecord, mode: AppMode = cluster) {
  const utils = await renderWorkspace(Workspace, ModeContext, record.file.id, mode);
  await screen.findByTestId("editor");
  await waitFor(() => expect(fake.editor).not.toBeNull());
  return utils;
}
const saved = (id: string) => fake.records.get(id)!;
const status = () => document.querySelector(".save-status")!.textContent;
const editorProps = () => fake.editor as unknown as {
  onChange: (content: unknown, extra?: unknown) => void;
  readOnly: boolean;
  file: SuiteFile;
  collabDoc: Y.Doc | null;
  remoteCarets: unknown[];
  remoteSelections: unknown[];
};
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const docContent = (value: number) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: `Edit ${value}` }] }],
});
const textOf = (file: SuiteFile) => JSON.stringify(file.content);
/** The open file's content, changed in a way its kind allows. */
function changed(value: number) {
  const file = editorProps().file;
  if (file.kind === "doc") return docContent(value);
  const content = structuredClone(file.content) as unknown as Record<string, unknown>;
  if (file.kind === "sheet") {
    const workbook = content.workbook as { sheetOrder: string[]; sheets: Record<string, { name: string }> };
    workbook.sheets[workbook.sheetOrder[0]!]!.name = `Sheet ${value}`;
  } else if (file.kind === "drawing") content.source = `graph ${value}`;
  else content.width = (content.width as number) + value;
  return content;
}
const edit = (value: number) => act(() => editorProps().onChange(changed(value)));

beforeEach(() => {
  fake.reset();
  fake.session = { url: "https://drive.example", user: { id: "ada", name: "Ada" } };
  vi.useFakeTimers({ shouldAdvanceTime: true });
  nodeExtras.uploadDriveSpan.mockImplementation(
    async (file: SuiteFile, link: FileRecord["drive"], _start: number, end: number) => ({
      done: true,
      accepted: end,
      link: { ...link, versionId: "v2", syncedAt: file.updatedAt },
    }),
  );
  driveApi.get.mockImplementation(async (id: string) => driveItem(id));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a SuiteDrive file", () => {
  it.each(["doc", "sheet", "slide"] as const)(
    "opens a signed-in %s in the shared room even when another tab holds the cache lock",
    async (kind) => {
      const request = vi.fn(
        async (
          _name: string,
          _options: unknown,
          run: (lock: null) => Promise<void>,
        ) => run(null),
      );
      Object.defineProperty(navigator, "locks", {
        value: { request },
        configurable: true,
      });
      try {
        const plan = store(kind);
        await open(plan);
        expect(request).not.toHaveBeenCalled();
        expect(fake.room).toMatchObject({ itemId: "item-1", role: "owner" });
        expect(editorProps().readOnly).toBe(false);
        const doc = new Y.Doc();
        fake.seed = true;
        act(() => (fake.room!.onDoc as (doc: Y.Doc) => void)(doc));
        await waitFor(() => expect(editorProps().collabDoc).toBe(doc));
        expect(screen.queryByText("Already open in another tab")).toBeNull();
      } finally {
        Object.defineProperty(navigator, "locks", {
          value: undefined,
          configurable: true,
        });
      }
    },
  );

  it("keeps the cache lock for a SuiteDrive copy opened without a session", async () => {
    fake.session = null;
    const request = vi.fn(
      async (
        _name: string,
        _options: unknown,
        run: (lock: null) => Promise<void>,
      ) => run(null),
    );
    Object.defineProperty(navigator, "locks", {
      value: { request },
      configurable: true,
    });
    try {
      const plan = store();
      await renderWorkspace(Workspace, ModeContext, plan.file.id, cluster);
      await advance(2000);
      expect(
        await screen.findByText("Already open in another tab"),
      ).toBeTruthy();
      expect(request).toHaveBeenCalledTimes(6);
    } finally {
      Object.defineProperty(navigator, "locks", {
        value: undefined,
        configurable: true,
      });
    }
  });

  it("hides presentation file comments until the header Comments button is pressed", async () => {
    const deck = store("slide", "Slides");
    await open(deck);
    const button = screen.getByLabelText("Comments", { selector: "button" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("region", { name: "File comments" })).toBeNull();
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("region", { name: "File comments" }).textContent).toBe("can post");
    expect(fake.actions!.slideActions.toggleComments).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("region", { name: "File comments" })).toBeNull();
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("button", { name: "Close comments" }));
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("region", { name: "File comments" })).toBeNull();
  });

  it("keeps a viewer's presentation comments read only when opened", async () => {
    driveApi.get.mockImplementation(async (id: string) => driveItem(id, { role: "viewer" }));
    await open(store("slide", "Read-only slides"));
    expect(screen.queryByRole("region", { name: "File comments" })).toBeNull();
    fireEvent.click(screen.getByLabelText("Comments", { selector: "button" }));
    expect(screen.getByRole("region", { name: "File comments" }).textContent).toBe("read only");
  });

  it("keeps local presentations connected to the slide comment panel", async () => {
    const deck = store("slide", "Local slides");
    delete deck.drive;
    fake.records.set(deck.file.id, structuredClone(deck));
    await open(deck, { kind: "single" });
    fireEvent.click(screen.getByLabelText("Comments", { selector: "button" }));
    expect(fake.actions!.slideActions.toggleComments).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("region", { name: "File comments" })).toBeNull();
  });

  it("opens the desktop's cached copy with its sync status, not as a recovered draft", async () => {
    const plan = store();
    fake.records.set(plan.file.id, { ...structuredClone(plan), recovery: true });
    await open(plan);
    await waitFor(() => expect(status()).toBe("Saved to SuiteDrive"));
  });

  it("uploads saved edits and says so", async () => {
    const plan = store();
    await open(plan);
    expect(document.querySelector(".header-right-tools .workspace-brand")).toBeNull();
    expect(screen.getByRole("region", { name: "File comments" }).textContent).toBe("can post");
    expect(await assistantAccessNow()).toBe("owner");
    const refreshed = vi.fn();
    window.addEventListener(DRIVE_SAVED, refreshed);
    edit(1);
    await advance(600);
    await advance(1600);
    window.removeEventListener(DRIVE_SAVED, refreshed);
    await waitFor(() => expect(saved(plan.file.id).drive?.versionId).toBe("v2"));
    expect(status()).toBe("Saved to SuiteDrive");
    expect(refreshed).toHaveBeenCalled();
    expect(uploadQueue.get("item-1")).toBeUndefined();
  });

  it("does not finish an upload whose slices stop short", async () => {
    const plan = store();
    nodeExtras.uploadDriveSpan.mockImplementation(async (_f: SuiteFile, _l: unknown, _s: number, end: number) => ({
      done: false,
      accepted: end,
    }));
    await open(plan);
    edit(1);
    await advance(2200);
    expect(saved(plan.file.id).drive?.versionId).toBe("v1");
    expect(uploadQueue.get("item-1")?.sent).toBeGreaterThan(0);
  });

  it("retries a network failure, and checks what already reached SuiteDrive", async () => {
    const plan = store();
    nodeExtras.uploadDriveSpan.mockRejectedValueOnce(new Error("SuiteDrive is unreachable. Your changes stay on this device."));
    await open(plan);
    edit(1);
    await advance(2200);
    const retry = await screen.findByRole("button", { name: "Retry sync" });
    expect(status()).toContain("SuiteDrive");
    driveApi.read.mockImplementation(async () => ({ text: serializeFile(fake.records.get(plan.file.id)!.file), versionId: "v7" }));
    fireEvent.click(retry);
    await waitFor(() => expect(saved(plan.file.id).drive?.versionId).toBe("v7"));
    expect(nodeExtras.retryOtherDueUploads).toHaveBeenCalledWith("item-1");
    expect(nodeExtras.uploadDriveSpan).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Retry sync" })).toBeNull();
  });

  it("uploads again when the stored copy differs or cannot be read", async () => {
    const plan = store();
    nodeExtras.uploadDriveSpan.mockRejectedValueOnce(new Error("SuiteDrive is unreachable."));
    nodeExtras.uploadDriveSpan.mockRejectedValueOnce(new Error("That upload does not continue the saved part."));
    await open(plan);
    edit(1);
    await advance(2200);
    driveApi.read.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(await screen.findByRole("button", { name: "Retry sync" }));
    await advance(10);
    expect(nodeExtras.uploadDriveSpan).toHaveBeenCalledTimes(2);
    expect(uploadQueue.get("item-1")?.sent ?? 0).toBe(0);
    driveApi.read.mockResolvedValue({ text: "older", versionId: "v0" });
    await advance(5000);
    await waitFor(() => expect(saved(plan.file.id).drive?.versionId).toBe("v2"));
    expect(nodeExtras.uploadDriveSpan).toHaveBeenCalledTimes(3);
  });

  it("stops retrying when only a person can fix the upload", async () => {
    const plan = store();
    nodeExtras.uploadDriveSpan.mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
    await open(plan);
    edit(1);
    await advance(2200);
    await waitFor(() => expect(status()).toContain("Ask for access"));
    expect(screen.queryByRole("button", { name: "Retry sync" })).toBeNull();
    expect(uploadQueue.get("item-1")?.failure?.kind).toBe("access");
  });

  it("says the file waits for sign-in", async () => {
    const plan = store();
    await open(plan);
    fake.session = null;
    edit(1);
    await advance(2200);
    expect(status()).toMatch(/sign in|offline|not yet/i);
    expect(nodeExtras.uploadDriveSpan).not.toHaveBeenCalled();
  });

  it("uploads unsent edits as soon as it opens", async () => {
    const plan = store("doc", "Plan", { syncedAt: "2026-09-01T00:00:00.000Z" });
    await open(plan);
    await waitFor(() => expect(saved(plan.file.id).drive?.versionId).toBe("v2"));
  });

  it("uploads pending work when it closes", async () => {
    const plan = store();
    const { unmount } = await open(plan);
    edit(1);
    unmount();
    await advance(50);
    expect(textOf(saved(plan.file.id).file)).toContain("Edit 1");
    await waitFor(() => expect(saved(plan.file.id).drive?.versionId).toBe("v2"));
  });

  it("shows the roles that cannot edit", async () => {
    for (const [role, badge, comments] of [
      ["viewer", "View only", "read only"],
      ["commenter", "Can comment", "can post · wording stays"],
      ["responder", "Can respond", "can post · wording stays"],
    ] as const) {
      driveApi.get.mockImplementation(async (id: string) => driveItem(id, { role }));
      const sheet = store("sheet", "Budget");
      await open(sheet);
      expect(screen.getByText(badge)).toBeTruthy();
      expect(editorProps().readOnly).toBe(true);
      expect((screen.getByLabelText("File title") as HTMLInputElement).readOnly).toBe(true);
      expect(screen.getByRole("region", { name: "File comments" }).textContent).toBe(comments);
      expect(screen.queryByRole("button", { name: "Move" })).toBeNull();
      fireEvent.keyDown(screen.getByRole("button", { name: "File", exact: true }), { key: "ArrowDown" });
      expect((await screen.findByRole("menuitem", { name: "Move", exact: true })).getAttribute("aria-disabled")).toBe("true");
      expect(screen.getByRole("menuitem", { name: "Rename", exact: true }).getAttribute("aria-disabled")).toBe("true");
      cleanup();
    }
  });

  it("mirrors a viewer's sheet edits into the live room without saving them", async () => {
    driveApi.get.mockImplementation(async (id: string) => driveItem(id, { role: "viewer" }));
    const sheet = store("sheet", "Budget");
    await open(sheet);
    edit(1);
    expect(editorExtras.mirrorLiveEdit).not.toHaveBeenCalled();
    const doc = new Y.Doc();
    act(() => (fake.room!.onDoc as (d: Y.Doc) => void)(doc));
    edit(2);
    expect(editorExtras.mirrorLiveEdit).toHaveBeenCalledWith(doc, "sheet", expect.anything(), undefined);
    fireEvent.change(screen.getByLabelText("File title"), { target: { value: "Mine" } });
    await advance(2200);
    expect(saved(sheet.file.id).file.title).toBe("Budget");
  });

  it("refuses a file this account lost, and reads an unknown error as view only", async () => {
    driveApi.get.mockRejectedValue(new Error("Item not found"));
    const gone = store();
    await renderWorkspace(Workspace, ModeContext, gone.file.id, cluster);
    expect((await screen.findByRole("alert")).textContent).toBe("You no longer have access to this file.");
    expect(await assistantAccessNow()).toBe("none");
    cleanup();
    driveApi.get.mockRejectedValue("timeout");
    await open(store());
    expect(screen.getByText("View only")).toBeTruthy();
  });

  it("lists who else is here", async () => {
    driveApi.presence.mockResolvedValue([
      { name: "Sam", editing: true },
      { name: "Priya", editing: false },
    ]);
    await open(store());
    const here = await screen.findByRole("region", { name: "Also in this file" });
    await waitFor(() => expect(here.querySelectorAll(".presence-chip")).toHaveLength(2));
    expect(here.querySelector(".presence-chip.editing")?.textContent).toContain("Sam");
    expect(driveApi.reportPresence).toHaveBeenCalledWith("item-1", false);
    driveApi.reportPresence.mockRejectedValueOnce(new Error("busy"));
    driveApi.presence.mockRejectedValueOnce(new Error("busy"));
    await advance(5000);
    expect(here.querySelectorAll(".presence-chip")).toHaveLength(2);
    fake.session = null;
    await advance(5000);
  });

  it("opens sharing without showing a folder location in the header", async () => {
    driveApi.get.mockImplementation(async (id: string) => driveItem(id, { parentId: "f1", parentName: "Beds" }));
    driveApi.listFolders.mockResolvedValue([{ id: "f1", name: "Beds", parentId: null }]);
    await open(store());
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    fireEvent.click(screen.getByRole("button", { name: "Close share" }));
    expect(screen.queryByRole("dialog", { name: "Share Plan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Folder Beds" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Move" })).toBeNull();
  });

  it("offers moving from File when the folder list is unavailable", async () => {
    driveApi.get.mockImplementation(async (id: string) => driveItem(id, { parentId: "f1", parentName: "Beds" }));
    driveApi.listFolders.mockRejectedValue(new Error("offline"));
    await open(store());
    await runMenu("File › Move");
    expect(screen.getByRole("dialog", { name: "Move dialog" })).toBeTruthy();
  });

  it("moves the file and undoes the move", async () => {
    driveApi.get.mockImplementation(async (id: string) => driveItem(id, { parentId: "f1", parentName: "Beds" }));
    await open(store());
    await runMenu("File › Move");
    const move = fake.moveDialog as unknown as {
      includeMyDrive: boolean;
      onMoved: (r: unknown) => void;
      onClose: () => void;
    };
    expect(move.includeMyDrive).toBe(true);
    act(() =>
      move.onMoved({
        item: driveItem("item-1", { parentId: "f2", parentName: "Herbs" }),
        previousParentId: "f1",
        folderName: "Herbs",
      }),
    );
    expect(document.querySelector(".drive-move-banner")?.textContent).toContain("Herbs");
    expect(screen.queryByRole("button", { name: "Folder Herbs" })).toBeNull();
    driveApi.update.mockRejectedValueOnce(new Error("Move refused."));
    fireEvent.click(within(document.querySelector(".drive-move-banner") as HTMLElement).getByRole("button", { name: "Undo" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Move refused.");
    fireEvent.click(within(document.querySelector(".drive-move-banner") as HTMLElement).getByRole("button", { name: "Dismiss" }));
    expect(document.querySelector(".drive-move-banner")).toBeNull();
    await runMenu("File › Move");
    act(() => (fake.moveDialog as unknown as { onClose: () => void }).onClose());
    expect(screen.queryByRole("dialog", { name: "Move dialog" })).toBeNull();
  });

  it("offers a form's sign-up link", async () => {
    const form = store("form", "Plots");
    await renderWorkspace(Workspace, ModeContext, form.file.id, cluster);
    fireEvent.click(await screen.findByRole("button", { name: "Sign-up link" }));
    fireEvent.click(screen.getByRole("button", { name: "Close sign-up" }));
    expect(screen.queryByRole("dialog", { name: "Sign-up link dialog" })).toBeNull();
  });

  it("downloads a copy and opens a file shared just now", async () => {
    const plan = store();
    await open(plan);
    const download = screen.getByRole("button", { name: "Download" });
    expect(download.textContent).toBe("");
    expect(download.querySelector("svg")).not.toBeNull();
    expect(download.getAttribute("title")).toContain("Download “Plan.sldoc”");
    fireEvent.click(download);
    await waitFor(() => expect(storageExtras.exportText).toHaveBeenCalledWith("Plan.sldoc", expect.any(String), expect.any(String)));
    storageExtras.exportText.mockRejectedValueOnce(new Error("Downloads are blocked."));
    fireEvent.click(download);
    expect((await screen.findByRole("alert")).textContent).toContain("Downloads are blocked.");
    const other = createFile("doc", "Shared");
    nodeExtras.openDriveFile.mockResolvedValue({ file: other, drive: { itemId: "item-9" } });
    await act(() => (fake.shareNotices!.onOpen as (item: unknown) => Promise<void>)(driveItem("item-9")));
    expect(paths.at(-1)).toBe(`/file/${other.id}`);
  });
});

describe("a SuiteDrive conflict", () => {
  const conflictItem = () => driveItem("item-1", { headVersionId: "v9", updatedAt: new Date().toISOString(), parentId: "f1" });
  async function conflicted(kind: SuiteFile["kind"] = "doc") {
    const plan = store(kind);
    nodeExtras.uploadDriveSpan.mockRejectedValueOnce(new DriveConflict(conflictItem()));
    await open(plan);
    edit(1);
    await advance(2200);
    await screen.findByText("This file was changed in SuiteDrive after you opened it.");
    return plan;
  }
  const banner = () => document.querySelector(".drive-conflict") as HTMLElement;

  it("shows the conflict and saves a copy", async () => {
    const plan = await conflicted();
    expect(banner().textContent).toMatch(/A newer version was saved at /);
    nodeExtras.saveNewDriveFile.mockImplementation(async (file: SuiteFile) => ({
      itemId: "item-2",
      versionId: "c1",
      syncedAt: file.updatedAt,
    }));
    fireEvent.click(within(banner()).getByRole("button", { name: "Save as copy" }));
    await waitFor(() => expect(status()).toBe("Saved a copy to SuiteDrive"));
    expect(nodeExtras.saveNewDriveFile).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Plan (copy)" }),
      "f1",
      "Plan (copy).sldoc",
    );
    expect(saved(plan.file.id).drive?.itemId).toBe("item-2");
    expect(document.querySelector(".drive-conflict")).toBeNull();
  });

  it("keeps the conflict and local edits when uploading a copy fails", async () => {
    const plan = await conflicted();
    nodeExtras.saveNewDriveFile.mockRejectedValueOnce(new Error("Copy upload failed"));
    fireEvent.click(within(banner()).getByRole("button", { name: "Save as copy" }));
    await screen.findByText("Copy upload failed");
    expect(banner()).not.toBeNull();
    expect(saved(plan.file.id).drive?.itemId).toBe("item-1");
  });

  it("combines edits made in different parts", async () => {
    const plan = await conflicted();
    const fresh = { ...plan.file, title: "Theirs" };
    nodeExtras.openDriveFile.mockResolvedValue({ file: fresh, drive: { itemId: "item-1", versionId: "v9" } });
    editorExtras.combineDocuments.mockReturnValue({
      merged: { ...plan.file, title: "Merged" },
      localCopy: { ...plan.file, title: "Mine" },
    });
    nodeExtras.saveNewDriveFile.mockResolvedValue({ itemId: "item-3" });
    fireEvent.click(within(banner()).getByRole("button", { name: "Combine separate edits" }));
    await waitFor(() => expect((screen.getByLabelText("File title") as HTMLInputElement).value).toBe("Merged"));
    expect(editorExtras.combineDocuments).toHaveBeenCalledWith(expect.anything(), expect.anything(), fresh, { keepBoth: false });
    expect(nodeExtras.saveNewDriveFile).toHaveBeenCalledWith(expect.objectContaining({ title: "Mine" }), "f1", "Mine.sldoc");
    await waitFor(() => expect(saved(plan.file.id).drive?.versionId).toBe("v2"));
  });

  it("keeps both versions of overlapping parts, per kind", async () => {
    for (const [kind, merge] of [
      ["sheet", editorExtras.keepBothSheets],
      ["slide", editorExtras.keepBothSlides],
      ["drawing", editorExtras.keepBothDrawings],
      ["doc", editorExtras.combineDocuments],
    ] as const) {
      const plan = await conflicted(kind);
      nodeExtras.openDriveFile.mockResolvedValue({ file: { ...plan.file }, drive: { itemId: "item-1", versionId: "v9" } });
      merge.mockReturnValue({ merged: null, reason: `${kind} parts overlap.` });
      fireEvent.click(within(banner()).getByRole("button", { name: "Keep both parts" }));
      await waitFor(() => expect(document.body.textContent).toContain(`${kind} parts overlap.`));
      expect(merge).toHaveBeenCalled();
      cleanup();
    }
  });

  it("takes chosen cells, and explains plans that cannot merge", async () => {
    const plan = await conflicted("sheet");
    nodeExtras.openDriveFile.mockResolvedValue({ file: { ...plan.file }, drive: undefined });
    editorExtras.keepSelectedCells.mockReturnValue({ merged: { ...plan.file }, localCopy: plan.file });
    fireEvent.click(screen.getByRole("button", { name: "Take cells" }));
    await waitFor(() => expect(document.body.textContent).toContain("These edits overlap, so they stay as two versions."));
    expect(editorExtras.keepSelectedCells).toHaveBeenCalledWith(expect.anything(), expect.anything(), ["A1"]);
  });

  it("cannot combine without the last synchronized copy", async () => {
    const plan = store("doc", "Plan", { syncedAt: "2026-09-01T00:00:00.000Z" });
    nodeExtras.uploadDriveSpan.mockRejectedValueOnce(new DriveConflict(conflictItem()));
    await open(plan);
    await screen.findByText("This file was changed in SuiteDrive after you opened it.");
    fireEvent.click(within(banner()).getByRole("button", { name: "Combine separate edits" }));
    await waitFor(() =>
      expect(document.body.textContent).toContain(
        "These edits cannot be combined because the last synchronized copy is not on this device.",
      ),
    );
  });

  it("discards local changes after confirming and reloads the SuiteDrive version without a copy", async () => {
    const plan = await conflicted();
    const reload = vi.fn();
    const location = window.location;
    vi.stubGlobal("confirm", vi.fn(() => false));
    fireEvent.click(within(banner()).getByRole("button", { name: "Discard local changes and reload" }));
    expect(nodeExtras.openDriveFile).not.toHaveBeenCalled();
    vi.stubGlobal("confirm", vi.fn(() => true));
    Object.defineProperty(window, "location", { value: { ...location, reload }, configurable: true });
    nodeExtras.openDriveFile.mockResolvedValue({ file: { ...plan.file, title: "Theirs" }, drive: { itemId: "item-1", versionId: "v9" } });
    fireEvent.click(within(banner()).getByRole("button", { name: "Discard local changes and reload" }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    Object.defineProperty(window, "location", { value: location, configurable: true });
    expect(saved(plan.file.id)).toMatchObject({ file: { title: "Theirs" }, drive: { versionId: "v9" } });
    expect(saved(`${plan.file.id}-kept`)).toBeUndefined();
    expect(uploadQueue.get("item-1")).toBeUndefined();
  });

  it("keeps local changes when discarding cannot download the server version", async () => {
    const plan = await conflicted("slide");
    const local = structuredClone(saved(plan.file.id));
    const pending = uploadQueue.get("item-1");
    vi.stubGlobal("confirm", vi.fn(() => true));
    nodeExtras.openDriveFile.mockRejectedValueOnce(new Error("SuiteDrive is unreachable."));
    fireEvent.click(within(banner()).getByRole("button", { name: "Discard local changes and reload" }));
    await screen.findByText("SuiteDrive is unreachable.");
    expect(saved(plan.file.id)).toEqual(local);
    expect(uploadQueue.get("item-1")).toEqual(pending);
    expect(saved(`${plan.file.id}-kept`)).toBeUndefined();
    expect(banner()).toBeTruthy();
  });

  it("keeps edits and their upload when the downloaded version cannot be saved locally", async () => {
    const plan = await conflicted("slide");
    const local = structuredClone(saved(plan.file.id));
    const pending = uploadQueue.get("item-1");
    vi.stubGlobal("confirm", vi.fn(() => true));
    nodeExtras.openDriveFile.mockResolvedValue({ file: { ...plan.file, title: "Theirs" }, drive: { itemId: "item-1", versionId: "v9" } });
    fake.failSave = "Local storage is full.";
    fireEvent.click(within(banner()).getByRole("button", { name: "Discard local changes and reload" }));
    await screen.findByText("Local storage is full.");
    expect(saved(plan.file.id)).toEqual(local);
    expect(uploadQueue.get("item-1")).toEqual(pending);
  });

  it("preserves the assistant's existing reload-with-a-copy behavior", async () => {
    const plan = await conflicted();
    fake.hosts.workspace!();
    const tools = fake.conflictCtx as unknown as { reload: () => Promise<void> };
    const reload = vi.fn();
    const location = window.location;
    Object.defineProperty(window, "location", { value: { ...location, reload }, configurable: true });
    try {
      nodeExtras.openDriveFile.mockResolvedValue({ file: { ...plan.file, title: "Theirs" }, drive: { itemId: "item-1", versionId: "v9" } });
      await act(() => tools.reload());
      expect(reload).toHaveBeenCalledTimes(1);
      expect(saved(`${plan.file.id}-kept`).file.title).toBe("Plan (kept)");
    } finally {
      Object.defineProperty(window, "location", { value: location, configurable: true });
    }
  });

  it("shows conflict actions that fail", async () => {
    await conflicted();
    nodeExtras.saveNewDriveFile.mockRejectedValue(new Error("Copy refused."));
    fireEvent.click(within(banner()).getByRole("button", { name: "Save as copy" }));
    expect((await screen.findByText("Copy refused.", { exact: false })).textContent).toContain("Copy refused.");
  });

  it("gives the assistant the conflict tools", async () => {
    const plan = await conflicted();
    const built = fake.hosts.workspace!();
    expect(built.tools.map((t) => t.name)).toEqual(["workspace-tool", "conflict-tool"]);
    expect(built.snapshot()).toContain("Someone else saved a newer version");
    const tools = fake.conflictCtx as unknown as {
      conflict: () => boolean;
      title: () => string;
      rename: (t: string) => void;
    };
    expect(tools.conflict()).toBe(true);
    expect(tools.title()).toBe(plan.file.title);
    act(() => tools.rename("Renamed in conflict"));
    expect((screen.getByLabelText("File title") as HTMLInputElement).value).toBe("Renamed in conflict");
  });

  it("names the day of an older conflict, and ignores another file's", async () => {
    const plan = store();
    nodeExtras.uploadDriveSpan.mockRejectedValueOnce(
      new DriveConflict(driveItem("item-1", { headVersionId: "v9", updatedAt: "2026-01-05T12:00:00.000Z" })),
    );
    await open(plan);
    edit(1);
    await advance(2200);
    expect(await screen.findByText(/A newer version was saved on /)).toBeTruthy();
    cleanup();
    nodeExtras.uploadDriveSpan.mockRejectedValueOnce(new DriveConflict(driveItem("item-other")));
    await open(store());
    edit(1);
    await advance(2200);
    expect(document.querySelector(".drive-conflict")).toBeNull();
  });
});

describe("someone else's SuiteDrive save", () => {
  it("switches an idle file to the newer version", async () => {
    const plan = store();
    await open(plan);
    const theirs = { ...plan.file, title: "Their plan", updatedAt: "2026-10-02T10:00:00.000Z" };
    driveApi.get.mockImplementation(async (id: string) =>
      driveItem(id, { headVersionId: "v5", lastAuthorName: " Sam ", name: "Their plan.sldoc" }),
    );
    driveApi.read.mockResolvedValue({ text: serializeFile(theirs), versionId: "v5" });
    await advance(2100);
    await waitFor(() => expect(status()).toBe("Sam updated this."));
    expect((screen.getByLabelText("File title") as HTMLInputElement).value).toBe("Their plan");
    expect(saved(plan.file.id)).toMatchObject({ drive: { versionId: "v5", name: "Their plan.sldoc" } });
  });

  it("names nobody when the author is unknown, and skips a head that moved again", async () => {
    const plan = store();
    await open(plan);
    const theirs = { ...plan.file, title: "Theirs" };
    let calls = 0;
    driveApi.get.mockImplementation(async (id: string) => {
      calls += 1;
      return driveItem(id, { headVersionId: calls === 2 ? "v6" : "v5" });
    });
    driveApi.read.mockResolvedValue({ text: serializeFile(theirs), versionId: "" });
    await advance(2100);
    expect((screen.getByLabelText("File title") as HTMLInputElement).value).toBe("Plan");
    await advance(2000);
    await waitFor(() => expect(status()).toBe("Someone else updated this."));
  });

  it("keeps unsent typing and shows the conflict instead", async () => {
    const plan = store();
    await open(plan);
    driveApi.get.mockImplementation(async (id: string) => driveItem(id, { headVersionId: "v5" }));
    edit(1);
    await advance(2100);
    expect(await screen.findByText("This file was changed in SuiteDrive after you opened it.")).toBeTruthy();
    expect(status()).toBe("SuiteDrive has a newer version");
  });

  it("notices typing that starts while the newer version is read", async () => {
    const plan = store();
    await open(plan);
    driveApi.get.mockImplementation(async (id: string) => driveItem(id, { headVersionId: "v5" }));
    driveApi.read.mockImplementation(async () => {
      edit(1);
      return { text: serializeFile(plan.file), versionId: "v5" };
    });
    await advance(2100);
    expect(await screen.findByText("This file was changed in SuiteDrive after you opened it.")).toBeTruthy();
  });

  it("retries a read that failed on the next tick", async () => {
    const plan = store();
    await open(plan);
    driveApi.get.mockRejectedValue(new Error("offline"));
    await advance(2100);
    expect(document.querySelector(".drive-conflict")).toBeNull();
  });
});

describe("the live room", () => {
  type Room = {
    onCaret: (c: unknown) => void;
    onSheetSelection: (s: unknown) => void;
    onSlideSelection: (s: unknown) => void;
    onRecovery: (notice: string) => void;
    onDoc: (doc: Y.Doc | null) => void;
    onSoloAgain: () => void;
    sendSelection: { current: (a: number, h: number) => void };
  };
  const room = () => fake.room as unknown as Room;

  it("shows other people's carets and selections", async () => {
    await open(store());
    act(() => room().onCaret({ name: "Sam", anchor: 1, head: 2 }));
    act(() => room().onCaret({ name: "Sam", anchor: 3, head: 3 }));
    expect(editorProps().remoteCarets).toEqual([{ name: "Sam", anchor: 3, head: 3 }]);
    cleanup();
    await open(store("sheet", "Budget"));
    act(() => room().onSheetSelection({ name: "Sam", sheetId: "s", startRow: 0 }));
    act(() => room().onSheetSelection({ name: "Sam", sheetId: "s", startRow: 1 }));
    expect(editorProps().remoteSelections).toHaveLength(1);
    act(() => room().onDoc(null));
    expect(editorProps().remoteSelections).toEqual([]);
    cleanup();
    await open(store("slide", "Deck"));
    act(() => room().onSlideSelection({ name: "Sam", slideId: "a" }));
    act(() => room().onSlideSelection({ name: "Priya", slideId: "b" }));
    expect(editorProps().remoteSelections).toHaveLength(2);
  });

  it("says when the room recovers", async () => {
    await open(store());
    act(() => room().onRecovery("Reconnected to the room."));
    expect(screen.getByText("Reconnected to the room.")).toBeTruthy();
  });

  it("names shared edits still waiting, and leaves other statuses alone", async () => {
    await open(store());
    await waitFor(() => expect(status()).toBe("Saved to SuiteDrive"));
    noteUnackedEdits(2);
    act(() => room().onRecovery("2 edits are waiting to be stored."));
    expect(status()).toBe("Saved on this device · not yet on SuiteDrive");
    noteUnackedEdits(0);
    act(() => room().onRecovery(null as never));
    expect(status()).toBe("Saved to SuiteDrive");
    act(() => room().onRecovery("Joining the shared document."));
    expect(status()).toBe("Saved to SuiteDrive");
  });

  it("seeds a new room from the document and joins it", async () => {
    await open(store());
    const doc = new Y.Doc();
    act(() => room().onDoc(doc));
    expect(editorProps().collabDoc).toBe(doc);
    act(() => room().onDoc(null));
    expect(editorProps().collabDoc).toBeNull();
  });

  it("waits for a room's first text before showing it", async () => {
    fake.seed = false;
    await open(store());
    const doc = new Y.Doc();
    act(() => room().onDoc(doc));
    expect(editorProps().collabDoc).toBeNull();
    act(() => {
      const fragment = doc.getXmlFragment("prosemirror");
      fragment.insert(0, [new Y.XmlElement("paragraph")]);
    });
    expect(editorProps().collabDoc).toBe(doc);
  });

  it("uses CRDT instead of full document uploads when collabDoc is active", async () => {
    const plan = store("slide", "Deck");
    await open(plan);
    const doc = new Y.Doc();
    act(() => room().onDoc(doc));
    expect(editorProps().collabDoc).toBe(doc);

    const nextContent = { ...plan.file.content, slideOrder: ["s1", "s2"] };
    act(() => editorProps().onChange(nextContent, { kind: "slide", added: ["s2"] }));
    await advance(2000);

    expect(uploadQueue.get("item-1")).toBeUndefined();
    expect(saved(plan.file.id).file.content).toEqual(nextContent);
    expect(saved(plan.file.id).drive?.syncedAt).toBe(saved(plan.file.id).file.updatedAt);
    expect(status()).toBe("Saved to SuiteDrive");
  });

  it("renames the SuiteDrive item when a title changes in a live room", async () => {
    const plan = store("slide", "Deck");
    await open(plan);
    act(() => room().onDoc(new Y.Doc()));
    fireEvent.change(screen.getByLabelText("File title"), { target: { value: "Renamed deck" } });
    await advance(2000);
    expect(driveApi.update).toHaveBeenCalledWith("item-1", { name: "Renamed deck.slslides" });
    expect(saved(plan.file.id).drive?.name).toBe("Renamed deck.slslides");
    expect(nodeExtras.uploadDriveSpan).not.toHaveBeenCalled();
  });

  it("adopts a newer file after working alone again, or compacts the session", async () => {
    const plan = store();
    await open(plan);
    const at = "2026-10-02T10:00:00.000Z";
    const edited = recordEdit(plan.file, { content: docContent(9), op: { kind: "doc" }, by: { id: "u", name: "U" }, at }).file;
    const remote = { ...sealIfIdle(edited, Date.parse(at) + 1, 0).file, title: "Remote" };
    driveApi.read.mockResolvedValueOnce({ text: serializeFile(remote as SuiteFile), versionId: "v8" });
    act(() => room().onSoloAgain());
    await waitFor(() => expect((screen.getByLabelText("File title") as HTMLInputElement).value).toBe("Remote"));
    act(() => room().onDoc(new Y.Doc()));
    driveApi.read.mockResolvedValueOnce({ text: serializeFile(plan.file), versionId: undefined });
    act(() => room().onSoloAgain());
    await waitFor(() => expect(driveApi.read).toHaveBeenCalledTimes(2));
    await advance(10);
    driveApi.read.mockResolvedValueOnce({ text: serializeFile(plan.file), versionId: "v1" });
    act(() => room().onSoloAgain());
    await advance(10);
    driveApi.read.mockRejectedValueOnce(new Error("offline"));
    act(() => room().onSoloAgain());
    await advance(10);
  });
});

describe("SuiteDrive commands", () => {
  it("opens and saves through the SuiteDrive browser", async () => {
    driveApi.get.mockImplementation(async (id: string) => driveItem(id, { parentId: "f1", parentName: "Beds" }));
    const plan = store();
    await open(plan);
    await runMenu("File › Save as…");
    const browser = () => fake.browser as unknown as {
      mode: string;
      defaultName: string;
      startIn: unknown;
      onSave: (folder: string | null, name: string) => Promise<void>;
      onOpen: (item: unknown) => Promise<void>;
      onClose: () => void;
    };
    expect(browser()).toMatchObject({ mode: "save", defaultName: "Plan.sldoc", startIn: { id: "f1", name: "Beds" } });
    nodeExtras.saveNewDriveFile.mockResolvedValue({ itemId: "item-5", versionId: "n1" });
    await act(() => browser().onSave("f1", "Notes"));
    expect(nodeExtras.saveNewDriveFile).toHaveBeenCalledWith(expect.objectContaining({ title: "Notes" }), "f1", "Notes.sldoc");
    expect(saved(plan.file.id).drive?.itemId).toBe("item-5");
    expect(screen.queryByRole("dialog", { name: "Drive save" })).toBeNull();
    fireEvent.keyDown(window, { key: "s", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Drive save" })).toBeTruthy());
    nodeExtras.saveNewDriveFile.mockRejectedValueOnce(new Error("Folder is full."));
    await act(() => browser().onSave(null, "Again"));
    expect(screen.getByRole("alert").textContent).toContain("Folder is full.");
    await runMenu("File › Open…");
    expect(browser().mode).toBe("open");
    act(() => browser().onClose());
    expect(screen.queryByRole("dialog", { name: "Drive open" })).toBeNull();
    await runMenu("File › Open…");
    const other = createFile("doc", "Other");
    nodeExtras.openDriveFile.mockResolvedValue({ file: other, drive: { itemId: "item-7" } });
    await act(() => browser().onOpen(driveItem("item-7")));
    expect(paths.at(-1)).toBe(`/file/${other.id}`);
  });

  it("makes new files and copies in SuiteDrive", async () => {
    const plan = store();
    nodeExtras.saveNewDriveFile.mockImplementation(async (file: SuiteFile) => ({ itemId: `drive-${file.id}` }));
    await open(plan);
    await runMenu("File › New › Spreadsheet");
    await waitFor(() => expect(nodeExtras.saveNewDriveFile).toHaveBeenCalledWith(expect.objectContaining({ kind: "sheet" }), null, expect.any(String), { fallbackToRoot: true }));
    cleanup();
    await open(plan);
    await runMenu("File › Make a copy");
    await waitFor(() => expect(nodeExtras.saveNewDriveFile).toHaveBeenCalledTimes(2));
    cleanup();
    await open(plan);
    await runMenu("File › Download a copy");
    await waitFor(() => expect(storageExtras.exportText).toHaveBeenCalled());
  });

  it("gives the assistant SuiteDrive versions", async () => {
    const plan = store();
    await open(plan);
    fake.hosts.workspace!();
    const ctx = fake.wsCtx as unknown as {
      download: () => Promise<{ name: string; path?: string } | null>;
      create: (kind: string, title: string) => Promise<void>;
      openNew: (file: SuiteFile) => Promise<void>;
      versions: {
        list: () => Promise<{ id: string; current: boolean; author: string; preview: string }[]>;
        restore: (id: string) => Promise<void>;
        copy: (entry: { id: string; author: string; createdAt: string }) => Promise<string>;
      };
    };
    driveApi.versions.mockResolvedValue([
      { id: "v1", authorName: "Ada", createdAt: "2026-10-01T10:00:00.000Z", name: null },
      { id: "v0", authorName: "", createdAt: "2026-09-01T10:00:00.000Z", name: "Draft" },
      { id: "vx", authorName: "Sam", createdAt: "2026-08-01T10:00:00.000Z", name: null },
    ]);
    driveApi.read.mockResolvedValue({ text: "current text", versionId: "v1" });
    driveApi.readVersion.mockImplementation(async (_id: string, version: string) => {
      if (version === "vx") throw new Error("gone");
      return "older text";
    });
    const list = await ctx.versions.list();
    expect(list.map((v) => [v.id, v.current, v.author, v.preview])).toEqual([
      ["v1", true, "Ada", "preview of 12 characters"],
      ["v0", false, "Someone", "preview of 10 characters"],
      ["vx", false, "Sam", ""],
    ]);
    const restored = { ...plan.file, title: "Restored" };
    driveApi.restoreVersion.mockResolvedValue(driveItem("item-1", { name: "Restored.sldoc", headVersionId: "v10" }));
    driveApi.read.mockResolvedValue({ text: serializeFile(restored), versionId: undefined });
    await act(() => ctx.versions.restore("v0"));
    expect(driveApi.restoreVersion).toHaveBeenCalledWith("item-1", "v0", "v1");
    expect(saved(plan.file.id).drive).toMatchObject({ versionId: "v10", name: "Restored.sldoc" });
    driveApi.restoreVersion.mockRejectedValueOnce(new DriveConflict(driveItem("item-1")));
    await expect(ctx.versions.restore("v0")).rejects.toThrow("SuiteDrive has a newer version than the one open here.");
    driveApi.restoreVersion.mockRejectedValueOnce(new Error("Version gone."));
    await expect(ctx.versions.restore("v0")).rejects.toThrow("Version gone.");
    driveApi.copyVersion.mockResolvedValue(undefined);
    const name = await ctx.versions.copy({ id: "v0", author: "Ada", createdAt: "2026-09-01T10:00:00.000Z" });
    expect(driveApi.copyVersion).toHaveBeenCalledWith("item-1", "v0", name);
    expect(await act(() => ctx.download())).toEqual({ name: "Restored.sldoc", path: undefined });
    nodeExtras.saveNewDriveFile.mockImplementation(async (file: SuiteFile) => ({ itemId: `drive-${file.id}` }));
    await act(() => ctx.create("doc", "Fresh"));
    await act(() => ctx.openNew(createFile("sheet", "Also fresh")));
    expect(nodeExtras.saveNewDriveFile).toHaveBeenCalledTimes(2);
  });
});
