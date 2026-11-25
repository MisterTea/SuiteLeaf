// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DriveItem } from "../../apps/web/src/node-client";

const state = vi.hoisted(() => ({
  items: [] as DriveItem[],
}));

const exportText = vi.hoisted(() => vi.fn(async () => {}));

const drive = vi.hoisted(() => ({
  list: vi.fn(async (parentId: string | null) =>
    state.items
      .filter((i) => i.parentId === parentId && !i.trashed)
      .map((i) => ({ ...i })),
  ),
  listTrashed: vi.fn(async () =>
    state.items.filter((i) => i.trashed).map((i) => ({ ...i })),
  ),
  shared: vi.fn(async () =>
    state.items
      .filter((i) => i.role !== "owner" && !i.trashed)
      .map((i) => ({ ...i })),
  ),
  search: vi.fn(async () => []),
  get: vi.fn(async (id: string) => state.items.find((i) => i.id === id)!),
  update: vi.fn(async (id: string, patch: Partial<DriveItem>) => {
    const found = state.items.find((i) => i.id === id)!;
    Object.assign(found, patch);
    return { ...found };
  }),
  keepCopy: vi.fn(async () => {}),
  read: vi.fn(async (id: string) => ({ text: `{"id":"${id}"}`, versionId: "v1" })),
  create: vi.fn(),
  deleteForever: vi.fn(async (id: string) => {
    state.items = state.items.filter((i) => i.id !== id);
  }),
  notices: vi.fn(async () => []),
  dismissNotice: vi.fn(),
  listFolders: vi.fn(async () =>
    state.items
      .filter((i) => i.kind === "folder" && !i.trashed)
      .map(({ id, name, parentId }) => ({ id, name, parentId })),
  ),
  access: vi.fn(async () => ({ grants: [], parent: null, yourRole: "owner" })),
}));

function makeItem(
  id: string,
  name: string,
  parentId: string | null,
  extra: Partial<DriveItem> = {},
): DriveItem {
  return {
    id,
    parentId,
    name,
    kind: "file",
    ownerId: "ada",
    mime: null,
    size: 100,
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

vi.mock("../../apps/web/src/node-client", () => ({
  drive,
  getSession: () => ({ url: "https://drive.example", user: { id: "ada" } }),
}));

vi.mock("../../apps/web/src/storage", () => ({
  exportText,
}));

import { DriveBrowser } from "../../apps/web/src/drive/DriveBrowser";
import { bulkSelectionSummary } from "../../apps/web/src/drive/drive-selection";

beforeEach(() => {
  state.items = [
    makeItem("f-archive", "Archive", null, { kind: "folder" }),
    makeItem("doc-a", "Alpha.sldoc", null),
    makeItem("sheet-b", "Budget.slsheet", null, { role: "editor" }),
    makeItem("deck-c", "Pitch.slslides", null, { role: "viewer" }),
    makeItem("trash-1", "Old.sldoc", null, { trashed: true }),
    makeItem("trash-2", "Notes.sldoc", null, { trashed: true }),
  ];
  sessionStorage.clear();
  for (const fn of Object.values(drive)) fn.mockClear();
  exportText.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("bulkSelectionSummary", () => {
  it("computes eligible actions by item kind, role, and view", () => {
    const folder = makeItem("f1", "Docs", null, { kind: "folder", role: "owner" });
    const viewerFile = makeItem("v1", "Read.sldoc", null, { role: "viewer" });
    const ownedFile = makeItem("o1", "Edit.sldoc", null, { role: "owner" });

    expect(bulkSelectionSummary([folder], "mine")).toMatchObject({
      canDownload: false,
      canCopy: false,
      canMove: false,
      canTrash: true,
      canRestore: false,
      canDeleteForever: false,
    });

    expect(bulkSelectionSummary([viewerFile], "shared")).toMatchObject({
      canDownload: true,
      canCopy: true,
      canMove: false,
      canTrash: false,
    });

    expect(bulkSelectionSummary([ownedFile, viewerFile], "mine")).toMatchObject({
      canDownload: true,
      canCopy: true,
      canMove: true,
      canTrash: true,
    });

    expect(bulkSelectionSummary([ownedFile], "trash")).toMatchObject({
      canDownload: false,
      canCopy: false,
      canMove: false,
      canTrash: false,
      canRestore: true,
      canDeleteForever: true,
    });
  });
});

describe("DriveBrowser multi-select and bulk actions", () => {
  it("renders checkboxes in open mode, selects all from the sort row, and supports indeterminate state", async () => {
    render(<DriveBrowser inline mode="open" />);
    await screen.findByText("Alpha.sldoc");

    const selectAll = screen.getByRole("checkbox", {
      name: "Select all",
    }) as HTMLInputElement;
    const sortBtn = screen.getByRole("button", { name: "Sort" });
    expect(selectAll.closest(".drive-list-bar")).toBe(
      sortBtn.closest(".drive-list-bar"),
    );
    expect(selectAll.checked).toBe(false);
    expect(selectAll.indeterminate).toBe(false);

    // Selecting one file marks select-all as indeterminate and opens bulk toolbar
    const alphaBox = screen.getByRole("checkbox", {
      name: "Select Alpha.sldoc",
    }) as HTMLInputElement;
    fireEvent.click(alphaBox);
    expect(alphaBox.checked).toBe(true);
    expect(selectAll.checked).toBe(false);
    expect(selectAll.indeterminate).toBe(true);
    expect(screen.getByText("1 selected")).toBeTruthy();

    // Clicking Select all selects every visible item on the page
    fireEvent.click(selectAll);
    expect(selectAll.checked).toBe(true);
    expect(selectAll.indeterminate).toBe(false);
    expect(screen.getByText("4 selected")).toBeTruthy();
    for (const name of ["Archive", "Alpha.sldoc", "Budget.slsheet", "Pitch.slslides"]) {
      expect(
        (screen.getByRole("checkbox", { name: `Select ${name}` }) as HTMLInputElement)
          .checked,
      ).toBe(true);
    }

    // Clicking Select all again deselects everything
    fireEvent.click(selectAll);
    expect(selectAll.checked).toBe(false);
    expect(screen.queryByRole("toolbar", { name: "Selected items actions" })).toBeNull();
  });

  it("hides checkboxes in save mode", async () => {
    render(<DriveBrowser inline mode="save" />);
    await screen.findByText("Alpha.sldoc");
    expect(screen.queryByRole("checkbox", { name: "Select all" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Select Alpha.sldoc" })).toBeNull();
  });

  it("supports Shift-click range selection and Clear selection", async () => {
    render(<DriveBrowser inline mode="open" />);
    await screen.findByText("Alpha.sldoc");

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Archive" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Budget.slsheet" }), {
      shiftKey: true,
    });
    expect(screen.getByText("3 selected")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByRole("toolbar", { name: "Selected items actions" })).toBeNull();
  });

  it("moves multiple selected items to Trash and supports Undo for all of them", async () => {
    render(<DriveBrowser inline mode="open" />);
    await screen.findByText("Alpha.sldoc");

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Alpha.sldoc" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Budget.slsheet" }));

    const toolbar = screen.getByRole("toolbar", { name: "Selected items actions" });
    fireEvent.click(within(toolbar).getByRole("button", { name: "Move to trash" }));

    await screen.findByText("2 items are in Trash.");
    expect(drive.update).toHaveBeenCalledWith("doc-a", { trashed: true });
    expect(drive.update).toHaveBeenCalledWith("sheet-b", { trashed: true });
    expect(screen.queryByText("Alpha.sldoc")).toBeNull();
    expect(screen.queryByText("Budget.slsheet")).toBeNull();

    // Undo restores both items
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await screen.findByText("Alpha.sldoc");
    expect(screen.getByText("Budget.slsheet")).toBeTruthy();
    expect(drive.update).toHaveBeenCalledWith("doc-a", { trashed: false });
    expect(drive.update).toHaveBeenCalledWith("sheet-b", { trashed: false });
  });

  it("moves multiple selected files to another folder and supports Undo", async () => {
    render(<DriveBrowser inline mode="open" />);
    await screen.findByText("Alpha.sldoc");

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Alpha.sldoc" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Budget.slsheet" }));

    const toolbar = screen.getByRole("toolbar", { name: "Selected items actions" });
    fireEvent.click(within(toolbar).getByRole("button", { name: "Move" }));

    const dialog = await screen.findByRole("dialog", { name: "Move" });
    expect(within(dialog).getByText("Move 2 files to a folder.")).toBeTruthy();
    fireEvent.click(await within(dialog).findByRole("button", { name: "Archive" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Move here" }));

    await screen.findByText("Moved 2 files to Archive.");
    expect(drive.update).toHaveBeenCalledWith("doc-a", { parentId: "f-archive" });
    expect(drive.update).toHaveBeenCalledWith("sheet-b", { parentId: "f-archive" });

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await screen.findByText("Alpha.sldoc");
    expect(drive.update).toHaveBeenCalledWith("doc-a", { parentId: null });
    expect(drive.update).toHaveBeenCalledWith("sheet-b", { parentId: null });
  });

  it("downloads and copies multiple selected files", async () => {
    render(<DriveBrowser inline mode="open" />);
    await screen.findByText("Alpha.sldoc");

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Alpha.sldoc" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Pitch.slslides" }));

    const toolbar = screen.getByRole("toolbar", { name: "Selected items actions" });
    fireEvent.click(within(toolbar).getByRole("button", { name: "Download" }));
    await waitFor(() => expect(exportText).toHaveBeenCalledTimes(2));
    expect(drive.read).toHaveBeenCalledWith("doc-a");
    expect(drive.read).toHaveBeenCalledWith("deck-c");

    fireEvent.click(within(toolbar).getByRole("button", { name: "Copy" }));
    await screen.findByText(
      "Kept copies of 2 files in My Drive. These copies are yours.",
    );
    expect(drive.keepCopy).toHaveBeenCalledWith("doc-a");
    expect(drive.keepCopy).toHaveBeenCalledWith("deck-c");
  });

  it("restores and permanently deletes multiple selected items in Trash", async () => {
    render(<DriveBrowser inline mode="open" />);
    await screen.findByText("Alpha.sldoc");

    fireEvent.click(screen.getByRole("button", { name: "Trash" }));
    await screen.findByText("Old.sldoc");

    // Select all in Trash and Delete forever
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    const toolbar = screen.getByRole("toolbar", { name: "Selected items actions" });
    fireEvent.click(within(toolbar).getByRole("button", { name: "Delete forever" }));

    const dialog = await screen.findByRole("dialog", { name: "Delete forever" });
    expect(
      within(dialog).getByText(
        "2 items will be deleted forever. This cannot be undone.",
      ),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete forever" }));

    await screen.findByText("The trash is empty.");
    expect(drive.deleteForever).toHaveBeenCalledWith("trash-1");
    expect(drive.deleteForever).toHaveBeenCalledWith("trash-2");
  });

  it("restores multiple selected items in Trash", async () => {
    render(<DriveBrowser inline mode="open" />);
    await screen.findByText("Alpha.sldoc");

    fireEvent.click(screen.getByRole("button", { name: "Trash" }));
    await screen.findByText("Old.sldoc");

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    const toolbar = screen.getByRole("toolbar", { name: "Selected items actions" });
    fireEvent.click(within(toolbar).getByRole("button", { name: "Restore" }));

    await screen.findByText("The trash is empty.");
    expect(drive.update).toHaveBeenCalledWith("trash-1", { trashed: false });
    expect(drive.update).toHaveBeenCalledWith("trash-2", { trashed: false });
  });

  it("shows a determinate progress modal popover during multi-file trash and updates per item", async () => {
    const resolvers: (() => void)[] = [];
    drive.update.mockImplementation(async (id: string, patch: Partial<DriveItem>) => {
      await new Promise<void>((resolve) => {
        resolvers.push(resolve);
      });
      const found = state.items.find((i) => i.id === id)!;
      Object.assign(found, patch);
      return { ...found };
    });

    render(<DriveBrowser inline mode="open" />);
    await screen.findByText("Alpha.sldoc");

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Alpha.sldoc" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Budget.slsheet" }));

    const toolbar = screen.getByRole("toolbar", { name: "Selected items actions" });
    fireEvent.click(within(toolbar).getByRole("button", { name: "Move to trash" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Moving 2 items to Trash",
    });
    const bar = within(dialog).getByRole("progressbar") as HTMLProgressElement;
    expect(bar.value).toBe(0);
    expect(bar.max).toBe(2);
    expect(within(dialog).getByText("0 of 2 — Alpha.sldoc")).toBeTruthy();

    // Finish the first item -> progress advances to 1 of 2
    resolvers.shift()!();
    await waitFor(() => {
      expect(bar.value).toBe(1);
      expect(within(dialog).getByText("1 of 2 — Budget.slsheet")).toBeTruthy();
    });

    // Finish the second item -> modal closes and banner appears
    resolvers.shift()!();
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Moving 2 items to Trash" }),
      ).toBeNull();
    });
    await screen.findByText("2 items are in Trash.");
  });

  it("stops remaining items when Cancel is clicked in the bulk progress modal", async () => {
    const resolvers: (() => void)[] = [];
    drive.update.mockImplementation(async (id: string, patch: Partial<DriveItem>) => {
      await new Promise<void>((resolve) => {
        resolvers.push(resolve);
      });
      const found = state.items.find((i) => i.id === id)!;
      Object.assign(found, patch);
      return { ...found };
    });

    render(<DriveBrowser inline mode="open" />);
    await screen.findByText("Alpha.sldoc");

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Alpha.sldoc" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Budget.slsheet" }));

    const toolbar = screen.getByRole("toolbar", { name: "Selected items actions" });
    fireEvent.click(within(toolbar).getByRole("button", { name: "Move to trash" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Moving 2 items to Trash",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    // Resolve the already-in-flight first item; the second item must not start
    resolvers.shift()!();
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Moving 2 items to Trash" }),
      ).toBeNull();
    });
    expect(drive.update).toHaveBeenCalledTimes(1);
    expect(drive.update).toHaveBeenCalledWith("doc-a", { trashed: true });
    await screen.findByText("Alpha.sldoc is in Trash.");
    expect(screen.getByText("Budget.slsheet")).toBeTruthy();
  });
});
