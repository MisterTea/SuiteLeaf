// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFile, recordEdit, serializeFile, type FileRecord, type SuiteFile } from "../../packages/core/src";
import {
  editorExtras,
  fake,
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
vi.mock("../../apps/web/src/editor-failed-uploads", async () => (await import("./workspace-fakes")).failedUploadsModule);
vi.mock("../../apps/web/src/drive/upload-span", async () => (await import("./workspace-fakes")).uploadSpanModule);
vi.mock("../../apps/web/src/conflict-merge", async () => (await import("./workspace-fakes")).conflictMergeModule);
vi.mock("../../apps/web/src/conflict-cells", async () => (await import("./workspace-fakes")).conflictCellsModule);

import { Workspace } from "../../apps/web/src/workspace/Workspace";
import { ModeContext } from "../../apps/web/src/mode";
import { assistantAccessNow, currentAssistantFileRole } from "../../apps/web/src/ai/tool-permission";
import { applyRestoredFile } from "../../apps/web/src/ai/restored-file";
import { openNotices } from "../../apps/web/src/same-file";

function store(kind: SuiteFile["kind"] = "doc", title = "Plan", extra: Partial<FileRecord> = {}) {
  const file = { ...createFile(kind, title), updatedAt: "2026-10-01T10:00:00.000Z" } as SuiteFile;
  const record = { file, ...extra } as FileRecord;
  fake.records.set(file.id, structuredClone(record));
  return record;
}
async function open(record: FileRecord, state?: unknown) {
  const utils = await renderWorkspace(Workspace, ModeContext, record.file.id, { kind: "single" }, state);
  await screen.findByTestId("editor");
  await waitFor(() => expect(fake.editor).not.toBeNull());
  return utils;
}
const saved = (id: string) => fake.records.get(id)!;
const status = () => document.querySelector(".save-status")!.textContent;
const editorProps = () => fake.editor as unknown as {
  onChange: (content: unknown, extra?: unknown) => void;
  onError: (message: string) => void;
  onCreateDocument?: (created: SuiteFile | SuiteFile[]) => Promise<void>;
  onSlideUrl?: (slide: string) => void;
  file: SuiteFile;
  readOnly: boolean;
};
const flushTimers = () => act(() => vi.advanceTimersByTimeAsync(2000));

beforeEach(() => {
  fake.reset();
  openNotices.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete window.suiteleaf;
});

describe("Workspace on this device", () => {
  it("opens a document and saves an edit after a short pause", async () => {
    const plan = store();
    await open(plan);
    expect(screen.getByTestId("editor").textContent).toBe("doc:Plan:editable");
    expect((screen.getByLabelText("File title") as HTMLInputElement).value).toBe("Plan");
    expect(screen.queryByRole("region", { name: "Also in this file" })).toBeNull();
    expect(currentAssistantFileRole()).toBe("local");
    expect(await assistantAccessNow()).toBe("local");
    const content = structuredClone(plan.file.content) as { blocks?: unknown[] };
    act(() => editorProps().onChange(plan.file.content));
    expect(status()).not.toBe("Unsaved changes");
    act(() => editorProps().onChange({ ...content, changed: true }));
    expect(status()).toBe("Unsaved changes");
    await flushTimers();
    expect((saved(plan.file.id).file.content as { changed?: boolean }).changed).toBe(true);
    expect(status()).not.toBe("Unsaved changes");
    expect(editorExtras.noteLocalSnapshot).toHaveBeenCalled();
  });

  it("says when the file cannot be found", async () => {
    await renderWorkspace(Workspace, ModeContext, "missing");
    expect((await screen.findByRole("alert")).textContent).toBe("This file could not be found.");
    expect(screen.getByRole("link", { name: "Return to files" })).toBeTruthy();
  });

  it("renames the file, and names an empty title Untitled", async () => {
    const plan = store();
    await open(plan);
    const title = screen.getByLabelText("File title");
    fireEvent.change(title, { target: { value: "Plan B" } });
    await flushTimers();
    expect(saved(plan.file.id).file.title).toBe("Plan B");
    fireEvent.change(title, { target: { value: "" } });
    await flushTimers();
    expect(saved(plan.file.id).file.title).toBe("Untitled");
    fireEvent.change(title, { target: { value: "Untitled" } });
    expect(status()).not.toBe("Unsaved changes");
  });

  it.each(["doc", "sheet", "slide", "form"] as const)("renames a %s from the File menu", async (kind) => {
    const plan = store(kind);
    if (kind === "form") {
      await renderWorkspace(Workspace, ModeContext, plan.file.id, { kind: "single" });
      await screen.findByLabelText("File title");
    } else await open(plan);
    await runMenu("File › Rename");
    const dialog = screen.getByRole("dialog", { name: "Rename file" });
    const input = within(dialog).getByRole("textbox", { name: "Name" }) as HTMLInputElement;
    expect(input.value).toBe("Plan");
    expect(input.maxLength).toBe(200);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 4]);
    fireEvent.change(input, { target: { value: "  Plan B  " } });
    fireEvent.submit(dialog);
    expect(screen.queryByRole("dialog", { name: "Rename file" })).toBeNull();
    await flushTimers();
    expect(saved(plan.file.id).file.title).toBe("Plan B");
  });

  it("leaves the title alone when Rename is canceled and refuses blank names", async () => {
    const plan = store();
    await open(plan);
    await runMenu("File › Rename");
    const dialog = screen.getByRole("dialog", { name: "Rename file" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Name" }), { target: { value: "   " } });
    expect((within(dialog).getByRole("button", { name: "Rename", exact: true }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(dialog);
    expect(screen.getByRole("dialog", { name: "Rename file" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Rename file" })).toBeNull();
    expect(saved(plan.file.id).file.title).toBe("Plan");
  });

  it("does not show a favorite button in the editor", async () => {
    const plan = store("doc", "Plan", { starred: true });
    await open(plan);
    expect(screen.queryByRole("button", { name: "Star document" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Starred" })).toBeNull();
    expect(document.querySelector(".star-btn")).toBeNull();
    expect(saved(plan.file.id).starred).toBe(true);
  });

  it("goes back to the file list after saving", async () => {
    const plan = store();
    await open(plan);
    fireEvent.click(screen.getByRole("button", { name: "Back to files" }));
    expect(await screen.findByText("Somewhere else")).toBeTruthy();
    expect(paths.at(-1)).toBe("/");
  });

  it.each(["doc", "sheet", "slide"] as const)("exposes the %s menu bar directly and closes a dropdown with Escape", async (kind) => {
    await open(store(kind));
    const bar = screen.getByRole("menubar", { name: "Main menu" });
    expect(screen.queryByRole("button", { name: "Main menu" })).toBeNull();
    const file = within(bar).getByRole("button", { name: "File", exact: true });
    expect(within(bar).getByRole("button", { name: "Edit", exact: true })).toBeTruthy();
    fireEvent.keyDown(file, { key: "Enter" });
    expect(await screen.findByRole("menu")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(screen.getByRole("menubar")).toBe(bar);
  });

  it("selects the title of a file that was just made", async () => {
    const plan = store();
    await open(plan, { selectTitle: true });
    const title = screen.getByLabelText("File title") as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect([title.selectionStart, title.selectionEnd]).toEqual([0, 4]);
    fireEvent.keyDown(title, { key: "x" });
    await flushTimers();
  });

  it("shows import notes until they are closed", async () => {
    const plan = store("doc", "Imported", {});
    const file = saved(plan.file.id).file;
    file.importInfo = {
      sourceFormat: "docx",
      sourceName: "Report.docx",
      warnings: ["2 footnotes imported", "Letterhead: Acme", "Shapes were flattened"],
    } as never;
    await open(plan);
    const notes = screen.getByRole("region", { name: "Import notes" });
    expect(notes.textContent).toContain(
      "Imported DOCX: Report.docx · 2 footnotes imported · Letterhead: Acme · 1 compatibility note",
    );
    expect(within(notes).getByRole("listitem").textContent).toBe("Shapes were flattened");
    fireEvent.click(screen.getByRole("button", { name: "Close import notes" }));
    expect(screen.queryByRole("region", { name: "Import notes" })).toBeNull();
  });

  it("says supported content imported when there are no compatibility notes", async () => {
    const plan = store("doc", "Imported");
    saved(plan.file.id).file.importInfo = {
      sourceFormat: "odt",
      sourceName: "Notes.odt",
      warnings: ["3 comment threads imported"],
    } as never;
    await open(plan);
    expect(screen.getByRole("region", { name: "Import notes" }).textContent).toContain(
      "Supported content was imported into an editable SuiteLeaf copy.",
    );
  });

  it("toggles the comments of each kind of editor", async () => {
    await open(store());
    fireEvent.click(screen.getByTitle("Comments"));
    expect(fake.actions!.docActions.toggleComments).toHaveBeenCalled();
    cleanup();
    await open(store("sheet", "Budget"));
    fireEvent.click(screen.getByTitle("Comments"));
    expect(fake.actions!.sheetActions.openComments).toHaveBeenCalled();
    fake.actions!.sheetActions.openComments = undefined;
    const heard = vi.fn();
    window.addEventListener("suiteleaf:open-sheet-comments", heard);
    fireEvent.click(screen.getByTitle("Comments"));
    window.removeEventListener("suiteleaf:open-sheet-comments", heard);
    expect(heard).toHaveBeenCalled();
    cleanup();
    await open(store("slide", "Deck"));
    fireEvent.click(screen.getByTitle("Comments"));
    expect(fake.actions!.slideActions.toggleComments).toHaveBeenCalled();
  });

  it("opens each kind of editor", async () => {
    for (const [kind, label] of [
      ["sheet", "spreadsheet"],
      ["slide", "presentation"],
      ["drawing", "drawing"],
      ["form", "form"],
    ] as const) {
      const record = store(kind, kind);
      await renderWorkspace(Workspace, ModeContext, record.file.id);
      if (kind !== "form")
        expect(await screen.findByText(new RegExp(`Opening ${label} editor|${kind}:`))).toBeTruthy();
      if (kind === "form") expect(await screen.findByText("Forms are turned off in this build.")).toBeTruthy();
      else expect((await screen.findByTestId("editor")).textContent).toBe(`${kind}:${kind}:editable`);
      cleanup();
    }
  });

  it("puts the open slide in the address", async () => {
    const deck = store("slide", "Deck");
    await open(deck);
    act(() => editorProps().onSlideUrl!("s2"));
    expect(paths.at(-1)).toBe(`/file/${deck.file.id}/s2`);
    act(() => editorProps().onSlideUrl!("s2"));
    act(() => editorProps().onSlideUrl!(""));
    expect(paths.at(-1)).toBe(`/file/${deck.file.id}/s2`);
  });

  it("opens documents the editor creates", async () => {
    await open(store());
    const first = createFile("doc", "Chapter 1");
    const second = createFile("doc", "Chapter 2");
    await act(() => editorProps().onCreateDocument!([first, second]));
    expect(paths.at(-1)).toBe(`/file/${second.id}`);
    expect(fake.records.has(first.id)).toBe(true);
  });

  it("shows a save error with ways out", async () => {
    const plan = store();
    await open(plan);
    fake.failSave = "The disk is full.";
    act(() => editorProps().onChange({ changed: 1 }));
    await flushTimers();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The disk is full.");
    expect(status()).toContain("The disk is full.");
    fake.failSave = null;
    fireEvent.click(within(alert).getByRole("button", { name: "Retry save" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    act(() => editorProps().onError("Editor broke."));
    expect(screen.getByRole("alert").textContent).toContain("Editor broke.");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss error" }));
    expect(screen.queryByRole("alert")).toBeNull();
    act(() => editorProps().onError("Again."));
    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "Save As" }));
    await waitFor(() => expect(storageExtras.saveAs).toHaveBeenCalled());
  });

  it("reloads the saved file after confirming", async () => {
    const plan = store();
    await open(plan);
    act(() => editorProps().onError("Something went wrong."));
    const reload = vi.fn();
    const location = window.location;
    vi.stubGlobal("confirm", vi.fn(() => false));
    fireEvent.click(screen.getByRole("button", { name: "Reload saved" }));
    vi.stubGlobal("confirm", vi.fn(() => true));
    Object.defineProperty(window, "location", { value: { ...location, reload }, configurable: true });
    fireEvent.click(screen.getByRole("button", { name: "Reload saved" }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    Object.defineProperty(window, "location", { value: location, configurable: true });
  });

  it("downloads a SuiteLeaf copy in the browser", async () => {
    const plan = store();
    await open(plan);
    const button = screen.getByRole("button", { name: "Download" });
    expect(button.getAttribute("title")).toContain("Plan.sldoc");
    fireEvent.click(button);
    await waitFor(() => expect(status()).toBe("Downloaded “Plan.sldoc”"));
    fake.saveAsResult = null;
    fireEvent.click(button);
    await flushTimers();
    expect(storageExtras.saveAs).toHaveBeenCalledTimes(2);
  });

  it("saves, saves as and opens history from the keyboard", async () => {
    const plan = store();
    await open(plan);
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => expect(editorExtras.noteLocalSnapshot).toHaveBeenCalledWith(expect.anything(), true));
    fireEvent.keyDown(window, { key: "s", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(storageExtras.saveAs).toHaveBeenCalled());
    fireEvent.keyDown(window, { key: "H", ctrlKey: true, altKey: true, shiftKey: true });
    expect(screen.getByRole("complementary", { name: "Version history panel" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "h", metaKey: true, altKey: true, shiftKey: true });
    expect(screen.queryByRole("complementary", { name: "Version history panel" })).toBeNull();
  });

  it("asks before leaving with unsaved changes", async () => {
    await open(store());
    const calm = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(calm);
    expect(calm.defaultPrevented).toBe(false);
    act(() => editorProps().onChange({ changed: 1 }));
    const leaving = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
  });

  it.each(["doc", "sheet", "slide"] as const)("leaves a %s comparison directly from the preview", async (kind) => {
    const plan = store(kind);
    await open(plan);
    fireEvent.click(screen.getByRole("button", { name: "Version history" }));
    const history = fake.history as unknown as { onPreview: (preview: unknown) => void };
    act(() => history.onPreview({ kind, content: {}, diff: {}, label: "Earlier version" }));
    expect(document.querySelector(".live-editor")?.hasAttribute("inert")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Back to editor" }));
    expect(screen.queryByRole("complementary", { name: "Version history panel" })).toBeNull();
    expect(document.querySelector(".version-preview-session")).toBeNull();
    expect(document.querySelector(".live-editor")?.hasAttribute("inert")).toBe(false);
    expect(editorProps().file.content).toEqual(plan.file.content);
  });

  it("previews, restores and commits versions from history", async () => {
    const plan = store();
    await open(plan);
    fireEvent.click(screen.getByRole("button", { name: "Version history" }));
    const history = () =>
      fake.history as unknown as {
        getFile: () => SuiteFile;
        onPreview: (p: unknown) => void;
        onClose: () => void;
        onStatus: (s: string) => void;
        onCommitFile: (f: SuiteFile) => void;
        onRestored: (r: FileRecord) => void;
        bindParagraphRestore: { current: (key: string) => void };
      };
    expect(history().getFile().id).toBe(plan.file.id);
    const restore = vi.fn();
    history().bindParagraphRestore.current = restore;
    act(() => history().onPreview({ kind: "doc", content: {}, label: "Yesterday", offers: [] }));
    expect(screen.getByRole("region", { name: "Version preview" }).textContent).toContain("Yesterday");
    expect(document.querySelector(".live-editor")?.hasAttribute("inert")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Restore paragraph" }));
    expect(restore).toHaveBeenCalledWith("p1");
    act(() => history().onPreview({ kind: "sheet", diff: {}, label: "Sheet then" }));
    expect(screen.getByRole("region", { name: "Sheet preview" })).toBeTruthy();
    act(() => history().onPreview({ kind: "slide", diff: {}, label: "Deck then" }));
    expect(screen.getByRole("region", { name: "Slide preview" })).toBeTruthy();
    act(() => history().onStatus("Restored a paragraph"));
    expect(status()).toBe("Restored a paragraph");
    act(() => history().onCommitFile({ ...plan.file, title: "Committed" }));
    await waitFor(() => expect(saved(plan.file.id).file.title).toBe("Committed"));
    act(() => history().onRestored({ file: { ...plan.file, title: "Restored" } }));
    expect(screen.queryByRole("complementary", { name: "Version history panel" })).toBeNull();
    await waitFor(() => expect(saved(plan.file.id).file.title).toBe("Restored"));
    expect((screen.getByLabelText("File title") as HTMLInputElement).value).toBe("Restored");
    fireEvent.click(screen.getByRole("button", { name: "Version history" }));
    act(() => history().onClose());
    expect(screen.queryByRole("complementary", { name: "Version history panel" })).toBeNull();
  });

  it("seals a version after a pause and adds its summary", async () => {
    localStorage.setItem("suiteleaf.versionPauseMs", "0");
    const plan = store();
    await open(plan);
    act(() => editorProps().onChange({ changed: 1 }));
    await flushTimers();
    await waitFor(() => expect(saved(plan.file.id).file.versions?.length).toBe(1));
    await waitFor(() => expect(saved(plan.file.id).file.versions?.[0]?.summary).toBe("A short summary."));
    expect(editorExtras.frogSummary).toHaveBeenCalled();
  });

  it("seals edits left from last time when the file opens", async () => {
    localStorage.setItem("suiteleaf.versionPauseMs", "0");
    const plan = store();
    const edited = recordEdit(saved(plan.file.id).file, {
      content: { changed: 1 },
      op: { kind: "doc", truncated: true },
      by: { id: "u1", name: "Ada" },
      at: "2026-10-01T11:00:00.000Z",
    }).file;
    fake.records.set(plan.file.id, { file: edited });
    await open(plan);
    await flushTimers();
    expect(saved(plan.file.id).file.versions).toHaveLength(1);
    expect(saved(plan.file.id).file.versions![0]!.summary).toBe("A short summary.");
  });

  it("renames a form without recording an edit", async () => {
    const form = store("form", "Plots");
    await renderWorkspace(Workspace, ModeContext, form.file.id);
    fireEvent.change(await screen.findByLabelText("File title"), { target: { value: "Plot sign-up" } });
    expect(status()).toBe("Unsaved changes");
    await flushTimers();
    expect(saved(form.file.id).file.title).toBe("Plot sign-up");
    expect(saved(form.file.id).file.edits ?? []).toEqual([]);
  });

  it("shows a local save, Save As or editor flush that failed", async () => {
    const plan = store();
    await open(plan);
    fake.failSave = "Disk full.";
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    expect((await screen.findByRole("alert")).textContent).toContain("Disk full.");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss error" }));
    fake.failSave = null;
    storageExtras.saveAs.mockImplementationOnce(() => {
      throw new Error("The folder is read-only.");
    });
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect((await screen.findByRole("alert")).textContent).toContain("The folder is read-only.");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss error" }));
    fake.actions!.flush.mockRejectedValueOnce(new Error("The editor could not finish."));
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    expect((await screen.findByRole("alert")).textContent).toContain("The editor could not finish.");
  });

  it("saves again when an edit lands during Save As", async () => {
    const plan = store();
    await open(plan);
    storageExtras.saveAs.mockImplementationOnce(() => editorProps().onChange({ duringSaveAs: true }));
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await flushTimers();
    expect((saved(plan.file.id).file.content as { duringSaveAs?: boolean }).duringSaveAs).toBe(true);
    expect(status()).not.toContain("Downloaded");
  });

  it("applies a file the assistant restored", async () => {
    const plan = store();
    await open(plan);
    act(() => void applyRestoredFile({ file: { ...plan.file, title: "From the assistant" } }));
    expect((screen.getByLabelText("File title") as HTMLInputElement).value).toBe("From the assistant");
    await waitFor(() => expect(saved(plan.file.id).file.title).toBe("From the assistant"));
  });

  it("keeps a document's tab names with its edits", async () => {
    const plan = store();
    await open(plan);
    act(() => editorProps().onChange(plan.file.content, { tabTitle: "Intro", tabs: [{ id: "t", title: "Two" }] }));
    await flushTimers();
    expect(saved(plan.file.id).file).toMatchObject({ tabTitle: "Intro", tabs: [{ id: "t", title: "Two" }] });
    act(() => editorProps().onChange(plan.file.content, { tabTitle: "Intro", tabs: [{ id: "t", title: "Two" }] }));
    act(() => editorProps().onChange(plan.file.content, { tabs: [] }));
    await flushTimers();
    expect(saved(plan.file.id).file).not.toHaveProperty("tabTitle");
    expect(saved(plan.file.id).file).not.toHaveProperty("tabs");
  });
});

describe("Workspace menus and commands", () => {
  it("makes new files and copies from the File menu", async () => {
    const plan = store();
    await open(plan);
    await runMenu("File › New › Spreadsheet");
    await waitFor(() => expect(paths.at(-1)).not.toBe(`/file/${plan.file.id}`));
    const made = fake.records.get(paths.at(-1)!.slice("/file/".length))!;
    expect(made.file.kind).toBe("sheet");
    cleanup();
    await open(plan);
    for (const item of ["Document", "Presentation", "MARP presentation", "SVG drawing", "Mermaid diagram", "Graphviz graph"])
      await runMenu(`File › New › ${item}`);
    await waitFor(() => expect(fake.records.size).toBe(8));
    await runMenu("File › New › From template");
    // Each new file opened in turn, so the last one, a Graphviz drawing, is open now.
    await waitFor(() => expect(paths.at(-1)).toBe("/templates?kind=drawing"));
  });

  it("runs the rest of the File menu", async () => {
    const plan = store();
    await open(plan);
    await runMenu("File › Make a copy");
    await waitFor(() => expect(fake.records.size).toBe(2));
    cleanup();
    await open(plan);
    await runMenu("File › Save now");
    await waitFor(() => expect(editorExtras.noteLocalSnapshot).toHaveBeenCalledWith(expect.anything(), true));
    await runMenu("File › Version history");
    expect(screen.getByRole("complementary", { name: "Version history panel" })).toBeTruthy();
    await runMenu("File › Export DOCX");
    expect(fake.actions!.export).toHaveBeenCalledWith("docx");
    fake.actions!.export.mockRejectedValueOnce(new Error("Export failed."));
    await runMenu("File › Export PDF");
    expect((await screen.findByRole("alert")).textContent).toContain("Export failed.");
    await runMenu("File › Page setup…");
    expect(fake.actions!.docActions.openPageSetup).toHaveBeenCalled();
    await runMenu("File › Print / Save as PDF");
    expect(fake.actions!.print).toHaveBeenCalled();
    await runMenu("File › Download SuiteLeaf file (.sldoc)");
    await waitFor(() => expect(storageExtras.saveAs).toHaveBeenCalled());
    await runMenu("File › Save as template");
    fireEvent.click(await screen.findByRole("button", { name: "Save template" }));
    expect(status()).toBe("Saved as template “Weekly”");
    await runMenu("File › Save as template");
    fireEvent.click(await screen.findByRole("button", { name: "Close template" }));
    expect(screen.queryByRole("dialog", { name: "Save template" })).toBeNull();
  });

  it("lists each kind's exports and a sheet's print settings", async () => {
    await open(store("sheet", "Budget"));
    await runMenu("File › Export XLSX");
    expect(fake.actions!.export).toHaveBeenCalledWith("xlsx");
    await runMenu("File › Print settings");
    expect(fake.actions!.sheetActions.openPrintSettings).toHaveBeenCalled();
    cleanup();
    await open(store("slide", "Deck"));
    await runMenu("File › Export PPTX");
    expect(fake.actions!.export).toHaveBeenCalledWith("pptx");
    cleanup();
    const marp = store("slide", "Talk");
    (saved(marp.file.id).file.content as { marp?: unknown }).marp = { markdown: "# Hi" };
    await open(marp);
    await runMenu("File › Export MD");
    expect(fake.actions!.export).toHaveBeenCalledWith("md");
    cleanup();
    await open(store("drawing", "Sketch"));
    await runMenu("File › Export SVG");
    expect(fake.actions!.export).toHaveBeenCalledWith("svg");
  });

  it("reports a copy that could not be made", async () => {
    const plan = store();
    await open(plan);
    fake.failSave = "No space for a copy.";
    await runMenu("File › Make a copy");
    expect((await screen.findByRole("alert")).textContent).toContain("No space for a copy.");
    await runMenu("File › New › Document");
    await waitFor(() => expect(fake.records.size).toBe(1));
    fake.actions!.flush.mockRejectedValueOnce(new Error("Flush failed."));
    await runMenu("File › Save as template");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Flush failed."));
  });
});

describe("Workspace on the desktop", () => {
  let menu: (action: string) => void;
  beforeEach(() => {
    menu = () => {};
    window.suiteleaf = {
      setDirty: vi.fn(),
      onMenu: (listener: typeof menu) => {
        menu = listener;
        return () => {};
      },
      exportFile: vi.fn(async () => "/docs/Plan.sldoc"),
    } as never;
  });

  it("names the button Save As and exports a native copy", async () => {
    const plan = store();
    await open(plan);
    const button = screen.getByRole("button", { name: "Save As" });
    expect(button.getAttribute("title")).toBe("Save to a .sldoc file");
    fireEvent.click(button);
    await waitFor(() => expect(storageExtras.saveAs).toHaveBeenCalled());
    expect(status()).not.toContain("Downloaded");
    await runMenu("File › Export native copy");
    expect(storageExtras.exportText).toHaveBeenCalledWith(
      "Plan.sldoc",
      serializeFile(saved(plan.file.id).file),
      expect.any(String),
    );
    storageExtras.exportText.mockRejectedValueOnce(new Error("Export blocked."));
    await runMenu("File › Export native copy");
    expect((await screen.findByRole("alert")).textContent).toContain("Export blocked.");
    act(() => editorProps().onChange({ changed: 1 }));
    expect(window.suiteleaf!.setDirty).toHaveBeenCalledWith(true);
  });

  it("answers the desktop menu", async () => {
    const plan = store();
    await open(plan);
    const other = store("doc", "Other");
    fake.opened = other;
    act(() => menu("open"));
    await waitFor(() => expect(paths.at(-1)).toBe(`/file/${other.file.id}`));
  });

  it("does nothing more when the desktop open dialog is cancelled", async () => {
    const plan = store();
    await open(plan);
    act(() => menu("open"));
    await flushTimers();
    expect(paths.at(-1)).toBe(`/file/${plan.file.id}`);
    act(() => menu("print"));
    await waitFor(() => expect(fake.actions!.print).toHaveBeenCalled());
  });
});

describe("Workspace assistant on this device", () => {
  type Ctx = {
    title: string;
    kind: string;
    rename: (t: string) => void;
    download: () => Promise<{ name: string; path?: string } | null>;
    back: () => Promise<void>;
    create: (kind: string, title: string) => Promise<void>;
    openNew: (file: SuiteFile) => Promise<void>;
    snapshotFile: () => Promise<SuiteFile>;
    versions: {
      list: () => Promise<{ id: string; current: boolean; preview: string; author: string }[]>;
      restore: (id: string) => Promise<void>;
      copy: (entry: { id: string; author: string; createdAt: string }) => Promise<string>;
    };
  };
  const host = () => {
    const built = fake.hosts.workspace!();
    return { built, ctx: fake.wsCtx as unknown as Ctx };
  };

  it("describes the open file and acts on it", async () => {
    const plan = store();
    await open(plan);
    const { built, ctx } = host();
    expect(built.kind).toBe("doc");
    expect(built.place()).toBe("Document “Plan”");
    expect(built.snapshot()).toBe("workspace snapshot.");
    expect(built.tools).toEqual([{ name: "workspace-tool" }]);
    act(() => ctx.rename("Renamed"));
    expect((screen.getByLabelText("File title") as HTMLInputElement).value).toBe("Renamed");
    expect(await act(() => ctx.download())).toEqual({ name: "Renamed.sldoc", path: undefined });
    fake.saveAsResult = null;
    expect(await act(() => ctx.download())).toBeNull();
    const snapshot = await act(() => ctx.snapshotFile());
    expect(snapshot.title).toBe("Renamed");
    await act(() => ctx.create("sheet", "Budget"));
    expect([...fake.records.values()].some((r) => r.file.title === "Budget")).toBe(true);
    await act(() => ctx.openNew(createFile("doc", "Fresh")));
    expect([...fake.records.values()].some((r) => r.file.title === "Fresh")).toBe(true);
    await act(() => ctx.back());
    expect(paths.at(-1)).toBe("/");
  });

  it("names each kind of file it can see", async () => {
    for (const [kind, word] of [
      ["sheet", "Spreadsheet"],
      ["slide", "Presentation"],
      ["drawing", "Drawing"],
      ["form", "Form"],
    ] as const) {
      const record = store(kind, "X");
      await renderWorkspace(Workspace, ModeContext, record.file.id);
      await waitFor(() => expect(fake.hosts.workspace!().place()).toBe(`${word} “X”`));
      cleanup();
    }
    fake.hosts = {};
    await renderWorkspace(Workspace, ModeContext, "missing");
    await screen.findByRole("alert");
    const empty = fake.hosts.workspace!();
    expect([empty.kind, empty.place(), empty.snapshot(), empty.tools]).toEqual(["doc", "", "", []]);
  });

  it("lists, restores and copies versions kept on this device", async () => {
    const plan = store();
    await open(plan);
    const older = { ...plan.file, title: "Older" };
    fake.localVersions = [
      { id: "snap-1", createdAt: "2026-09-01T10:00:00.000Z", authorName: "You", name: "First", native: serializeFile(older) },
    ];
    const { ctx } = host();
    const list = await ctx.versions.list();
    expect(list.map((v) => [v.id, v.current, v.author])).toEqual([
      ["current", true, "You"],
      ["snap-1", false, "You"],
    ]);
    expect(list[0]!.preview).toMatch(/^preview of \d+ characters$/);
    await act(() => ctx.versions.restore("snap-1"));
    expect((screen.getByLabelText("File title") as HTMLInputElement).value).toBe("Older");
    await expect(ctx.versions.restore("gone")).rejects.toThrow("That version is no longer on this computer.");
    const name = await act(() => ctx.versions.copy({ id: "snap-1", author: "You", createdAt: "2026-09-01T10:00:00.000Z" }));
    expect(name).toMatch(/\.sldoc$/);
    await act(() => ctx.versions.copy({ id: "current", author: "You", createdAt: "2026-09-01T10:00:00.000Z" }));
    await expect(ctx.versions.copy({ id: "gone", author: "You", createdAt: "x" })).rejects.toThrow(
      "That version is no longer on this computer.",
    );
    fake.localVersions = [
      { id: "same", createdAt: "x", authorName: "You", name: null, native: serializeFile(saved(plan.file.id).file) },
    ];
    await waitFor(async () => expect((await host().ctx.versions.list()).map((v) => v.id)).toEqual(["same"]));
  });

  it("refuses to act with no file open", async () => {
    await renderWorkspace(Workspace, ModeContext, "missing");
    await screen.findByRole("alert");
    expect(fake.wsCtx).toBeNull();
  });
});

describe("Workspace locks", () => {
  it("says the file is open in another tab when the lock never frees", async () => {
    const plan = store();
    const request = vi.fn(async (_name: string, _options: unknown, run: (lock: null) => Promise<void>) => run(null));
    Object.defineProperty(navigator, "locks", { value: { request }, configurable: true });
    await renderWorkspace(Workspace, ModeContext, plan.file.id);
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(await screen.findByText("Already open in another tab")).toBeTruthy();
    expect(request).toHaveBeenCalledTimes(6);
    Object.defineProperty(navigator, "locks", { value: undefined, configurable: true });
  });

  it("holds the lock while the file is open and lets go after", async () => {
    const plan = store();
    let released = false;
    const request = vi.fn(async (_name: string, _options: unknown, run: (lock: object) => Promise<void>) => {
      await run({});
      released = true;
    });
    Object.defineProperty(navigator, "locks", { value: { request }, configurable: true });
    const { unmount } = await renderWorkspace(Workspace, ModeContext, plan.file.id);
    await act(() => vi.advanceTimersByTimeAsync(10));
    await screen.findByTestId("editor");
    act(() => editorProps().onChange({ changed: 1 }));
    expect(released).toBe(false);
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(released).toBe(true);
    expect((saved(plan.file.id).file.content as { changed?: number }).changed).toBe(1);
    Object.defineProperty(navigator, "locks", { value: undefined, configurable: true });
  });

  it("shows a lock failure", async () => {
    const plan = store();
    Object.defineProperty(navigator, "locks", {
      value: { request: async () => Promise.reject(new Error("Locks are broken.")) },
      configurable: true,
    });
    await renderWorkspace(Workspace, ModeContext, plan.file.id);
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect((await screen.findByRole("alert")).textContent).toBe("Locks are broken.");
    Object.defineProperty(navigator, "locks", { value: undefined, configurable: true });
  });
});

describe("Workspace recovery", () => {
  it("opens a recovered draft with its notice", async () => {
    const plan = store("doc", "Plan", { recovery: { savedAt: "x" } as never });
    openNotices.set(plan.file.id, "Opened “Plan.sldoc”");
    await open(plan);
    expect(status()).toBe("Opened “Plan.sldoc” · Recovered draft · review and save");
    expect(openNotices.has(plan.file.id)).toBe(false);
    // A local file has no room, and the room says so as the editor mounts.
    act(() => (fake.room as { onRecovery: (notice: string | null) => void }).onRecovery(null));
    expect(status()).toBe("Opened “Plan.sldoc” · Recovered draft · review and save");
  });
});
