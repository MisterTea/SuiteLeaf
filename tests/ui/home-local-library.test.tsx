// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFile, type FileRecord, type SuiteFile } from "../../packages/core/src";

type ImportProps = {
  onImport: (r: FileRecord, name?: string) => Promise<void>;
  onError: (s: string) => void;
  importer?: { current: ((f: File) => Promise<void>) | null };
  placeInFolder?: (file: SuiteFile, folder: string) => Promise<FileRecord | void>;
  keepImported?: (file: SuiteFile) => Promise<void>;
  onBatchDone?: () => void | Promise<void>;
};

const hoisted = vi.hoisted(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    },
  });
  return {
  records: new Map<string, FileRecord>(),
  failSave: null as null | string,
  failRemove: null as null | string,
  failList: null as null | string,
  opened: null as null | FileRecord,
  mode: { locked: false, demo: false },
  left: null as null | string,
  importProps: null as null | ImportProps,
  ctx: null as null | Record<string, (...args: never[]) => unknown> & Record<string, unknown>,
  connect: null as null | { probe: unknown; connect: (url: string) => unknown },
  host: null as null | (() => { kind: string; place: () => string; snapshot: () => string; tools: unknown[] }),
  switchMode: vi.fn(),
  };
});

vi.mock("../../apps/web/src/storage", () => ({
  storage: {
    list: async () => {
      if (hoisted.failList) throw new Error(hoisted.failList);
      return [...hoisted.records.values()];
    },
    get: async (id: string) => hoisted.records.get(id) ?? null,
    save: async (record: FileRecord) => {
      if (hoisted.failSave) throw new Error(hoisted.failSave);
      hoisted.records.set(record.file.id, record);
      return record;
    },
    remove: async (id: string) => {
      if (hoisted.failRemove) throw new Error(hoisted.failRemove);
      hoisted.records.delete(id);
    },
    open: async () => hoisted.opened,
  },
}));
vi.mock("../../apps/web/src/mode", () => ({
  useMode: () => ({ mode: { kind: "single" }, ...hoisted.mode }),
  probeServer: vi.fn(),
  switchMode: hoisted.switchMode,
  leftServer: () => hoisted.left,
  forgetLeftServer: vi.fn(),
}));
vi.mock("../../apps/web/src/ai/host", () => ({
  useAgentHost: (_id: string, build: never) => {
    hoisted.host = build;
  },
}));
vi.mock("../../apps/web/src/ai/tools/files", () => ({
  homeSnapshot: () => "home snapshot",
  homeTools: (ctx: never) => {
    hoisted.ctx = ctx;
    return [{ name: "home-tool" }];
  },
}));
vi.mock("../../apps/web/src/ai/tools/cluster", () => ({
  connectTools: (input: never) => {
    hoisted.connect = input;
    return [{ name: "connect-tool" }];
  },
}));
vi.mock("../../apps/web/src/ai/AgentSidebar", () => ({ AiButton: () => null }));
vi.mock("../../apps/web/src/templates/gallery", () => ({ TemplateHome: () => null }));
vi.mock("../../apps/web/src/document-settings", () => ({ SettingsButton: () => null }));
vi.mock("../../apps/web/src/home/ImportButton", () => ({
  ImportButton: (props: ImportProps) => {
    hoisted.importProps = props;
    return <button type="button">Import</button>;
  },
}));

import { LocalHome } from "../../apps/web/src/home/LocalHome";
import { openNotices } from "../../apps/web/src/same-file";

function Probe() {
  return <span data-testid="path">{useLocation().pathname}</span>;
}
function renderHome() {
  return render(
    <MemoryRouter>
      <Routes>
        <Route path="*" element={<LocalHome />} />
      </Routes>
      <Probe />
    </MemoryRouter>,
  );
}
const path = () => screen.getByTestId("path").textContent;
const record = (kind: "doc" | "sheet" | "slide", title: string, extra: Partial<FileRecord> = {}, at = "2026-10-01T10:00:00.000Z") => {
  const file = { ...createFile(kind, title), updatedAt: at };
  const r = { file, ...extra } as FileRecord;
  hoisted.records.set(file.id, r);
  return r;
};
const titles = () =>
  [...document.querySelectorAll(".file-list .file-row .file-main a > span:last-child")].map(
    (span) => span.childNodes[0]?.textContent,
  );

beforeEach(() => {
  hoisted.records.clear();
  hoisted.failSave = null;
  hoisted.failRemove = null;
  hoisted.failList = null;
  hoisted.opened = null;
  hoisted.mode = { locked: false, demo: false };
  hoisted.left = null;
  hoisted.importProps = null;
  hoisted.ctx = null;
  hoisted.switchMode.mockReset();
  openNotices.clear();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete window.suiteleaf;
  Object.defineProperty(navigator, "locks", { value: undefined, configurable: true });
});

describe("LocalHome in the browser", () => {
  it("welcomes an empty library and opens a new file or a sample", async () => {
    renderHome();
    expect(await screen.findByText("A workspace waiting for you")).toBeTruthy();
    expect(screen.getByText("Your workspace, in this browser.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /New document/ }));
    await waitFor(() => expect(path()).toMatch(/^\/file\//));
    const id = path()!.slice("/file/".length);
    expect(hoisted.records.get(id)?.file.kind).toBe("doc");
    fireEvent.click(screen.getByRole("button", { name: "Sample budget" }));
    await waitFor(() => expect(hoisted.records.size).toBe(2));
  });

  it("shows a save failure and dismisses it", async () => {
    hoisted.failSave = "The browser is out of space.";
    renderHome();
    fireEvent.click(await screen.findByRole("button", { name: /New spreadsheet/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("The browser is out of space.");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss error" }));
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sample document" }));
    expect((await screen.findByRole("alert")).textContent).toContain("out of space");
  });

  it("sorts by name and by date, and searches inside files", async () => {
    record("doc", "beta notes", {}, "2026-10-03T10:00:00.000Z");
    record("doc", "Alpha plan", {}, "2026-10-01T10:00:00.000Z");
    record("sheet", "item 10", {}, "2026-10-02T10:00:00.000Z");
    record("sheet", "item 9", {}, "2026-09-02T10:00:00.000Z");
    renderHome();
    await waitFor(() => expect(titles()).toEqual(["beta notes", "item 10", "Alpha plan", "item 9"]));
    expect(screen.getByText(/Explore a sample:/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sort by name" }));
    expect(titles()).toEqual(["Alpha plan", "beta notes", "item 9", "item 10"]);
    fireEvent.click(screen.getByRole("button", { name: "Sort by name" }));
    expect(titles()).toEqual(["item 10", "item 9", "beta notes", "Alpha plan"]);
    fireEvent.click(screen.getByRole("button", { name: "Sort by last edited" }));
    expect(titles()).toEqual(["beta notes", "item 10", "Alpha plan", "item 9"]);
    fireEvent.click(screen.getByRole("button", { name: "Sort by last edited" }));
    expect(titles()).toEqual(["item 9", "Alpha plan", "item 10", "beta notes"]);
    const search = screen.getByLabelText("Search files");
    fireEvent.change(search, { target: { value: "plan" } });
    expect(screen.getByRole("heading", { name: "Results for “plan”" })).toBeTruthy();
    expect(titles()).toEqual(["Alpha plan"]);
    expect(screen.queryByText("Good ideas start here.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Documents" }));
    expect(screen.getByRole("heading", { name: "Documents matching “plan”" })).toBeTruthy();
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByText("No files match “zzz”")).toBeTruthy();
    fireEvent.keyDown(search, { key: "a" });
    fireEvent.keyDown(search, { key: "Escape" });
    expect((search as HTMLInputElement).value).toBe("");
    fireEvent.change(search, { target: { value: "item" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect((search as HTMLInputElement).value).toBe("");
  });

  it("names each empty view", async () => {
    record("doc", "Only doc");
    renderHome();
    await screen.findByText("Only doc");
    const views: [string, string][] = [
      ["Starred", "No starred files"],
      ["Trash", "Trash is empty"],
      ["Spreadsheets", "No spreadsheets yet"],
    ];
    for (const [button, heading] of views) {
      fireEvent.click(screen.getByRole("button", { name: button }));
      expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: "Presentations" }));
    fireEvent.click(screen.getByRole("button", { name: "Drawings" }));
    fireEvent.click(screen.getByRole("button", { name: "All files" }));
    expect(screen.getByText("Only doc")).toBeTruthy();
  });

  it("stars, renames, copies, trashes, undoes, restores and deletes files", async () => {
    const plan = record("doc", "Plan");
    renderHome();
    fireEvent.click(await screen.findByRole("button", { name: "Star Plan" }));
    await waitFor(() => expect(hoisted.records.get(plan.file.id)?.starred).toBe(true));
    fireEvent.click(await screen.findByRole("button", { name: "Unstar Plan" }));
    await waitFor(() => expect(hoisted.records.get(plan.file.id)?.starred).toBeFalsy());
    fireEvent.click(screen.getByRole("button", { name: "Rename Plan" }));
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    fireEvent.click(screen.getByRole("button", { name: "Rename Plan" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Plot plan" } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(await screen.findByText("Plot plan")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Duplicate Plot plan" }));
    await waitFor(() => expect(hoisted.records.size).toBe(2));
    const trash = (title: string) =>
      fireEvent.click(screen.getByRole("button", { name: `Move ${title} to Trash` }));
    trash("Plot plan copy");
    const toast = await screen.findByRole("status");
    expect(toast.textContent).toContain("Plot plan copy");
    fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect([...hoisted.records.values()].every((r) => !r.trashedAt)).toBe(true));
    trash("Plot plan copy");
    fireEvent.click(within(await screen.findByRole("status")).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).toBeNull();
    trash("Plot plan");
    expect((await screen.findByRole("status")).textContent).toContain("“Plot plan”");
    fireEvent.click(screen.getByRole("button", { name: "Trash" }));
    expect(document.querySelector(".trash-banner")?.textContent).toContain("30 days");
    fireEvent.click(await screen.findByRole("button", { name: "Restore Plot plan" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Your files" })).toBeTruthy());
    expect(screen.queryByRole("status")).toBeNull();
    trash("Plot plan");
    await waitFor(() => expect([...hoisted.records.values()].every((r) => r.trashedAt)).toBe(true));
    expect(await screen.findByText(/Anything you deleted is in Trash/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Trash" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete Plot plan copy forever" }));
    const forever = screen.getByRole("dialog");
    fireEvent.click(within(forever).getByRole("button", { name: "Delete forever" }));
    await waitFor(() => expect(hoisted.records.size).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "Empty trash" }));
    const emptying = screen.getByRole("dialog");
    expect(within(emptying).getAllByRole("listitem")).toHaveLength(1);
    fireEvent.click(within(emptying).getByRole("button", { name: "Delete forever" }));
    expect(await screen.findByRole("heading", { name: "Trash is empty" })).toBeTruthy();
    expect(hoisted.records.size).toBe(0);
  });

  it("shows why each file action failed", async () => {
    record("doc", "Plan", {}, "2026-10-02T10:00:00.000Z");
    record("doc", "Old", { trashedAt: new Date().toISOString() });
    renderHome();
    await screen.findByText("Plan");
    hoisted.failSave = "Disk full.";
    const expectError = async () => {
      expect((await screen.findByRole("alert")).textContent).toContain("Disk full.");
      fireEvent.click(screen.getByRole("button", { name: "Dismiss error" }));
    };
    fireEvent.click(screen.getByRole("button", { name: "Star Plan" }));
    await expectError();
    fireEvent.click(screen.getByRole("button", { name: "Move Plan to Trash" }));
    await expectError();
    fireEvent.click(screen.getByRole("button", { name: "Duplicate Plan" }));
    await expectError();
    fireEvent.click(screen.getByRole("button", { name: "Rename Plan" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Plot" } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await expectError();
    fireEvent.click(screen.getByRole("button", { name: "Rename Plan" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    hoisted.failSave = null;
    fireEvent.click(screen.getByRole("button", { name: "Move Plan to Trash" }));
    const toast = await screen.findByRole("status");
    hoisted.failSave = "Disk full.";
    fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    await expectError();
    fireEvent.click(screen.getByRole("button", { name: "Trash" }));
    fireEvent.click(await screen.findByRole("button", { name: "Restore Old" }));
    await expectError();
    hoisted.failRemove = "Disk full.";
    fireEvent.click(screen.getByRole("button", { name: "Delete Old forever" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete forever" }));
    await expectError();
    fireEvent.click(screen.getByRole("button", { name: "Empty trash" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete forever" }));
    await expectError();
  });

  it("shows a library that cannot be read, and a file that cannot be opened", async () => {
    hoisted.failList = "The library is locked.";
    let menu: (action: string) => void = () => {};
    window.suiteleaf = { onMenu: (listener: typeof menu) => ((menu = listener), () => {}) } as never;
    renderHome();
    expect((await screen.findByRole("alert")).textContent).toContain("The library is locked.");
    hoisted.failList = null;
    fireEvent.click(screen.getByRole("button", { name: "Dismiss error" }));
    hoisted.opened = Promise.reject(new Error("That file is unreadable.")) as never;
    act(() => menu("open"));
    expect((await screen.findByRole("alert")).textContent).toContain("That file is unreadable.");
  });

  it("orders Recents by when files were opened, and makes a MARP deck", async () => {
    const older = record("doc", "Older", {}, "2026-10-01T10:00:00.000Z");
    record("doc", "Newer", {}, "2026-10-05T10:00:00.000Z");
    localStorage.setItem(
      "suiteleaf:opened",
      JSON.stringify({ [older.file.id]: "2026-10-09T10:00:00.000Z" }),
    );
    renderHome();
    await screen.findByText("Older");
    fireEvent.click(screen.getByRole("button", { name: "Recents" }));
    expect(screen.getByRole("heading", { name: "Recents" })).toBeTruthy();
    expect(titles()).toEqual(["Older", "Newer"]);
    fireEvent.click(screen.getByRole("button", { name: "All files" }));
    fireEvent.click(screen.getByRole("button", { name: /New MARP deck/ }));
    await waitFor(() => expect(hoisted.records.size).toBe(3));
    const deck = [...hoisted.records.values()].find((r) => r.file.kind === "slide")!;
    expect(deck.file.kind === "slide" && deck.file.content.marp).toBeTruthy();
  });

  it("closes the trash dialogs without deleting, and clears expired trash", async () => {
    record("doc", "Old", { trashedAt: "2020-01-01T00:00:00.000Z" });
    const recent = record("doc", "Recent", { trashedAt: new Date().toISOString() });
    renderHome();
    fireEvent.click(await screen.findByRole("button", { name: "Trash" }));
    await screen.findByText("Recent");
    expect(hoisted.records.size).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Delete Recent forever" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Empty trash" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(hoisted.records.has(recent.file.id)).toBe(true);
  });

  it("asks to rename a file open in another tab there", async () => {
    record("doc", "Plan");
    Object.defineProperty(navigator, "locks", {
      value: { request: async (_n: string, _o: unknown, run: (lock: null) => unknown) => run(null) },
      configurable: true,
    });
    renderHome();
    fireEvent.click(await screen.findByRole("button", { name: "Rename Plan" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Plot" } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      '"Plan" is open in another tab. Rename it there, or close it first.',
    );
  });

  it("opens imported files, matching what the library already has", async () => {
    renderHome();
    await waitFor(() => expect(hoisted.importProps).not.toBeNull());
    const props = () => hoisted.importProps!;
    const fresh = { file: createFile("doc", "Trip") };
    await act(() => props().onImport(fresh, "Trip.sldoc"));
    expect(path()).toBe(`/file/${fresh.file.id}`);
    expect(openNotices.get(fresh.file.id)).toBe("Opened “Trip.sldoc”");
    await act(() => props().onImport({ file: fresh.file }, "Trip.sldoc"));
    expect(openNotices.get(fresh.file.id)).toBe("“Trip.sldoc” matches the copy here");
    hoisted.records.set(fresh.file.id, { ...fresh, trashedAt: new Date().toISOString() });
    await act(() => props().onImport({ file: fresh.file }, "Trip.sldoc"));
    expect(openNotices.get(fresh.file.id)).toBe("Restored “Trip.sldoc” from Trash");
    expect(hoisted.records.get(fresh.file.id)?.trashedAt).toBeUndefined();
    await act(() => props().onImport({ file: fresh.file }));
    const copies = [...hoisted.records.values()].filter((r) => r.file.title.startsWith("Trip"));
    expect(copies.map((r) => r.file.title).sort()).toEqual(["Trip", "Trip copy"]);
    const changed = { file: { ...fresh.file, title: "Trip v2", updatedAt: "2030-01-01T00:00:00.000Z" } };
    await act(() => props().onImport(changed, "Trip v2.sldoc"));
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("“Trip” is already in this browser");
    fireEvent.click(within(dialog).getByRole("button", { name: "Replace" }));
    await waitFor(() => expect(hoisted.records.get(fresh.file.id)?.file.title).toBe("Trip v2"));
    expect(openNotices.get(fresh.file.id)).toBe("Replaced with “Trip v2.sldoc”");
    await act(() =>
      props().onImport({ file: { ...fresh.file, title: "Trip v3" } }, "Trip v3.sldoc"),
    );
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Keep both" }));
    await waitFor(() => expect([...hoisted.records.values()].some((r) => r.file.title === "Trip v3 copy")).toBe(true));
    await act(() => props().onImport({ file: { ...fresh.file, title: "Trip v4" } }, "Trip v4.sldoc"));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    const desktopCopy = { file: createFile("doc", "Desk"), path: "/docs/Desk.sldoc" };
    await act(() => props().onImport(desktopCopy, "Desk.sldoc"));
    expect(path()).toBe(`/file/${desktopCopy.file.id}`);
    expect(hoisted.records.has(desktopCopy.file.id)).toBe(false);
  });

  it("will not replace a file open in another tab", async () => {
    const trip = record("doc", "Trip");
    Object.defineProperty(navigator, "locks", {
      value: { query: async () => ({ held: [{ name: `suiteleaf:${trip.file.id}` }] }) },
      configurable: true,
    });
    renderHome();
    await waitFor(() => expect(hoisted.importProps).not.toBeNull());
    await act(() =>
      hoisted.importProps!.onImport({ file: { ...trip.file, title: "Trip v2" } }, "Trip v2.sldoc"),
    );
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Replace" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "“Trip v2” is open in another tab. Close it there, then try again.",
    );
  });

  it("connects to a server, and hides that in a locked build", async () => {
    renderHome();
    fireEvent.click(await screen.findByRole("button", { name: "Connect to a server" }));
    expect(screen.getByRole("dialog", { name: "Connect to a SuiteLeaf server" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    cleanup();
    hoisted.mode = { locked: true, demo: true };
    renderHome();
    expect(await screen.findByText("Demo: files are saved in this browser.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect to a server" })).toBeNull();
    expect(hoisted.host!().tools).toEqual([{ name: "home-tool" }]);
  });

  it("says once that this window left a server", async () => {
    hoisted.left = "drive.example";
    renderHome();
    const notice = await screen.findByText(/Disconnected from drive.example/);
    fireEvent.click(within(notice.closest("[role=status]") as HTMLElement).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/Disconnected from drive.example/)).toBeNull();
  });

  it("re-reads the library when the assistant changes it", async () => {
    renderHome();
    await screen.findByText("A workspace waiting for you");
    record("doc", "Put back");
    act(() => void window.dispatchEvent(new Event("suiteleaf:library-changed")));
    expect(await screen.findByText("Put back")).toBeTruthy();
  });

  it("gives the assistant the library and its file actions", async () => {
    const plan = record("doc", "Plan");
    renderHome();
    await screen.findByText("Plan");
    const host = hoisted.host!();
    expect(host.kind).toBe("home");
    expect(host.place()).toBe("No document open");
    expect(host.snapshot()).toBe("home snapshot");
    expect(host.tools).toEqual([{ name: "home-tool" }, { name: "connect-tool" }]);
    type Ctx = {
      records: FileRecord[];
      shown: FileRecord[];
      setQuery: (q: string) => void;
      setFilter: (f: string) => void;
      create: (kind: string, title: string) => Promise<void>;
      openNew: (file: SuiteFile) => Promise<void>;
      open: (r: FileRecord) => void;
      openSample: (kind: string) => void;
      rename: (r: FileRecord, title: string) => Promise<void>;
      duplicate: (r: FileRecord) => Promise<FileRecord>;
      showRemove: () => void;
      remove: (r: FileRecord) => Promise<void>;
      star: (r: FileRecord, s: boolean) => Promise<void>;
      restore: (r: FileRecord) => Promise<void>;
      fresh: () => Promise<FileRecord[]>;
      deleteForever: (ids: string[]) => Promise<void>;
      importFile: (f: File) => Promise<void>;
    };
    const fresh = () => {
      hoisted.host!();
      return hoisted.ctx as never as Ctx;
    };
    let ctx = fresh();
    expect(ctx.records.map((r) => r.file.title)).toEqual(["Plan"]);
    act(() => ctx.setQuery("pl"));
    expect((screen.getByLabelText("Search files") as HTMLInputElement).value).toBe("pl");
    act(() => ctx.setFilter("doc"));
    expect(screen.getByRole("heading", { name: "Documents matching “pl”" })).toBeTruthy();
    await act(() => ctx.create("sheet", "Budget"));
    expect([...hoisted.records.values()].some((r) => r.file.title === "Budget")).toBe(true);
    await act(() => ctx.openNew(createFile("slide", "Deck")));
    expect([...hoisted.records.values()].some((r) => r.file.title === "Deck")).toBe(true);
    act(() => ctx.open(plan));
    expect(path()).toBe(`/file/${plan.file.id}`);
    for (const kind of ["doc", "sheet", "slide", "form"]) act(() => ctx.openSample(kind));
    await waitFor(() => expect(hoisted.records.size).toBe(7));
    await act(() => ctx.rename(plan, "Plan B"));
    expect(hoisted.records.get(plan.file.id)?.file.title).toBe("Plan B");
    const copy = await act(() => ctx.duplicate(plan));
    expect(copy.file.id).not.toBe(plan.file.id);
    ctx.showRemove();
    await act(() => ctx.star(plan, true));
    expect(hoisted.records.get(plan.file.id)?.starred).toBe(true);
    await act(() => ctx.remove(plan));
    expect(hoisted.records.get(plan.file.id)?.trashedAt).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Plan B");
    ctx = fresh();
    await act(() => ctx.restore(plan));
    expect(hoisted.records.get(plan.file.id)?.trashedAt).toBeUndefined();
    expect(screen.queryByRole("status")).toBeNull();
    await act(() => ctx.restore(plan));
    expect((await ctx.fresh()).length).toBe(8);
    await act(() => ctx.deleteForever([copy.file.id]));
    expect(hoisted.records.has(copy.file.id)).toBe(false);
    await expect(ctx.importFile(new File(["x"], "x.txt"))).rejects.toThrow(
      "Clear the search to import a file.",
    );
    const imported = vi.fn(async () => {});
    hoisted.importProps!.importer!.current = imported;
    await ctx.importFile(new File(["x"], "x.txt"));
    expect(imported).toHaveBeenCalled();
    await act(() => ctx.remove(copy));
    ctx = fresh();
    await act(() => ctx.deleteForever([copy.file.id]));
    expect(screen.queryByRole("status")).toBeNull();
    hoisted.connect!.connect("https://drive.example");
    expect(hoisted.switchMode).toHaveBeenCalledWith({ kind: "cluster", serverUrl: "https://drive.example" });
  });
});

describe("LocalHome on the desktop", () => {
  const root = "/docs";
  let folders: string[];
  let bridge: Record<string, ReturnType<typeof vi.fn>>;
  let menu: ((action: string) => void) | null;
  let filesChanged: (() => void) | null;
  beforeEach(() => {
    folders = ["Garden", "Garden/Beds", "Recipes"];
    menu = null;
    filesChanged = null;
    bridge = {
      listFolders: vi.fn(async () => [...folders]),
      getDocumentsDirectory: vi.fn(async () => root),
      createFolder: vi.fn(async (parent: string, name: string) => {
        const made = parent ? `${parent}/${name}` : name;
        folders.push(made);
        return made;
      }),
      moveFile: vi.fn(async (id: string, target: string) => {
        const r = hoisted.records.get(id)!;
        const name = r.file.title;
        const moved = { ...r, path: `${root}/${target ? `${target}/` : ""}${name}.sldoc` };
        hoisted.records.set(id, moved);
        return moved;
      }),
      moveFolder: vi.fn(async () => {}),
      renameFolder: vi.fn(async (from: string, name: string) => {
        const next = from.includes("/") ? `${from.slice(0, from.lastIndexOf("/"))}/${name}` : name;
        folders = folders.map((f) => (f === from || f.startsWith(`${from}/`) ? next + f.slice(from.length) : f));
        return next;
      }),
      onMenu: vi.fn((listener: (action: string) => void) => {
        menu = listener;
        return () => {};
      }),
      onFilesChanged: vi.fn((listener: () => void) => {
        filesChanged = listener;
        return () => {};
      }),
    };
    window.suiteleaf = bridge as never;
  });

  const goTop = () => {
    const top = within(screen.getByRole("navigation", { name: "Folder path" })).getAllByRole("button")[0]!;
    if (!(top as HTMLButtonElement).disabled) fireEvent.click(top);
  };

  it("browses folders, creates one, and files new work into the open folder", async () => {
    record("doc", "Top note", { path: `${root}/Top note.sldoc` });
    record("doc", "Bed plan", { path: `${root}/Garden/Bed plan.sldoc` });
    renderHome();
    expect(await screen.findByText("Your files, on this computer.")).toBeTruthy();
    await screen.findByText("Top note");
    expect(screen.queryByText("Bed plan")).toBeNull();
    expect(screen.getByRole("button", { name: /^Garden/ }).textContent).toContain("2 items");
    expect(screen.getByRole("button", { name: /^Recipes/ }).textContent).toContain("0 items");
    fireEvent.click(screen.getByRole("button", { name: /^Garden/ }));
    expect(await screen.findByText("Bed plan")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Beds/ }).textContent).toContain("0 items");
    fireEvent.click(screen.getByRole("button", { name: /^Beds/ }));
    expect(screen.getByRole("heading", { name: "This folder is empty" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Seeds" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(bridge.createFolder).toHaveBeenCalledWith("Garden/Beds", "Seeds"));
    expect(await screen.findByRole("button", { name: /^Seeds/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /New presentation/ }));
    await waitFor(() => expect(bridge.moveFile).toHaveBeenCalledWith(expect.any(String), "Garden/Beds"));
    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    goTop();
    expect(await screen.findByText("Top note")).toBeTruthy();
  });

  it("renames and moves folders and files", async () => {
    const note = record("doc", "Top note", { path: `${root}/Top note.sldoc` });
    renderHome();
    await screen.findByText("Top note");
    fireEvent.click(screen.getByRole("button", { name: /^Garden/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Beds/ }));
    goTop();
    fireEvent.click(screen.getByRole("button", { name: "Rename folder Recipes" }));
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(bridge.renameFolder).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Rename folder Garden" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Yard" } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(bridge.renameFolder).toHaveBeenCalledWith("Garden", "Yard"));
    expect(await screen.findByRole("button", { name: /^Yard/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Move folder Recipes" }));
    const moveFolder = screen.getByRole("dialog", { name: "Move" });
    fireEvent.click(within(moveFolder).getByRole("button", { name: "Yard" }));
    fireEvent.click(within(moveFolder).getByRole("button", { name: "Move here" }));
    await waitFor(() => expect(bridge.moveFolder).toHaveBeenCalledWith("Recipes", "Yard"));
    fireEvent.click(screen.getByRole("button", { name: "Move Top note to a folder" }));
    const moveFile = screen.getByRole("dialog", { name: "Move" });
    expect(moveFile.textContent).toContain("Top note is in All files.");
    fireEvent.click(within(moveFile).getByRole("button", { name: "Recipes" }));
    fireEvent.click(within(moveFile).getByRole("button", { name: "Move here" }));
    await waitFor(() => expect(bridge.moveFile).toHaveBeenCalledWith(note.file.id, "Recipes"));
    fireEvent.click(screen.getByRole("button", { name: "Move folder Recipes" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Rename folder Recipes" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("files imported folders on disk and re-reads after a batch", async () => {
    renderHome();
    await waitFor(() => expect(hoisted.importProps?.placeInFolder).toBeTruthy());
    const props = hoisted.importProps!;
    const file = createFile("doc", "Lesson");
    const placed = (await props.placeInFolder!(file, "Garden/New/Deep")) as FileRecord;
    expect(bridge.createFolder.mock.calls).toEqual([
      ["Garden", "New"],
      ["Garden/New", "Deep"],
    ]);
    expect(placed.path).toBe(`${root}/Garden/New/Deep/Lesson.sldoc`);
    bridge.createFolder.mockRejectedValueOnce(new Error("That folder already exists."));
    await props.placeInFolder!(createFile("doc", "Two"), "Other");
    expect(bridge.moveFile).toHaveBeenLastCalledWith(expect.any(String), "Other");
    bridge.createFolder.mockRejectedValueOnce(new Error("Disk full."));
    await expect(props.placeInFolder!(createFile("doc", "Three"), "Elsewhere")).rejects.toThrow("Disk full.");
    await props.keepImported!(createFile("sheet", "Kept"));
    expect(bridge.moveFile).toHaveBeenLastCalledWith(expect.any(String), "");
    const before = bridge.listFolders.mock.calls.length;
    await act(async () => void (await props.onBatchDone!()));
    expect(bridge.listFolders.mock.calls.length).toBeGreaterThan(before);
    act(() => filesChanged!());
    await waitFor(() => expect(bridge.listFolders.mock.calls.length).toBeGreaterThan(before + 1));
  });

  it("answers the desktop menu", async () => {
    renderHome();
    await waitFor(() => expect(menu).not.toBeNull());
    act(() => menu!("new-doc"));
    await waitFor(() => expect(path()).toMatch(/^\/file\//));
    act(() => menu!("new-drawing-svg"));
    await waitFor(() => expect([...hoisted.records.values()].some((r) => r.file.kind === "drawing")).toBe(true));
    act(() => menu!("connect-server"));
    expect(screen.getByRole("dialog", { name: "Connect to a SuiteLeaf server" })).toBeTruthy();
    const opened = { file: createFile("doc", "From disk"), path: `${root}/From disk.sldoc` };
    hoisted.opened = opened;
    act(() => menu!("open"));
    await waitFor(() => expect(path()).toBe(`/file/${opened.file.id}`));
    for (const action of ["new-sheet", "new-slide", "new-marp"]) act(() => menu!(action));
    await waitFor(() => expect(hoisted.records.size).toBe(5));
  });

  it("drags a file, and shows failed folder changes", async () => {
    const note = record("doc", "Top note", { path: `${root}/Top note.sldoc` });
    renderHome();
    await screen.findByText("Top note");
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (type: string, value: string) => void data.set(type, value),
      getData: (type: string) => data.get(type) ?? "",
      get types() {
        return [...data.keys()];
      },
      effectAllowed: "",
      dropEffect: "",
    };
    const row = screen.getByText("Top note").closest(".file-row")!;
    expect(row.getAttribute("draggable")).toBe("true");
    fireEvent.dragStart(row, { dataTransfer });
    expect(data.get("application/x-suiteleaf-file")).toBe(note.file.id);
    bridge.moveFile.mockRejectedValueOnce(new Error("Cannot move there."));
    const garden = screen.getByRole("button", { name: /^Garden/ }).closest(".folder-row")!;
    fireEvent.dragOver(garden, { dataTransfer });
    fireEvent.drop(garden, { dataTransfer });
    expect((await screen.findByRole("alert")).textContent).toContain("Cannot move there.");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss error" }));
    bridge.createFolder.mockRejectedValueOnce(new Error("Name taken."));
    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Name taken.");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss error" }));
    bridge.renameFolder.mockRejectedValueOnce(new Error("Folder is busy."));
    fireEvent.click(screen.getByRole("button", { name: "Rename folder Recipes" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Meals" } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Folder is busy.");
    fireEvent.click(screen.getByRole("button", { name: "Move Top note to a folder" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says deleting from Trash leaves the saved file on disk", async () => {
    record("doc", "Gone", { path: `${root}/Gone.sldoc`, trashedAt: new Date().toISOString() });
    renderHome();
    fireEvent.click(await screen.findByRole("button", { name: "Trash" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete Gone forever" }));
    expect(screen.getByRole("dialog").textContent).toMatch(/disk|computer/);
  });
});
