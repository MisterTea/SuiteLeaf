// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFile,
  nativeFilename,
  serializeFile,
  type DocFile,
  type FileRecord,
  type JsonNode,
  type SheetFile,
  type SuiteFile,
} from "../../packages/core/src";
import { VersionHistory, VersionPreview } from "../../apps/web/src/editors/version-history";
import type { HistoryPreview } from "../../apps/web/src/editors/version-compare";
import {
  localVersions,
  noteLocalSnapshot,
  restoreLocalVersion,
} from "../../apps/web/src/editors/local-versions";
import { versionWhen } from "../../apps/web/src/editors/version-history-model";
import { stubBrowser } from "./other-editors-env";

const drive = vi.hoisted(() => ({
  versions: vi.fn(),
  get: vi.fn(),
  read: vi.fn(),
  readVersion: vi.fn(),
  nameVersion: vi.fn(),
  copyVersion: vi.fn(),
  restoreVersion: vi.fn(),
}));
const uploadDriveFile = vi.hoisted(() => vi.fn());
const save = vi.hoisted(() => vi.fn());

vi.mock("../../apps/web/src/node-client", () => ({
  drive,
  uploadDriveFile,
  getSession: () => ({ user: { id: "me", name: "Mo Writer" } }),
}));
vi.mock("../../apps/web/src/storage", () => ({ storage: { save } }));

beforeEach(stubBrowser);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function doc(...texts: string[]): JsonNode {
  return {
    type: "doc",
    content: texts.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
  };
}

function docFile(title: string, content: JsonNode): DocFile {
  const file = createFile("doc", title) as DocFile;
  return { ...file, content: content as DocFile["content"] };
}

const ada = { id: "ada", name: "Ada Lovelace" };

/** A document with two kept versions and newer, unsaved edits by Bo. */
function trackedDoc(): DocFile {
  const file = docFile("Plan", doc("North bed: beans", "South bed: leeks"));
  return {
    ...file,
    updatedAt: minutesAgo(5),
    edits: [{ id: "e3", at: minutesAgo(5), by: { id: "bo", name: "Bo" }, op: { kind: "doc" } }],
    versions: [
      {
        id: "v1",
        at: minutesAgo(60),
        by: ada,
        summary: "Added a paragraph",
        title: "Plan",
        throughEdit: "e1",
        content: doc("North bed: carrots"),
      },
      {
        id: "v2",
        at: minutesAgo(30),
        by: ada,
        summary: "Edited a paragraph",
        label: "Draft",
        title: "Plan",
        throughEdit: "e2",
        content: doc("North bed: beans"),
      },
    ],
  };
}

function openHistory(record: FileRecord, getFile: () => SuiteFile = () => record.file) {
  const handlers = {
    onClose: vi.fn(),
    onPreview: vi.fn<(preview: HistoryPreview | null) => void>(),
    onRestored: vi.fn<(record: FileRecord) => void>(),
    onCommitFile: vi.fn<(file: SuiteFile) => void>(),
    onStatus: vi.fn<(status: string) => void>(),
  };
  const bind: { current: (key: string) => void } = { current: () => {} };
  const view = render(
    <VersionHistory record={record} getFile={getFile} bindParagraphRestore={bind} {...handlers} />,
  );
  const lastPreview = () => handlers.onPreview.mock.lastCall?.[0] ?? null;
  return { ...view, ...handlers, bind, lastPreview };
}

/** The row whose title or subtitle reads exactly `text`. */
const entry = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>(".version-entry")].find((button) =>
    [...button.querySelectorAll("span")].some((span) => span.textContent === text),
  )!;

/** A newer edit by someone else, so the open file is its own history entry. */
function edited(file: DocFile, ...texts: string[]): DocFile {
  return {
    ...file,
    content: doc(...texts) as DocFile["content"],
    updatedAt: minutesAgo(0),
    edits: [{ id: "later", at: minutesAgo(0), by: { id: "bo", name: "Bo" }, op: { kind: "doc" } }],
  };
}

describe("version history kept in the file", () => {
  it("lists the unsaved head, named versions, and summaries newest first", async () => {
    const file = trackedDoc();
    openHistory({ file });
    await waitFor(() => expect(screen.queryByText("Loading versions…")).toBeNull());
    const titles = [...document.querySelectorAll(".version-entry")].map((node) => node.textContent);
    expect(titles).toEqual([
      `Current version${versionWhen(minutesAgo(5))} · Bo`,
      `Draft${versionWhen(minutesAgo(30))} · Ada Lovelace`,
      `${versionWhen(minutesAgo(60))} · Ada LovelaceAdded a paragraph`,
    ]);
    expect(screen.getByRole("heading", { name: "Today" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Restore this version" })).toBeNull();
  });

  it("compares an older version with the current one and offers each changed paragraph back", async () => {
    const file = trackedDoc();
    const { lastPreview } = openHistory({ file });
    await waitFor(() => expect(entry("Added a paragraph")).toBeTruthy());
    fireEvent.click(entry("Added a paragraph"));
    await waitFor(() => expect(lastPreview()?.kind).toBe("doc"));
    const preview = lastPreview() as Extract<HistoryPreview, { kind: "doc" }>;
    expect(preview.label).toContain("Comparing with the current version");
    const offers = preview.offers!.filter(Boolean);
    expect(offers[0]!.prompt).toContain(
      `Restore the north-bed paragraph from ${versionWhen(minutesAgo(60))}?`,
    );
    expect(screen.getByText(/^Restore the version from .* paragraphs change\./)).toBeTruthy();
  });

  it("restores a kept version and keeps the document that was open", async () => {
    const file = trackedDoc();
    const { onRestored } = openHistory({ file });
    await waitFor(() => expect(entry("Added a paragraph")).toBeTruthy());
    fireEvent.click(entry("Added a paragraph"));
    fireEvent.click(await screen.findByRole("button", { name: "Restore this version" }));
    await waitFor(() => expect(onRestored).toHaveBeenCalledTimes(1));
    const restored = onRestored.mock.calls[0][0].file as DocFile;
    expect(restored.content).toEqual(doc("North bed: carrots"));
    expect(restored.versions!.at(-1)!.content).toEqual(file.content);
    expect(restored.edits!.at(-1)!.by).toEqual({ id: "me", name: "Mo Writer" });
  });

  it("shows only what a version changed, and says when there is nothing earlier", async () => {
    const file = trackedDoc();
    const { lastPreview } = openHistory({ file });
    await waitFor(() => expect(entry("Draft")).toBeTruthy());
    fireEvent.click(entry("Draft"));
    fireEvent.click(screen.getByRole("button", { name: "Changes in this version" }));
    await waitFor(() => expect(lastPreview()?.label).toContain("Changes in this version"));
    expect(screen.getByRole("button", { name: "Changes in this version" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(entry("Added a paragraph"));
    expect(screen.getByRole("button", { name: "Compare with current" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Changes in this version" }));
    await waitFor(() => expect(lastPreview()?.label).toContain("earliest version"));
  });

  it("names a kept version in the file, and asks for a name when the box is empty", async () => {
    const file = trackedDoc();
    const { onCommitFile } = openHistory({ file });
    await waitFor(() => expect(entry("Draft")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Actions for Draft" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Name this version" }));
    const box = screen.getByLabelText("Version name");
    expect(box).toHaveProperty("value", "Draft");
    fireEvent.change(box, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Type a name for this version.");
    fireEvent.change(box, { target: { value: "Final plan" } });
    fireEvent.submit(box.closest("form")!);
    await waitFor(() => expect(onCommitFile).toHaveBeenCalledTimes(1));
    const named = onCommitFile.mock.calls[0][0] as DocFile;
    expect(named.versions!.find((version) => version.id === "v2")!.label).toBe("Final plan");
    await waitFor(() => expect(screen.queryByLabelText("Version name")).toBeNull());
  });

  it("cancels naming, and closes the actions menu on the next click elsewhere", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      openHistory({ file: trackedDoc() });
      await vi.waitFor(() => expect(entry("Draft")).toBeTruthy());
      fireEvent.click(screen.getByRole("button", { name: "Actions for Draft" }));
      expect(screen.getByRole("menu")).toBeTruthy();
      fireEvent.click(screen.getByRole("menu"));
      act(() => vi.runAllTimers());
      expect(screen.getByRole("menu")).toBeTruthy();
      fireEvent.click(document.body);
      expect(screen.queryByRole("menu")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Actions for Draft" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Name this version" }));
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByLabelText("Version name")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("saves a copy of a version with the user's files", async () => {
    const file = trackedDoc();
    const { onStatus } = openHistory({ file });
    await waitFor(() => expect(entry("Added a paragraph")).toBeTruthy());
    const title = `${versionWhen(minutesAgo(60))} · Ada Lovelace`;
    fireEvent.click(screen.getByRole("button", { name: `Actions for ${title}` }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Make a copy" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const copy = save.mock.calls[0][0].file as DocFile;
    expect(copy.title).toMatch(/^Plan \(Ada's draft, \d+ \w+ \d\d:\d\d\)$/);
    expect(copy.id).not.toBe(file.id);
    expect(copy.content).toEqual(doc("North bed: carrots"));
    expect(onStatus).toHaveBeenCalledWith(`Saved “${copy.title}” with your files.`);
    expect(screen.getByText(`Saved “${copy.title}” with your files.`)).toBeTruthy();
  });

  it("reports a copy that could not be saved", async () => {
    save.mockRejectedValueOnce(new Error("The disk is full."));
    openHistory({ file: trackedDoc() });
    await waitFor(() => expect(entry("Draft")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Actions for Draft" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Make a copy" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The disk is full.");
  });

  it("puts one paragraph back and names the result in the file's history", async () => {
    const file = trackedDoc();
    const { bind, onRestored } = openHistory({ file });
    await waitFor(() => expect(entry("Added a paragraph")).toBeTruthy());
    fireEvent.click(entry("Added a paragraph"));
    await screen.findByRole("button", { name: "Restore this version" });
    await act(async () => bind.current("replace:0"));
    await waitFor(() => expect(onRestored).toHaveBeenCalledTimes(1));
    const restored = onRestored.mock.calls[0][0].file as DocFile;
    expect(restored.content).toEqual(doc("North bed: carrots", "South bed: leeks"));
    expect(restored.versions!.at(-1)!.label).toBe("Restored the north-bed paragraph");
  });

  it("refuses a paragraph that already matches the current document", async () => {
    const { bind, onRestored } = openHistory({ file: trackedDoc() });
    await waitFor(() => expect(entry("Added a paragraph")).toBeTruthy());
    fireEvent.click(entry("Added a paragraph"));
    await screen.findByRole("button", { name: "Restore this version" });
    await act(async () => bind.current("replace:9"));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "That paragraph matches the current document.",
    );
    expect(onRestored).not.toHaveBeenCalled();
  });

  it("filters to named versions, and says when there are none", async () => {
    const file = trackedDoc();
    file.versions = file.versions!.map((version) => {
      const copy = { ...version };
      delete copy.label;
      return copy;
    });
    openHistory({ file });
    await waitFor(() => expect(document.querySelectorAll(".version-entry")).toHaveLength(3));
    fireEvent.click(screen.getByLabelText("Named versions only"));
    expect(screen.getByText(/No named versions yet/)).toBeTruthy();
    expect(document.querySelectorAll(".version-entry")).toHaveLength(0);
  });

  it("folds a run of autosaves under the newest one", async () => {
    const file = trackedDoc();
    file.edits = [{ id: "e3", at: minutesAgo(5), by: ada, op: { kind: "doc" } }];
    file.versions = [
      { ...file.versions![0], at: minutesAgo(9) },
      { ...file.versions![1], at: minutesAgo(7), label: undefined, summary: "Edited a paragraph" },
    ];
    openHistory({ file });
    const expand = await screen.findByRole("button", { name: "Show earlier autosaves" });
    expect(document.querySelectorAll(".version-entry")).toHaveLength(1);
    fireEvent.click(expand);
    expect(document.querySelectorAll(".version-entry")).toHaveLength(3);
    expect(document.querySelectorAll(".version-row.nested")).toHaveLength(2);
    fireEvent.click(entry("Added a paragraph"));
    expect(document.querySelector(".version-row.nested.selected")?.textContent).toContain("Added a paragraph");
    fireEvent.click(screen.getByRole("button", { name: `Actions for ${versionWhen(minutesAgo(9))} · Ada Lovelace` }));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide earlier autosaves" }));
    expect(document.querySelectorAll(".version-entry")).toHaveLength(1);
  });

  it("compares spreadsheet versions cell by cell", async () => {
    const sheet = createFile("sheet", "Budget") as SheetFile;
    const sheetId = sheet.content.workbook.sheetOrder[0];
    const withCell = (value: string) => {
      const content = structuredClone(sheet.content);
      content.workbook.sheets[sheetId].cellData = { 0: { 0: { v: value } } };
      return content;
    };
    const file: SheetFile = {
      ...sheet,
      content: withCell("12"),
      versions: [
        { id: "s1", at: minutesAgo(20), by: ada, summary: "Changed 1 cell", title: "Budget", throughEdit: "x", content: withCell("10") },
      ],
    };
    const { lastPreview } = openHistory({ file });
    await waitFor(() => expect(entry("Changed 1 cell")).toBeTruthy());
    fireEvent.click(entry("Changed 1 cell"));
    await waitFor(() => expect(lastPreview()?.kind).toBe("sheet"));
    expect(screen.getByText("1 cell changes")).toBeTruthy();
    expect(screen.getByText(/1 cell changes\. The current version stays in history\./)).toBeTruthy();
  });

  it("says a version list is empty before the first save", async () => {
    const file = docFile("Blank", doc("Hello"));
    await noteLocalSnapshot(file, true);
    openHistory({ file });
    await waitFor(() => expect(document.querySelectorAll(".version-entry")).toHaveLength(1));
    expect(screen.getByText(/^Current version/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Restore this version" })).toBeNull();
  });

  it("closes from the header", () => {
    const { onClose } = openHistory({ file: trackedDoc() });
    fireEvent.click(screen.getByRole("button", { name: "Close version history" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("snapshots kept on this computer", () => {
  it("lists snapshots, restores one, and names one", async () => {
    const before = docFile("Notes", doc("First thought"));
    await noteLocalSnapshot(before, true);
    const live = edited(before, "Second thought");
    const { onRestored, lastPreview } = openHistory({ file: live });
    await waitFor(() => expect(document.querySelectorAll(".version-entry")).toHaveLength(2));
    const older = document.querySelectorAll<HTMLButtonElement>(".version-entry")[1];
    fireEvent.click(older);
    await waitFor(() => expect(lastPreview()?.kind).toBe("doc"));
    fireEvent.click(screen.getByRole("button", { name: "Restore this version" }));
    await waitFor(() => expect(onRestored).toHaveBeenCalledTimes(1));
    expect(onRestored.mock.calls[0][0].file.content).toEqual(doc("First thought"));
    const kept = await localVersions(before.id);
    expect(kept[0].restoredFrom).toBe(kept[1].id);

    cleanup();
    openHistory({ file: live });
    await waitFor(() => expect(document.querySelectorAll(".version-entry").length).toBeGreaterThan(1));
    expect(screen.getAllByText(/^Restored /).length).toBeGreaterThan(0);
    const menus = screen.getAllByRole("button", { name: /^Actions for / });
    fireEvent.click(menus.at(-1)!);
    fireEvent.click(screen.getByRole("menuitem", { name: "Name this version" }));
    fireEvent.change(screen.getByLabelText("Version name"), { target: { value: "Kickoff" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(entry("Kickoff")).toBeTruthy());
    expect((await localVersions(before.id)).some((version) => version.name === "Kickoff")).toBe(true);
  });

  it("names the unsaved head by keeping it as a snapshot", async () => {
    const before = docFile("Head", doc("One"));
    await noteLocalSnapshot(before, true);
    const live = edited(before, "Two");
    openHistory({ file: live });
    await waitFor(() => expect(document.querySelectorAll(".version-entry")).toHaveLength(2));
    fireEvent.click(screen.getAllByRole("button", { name: /^Actions for / })[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Name this version" }));
    fireEvent.change(screen.getByLabelText("Version name"), { target: { value: "Second pass" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(entry("Second pass")).toBeTruthy());
    const kept = await localVersions(before.id);
    expect(kept[0]).toMatchObject({ name: "Second pass", authorName: "Bo", native: serializeFile(live) });
  });

  it("keeps a snapshot that matches a version in the file out of the list", async () => {
    const file = trackedDoc();
    await noteLocalSnapshot({ ...file, content: doc("North bed: beans") as DocFile["content"], edits: undefined, versions: undefined }, true);
    openHistory({ file });
    await waitFor(() => expect(document.querySelectorAll(".version-entry")).toHaveLength(3));
  });

  it("restores one paragraph from a snapshot", async () => {
    const before = docFile("Beds", doc("North bed: carrots"));
    await noteLocalSnapshot(before, true);
    const live = edited(before, "North bed: beans");
    const { bind, onRestored } = openHistory({ file: live });
    await waitFor(() => expect(document.querySelectorAll(".version-entry")).toHaveLength(2));
    fireEvent.click(document.querySelectorAll<HTMLButtonElement>(".version-entry")[1]);
    await screen.findByRole("button", { name: "Restore this version" });
    await act(async () => bind.current("replace:0"));
    await waitFor(() => expect(onRestored).toHaveBeenCalledTimes(1));
    const restored = onRestored.mock.calls[0][0].file as DocFile;
    expect(restored.content).toEqual(doc("North bed: carrots"));
    expect(restored.versions!.at(-1)!.label).toBe("Restored the north-bed paragraph");
  });

  it("says what is wrong with a snapshot that cannot be read", async () => {
    const live = docFile("Broken", doc("Fine"));
    await restoreLocalVersion({
      id: "gone",
      fileId: live.id,
      createdAt: minutesAgo(30),
      authorId: "local",
      authorName: "You",
      name: null,
      restoredFrom: null,
      native: "not a SuiteLeaf file",
    }).catch(() => {});
    openHistory({ file: live });
    await waitFor(() => expect(document.querySelectorAll(".version-entry")).toHaveLength(2));
    fireEvent.click(document.querySelectorAll<HTMLButtonElement>(".version-entry")[1]);
    expect((await screen.findByRole("alert")).textContent).not.toBe("");
  });
});

describe("versions on SuiteDrive", () => {
  const link = { nodeUrl: "https://node.test", itemId: "item-1", versionId: "head", name: "Plan.sldoc" };
  const live = docFile("Plan", doc("North bed: beans"));
  const older = docFile("Plan", doc("North bed: carrots"));

  function driveVersions(extra: { headId?: string } = {}) {
    drive.versions.mockResolvedValue([
      { id: "head", createdAt: minutesAgo(1), authorId: "me", authorName: "Mo Writer", name: null, restoredFrom: null },
      { id: "back", createdAt: minutesAgo(10), authorId: "ada", authorName: "Ada Lovelace", name: null, restoredFrom: "kick" },
      { id: "kick", createdAt: minutesAgo(90), authorId: "ada", authorName: "Ada Lovelace", name: "Kickoff", restoredFrom: null },
    ]);
    drive.get.mockResolvedValue({ headVersionId: extra.headId ?? "head" });
    drive.read.mockResolvedValue({ text: serializeFile(live), versionId: "head" });
    drive.readVersion.mockImplementation(async (_item: string, id: string) =>
      id === "kick" ? serializeFile(older) : serializeFile(live),
    );
  }

  it("lists drive versions with restores, and compares against the drive head", async () => {
    driveVersions();
    const { lastPreview } = openHistory({ file: live, drive: link });
    await waitFor(() => expect(entry("Kickoff")).toBeTruthy());
    expect(entry('Restored "Kickoff" · Ada Lovelace')).toBeTruthy();
    fireEvent.click(entry("Kickoff"));
    await waitFor(() => expect(lastPreview()?.kind).toBe("doc"));
    expect(drive.read).toHaveBeenCalledWith("item-1");
    expect(drive.readVersion).toHaveBeenCalledWith("item-1", "kick");
    expect(screen.getByText(/^Restore "Kickoff"\? 1 paragraph changes\./)).toBeTruthy();
  });

  it("restores a drive version and follows the new head", async () => {
    driveVersions();
    drive.restoreVersion.mockResolvedValue({ id: "item-1", name: nativeFilename(older), headVersionId: "fresh" });
    drive.read.mockResolvedValue({ text: serializeFile(live), versionId: "head" });
    const { onRestored } = openHistory({ file: live, drive: link });
    await waitFor(() => expect(entry("Kickoff")).toBeTruthy());
    fireEvent.click(entry("Kickoff"));
    await screen.findByRole("button", { name: "Restore this version" });
    drive.read.mockResolvedValue({ text: serializeFile(older) });
    fireEvent.click(screen.getByRole("button", { name: "Restore this version" }));
    await waitFor(() => expect(onRestored).toHaveBeenCalledTimes(1));
    expect(drive.restoreVersion).toHaveBeenCalledWith("item-1", "kick", "head");
    const restored = onRestored.mock.calls[0][0];
    expect(restored.file.content).toEqual(doc("North bed: carrots"));
    expect(restored.drive).toMatchObject({ itemId: "item-1", versionId: "fresh", name: nativeFilename(older) });
  });

  it("names and copies drive versions in the folder", async () => {
    driveVersions();
    drive.copyVersion.mockResolvedValue(undefined);
    drive.nameVersion.mockResolvedValue(undefined);
    const { onStatus } = openHistory({ file: live, drive: link });
    await waitFor(() => expect(entry("Kickoff")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Actions for Kickoff" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Make a copy" }));
    await waitFor(() => expect(drive.copyVersion).toHaveBeenCalledTimes(1));
    const [, id, filename] = drive.copyVersion.mock.calls[0];
    expect(id).toBe("kick");
    expect(onStatus).toHaveBeenCalledWith(`Saved “${filename}” in this folder.`);
    fireEvent.click(screen.getByRole("button", { name: "Actions for Kickoff" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Name this version" }));
    fireEvent.change(screen.getByLabelText("Version name"), { target: { value: "Start" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(drive.nameVersion).toHaveBeenCalledWith("item-1", "kick", "Start"));
    await waitFor(() => expect(drive.versions).toHaveBeenCalledTimes(2));
  });

  it("uploads the open document before putting one paragraph back", async () => {
    driveVersions();
    const edited = docFile("Plan", doc("North bed: peas"));
    uploadDriveFile
      .mockResolvedValueOnce({ ...link, versionId: "kept" })
      .mockResolvedValueOnce({ ...link, versionId: "mixed" });
    const { bind, onRestored } = openHistory({ file: edited, drive: link }, () => edited);
    await waitFor(() => expect(entry("Kickoff")).toBeTruthy());
    fireEvent.click(entry("Kickoff"));
    await screen.findByRole("button", { name: "Restore this version" });
    await act(async () => bind.current("replace:0"));
    await waitFor(() => expect(onRestored).toHaveBeenCalledTimes(1));
    expect(uploadDriveFile).toHaveBeenCalledTimes(2);
    expect(uploadDriveFile.mock.calls[0][0]).toBe(edited);
    expect(drive.nameVersion).toHaveBeenCalledWith("item-1", "mixed", "Restored the north-bed paragraph");
    expect(onRestored.mock.calls[0][0].drive?.versionId).toBe("mixed");
    expect(onRestored.mock.calls[0][0].file.content).toEqual(doc("North bed: carrots"));
  });

  it("does not compare files of different kinds", async () => {
    driveVersions();
    drive.readVersion.mockResolvedValue(serializeFile(createFile("sheet", "Plan")));
    const { lastPreview, onPreview } = openHistory({ file: live, drive: link });
    await waitFor(() => expect(entry("Kickoff")).toBeTruthy());
    fireEvent.click(entry("Kickoff"));
    await waitFor(() => expect(drive.readVersion).toHaveBeenCalled());
    await act(async () => {});
    expect(onPreview).toHaveBeenCalled();
    expect(lastPreview()).toBeNull();
    expect(screen.getByText(/^Restore "Kickoff"\? The current version stays in history\./)).toBeTruthy();
  });

  it("refuses to restore one paragraph into a spreadsheet", async () => {
    const sheet = createFile("sheet", "Plan");
    drive.versions.mockResolvedValue([
      { id: "head", createdAt: minutesAgo(1), authorId: "me", authorName: "Mo", name: null, restoredFrom: null },
      { id: "old", createdAt: minutesAgo(9), authorId: "me", authorName: "Mo", name: "Old", restoredFrom: null },
    ]);
    drive.get.mockResolvedValue({ headVersionId: null });
    drive.read.mockResolvedValue({ text: serializeFile(sheet) });
    drive.readVersion.mockResolvedValue(serializeFile(sheet));
    const { bind } = openHistory({ file: sheet, drive: link });
    await waitFor(() => expect(entry("Old")).toBeTruthy());
    fireEvent.click(entry("Old"));
    await screen.findByRole("button", { name: "Restore this version" });
    await act(async () => bind.current("replace:0"));
    expect((await screen.findByRole("alert")).textContent).toBe("Only a document can restore one paragraph.");
  });

  it("says why the drive history could not load", async () => {
    drive.versions.mockRejectedValue(new Error("SuiteDrive is offline."));
    drive.get.mockResolvedValue({});
    openHistory({ file: live, drive: link });
    expect((await screen.findByRole("alert")).textContent).toBe("SuiteDrive is offline.");
    expect(screen.getByText(/Versions appear as the file is saved/)).toBeTruthy();
  });

  it("reports a restore the drive refused", async () => {
    driveVersions();
    drive.restoreVersion.mockRejectedValue("Not allowed");
    openHistory({ file: live, drive: link });
    await waitFor(() => expect(entry("Kickoff")).toBeTruthy());
    fireEvent.click(entry("Kickoff"));
    fireEvent.click(await screen.findByRole("button", { name: "Restore this version" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Not allowed");
    expect(screen.getByRole("button", { name: "Restore this version" })).toHaveProperty("disabled", false);
  });
});

describe("the version preview", () => {
  it("draws the version read-only, and a paragraph button calls back with its key", async () => {
    const onRestoreParagraph = vi.fn();
    render(
      <VersionPreview
        content={doc("North bed: carrots")}
        label="Comparing with the current version"
        offers={[{ key: "replace:0", prompt: "Restore the north-bed paragraph?" }]}
        onRestoreParagraph={onRestoreParagraph}
      />,
    );
    expect(screen.getByText("Comparing with the current version")).toBeTruthy();
    const editor = await screen.findByLabelText("Version preview", { selector: "[contenteditable]" });
    expect(editor.getAttribute("contenteditable")).toBe("false");
    expect(editor.textContent).toContain("North bed: carrots");
    fireEvent.click(await screen.findByRole("button", { name: "Restore this paragraph" }));
    expect(onRestoreParagraph).toHaveBeenCalledWith("replace:0");
  });

  it("switches between document tabs and marks added and deleted ones", async () => {
    const tabs = [
      { id: "first", title: "Minutes", status: "same" as const, content: doc("Same"), changedParagraphs: 0 },
      { id: "t2", title: "Actions", status: "added" as const, content: doc("New tab"), changedParagraphs: 1 },
      { id: "t3", title: "Old", status: "removed" as const, content: doc("Gone tab"), changedParagraphs: 1 },
    ];
    render(<VersionPreview content={doc("Same")} label="Tabs" tabs={tabs} />);
    const list = screen.getByRole("tablist", { name: "Document tabs" });
    const buttons = within(list).getAllByRole("tab");
    expect(buttons.map((button) => button.textContent)).toEqual(["Minutes", "Actions · added", "Old · deleted"]);
    expect(buttons[1].getAttribute("aria-selected")).toBe("true");
    await waitFor(() => expect(document.querySelector(".ProseMirror")?.textContent).toBe("New tab"));
    fireEvent.click(buttons[2]);
    await waitFor(() => expect(document.querySelector(".ProseMirror")?.textContent).toBe("Gone tab"));
    expect(within(list).getAllByRole("tab")[2].getAttribute("aria-selected")).toBe("true");
  });
});
