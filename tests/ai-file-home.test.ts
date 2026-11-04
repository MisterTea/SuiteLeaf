// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { approvalStore } from "../apps/web/src/ai/guard";
import { fileRequestStore } from "../apps/web/src/ai/file-request";
import { registerAgentHost } from "../apps/web/src/ai/host";
import { homeSnapshot } from "../apps/web/src/ai/tools/files";
import { namesFrom } from "../apps/web/src/ai/tools/file-library";
import { closeEditor, homeHarness, openEditor, record, settle, useFileTimers } from "./ai-file-harness";
import { memoryStorage } from "./ai-memory-storage";

const offs: (() => void)[] = [];
const answerApprovals = (ok: boolean) => offs.push(approvalStore.subscribe(() => approvalStore.get()?.resolve(ok)));
const answerFile = (file: File | null) => offs.push(fileRequestStore.subscribe(() => fileRequestStore.get()?.resolve(file)));

beforeEach(() => {
  useFileTimers();
  memoryStorage();
  document.body.innerHTML = `<div class="file-section"></div><input aria-label="Search files" />`;
  location.hash = "#/";
});
afterEach(() => {
  offs.splice(0).forEach((off) => off());
  closeEditor();
  vi.useRealTimers();
});

const library = () => [
  record("doc", "Garden notes", { starred: true }, "2026-10-03T10:00:00.000Z"),
  record("sheet", "Budget 2026", {}, "2026-10-02T10:00:00.000Z"),
  record("slide", "Club update", { trashedAt: "2026-10-01T00:00:00.000Z" }, "2026-10-01T10:00:00.000Z"),
];

describe("listing and finding files", () => {
  it("lists files newest first, then Trash, optionally one kind", async () => {
    const { call } = homeHarness(library());
    const out = await call("list_files");
    expect(out.split("\n")[0]).toMatch(/^"Garden notes" \(document, starred, edited /);
    expect(out.split("\n")[1]).toMatch(/^"Budget 2026" \(spreadsheet, edited /);
    expect(out).toMatch(/In Trash:\n"Club update" \(presentation, in Trash, edited /);
    expect(await call("list_files", { kind: "spreadsheet" })).toMatch(/^"Budget 2026" .*\nTrash is empty\.$/);
    expect(await call("list_files", { kind: "presentation" })).toMatch(/^No files outside Trash\.\nIn Trash:/);
    expect(await homeHarness([]).call("list_files")).toBe("There are no files yet.");
  });

  it("types a search letter by letter and lists the matches with their snippets", async () => {
    const { state, call } = homeHarness(library());
    const out = await call("search_files", { query: "bud" });
    expect(state.query).toBe("bud");
    expect(out).toBe('1 file(s) match "bud" (in the name or the text):\n- "Budget 2026": …bud here…');
    expect(await call("search_files", { query: "zebra" })).toMatch(/^No files match "zebra"\. A file that is not listed here is on the user's computer/);
    expect(await call("search_files", { query: "" })).toBe("Cleared the search.");
    expect(state.query).toBe("");
  });

  it("filters and sorts the list, and says when a search hides files", async () => {
    const { state, call, target } = homeHarness(library());
    document.body.insertAdjacentHTML("beforeend", `<nav class="sidebar-links"><button>All files</button><button>Starred</button><button>Trash</button></nav>`);
    expect(await call("show_files", { show: "starred" })).toBe('Showing starred.\n- "Garden notes" (starred)');
    expect(state).toMatchObject({ filter: "starred", sort: { by: "edited", desc: true } });
    expect(await call("show_files", { show: "spreadsheets", sort_by: "name" })).toBe('Showing spreadsheets, sorted by name.\n- "Budget 2026"');
    expect(state.sort).toEqual({ by: "name", desc: false });
    expect(await call("show_files", { show: "trash" })).toBe('Showing trash.\n- "Club update" (in Trash)');
    state.query = "zzz";
    expect(await call("show_files", { show: "all" })).toBe(
      'Showing all. Only files matching the search "zzz" are listed; call search_files with an empty query to list them all.\nNo files listed.',
    );
    expect((await target("show_files", { show: "all" }))?.textContent).toBe("All files");
    expect((await target("show_files", { show: "trash" }))?.textContent).toBe("Trash");
    expect(((await target("list_files")) as Element).className).toBe("file-list");
  });

  it("describes the home screen for the model", () => {
    const { ctx, state } = homeHarness(library());
    state.query = "notes";
    state.filter = "starred";
    const snap = homeSnapshot({ ...ctx, where: "SuiteDrive" });
    expect(snap.split("\n")[0]).toBe('Screen: the file list (SuiteDrive). 2 file(s) in the library, 1 starred, 1 in Trash. Search: "notes". Showing starred files.');
    expect(snap.split("\n")).toHaveLength(4);
    expect(homeSnapshot(homeHarness([]).ctx)).toBe("Screen: the file list. 0 file(s) in the library, 0 starred, 0 in Trash.\n");
  });

  it("reads file names from lists, JSON and sentences", () => {
    expect(namesFrom({ names: '["A", "B"]' })).toEqual(["A", "B"]);
    expect(namesFrom({ names: "['A', 'b']", name: "a" })).toEqual(["A", "b"]);
    expect(namesFrom({ names: "[not json", name: ["X", ["Y"]] })).toEqual(["[not json", "X", "Y"]);
    expect(namesFrom({ names: '"Notes", Budget and Club update.; or' })).toEqual(["Notes", "Budget", "Club update"]);
    expect(namesFrom({})).toEqual([]);
  });
});

describe("creating and opening files", () => {
  it("creates a file and describes the editor it opened", async () => {
    const { state, call, target } = homeHarness(library());
    document.body.insertAdjacentHTML("beforeend", `<button class="new-card">New document</button>`);
    expect(await call("create_file", { kind: "document", title: "Minutes" })).toBe('Created a new document called "Minutes" and opened it.\nOpen doc editor.');
    expect(state.created).toEqual([{ kind: "doc", title: "Minutes" }]);
    expect(await call("create_file", { kind: "spreadsheet" })).toBe("Created a new spreadsheet and opened it.\nOpen sheet editor.");
    await expect(call("create_file", { kind: "poster" })).rejects.toThrow('Unknown kind "poster".');
    expect((await target("create_file", { kind: "document" }))?.textContent).toBe("New document");
  });

  it("opens a library file or a sample", async () => {
    const { state, call } = homeHarness(library());
    expect(await call("open_file", { name: "budget 2026.slsheet" })).toBe('Opened "Budget 2026".\nOpen sheet editor.');
    expect(await call("open_sample", { sample: "presentation" })).toBe("Opened the sample presentation.\nOpen slide editor.");
    await call("open_sample", { sample: "document" });
    await call("open_sample", { sample: "budget" });
    expect(state.opened).toEqual(["Budget 2026", "sample slide", "sample doc", "sample sheet"]);
  });

  it("asks the user to pick a file that is not in the library", async () => {
    const h = homeHarness(library());
    await expect(h.call("open_file", { name: "Tax return" })).rejects.toThrow('No file is called "Tax return"');
    offs.push(registerAgentHost("home", { kind: "home", snapshot: () => "home", tools: Object.values(h.tools) }));
    answerFile(null);
    expect(await h.call("open_file", { name: "Tax return" })).toBe(
      '"Tax return" is not in the library (Files: "Garden notes", "Budget 2026", "Club update"), so the user was asked to pick it from their computer. The user did not choose a file.',
    );
  });

  it("points at the file's row, or at Open / import", async () => {
    const { target } = homeHarness(library());
    expect(((await target("open_file", { name: "Budget 2026" })) as Element).getAttribute("href")).toMatch(/^#\/file\//);
    document.body.insertAdjacentHTML("beforeend", `<button>Open / import</button>`);
    expect((await target("open_file", { name: "Missing" }))?.textContent).toBe("Open / import");
    expect((await target("open_from_computer"))?.textContent).toBe("Open / import");
  });

  it("renames and duplicates files", async () => {
    const { state, call, target } = homeHarness(library());
    expect(((await target("rename_file", { name: "garden" })) as Element).getAttribute("aria-label")).toBe("Rename Garden notes");
    expect(await call("rename_file", { name: "garden", new_name: "Allotment notes" })).toBe('Renamed "Garden notes" to "Allotment notes".');
    expect(state.records[0].file.title).toBe("Allotment notes");
    expect(((await target("duplicate_file", { name: "Budget 2026" })) as Element).getAttribute("aria-label")).toBe("Duplicate Budget 2026");
    expect(await call("duplicate_file", { name: "Budget 2026" })).toBe('Made a copy of "Budget 2026" called "Budget 2026 (copy)".');
  });

  it("brings a file that a filter hides back into view first", async () => {
    const { state, ctx, target } = homeHarness(library());
    ctx.setFilter("doc");
    ctx.setQuery("nothing");
    expect(((await target("rename_file", { name: "Budget 2026" })) as Element).getAttribute("aria-label")).toBe("Rename Budget 2026");
    expect(state).toMatchObject({ query: "", filter: "all" });
    expect(((await target("restore_file", { name: "Club update" })) as Element).getAttribute("aria-label")).toBe("Restore Club update");
    expect(state.filter).toBe("trash");
  });

  it("scrolls a row that is off screen into view", async () => {
    const { target } = homeHarness(library());
    const row = document.querySelector(".file-row")!;
    let top = -200;
    row.getBoundingClientRect = () => ({ top, bottom: top + 40 }) as DOMRect;
    row.scrollIntoView = vi.fn(() => {
      top = 100;
    });
    await target("rename_file", { name: "Garden notes" });
    expect(row.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
  });
});

describe("Trash", () => {
  it("asks before trashing one file unless the request said so", () => {
    const { confirm, tools } = homeHarness([...library(), record("doc", "Disk file", { path: "/tmp/disk.sldoc" })]);
    expect(confirm("remove_file", { name: "budget" })).toBe("Remove “Budget 2026” from SuiteLeaf? This can't be undone.");
    expect(confirm("remove_file", { name: "Disk file" })).toBe("Remove “Disk file” from SuiteLeaf? Its saved file stays on disk.");
    expect(confirm("remove_file", { names: "A, B" })).toBeUndefined();
    expect(confirm("remove_file", { name: "Nothing" })).toBeUndefined();
    expect(tools.remove_file.intent?.test("Throw it away")).toBe(true);
  });

  it("moves files to Trash through the dialog, and says when one is there already", async () => {
    const { state, call, ctx } = homeHarness([...library(), record("doc", "Disk file", { path: "/tmp/disk.sldoc" })]);
    ctx.showRemove = (r) => {
      state.shownRemove.push(r.file.title);
      document.body.insertAdjacentHTML("beforeend", `<div role="dialog"><button type="submit">Remove</button></div>`);
    };
    const out = await call("remove_file", { names: ["Budget 2026", "Club update", "Disk file"] });
    expect(state.shownRemove).toEqual(["Budget 2026", "Disk file"]);
    expect(out.split("\n")).toEqual([
      'Moved "Budget 2026" to Trash. Empty Trash deletes it. A copy that was downloaded or saved elsewhere is not affected. restore_file brings it back with the same text and star.',
      '"Club update" is already in Trash. restore_file brings it back. empty_trash deletes it forever.',
      'Moved "Disk file" to Trash. Its saved file stays on disk at /tmp/disk.sldoc; open_from_computer opens it again.',
    ]);
    expect(state.records[1].trashedAt).toBeTruthy();
    expect(state.records[3].trashedAt).toBeTruthy();
    await expect(call("remove_file", {})).rejects.toThrow("Name the file to move to Trash.");
  });

  it("points at the first file's Trash button", async () => {
    const { target } = homeHarness(library());
    expect(((await target("remove_file", { name: "Budget 2026" })) as Element).getAttribute("aria-label")).toBe("Move Budget 2026 to Trash");
    expect(await target("remove_file", {})).toBeUndefined();
    expect(await target("remove_file", { name: "Nope" })).toBeUndefined();
  });

  it("stars and unstars files without changing them", async () => {
    const { state, call, target, prepared } = homeHarness(library());
    expect(prepared("star_file", { names: ["A", "B"], starred: "false" })).toEqual({ names: "A, B", starred: false });
    expect(prepared("star_file", { name: ["A"], starred: "true" })).toEqual({ names: "A", starred: true });
    expect(((await target("star_file", { name: "Budget" })) as Element).getAttribute("aria-label")).toBe("Star Budget 2026");
    expect(await target("star_file", {})).toBeUndefined();
    expect(await call("star_file", { names: "Budget 2026, Club update" })).toBe(
      'Starred "Budget 2026", "Club update". The text is unchanged. A star stays on the file through Trash and restore.',
    );
    expect(state.records[1].starred).toBe(true);
    expect(await call("star_file", { name: "Garden notes", starred: false })).toMatch(/^Unstarred "Garden notes"\./);
    expect(state.records[0].starred).toBe(false);
    await expect(call("star_file", {})).rejects.toThrow("Name the file to star.");
  });

  it("restores trashed files with the Restore button, or directly", async () => {
    const records = library();
    const { state, call, target } = homeHarness(records);
    expect(await target("restore_file", {})).toBeUndefined();
    expect(await call("restore_file", { name: "Garden notes" })).toBe('"Garden notes" is not in Trash and is still starred.');
    expect(await call("restore_file", { name: "Budget 2026" })).toBe('"Budget 2026" is not in Trash.');
    expect(await call("restore_file", { name: "Club update" })).toBe('Restored "Club update" from Trash. Same title and text. It was not starred.');
    expect(state.records[2].trashedAt).toBeUndefined();

    const trashed = library();
    trashed[0].trashedAt = "2026-10-05T00:00:00.000Z";
    document.querySelector(".file-list")!.remove();
    const restoring = homeHarness(trashed, { setFilter: () => {}, setQuery: () => {} });
    document.querySelector(".file-list")!.innerHTML = "";
    expect(await restoring.call("restore_file", { names: "Garden notes" })).toBe('Restored "Garden notes" from Trash. Same title and text. It is still starred.');
    expect(restoring.state.records[0].trashedAt).toBeUndefined();
    await expect(call("restore_file", {})).rejects.toThrow("Name the file to restore.");
  });
});

describe("emptying Trash", () => {
  it("refuses when nothing, a starred file, or another file would be deleted", async () => {
    const records = library();
    const { call } = homeHarness(records);
    await expect(homeHarness([record("doc", "Live")]).call("empty_trash")).rejects.toThrow("Nothing to delete forever.");
    await expect(call("empty_trash", { name: "Garden notes" })).rejects.toThrow('"Garden notes" is starred. Starred files are not deleted forever.');
    await expect(call("empty_trash", { name: "Budget 2026" })).rejects.toThrow('"Club update" is also in Trash. Restore it with restore_file before emptying Trash, or it would be deleted forever too.');
    records.push(record("doc", "Old", { trashedAt: "2026-01-01T00:00:00.000Z" }));
    await expect(call("empty_trash", { name: "Budget 2026" })).rejects.toThrow('"Club update", "Old" are also in Trash. Restore them');
    records[0].starred = false;
    records[1].starred = true;
    await expect(call("empty_trash", { names: "Garden notes, Budget 2026" })).rejects.toThrow('"Budget 2026" is starred.');
  });

  it("stops when the user says no", async () => {
    const { state, call } = homeHarness(library());
    answerApprovals(false);
    await expect(call("empty_trash")).rejects.toThrow('The user answered no to "Delete 1 file forever? Club update. This can\'t be undone."');
    expect(state.deleted).toEqual([]);
  });

  it("deletes forever without the dialog when the Trash view has no button", async () => {
    const { state, call } = homeHarness(library());
    answerApprovals(true);
    expect(await call("empty_trash")).toBe("Deleted Club update forever. They are gone from Trash and from the library.");
    expect(state.records.map((r) => r.file.title)).toEqual(["Garden notes", "Budget 2026"]);
    expect(state.filter).toBe("trash");
  });

  it("moves named files to Trash, then confirms in the dialog", async () => {
    const h = homeHarness(library());
    answerApprovals(true);
    document.body.insertAdjacentHTML("beforeend", `<button>Empty trash</button>`);
    const empty = [...document.querySelectorAll("button")].find((b) => b.textContent === "Empty trash")!;
    empty.addEventListener("click", () => {
      const titles = h.state.records.filter((r) => r.trashedAt).map((r) => `<li>${r.file.title}</li>`).join("");
      document.body.insertAdjacentHTML("beforeend", `<div role="dialog">Delete <ul class="trash-name-list">${titles}</ul><button>Cancel</button><button>Delete forever</button></div>`);
      document.querySelector('[role="dialog"] button:last-child')!.addEventListener("click", () =>
        void h.ctx.deleteForever(h.state.records.filter((r) => r.trashedAt).map((r) => r.file.id)),
      );
    });
    expect(await h.call("empty_trash", { names: "Budget 2026, Club update" })).toBe("Deleted Budget 2026, Club update forever. They are gone from Trash and from the library.");
    expect(h.state.records.map((r) => r.file.title)).toEqual(["Garden notes"]);
  });

  it("cancels the dialog when it lists another file, or falls back when it names none", async () => {
    const h = homeHarness(library());
    answerApprovals(true);
    const dialog = (items: string) => {
      document.querySelectorAll('[role="dialog"]').forEach((d) => d.remove());
      document.body.insertAdjacentHTML("beforeend", `<div role="dialog">${items}<button>Cancel</button><button>Delete forever</button></div>`);
    };
    document.body.insertAdjacentHTML("beforeend", `<button>Empty trash</button>`);
    const empty = [...document.querySelectorAll("button")].find((b) => b.textContent === "Empty trash")!;
    empty.onclick = () => dialog(`<ul class="trash-name-list"><li>Club update</li><li>Secret</li></ul>`);
    await expect(h.call("empty_trash")).rejects.toThrow('Trash also has "Secret". Restore that with restore_file before emptying Trash.');
    expect(h.state.deleted).toEqual([]);
    empty.onclick = () => dialog(`Something else`);
    expect(await h.call("empty_trash")).toBe("Deleted Club update forever. They are gone from Trash and from the library.");
  });

  it("says when files are still there after deleting", async () => {
    const h = homeHarness(library(), { deleteForever: async () => {} });
    answerApprovals(true);
    await expect(h.call("empty_trash")).rejects.toThrow('Could not delete "Club update" forever.');
  });
});

describe("open_from_computer", () => {
  const csv = new File(["a,b"], "codes.csv", { type: "text/csv" });

  it("says when the user did not choose a file", async () => {
    answerFile(null);
    expect(await homeHarness([]).call("open_from_computer")).toBe("The user did not choose a file.");
    expect(fileRequestStore.get()).toBeNull();
  });

  it("imports a CSV through its preview and opens the sheet", async () => {
    answerFile(csv);
    const h = homeHarness([], {
      importFile: async (file) => {
        h.state.imported.push(file.name);
        document.body.insertAdjacentHTML(
          "beforeend",
          `<div class="csv-import-dialog"><div role="status">3 rows, 2 columns</div>
            <select><option value=",">Comma</option><option value=";">Semicolon</option></select>
            <label class="checkbox-row"><input type="checkbox" checked />First row is a header</label>
            <label class="checkbox-row"><input type="checkbox" />Keep code columns as text<small>Column A keeps 00412.</small></label>
            <table><thead><tr><th><span>Code</span><small>text</small></th><th><span>Name</span><small>text</small></th></tr></thead></table>
            <p class="csv-import-note">Dates were read as text.</p>
            <button>Cancel</button><button>Import</button></div>`,
        );
        const dialog = document.querySelector(".csv-import-dialog")!;
        await new Promise<void>((done) => [...dialog.querySelectorAll("button")].at(-1)!.addEventListener("click", () => done()));
        dialog.remove();
        document.body.insertAdjacentHTML("beforeend", `<ul class="import-notes"><li>Kept 2 columns.</li></ul>`);
        openEditor("sheet");
      },
    });
    const select = () => document.querySelector("select")!;
    const out = await h.call("open_from_computer", { separator: "semicolon", first_row_is_header: false });
    expect(h.state.imported).toEqual(["codes.csv"]);
    expect(out).toBe(
      'Imported "codes.csv" from its preview: 3 rows, 2 columns. Columns: Code (text), Name (text). Column A keeps 00412. Dates were read as text. It was converted into an editable SuiteLeaf copy; the original file is unchanged. Import notes: Kept 2 columns.\nOpen sheet editor.',
    );
    expect(select).toBeTypeOf("function");
  });

  it("stops at the preview's error and cancels the import", async () => {
    answerFile(csv);
    let cancelled = false;
    const h = homeHarness([], {
      importFile: async () => {
        document.body.insertAdjacentHTML(
          "beforeend",
          `<div class="csv-import-dialog"><div role="status">0 rows</div><div role="alert">The file is empty.</div><label class="checkbox-row"><input type="checkbox" checked />Keep code columns as text</label><button>Cancel</button><button>Import</button></div>`,
        );
        const dialog = document.querySelector(".csv-import-dialog")!;
        await new Promise<void>((done) =>
          dialog.querySelector("button")!.addEventListener("click", () => {
            cancelled = true;
            done();
          }),
        );
      },
    });
    await expect(h.call("open_from_computer", { keep_codes_as_text: false })).rejects.toThrow(
      'The import preview of "codes.csv" says: The file is empty. (0 rows). It was not imported.',
    );
    expect(cancelled).toBe(true);
    const box = document.querySelector<HTMLInputElement>(".checkbox-row input")!;
    expect(box.checked).toBe(false);
  });

  it("notes code columns that were not kept as text", async () => {
    answerFile(csv);
    const h = homeHarness([], {
      importFile: async () => {
        document.body.insertAdjacentHTML(
          "beforeend",
          `<div class="csv-import-dialog"><div role="status">1 row</div><label class="checkbox-row"><input type="checkbox" checked />Keep code columns as text</label><button>Import</button></div>`,
        );
        const dialog = document.querySelector(".csv-import-dialog")!;
        await new Promise<void>((done) => dialog.querySelector("button")!.addEventListener("click", () => done()));
        dialog.remove();
        openEditor("sheet");
      },
    });
    expect(await h.call("open_from_computer", { keep_codes_as_text: false })).toBe(
      'Imported "codes.csv" from its preview: 1 row. Columns: . Code columns with leading zeros were not kept as text.\nOpen sheet editor.',
    );
  });

  it("leaves the same-file choice to the user", async () => {
    answerFile(new File(["x"], "Notes.sldoc"));
    const h = homeHarness([], {
      importFile: async () => {
        document.body.insertAdjacentHTML("beforeend", `<div class="same-file-dialog"><h2> Notes is already here </h2><p class="same-file-warning"></p></div>`);
      },
    });
    const out = await h.call("open_from_computer");
    expect(out).toMatch(/^Notes is already here, so SuiteLeaf is asking the user what to do with "Notes.sldoc": Cancel, Replace/);
    expect(out).toContain("The one here has newer changes; replacing it discards them.");
  });

  it("reports a new error banner, and a cancelled import", async () => {
    answerFile(new File(["x"], "broken.docx"));
    document.body.insertAdjacentHTML("beforeend", `<div class="error" role="alert">Old problem ×</div>`);
    const failing = homeHarness([], {
      importFile: async () => {
        document.querySelector(".error")!.textContent = "This file is damaged. ×";
      },
    });
    await expect(failing.call("open_from_computer")).rejects.toThrow('"broken.docx" could not be opened: This file is damaged.');
    const cancelled = homeHarness([], { importFile: async () => {} });
    expect(await cancelled.call("open_from_computer")).toBe('"broken.docx" was not opened (the user cancelled the import).');
  });

  it("opens a file that needs no preview", async () => {
    answerFile(new File(["x"], "Deck.pptx"));
    const h = homeHarness([], { importFile: async () => openEditor("slide") });
    expect(await h.call("open_from_computer")).toBe('Opened "Deck.pptx".\nOpen slide editor.');
  });
});

it("waits for the editor before describing it", async () => {
  const pending = settle(async () => {
    setTimeout(() => openEditor("doc", "Late doc."), 1000);
    const { opened } = await import("../apps/web/src/ai/tools/file-tool-kit");
    return opened("doc", "Done.");
  });
  expect(await pending).toBe("Done.\nLate doc.");
});
