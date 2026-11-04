// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFile, serializeFile, type DocFile, type SheetFile } from "@suiteleaf/core";
import { MailMergeDialog } from "../../apps/web/src/editors/mail-merge-dialog";

type Cells = Record<string, Record<string, { v: string }>>;

function sheetFile(id: string, title: string, cellData: Cells): SheetFile {
  const file = createFile("sheet", title) as SheetFile;
  return {
    ...file,
    id,
    content: { ...file.content, workbook: { ...file.content.workbook, sheetOrder: ["s"], sheets: { s: { id: "s", name: "Sheet1", rowCount: 20, columnCount: 5, cellData } } } as never },
  };
}

const rows: Cells = {
  0: { 0: { v: "Name" }, 1: { v: "Street" }, 2: { v: "City" } },
  1: { 0: { v: "Rosa" }, 1: { v: "1 Elm St" }, 2: { v: "Leeds" } },
};

const state = vi.hoisted(() => ({
  library: [] as { file: unknown; drive?: unknown; trashedAt?: string }[],
  listFails: false,
  session: null as null | { user: { id: string } },
  remote: [] as { id: string; name: string; parentName: string }[],
  remoteFails: false,
  remoteText: "",
}));

vi.mock("../../apps/web/src/storage", () => ({
  storage: {
    list: async () => {
      if (state.listFails) throw new Error("The library is locked.");
      return state.library;
    },
    get: async (id: string) => state.library.find((record) => (record.file as { id: string }).id === id),
  },
}));
vi.mock("../../apps/web/src/node-client", () => ({
  getSession: () => state.session,
  drive: {
    spreadsheets: async () => {
      if (state.remoteFails) throw "offline";
      return state.remote;
    },
    read: async () => ({ text: state.remoteText }),
  },
}));

beforeEach(() => {
  state.library = [];
  state.listFails = false;
  state.session = null;
  state.remote = [];
  state.remoteFails = false;
  state.remoteText = "";
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const template = () => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Dear {{Name}}" }] }],
});

function openMerge(onCreate = vi.fn<(files: DocFile[]) => Promise<void>>(async () => {})) {
  const onClose = vi.fn();
  render(<MailMergeDialog template={template} sourceTitle="Letter" onClose={onClose} onCreate={onCreate} />);
  return { onClose, onCreate };
}

const output = (name: string) => fireEvent.click(screen.getByRole("radio", { name }));
const primary = () => document.querySelector<HTMLButtonElement>(".dialog-primary-btn")!;

describe("choosing a spreadsheet to merge from", () => {
  it("merges from a SuiteDrive spreadsheet", async () => {
    state.session = { user: { id: "u" } };
    state.remote = [{ id: "d1", name: "Addresses.slsheet", parentName: "Club" }];
    state.remoteText = serializeFile(sheetFile("d1", "Addresses", rows));
    const { onCreate, onClose } = openMerge();
    fireEvent.click(await screen.findByRole("radio", { name: /Addresses/ }));
    fireEvent.click(primary());
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][0].map((file) => file.title)).toEqual(["Letter — Rosa"]);
    expect(onClose).toHaveBeenCalled();
  });

  it("says why the lists could not be read, and when there is nothing to pick", async () => {
    state.listFails = true;
    state.session = { user: { id: "u" } };
    state.remoteFails = true;
    openMerge();
    expect((await screen.findByRole("alert")).textContent).toBe("The library is locked.");
    expect(screen.getByText("There are no spreadsheets to merge from.")).toBeTruthy();
    expect(primary()).toHaveProperty("disabled", true);
  });

  it("explains a SuiteDrive list that could not be read", async () => {
    state.session = { user: { id: "u" } };
    state.remoteFails = true;
    openMerge();
    expect((await screen.findByRole("alert")).textContent).toBe("Could not merge those letters.");
  });

  it("refuses a spreadsheet that left the library, or a file that is not a spreadsheet", async () => {
    const kept = sheetFile("lib1", "Kept", rows);
    state.library = [{ file: kept }];
    openMerge();
    fireEvent.click(await screen.findByRole("radio", { name: /Kept/ }));
    state.library = [{ file: kept, trashedAt: "2026-01-01" }];
    fireEvent.click(primary());
    expect((await screen.findByRole("alert")).textContent).toBe("That spreadsheet is no longer in this library.");
    cleanup();

    state.library = [];
    state.session = { user: { id: "u" } };
    state.remote = [{ id: "d2", name: "Notes.slsheet", parentName: "Club" }];
    state.remoteText = serializeFile(createFile("doc", "Notes"));
    openMerge();
    fireEvent.click(await screen.findByRole("radio", { name: /Notes/ }));
    fireEvent.click(primary());
    expect((await screen.findByRole("alert")).textContent).not.toBe("");
    expect(primary().textContent).toBe("Merge");
  });

  it("reports a letter set that could not be saved", async () => {
    state.library = [{ file: sheetFile("lib1", "Kept", rows) }];
    openMerge(vi.fn(async () => {
      throw new Error("Disk full.");
    }));
    fireEvent.click(await screen.findByRole("radio", { name: /Kept/ }));
    fireEvent.click(primary());
    expect((await screen.findByRole("alert")).textContent).toBe("Disk full.");
    expect(primary()).toHaveProperty("disabled", false);
  });

  it("says when a spreadsheet has headers but no rows", async () => {
    state.library = [{ file: sheetFile("lib1", "Empty", { 0: rows[0] }) }];
    openMerge();
    fireEvent.click(await screen.findByRole("radio", { name: /Empty/ }));
    fireEvent.click(primary());
    expect((await screen.findByRole("alert")).textContent).toBe("That spreadsheet has no rows to merge.");
    output("PDF");
    fireEvent.click(screen.getByRole("radio", { name: /Empty/ }));
    fireEvent.click(primary());
    expect((await screen.findByRole("alert")).textContent).toBe("That spreadsheet has no rows to merge.");
  });
});

describe("merge outputs", () => {
  beforeEach(() => {
    state.library = [{ file: sheetFile("lib1", "Addresses", rows) }];
  });

  it("places the first address on an envelope", async () => {
    openMerge();
    output("Envelopes");
    fireEvent.click(await screen.findByRole("radio", { name: /Addresses/ }));
    expect(primary().textContent).toBe("Place on envelope");
    fireEvent.click(primary());
    await waitFor(() => expect(document.body.textContent).toContain("1 Elm St"));
  });

  it("says when an address does not fit the envelope or a label", async () => {
    const wide: Cells = { 0: {}, 1: {} };
    for (let column = 0; column < 14; column++) {
      wide[0][column] = { v: column ? `Line ${column}` : "Name" };
      wide[1][column] = { v: column ? `Part ${column}` : "Rosa" };
    }
    state.library = [{ file: sheetFile("lib1", "Addresses", wide) }];
    openMerge();
    output("Envelopes");
    fireEvent.click(await screen.findByRole("radio", { name: /Addresses/ }));
    fireEvent.click(primary());
    expect((await screen.findByRole("alert")).textContent).toMatch(/^Rosa does not fit the envelope\./);
    output("Labels");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /Addresses/ }));
    fireEvent.click(primary());
    expect((await screen.findByRole("alert")).textContent).toMatch(/^Rosa does not fit a label\./);
  });

  it("says when the PDFs could not be saved", async () => {
    vi.stubGlobal("URL", Object.assign(Object.create(URL), {
      createObjectURL: () => {
        throw new Error("blocked");
      },
      revokeObjectURL: () => {},
    }));
    openMerge();
    output("PDF");
    fireEvent.click(await screen.findByRole("radio", { name: /Addresses/ }));
    fireEvent.click(primary());
    const status = await screen.findByRole("status");
    expect(status.textContent).toBe("Prepared Rosa.pdf. They were not saved. Nothing is mailed. This is not a print of the page.");
  });

  it("closes with Escape, the close button, Cancel, or a press outside", async () => {
    const { onClose } = openMerge();
    const dialog = screen.getByRole("dialog", { name: "Merge from a spreadsheet" });
    fireEvent.mouseDown(dialog);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: "Enter" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.mouseDown(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(4);
    await screen.findByRole("radio", { name: /Addresses/ });
  });
});
