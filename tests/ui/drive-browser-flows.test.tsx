// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DriveItem } from "../../apps/web/src/node-client";

const state = vi.hoisted(() => ({
  session: { url: "https://drive.example", user: { id: "ada" } } as null | {
    url: string;
    user: { id: string };
  },
  items: [] as DriveItem[],
  failList: null as null | string,
}));

const drive = vi.hoisted(() => ({
  list: vi.fn(async (parentId: string | null) => {
    if (state.failList) throw new Error(state.failList);
    return state.items.filter((i) => i.parentId === parentId && !i.trashed);
  }),
  listTrashed: vi.fn(async () => state.items.filter((i) => i.trashed)),
  shared: vi.fn(async () => state.items.filter((i) => i.role !== "owner" && !i.trashed)),
  search: vi.fn(),
  get: vi.fn(async (id: string) => state.items.find((i) => i.id === id)!),
  update: vi.fn(async (id: string, patch: Partial<DriveItem>) => {
    const item = state.items.find((i) => i.id === id)!;
    Object.assign(item, patch);
    return { ...item };
  }),
  keepCopy: vi.fn(async () => {}),
  create: vi.fn(async (input: { name: string; parentId: string | null; kind: "folder" }) => {
    const made = item(`new-${state.items.length}`, input.name, input.parentId, { kind: input.kind });
    state.items.push(made);
    return made;
  }),
  deleteForever: vi.fn(async (id: string) => {
    state.items = state.items.filter((i) => i.id !== id);
  }),
  notices: vi.fn(async () => []),
  dismissNotice: vi.fn(),
  listFolders: vi.fn(async () =>
    state.items.filter((i) => i.kind === "folder").map(({ id, name, parentId }) => ({ id, name, parentId })),
  ),
  access: vi.fn(async () => ({ grants: [], parent: null, yourRole: "owner" })),
}));

function item(
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

vi.mock("../../apps/web/src/node-client", () => ({
  drive,
  getSession: () => state.session,
}));

import {
  DriveBrowser,
  NameDialog,
  rememberDriveFolder,
  type DriveControl,
} from "../../apps/web/src/drive/DriveBrowser";
import { DRIVE_SAVED } from "../../apps/web/src/drive/last-edit";

beforeEach(() => {
  state.session = { url: "https://drive.example", user: { id: "ada" } };
  state.failList = null;
  state.items = [
    item("f-beds", "Beds", null, { kind: "folder" }),
    item("doc", "Plan.sldoc", null),
    item("sheet", "Budget.slsheet", null, { role: "editor" }),
    item("deck", "Pitch.slslides", null, { available: false, role: "viewer" }),
    item("pdf", "Scan.pdf", null),
    item("inner", "Rows.sldoc", "f-beds"),
  ];
  sessionStorage.clear();
  for (const fn of Object.values(drive)) fn.mockClear();
  drive.search.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const rows = () => screen.getAllByRole("listitem").map((row) => row.querySelector(".drive-item-name")?.textContent);

function RoutedDrive() {
  const location = useLocation();
  const navigate = useNavigate();
  return <>
    <output aria-label="URL">{location.pathname + location.search}</output>
    <button onClick={() => void navigate(-1)}>Browser back</button>
    <button onClick={() => void navigate(1)}>Browser forward</button>
    <DriveBrowser inline mode="open" folderRoute={{ pathname: location.pathname, search: location.search, navigate }} />
  </>;
}
const routedDrive = (url: string) => render(<MemoryRouter initialEntries={[url]}><RoutedDrive /></MemoryRouter>);
const urlIs = (url: string) => waitFor(() => expect(screen.getByLabelText("URL").textContent).toBe(url));

describe("folder URL navigation", () => {
  it("opens name-only URLs, encodes folder names, and follows Back and Forward", async () => {
    state.items.push(item("nested", "A / B # %", "f-beds", { kind: "folder" }));
    routedDrive("/drive");
    await screen.findByRole("button", { name: "Beds", exact: true });
    fireEvent.click(screen.getByRole("button", { name: "Beds", exact: true }));
    await urlIs("/drive/Beds?folder=f-beds");
    fireEvent.click(await screen.findByRole("button", { name: "A / B # %", exact: true }));
    await urlIs("/drive/Beds/A%20%2F%20B%20%23%20%25?folder=nested");
    fireEvent.click(screen.getByRole("button", { name: "Browser back" }));
    await urlIs("/drive/Beds?folder=f-beds");
    await screen.findByRole("button", { name: "Rows.sldoc", exact: true });
    fireEvent.click(screen.getByRole("button", { name: "Browser forward" }));
    await urlIs("/drive/Beds/A%20%2F%20B%20%23%20%25?folder=nested");
    await screen.findByText("This folder is empty.");
    fireEvent.click(within(screen.getByRole("navigation", { name: "Folder path" })).getByRole("button", { name: "My Drive" }));
    await urlIs("/drive");
  });
  it("opens a bookmarked name path even when storage remembers a different folder", async () => {
    rememberDriveFolder("other", "Other folder");
    routedDrive("/drive/Beds");
    await screen.findByRole("button", { name: "Rows.sldoc", exact: true });
    await urlIs("/drive/Beds?folder=f-beds");
    expect(drive.list).not.toHaveBeenCalledWith("other");
  });
  it("uses folder IDs after renaming and restores the remembered folder from home", async () => {
    const first = routedDrive("/drive/Old%20name?folder=f-beds");
    await urlIs("/drive/Beds?folder=f-beds");
    await screen.findByRole("button", { name: "Rows.sldoc", exact: true });
    first.unmount();
    routedDrive("/");
    await urlIs("/drive/Beds?folder=f-beds");
    await screen.findByRole("button", { name: "Rows.sldoc", exact: true });
  });
  it("lets an explicit Drive root override the remembered folder and puts views in history", async () => {
    rememberDriveFolder("f-beds", "Beds");
    routedDrive("/drive");
    await screen.findByRole("button", { name: "Plan.sldoc", exact: true });
    fireEvent.click(screen.getByRole("tab", { name: "Shared with me" }));
    await urlIs("/drive?view=shared");
    fireEvent.click(screen.getByRole("button", { name: "Trash", exact: true }));
    await urlIs("/drive?view=trash");
    fireEvent.click(screen.getByRole("button", { name: "Browser back" }));
    await urlIs("/drive?view=shared");
    await waitFor(() => expect((screen.getByRole("tab", { name: "Shared with me" })).getAttribute("aria-selected")).toBe("true"));
  });
  it("reports an invalid folder URL and lets the user return to My Drive", async () => {
    routedDrive("/drive/Missing");
    expect((await screen.findByRole("alert")).textContent).toContain("unavailable");
    expect(screen.queryByRole("button", { name: "Plan.sldoc", exact: true })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "My Drive" }));
    await urlIs("/drive");
    await screen.findByRole("button", { name: "Plan.sldoc", exact: true });
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("ignores a slow folder lookup after the user switches to the root", async () => {
    let resolve!: (items: DriveItem[]) => void;
    drive.list.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    routedDrive("/drive/Beds");
    fireEvent.click(screen.getByRole("tab", { name: "My Drive" }));
    await urlIs("/drive");
    await act(async () => resolve([state.items[0]!]));
    await screen.findByRole("button", { name: "Plan.sldoc", exact: true });
    expect(screen.getByLabelText("URL").textContent).toBe("/drive");
  });
});

describe("NameDialog", () => {
  it("selects the name without its extension and submits the trimmed name", () => {
    const onSubmit = vi.fn();
    render(
      <NameDialog title="Rename" submitLabel="OK" initial="Plan.sldoc" keepExtension onSubmit={onSubmit} onClose={vi.fn()} />,
    );
    const input = screen.getByLabelText("Name") as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 4]);
    fireEvent.change(input, { target: { value: "   " } });
    expect((screen.getByRole("button", { name: "OK" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: " Plot.sldoc " } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(onSubmit).toHaveBeenCalledWith("Plot.sldoc");
  });
});

describe("DriveBrowser", () => {
  it("opens SuiteLeaf files, walks folders, and closes", async () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    render(<DriveBrowser mode="open" onOpen={onOpen} onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "Open from SuiteDrive" })).toBeTruthy();
    await waitFor(() => expect(rows()).toEqual(["Beds", "Plan.sldoc", "Budget.slsheet", "Pitch.slslides"]));
    expect(screen.getByText("Copying…")).toBeTruthy();
    expect(document.querySelector(".file-icon.sheet")).toBeTruthy();
    expect(document.querySelector(".file-icon.slide")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Move Pitch.slslides" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Plan.sldoc" }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "doc" })));
    fireEvent.click(screen.getByRole("button", { name: "Beds" }));
    await waitFor(() => expect(rows()).toEqual(["Rows.sldoc"]));
    fireEvent.click(within(screen.getByRole("navigation", { name: "Folder path" })).getByRole("button", { name: "My Drive" }));
    await waitFor(() => expect(rows()).toContain("Plan.sldoc"));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(document.querySelector(".modal-overlay")!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("saves into the chosen folder under the typed name", async () => {
    const onSave = vi.fn();
    render(<DriveBrowser mode="save" defaultName="Draft.sldoc" onSave={onSave} />);
    expect(screen.getByRole("dialog", { name: "Save to SuiteDrive" })).toBeTruthy();
    await waitFor(() => expect(rows()).toContain("Scan.pdf"));
    fireEvent.click(screen.getByRole("button", { name: "Scan.pdf" }));
    expect((screen.getByLabelText("File name") as HTMLInputElement).value).toBe("Scan.pdf");
    fireEvent.change(screen.getByLabelText("File name"), { target: { value: "  " } });
    expect((screen.getByRole("button", { name: "Save here" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("File name"), { target: { value: " Notes.sldoc " } });
    fireEvent.click(screen.getByRole("button", { name: "Beds" }));
    await waitFor(() => expect(rows()).toEqual(["Rows.sldoc"]));
    fireEvent.click(screen.getByRole("button", { name: "Save here" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("f-beds", "Notes.sldoc"));
  });

  it("starts in the given folder", async () => {
    render(<DriveBrowser mode="save" startIn={{ id: "f-beds", name: "Beds" }} />);
    await waitFor(() => expect(rows()).toEqual(["Rows.sldoc"]));
    expect(drive.list).toHaveBeenCalledWith("f-beds");
  });

  it("lists shared files with their owner and keeps a copy", async () => {
    state.items.push(item("shared", "Ideas.sldoc", "elsewhere", { role: "commenter", ownerName: "Sam" }));
    render(<DriveBrowser mode="open" inline onOpen={vi.fn()} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Shared with me" }));
    await waitFor(() => expect(rows()).toEqual(["Budget.slsheet", "Pitch.slslides", "Ideas.sldoc"]));
    expect(screen.queryByRole("button", { name: "New folder" })).toBeNull();
    expect(screen.getByRole("button", { name: "Ideas.sldoc" }).textContent).toContain("Sam · Can comment");
    expect(screen.getByRole("button", { name: "Pitch.slslides" }).textContent).toContain("Someone · Can view");
    fireEvent.click(screen.getAllByRole("button", { name: "Keep a copy" })[2]!);
    expect(await screen.findByText("Kept a copy of Ideas.sldoc in My Drive. This copy is yours.")).toBeTruthy();
    expect(drive.keepCopy).toHaveBeenCalledWith("shared");
    state.items = state.items.filter((i) => i.role === "owner");
    fireEvent.click(screen.getByRole("tab", { name: "My Drive" }));
    fireEvent.click(screen.getByRole("tab", { name: "Shared with me" }));
    expect(await screen.findByText("Nothing has been shared with you yet.")).toBeTruthy();
  });

  it("moves a file to Trash, undoes it, and restores or deletes from Trash", async () => {
    render(<DriveBrowser mode="open" inline onOpen={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Move Plan.sldoc to trash" }));
    expect(await screen.findByText("Plan.sldoc is in Trash.")).toBeTruthy();
    expect(drive.update).toHaveBeenCalledWith("doc", { trashed: true });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.queryByText("Plan.sldoc is in Trash.")).toBeNull());
    expect(drive.update).toHaveBeenLastCalledWith("doc", { trashed: false });
    fireEvent.click(screen.getByRole("button", { name: "Move Plan.sldoc to trash" }));
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    fireEvent.click(screen.getByRole("button", { name: "Move Budget.slsheet to trash" }));
    await screen.findByText("Budget.slsheet is in Trash.");
    state.items.find((i) => i.id === "doc")!.parentId = "f-beds";
    state.items.find((i) => i.id === "doc")!.parentName = "Beds";
    fireEvent.click(screen.getByRole("button", { name: "Trash" }));
    expect(await screen.findByRole("heading", { name: "Trash" })).toBeTruthy();
    await waitFor(() => expect(rows()).toEqual(["Plan.sldoc", "Budget.slsheet"]));
    expect(screen.getByRole("button", { name: "Plan.sldoc" }).textContent).toContain("Beds");
    expect(screen.getByRole("button", { name: "Budget.slsheet" }).textContent).toContain("My Drive");
    fireEvent.click(screen.getByRole("button", { name: "Restore Budget.slsheet" }));
    await waitFor(() => expect(rows()).toEqual(["Plan.sldoc"]));
    expect(screen.queryByText("Budget.slsheet is in Trash.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete Plan.sldoc forever" }));
    const confirm = screen.getByRole("dialog", { name: "Delete forever" });
    expect(confirm.textContent).toContain("“Plan.sldoc” will be deleted forever.");
    fireEvent.click(within(confirm).getByRole("button", { name: "Delete forever" }));
    expect(await screen.findByText("The trash is empty.")).toBeTruthy();
    expect(drive.deleteForever).toHaveBeenCalledWith("doc");
  });

  it("names a trashed file's folder even when the server leaves the name out", async () => {
    state.items = [item("gone", "Old.sldoc", "f-x", { trashed: true })];
    render(<DriveBrowser mode="open" inline onOpen={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Trash" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Old.sldoc" }).textContent).toContain("A folder"));
    fireEvent.click(screen.getByRole("button", { name: "Delete Old.sldoc forever" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Delete forever" })).toBeNull();
  });

  it("creates and renames folders and files", async () => {
    render(<DriveBrowser mode="open" inline onOpen={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "New folder" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Herbs" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(rows()).toContain("Herbs"));
    expect(drive.create).toHaveBeenCalledWith({ name: "Herbs", parentId: null, kind: "folder" });
    fireEvent.click(screen.getByRole("button", { name: "Rename Plan.sldoc" }));
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(drive.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Rename Plan.sldoc" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Plot.sldoc" } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(rows()).toContain("Plot.sldoc"));
    expect(drive.update).toHaveBeenCalledWith("doc", { name: "Plot.sldoc" });
    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "New folder" })).toBeNull();
  });

  it("moves a file and undoes the move", async () => {
    render(<DriveBrowser mode="open" inline onOpen={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Move Plan.sldoc" }));
    const dialog = screen.getByRole("dialog", { name: "Move" });
    expect(dialog.textContent).toContain("Plan.sldoc is in My Drive.");
    fireEvent.click(await within(dialog).findByRole("button", { name: "Beds" }));
    await waitFor(() =>
      expect((within(dialog).getByRole("button", { name: "Move here" }) as HTMLButtonElement).disabled).toBe(false),
    );
    state.items.find((i) => i.id === "doc")!.parentName = "Beds";
    fireEvent.click(within(dialog).getByRole("button", { name: "Move here" }));
    await waitFor(() => expect(rows()).not.toContain("Plan.sldoc"));
    expect(document.querySelector(".drive-move-banner")).toBeTruthy();
    fireEvent.click(within(document.querySelector(".drive-move-banner") as HTMLElement).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(rows()).toContain("Plan.sldoc"));
    expect(drive.update).toHaveBeenLastCalledWith("doc", { parentId: null });
    expect(document.querySelector(".drive-move-banner")).toBeNull();
  });

  it("names a file's folder in the move dialog and dismisses the move notice", async () => {
    state.items.find((i) => i.id === "inner")!.role = "owner";
    render(<DriveBrowser mode="open" inline onOpen={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Beds" }));
    fireEvent.click(await screen.findByRole("button", { name: "Move Rows.sldoc" }));
    const dialog = screen.getByRole("dialog", { name: "Move" });
    expect(dialog.textContent).toContain("Rows.sldoc is in Beds.");
    fireEvent.click(await within(dialog).findByRole("button", { name: "My Drive" }));
    await waitFor(() =>
      expect((within(dialog).getByRole("button", { name: "Move here" }) as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Move here" }));
    await waitFor(() => expect(document.querySelector(".drive-move-banner")).toBeTruthy());
    fireEvent.click(within(document.querySelector(".drive-move-banner") as HTMLElement).getByRole("button", { name: "Dismiss" }));
    expect(document.querySelector(".drive-move-banner")).toBeNull();
  });

  it("searches names and words after a short pause", async () => {
    drive.search.mockResolvedValueOnce([
      { id: "inner", name: "Rows.sldoc", parentName: "Beds", snippet: "tomato rows" },
    ]);
    const onOpen = vi.fn();
    render(<DriveBrowser mode="open" onOpen={onOpen} />);
    await waitFor(() => expect(rows()).toContain("Plan.sldoc"));
    fireEvent.change(screen.getByLabelText("Search SuiteDrive"), { target: { value: "tomato" } });
    expect(screen.getByText("Searching…")).toBeTruthy();
    const hit = await screen.findByRole("button", { name: /Rows\.sldoc/ });
    expect(hit.textContent).toContain("tomato rows");
    expect(drive.search).toHaveBeenCalledWith("tomato");
    fireEvent.click(hit);
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "inner" })));
    drive.search.mockResolvedValueOnce([]);
    fireEvent.change(screen.getByLabelText("Search SuiteDrive"), { target: { value: "zzz" } });
    expect(await screen.findByText("No files match.")).toBeTruthy();
    drive.search.mockRejectedValueOnce(new Error("Search is down."));
    fireEvent.change(screen.getByLabelText("Search SuiteDrive"), { target: { value: "boom" } });
    expect((await screen.findByRole("alert")).textContent).toBe("Search is down.");
    fireEvent.change(screen.getByLabelText("Search SuiteDrive"), { target: { value: "" } });
    await waitFor(() => expect(rows()).toContain("Plan.sldoc"));
  });

  it("shows an error when a search hit can no longer be read", async () => {
    drive.search.mockResolvedValueOnce([{ id: "missing", name: "Gone.sldoc", parentName: "", snippet: "" }]);
    drive.get.mockRejectedValueOnce("That file is gone.");
    render(<DriveBrowser mode="open" onOpen={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search SuiteDrive"), { target: { value: "gone" } });
    fireEvent.click(await screen.findByRole("button", { name: /Gone\.sldoc/ }));
    expect((await screen.findByRole("alert")).textContent).toBe("That file is gone.");
  });

  it("shows a list failure and an action failure", async () => {
    state.failList = "SuiteDrive is unreachable.";
    render(<DriveBrowser mode="open" onOpen={vi.fn()} />);
    expect((await screen.findByRole("alert")).textContent).toBe("SuiteDrive is unreachable.");
    state.failList = null;
    act(() => void window.dispatchEvent(new Event(DRIVE_SAVED)));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    drive.update.mockRejectedValueOnce("Trash is full.");
    fireEvent.click(screen.getByRole("button", { name: "Move Plan.sldoc to trash" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Trash is full.");
  });

  it("flashes a row whose last editor changed", async () => {
    render(<DriveBrowser mode="open" onOpen={vi.fn()} />);
    await waitFor(() => expect(rows()).toContain("Plan.sldoc"));
    expect(document.querySelector(".just-edited")).toBeNull();
    Object.assign(state.items.find((i) => i.id === "doc")!, {
      lastAuthorName: "Sam",
      lastEditedAt: "2026-10-02T10:00:00.000Z",
    });
    act(() => void window.dispatchEvent(new Event(DRIVE_SAVED)));
    await waitFor(() => expect(document.querySelector(".just-edited")).toBeTruthy());
    const row = document.querySelector(".just-edited")!;
    expect(row.querySelector(".drive-editor")?.textContent).toBe("Sam");
    expect(row.querySelector("button")?.getAttribute("aria-description")).toMatch(/^Last edited by Sam, /);
  });

  it("clears the flash after a moment and re-lists on its own", async () => {
    vi.useFakeTimers();
    render(<DriveBrowser mode="open" onOpen={vi.fn()} />);
    await act(() => vi.advanceTimersByTimeAsync(0));
    Object.assign(state.items.find((i) => i.id === "doc")!, {
      lastAuthorName: "Sam",
      lastEditedAt: "2026-10-02T10:00:00.000Z",
    });
      await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(document.querySelector(".just-edited")).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(2400));
    expect(document.querySelector(".just-edited")).toBeNull();
  });

  it("returns to the remembered folder, and starts over when it is gone", async () => {
    rememberDriveFolder("f-beds", "Beds", [{ id: "f-beds", name: "Beds", parentId: null }]);
    const onFolderChange = vi.fn();
    const first = render(<DriveBrowser mode="open" inline onOpen={vi.fn()} onFolderChange={onFolderChange} />);
    await waitFor(() => expect(rows()).toEqual(["Rows.sldoc"]));
    expect(onFolderChange).toHaveBeenLastCalledWith("f-beds", "Beds");
    first.unmount();
    state.items = state.items.filter((i) => i.id !== "inner");
    drive.list.mockImplementationOnce(async () => {
      throw new Error("Folder not found.");
    });
    render(<DriveBrowser mode="open" inline onOpen={vi.fn()} onFolderChange={onFolderChange} />);
    await waitFor(() => expect(onFolderChange).toHaveBeenLastCalledWith(null, "My Drive"));
    await waitFor(() => expect(rows()).toContain("Plan.sldoc"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("forgets a folder remembered for someone else, or when signed out", async () => {
    rememberDriveFolder("f-beds", "Beds");
    state.session = { url: "https://drive.example", user: { id: "sam" } };
    render(<DriveBrowser mode="open" inline onOpen={vi.fn()} />);
    await waitFor(() => expect(rows()).toContain("Plan.sldoc"));
    cleanup();
    sessionStorage.setItem("suiteleaf:drive-place", "{broken");
    render(<DriveBrowser mode="open" inline onOpen={vi.fn()} />);
    await waitFor(() => expect(rows()).toContain("Plan.sldoc"));
    cleanup();
    sessionStorage.clear();
    state.session = null;
    rememberDriveFolder("f-beds", "Beds");
    expect(sessionStorage.getItem("suiteleaf:drive-place")).toBeNull();
  });

  it("lets the assistant read and drive the folder", async () => {
    const control = createRef<DriveControl | null>() as { current: DriveControl | null };
    render(<DriveBrowser mode="open" inline onOpen={vi.fn()} control={control} />);
    await waitFor(() => expect(control.current?.loading).toBe(false));
    expect(control.current!.path).toEqual(["My Drive"]);
    expect(control.current!.items.map((i) => i.name)).toContain("Plan.sldoc");
    act(() => control.current!.choose(control.current!.items.find((i) => i.name === "Beds")!));
    await waitFor(() => expect(control.current!.path).toEqual(["My Drive", "Beds"]));
    await act(() => control.current!.newFolder("Seeds"));
    expect(drive.create).toHaveBeenCalledWith({ name: "Seeds", parentId: "f-beds", kind: "folder" });
    await waitFor(() => expect(control.current!.items.map((i) => i.name)).toContain("Seeds"));
    act(() => control.current!.goTo(0));
    await waitFor(() => expect(control.current!.path).toEqual(["My Drive"]));
    act(() => control.current!.switchView("shared"));
    await waitFor(() => expect(control.current!.path).toEqual(["Shared with me"]));
  });
});
