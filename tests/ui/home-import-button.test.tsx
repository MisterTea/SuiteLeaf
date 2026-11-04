// @vitest-environment jsdom
import { act, cleanup, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFile, type SuiteFile } from "../../packages/core/src";

type Review = (draft: unknown) => Promise<unknown>;
type ImportCall = { name: string; assets: unknown; shouldStop: () => boolean };

const hoisted = vi.hoisted(() => ({
  calls: [] as ImportCall[],
  convert: null as null | ((f: File, review: Review) => Promise<SuiteFile | null>),
  opened: null as unknown,
}));

vi.mock("../../apps/web/src/imports", () => ({
  opensImportedFile: (count: number) => count === 1,
  importFile: async (
    f: File,
    review: Review,
    assets: unknown,
    options: { shouldStop: () => boolean },
  ) => {
    hoisted.calls.push({ name: f.name, assets, shouldStop: options.shouldStop });
    if (hoisted.convert) return hoisted.convert(f, review);
    return { ...createFile("doc", f.name.replace(/\.[^.]+$/, "")) };
  },
}));
vi.mock("../../apps/web/src/csv-import", () => ({
  CsvImportDialog: ({ onDone }: { onDone: (o: unknown) => void }) => (
    <button type="button" onClick={() => onDone({ delimiter: "," })}>
      Import these rows
    </button>
  ),
}));
vi.mock("../../apps/web/src/storage", () => ({
  storage: { open: async () => hoisted.opened },
}));

import { ImportButton } from "../../apps/web/src/home/ImportButton";
import { MarpPicturesDialog } from "../../apps/web/src/home/MarpPicturesDialog";

function file(path: string, text = "x") {
  const name = path.split("/").pop()!;
  const made = new File([text], name);
  Object.defineProperty(made, "webkitRelativePath", { value: path.includes("/") ? path : "" });
  return made;
}
const marp = (body = "# Hello") => `---\nmarp: true\n---\n${body}\n`;

function setup(extra: Partial<Parameters<typeof ImportButton>[0]> = {}) {
  const onImport = vi.fn<(record: { file: SuiteFile }, name?: string) => Promise<void>>(async () => {});
  const onError = vi.fn();
  const importer = { current: null as null | ((f: File) => Promise<void>) };
  const utils = render(<ImportButton onImport={onImport} onError={onError} importer={importer} {...extra} />);
  const [picker, folderPicker] = utils.container.querySelectorAll<HTMLInputElement>('input[type="file"]');
  return { onImport, onError, importer, picker: picker!, folderPicker: folderPicker!, ...utils };
}
const choose = (input: HTMLInputElement, files: File[]) =>
  act(async () => {
    fireEvent.change(input, { target: { files } });
  });
/** Starts an import that waits on the person, without waiting for it to finish. */
const start = (input: HTMLInputElement, files: File[]) =>
  fireEvent.change(input, { target: { files } });

beforeEach(() => {
  hoisted.calls = [];
  hoisted.convert = null;
  hoisted.opened = null;
});
afterEach(() => {
  cleanup();
  delete window.suiteleaf;
  delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
});

describe("ImportButton", () => {
  it("opens and closes its menu", () => {
    setup();
    const button = screen.getByRole("button", { name: "Import" });
    fireEvent.click(button);
    expect(screen.getByRole("dialog", { name: "Import" })).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole("dialog", { name: "Import" }));
    expect(screen.getByRole("dialog", { name: "Import" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "a" });
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog", { name: "Import" })).toBeNull();
    fireEvent.click(button);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Import" })).toBeNull();
  });

  it("opens one chosen file, and keeps a batch on this page", async () => {
    const keepImported = vi.fn(async () => {});
    const onBatchDone = vi.fn();
    const { onImport, picker, importer } = setup({ keepImported, onBatchDone });
    const click = vi.spyOn(picker, "click");
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    fireEvent.click(screen.getByRole("button", { name: /Open \/ import/ }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    await choose(picker, []);
    expect(onImport).not.toHaveBeenCalled();
    await choose(picker, [file("Notes.docx")]);
    expect(onImport).toHaveBeenCalledWith({ file: expect.objectContaining({ title: "Notes" }) }, "Notes.docx");
    await choose(picker, [file("A.docx"), file("B.xlsx")]);
    expect(keepImported).toHaveBeenCalledTimes(2);
    expect(onBatchDone).toHaveBeenCalledTimes(1);
    await act(() => importer.current!(file("C.docx")));
    expect(onImport).toHaveBeenLastCalledWith({ file: expect.objectContaining({ title: "C" }) }, "C.docx");
  });

  it("sends a batch to the opener when nothing keeps it here, and reports failures", async () => {
    const { onImport, onError, picker } = setup();
    await choose(picker, [file("A.docx"), file("B.docx")]);
    expect(onImport).toHaveBeenCalledTimes(2);
    hoisted.convert = async () => {
      throw new Error("That file is damaged.");
    };
    await choose(picker, [file("A.docx"), file("B.docx")]);
    expect(onError).toHaveBeenCalledWith("That file is damaged.");
    await choose(picker, [file("A.docx")]);
    expect(onError).toHaveBeenCalledTimes(2);
    hoisted.convert = async () => null;
    await choose(picker, [file("A.docx")]);
    expect(onImport).toHaveBeenCalledTimes(2);
  });

  it("asks how to read a CSV before importing it", async () => {
    let options: unknown;
    hoisted.convert = async (f, review) => {
      options = await review({ rows: [] });
      return createFile("sheet", f.name);
    };
    const { onImport, picker } = setup();
    start(picker, [file("rows.csv")]);
    fireEvent.click(await screen.findByRole("button", { name: "Import these rows" }));
    await waitFor(() => expect(onImport).toHaveBeenCalled());
    expect(options).toEqual({ delimiter: "," });
    expect(screen.queryByRole("button", { name: "Import these rows" })).toBeNull();
  });

  it("stops a long import when asked", async () => {
    let release = () => {};
    hoisted.convert = () =>
      new Promise((resolve) => {
        release = () => resolve(createFile("doc", "Big"));
      });
    const { picker } = setup();
    start(picker, [file("Big.docx")]);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel import" }));
    expect(hoisted.calls[0]!.shouldStop()).toBe(true);
    expect(screen.getByRole("button", { name: "Importing…" })).toBeTruthy();
    await act(async () => release());
    expect(screen.getByRole("button", { name: "Import" })).toBeTruthy();
  });

  it("asks for a deck's pictures, and skips or cancels", async () => {
    const { onImport, picker } = setup();
    start(picker, [file("deck.md", marp("![](img/a.png)"))]);
    const dialog = await screen.findByRole("dialog", { name: "Include pictures" });
    expect(dialog.textContent).toContain("deck.md uses 1 file stored next to the markdown, such as img/a.png.");
    fireEvent.click(screen.getByRole("button", { name: "Import without pictures" }));
    await waitFor(() => expect(onImport).toHaveBeenCalled());
    expect(hoisted.calls[0]!.assets).toBeUndefined();
    start(picker, [file("deck.markdown", marp("![](a.png) ![](b.png)"))]);
    const second = await screen.findByRole("dialog", { name: "Include pictures" });
    expect(second.textContent).toContain("uses 2 files");
    fireEvent.click(within(second).getByRole("button", { name: "Cancel import" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Include pictures" })).toBeNull());
    expect(hoisted.calls).toHaveLength(1);
    await choose(picker, [file("plain.md", "# No pictures")]);
    expect(hoisted.calls.at(-1)!.name).toBe("plain.md");
  });

  it("imports a deck's pictures from the folder chosen in the dialog", async () => {
    const { onImport, picker } = setup();
    start(picker, [file("deck.md", marp("![](img/a.png)"))]);
    await screen.findByRole("dialog", { name: "Include pictures" });
    const folderInput = document.querySelectorAll<HTMLInputElement>(".gdocs-dialog input[type=file]")[0]!;
    await choose(folderInput, [
      file("deck/deck.md", marp("![](img/a.png)")),
      file("deck/img/a.png", "png"),
    ]);
    await waitFor(() => expect(onImport).toHaveBeenCalled());
    expect(Object.keys(hoisted.calls[0]!.assets as object)).toEqual(["img/a.png"]);
  });

  it("opens a MARP deck from a chosen folder", async () => {
    const { onImport, folderPicker } = setup();
    const click = vi.spyOn(folderPicker, "click");
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    fireEvent.click(screen.getByRole("button", { name: /Open folder/ }));
    expect(click).toHaveBeenCalled();
    await choose(folderPicker, []);
    await choose(folderPicker, [
      file("talk/talk.md", marp("![](pic.png)")),
      file("talk/pic.png", "png"),
      file("talk/notes.md", "plain notes"),
    ]);
    expect(onImport).toHaveBeenCalledWith({ file: expect.any(Object) }, "talk.md");
    expect(Object.keys(hoisted.calls[0]!.assets as object)).toEqual(["pic.png"]);
  });

  it("asks which deck to open when a folder has several", async () => {
    const { onImport, folderPicker } = setup();
    start(folderPicker, [file("talks/one.md", marp()), file("talks/two.md", marp())]);
    const dialog = await screen.findByRole("dialog", { name: "Which presentation?" });
    fireEvent.click(screen.getByRole("button", { name: "two.md" }));
    await waitFor(() => expect(onImport).toHaveBeenCalledWith(expect.anything(), "two.md"));
    expect(dialog.isConnected).toBe(false);
    start(folderPicker, [file("talks/one.md", marp()), file("talks/two.md", marp())]);
    fireEvent.keyDown(await screen.findByRole("dialog", { name: "Which presentation?" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Which presentation?" })).toBeNull());
    start(folderPicker, [file("talks/one.md", marp()), file("talks/two.md", marp())]);
    const third = await screen.findByRole("dialog", { name: "Which presentation?" });
    fireEvent.click(within(third).getByRole("button", { name: "Cancel import" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Which presentation?" })).toBeNull());
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it("imports Office files from a folder, or says there is nothing to import", async () => {
    const placeInFolder = vi.fn(async (f: SuiteFile) => ({ file: f, path: "/docs/x" }));
    const { onImport, onError, folderPicker } = setup({ placeInFolder });
    await choose(folderPicker, [file("work/report.docx")]);
    expect(placeInFolder).toHaveBeenCalledWith(expect.any(Object), "work");
    expect(onImport).toHaveBeenCalledWith(expect.objectContaining({ path: "/docs/x" }), "report.docx");
    await choose(folderPicker, [file("work/a.docx"), file("work/sub/b.xlsx")]);
    expect(placeInFolder).toHaveBeenLastCalledWith(expect.any(Object), "work/sub");
    expect(onImport).toHaveBeenCalledTimes(1);
    hoisted.convert = async () => null;
    await choose(folderPicker, [file("work/c.docx")]);
    expect(placeInFolder).toHaveBeenCalledTimes(3);
    await choose(folderPicker, [file("pics/a.png")]);
    expect(onError).toHaveBeenCalledWith("That folder has no markdown file.");
  });

  it("keeps Office files from a folder when nothing files them on disk", async () => {
    const keepImported = vi.fn(async () => {});
    const { onImport, folderPicker } = setup({ keepImported });
    await choose(folderPicker, [file("work/a.docx"), file("work/b.docx")]);
    expect(keepImported).toHaveBeenCalledTimes(2);
    await choose(folderPicker, [file("work/a.docx")]);
    expect(onImport).toHaveBeenCalledTimes(1);
    cleanup();
    const bare = setup();
    await choose(bare.folderPicker, [file("work/a.docx"), file("work/b.docx")]);
    expect(bare.onImport).toHaveBeenCalledTimes(2);
  });

  it("asks how to read a table found in a folder or a deck", async () => {
    hoisted.convert = async (f, review) => {
      await review({ rows: [] });
      return createFile("sheet", f.name);
    };
    const { onImport, folderPicker } = setup();
    start(folderPicker, [file("work/rows.xlsx")]);
    fireEvent.click(await screen.findByRole("button", { name: "Import these rows" }));
    await waitFor(() => expect(onImport).toHaveBeenCalledWith(expect.anything(), "rows.xlsx"));
    start(folderPicker, [file("talk/talk.md", marp())]);
    fireEvent.click(await screen.findByRole("button", { name: "Import these rows" }));
    await waitFor(() => expect(onImport).toHaveBeenCalledWith(expect.anything(), "talk.md"));
  });

  it("stops between the Office files of a folder", async () => {
    let release = () => {};
    hoisted.convert = () =>
      new Promise((resolve) => {
        release = () => resolve(createFile("doc", "A"));
      });
    const { onError, folderPicker } = setup();
    start(folderPicker, [file("work/a.docx"), file("work/b.docx")]);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel import" }));
    await act(async () => release());
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith("Import cancelled. The original file is unchanged."),
    );
  });

  it("opens with the desktop file dialog and still offers the converter", async () => {
    const opened = { file: createFile("doc", "Desk"), path: "/docs/Desk.sldoc" };
    hoisted.opened = opened;
    window.suiteleaf = {} as never;
    const { onImport, onError, picker } = setup();
    const click = vi.spyOn(picker, "click");
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    fireEvent.click(screen.getByRole("button", { name: /Open \/ import/ }));
    await waitFor(() => expect(onImport).toHaveBeenCalledWith(opened));
    hoisted.opened = null;
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    fireEvent.click(screen.getByRole("button", { name: /Open \/ import/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Import" })).toBeTruthy());
    expect(onImport).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    fireEvent.click(screen.getByRole("button", { name: "Import Office / HTML / CSV" }));
    expect(click).toHaveBeenCalled();
    hoisted.opened = Promise.reject(new Error("Disk unavailable."));
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    fireEvent.click(screen.getByRole("button", { name: /Open \/ import/ }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("Disk unavailable."));
  });

  describe("dropping", () => {
    type Entry = {
      name: string;
      isFile: boolean;
      isDirectory: boolean;
      file?: (ok: (f: File) => void) => void;
      createReader?: () => { readEntries: (ok: (batch: Entry[]) => void) => void };
    };
    const fileEntry = (f: File): Entry => ({
      name: f.name,
      isFile: true,
      isDirectory: false,
      file: (ok) => ok(f),
    });
    const dirEntry = (name: string, children: Entry[]): Entry => ({
      name,
      isFile: false,
      isDirectory: true,
      createReader: () => {
        const batches = [children, []];
        return { readEntries: (ok) => ok(batches.shift() ?? []) };
      },
    });
    const drop = (target: Element, entries: (Entry | null)[], files: File[] = []) =>
      act(async () => {
        fireEvent.drop(target, {
          dataTransfer: {
            items: entries.map((entry) => ({ webkitGetAsEntry: () => entry })),
            files,
          },
        });
      });
    const zone = () => {
      if (!screen.queryByText("Drop a file or folder"))
        fireEvent.click(screen.getByRole("button", { name: "Import" }));
      return screen.getByText("Drop a file or folder");
    };

    it("highlights while something is dragged over it", () => {
      setup();
      const area = zone();
      fireEvent.dragOver(area);
      expect(area.className).toContain("over");
      const leave = (to: Node) => {
        const event = createEvent.dragLeave(area);
        Object.defineProperty(event, "relatedTarget", { value: to });
        fireEvent(area, event);
      };
      leave(area);
      expect(area.className).toContain("over");
      leave(document.body);
      expect(area.className).not.toContain("over");
    });

    it("opens one dropped file and keeps several", async () => {
      const keepImported = vi.fn(async () => {});
      const onBatchDone = vi.fn();
      const { onImport } = setup({ keepImported, onBatchDone });
      await drop(zone(), [fileEntry(file("One.docx"))]);
      expect(onImport).toHaveBeenCalledWith(expect.anything(), "One.docx");
      expect(onBatchDone).not.toHaveBeenCalled();
      await drop(zone(), [fileEntry(file("A.docx")), fileEntry(file("B.docx")), null]);
      expect(keepImported).toHaveBeenCalledTimes(2);
      expect(onBatchDone).toHaveBeenCalledTimes(1);
      await drop(zone(), [], [file("Loose.docx")]);
      expect(onImport).toHaveBeenLastCalledWith(expect.anything(), "Loose.docx");
      await drop(zone(), [{ name: "odd", isFile: false, isDirectory: false }]);
      expect(onBatchDone).toHaveBeenCalledTimes(2);
    });

    it("reads dropped folders, nested ones included", async () => {
      const placeInFolder = vi.fn<(file: SuiteFile, folder: string) => Promise<void>>(async () => {});
      const onBatchDone = vi.fn();
      const { onImport, onError } = setup({ placeInFolder, onBatchDone });
      await drop(zone(), [
        dirEntry("talk", [fileEntry(file("talk.md", marp())), dirEntry("img", [fileEntry(file("a.png"))])]),
      ]);
      expect(onImport).toHaveBeenCalledWith(expect.anything(), "talk.md");
      expect(onBatchDone).not.toHaveBeenCalled();
      await drop(zone(), [
        dirEntry("work", [fileEntry(file("a.docx")), dirEntry("sub", [fileEntry(file("b.docx"))])]),
      ]);
      expect(placeInFolder.mock.calls.map((call) => call[1])).toEqual(["work", "work/sub"]);
      expect(onBatchDone).toHaveBeenCalledTimes(1);
      await drop(zone(), [dirEntry("talk", [fileEntry(file("talk.md", marp()))]), fileEntry(file("x.docx"))]);
      expect(onImport.mock.calls.slice(1).map((call) => call[1])).toEqual(["x.docx", "talk.md"]);
      await drop(zone(), [dirEntry("empty", [fileEntry(file("a.png"))])]);
      expect(onError).toHaveBeenCalledWith("That folder has no markdown file.");
    });

    it("keeps a deck from a batch of dropped folders", async () => {
      const keepImported = vi.fn(async () => {});
      const { onImport } = setup({ keepImported });
      await drop(zone(), [
        dirEntry("one", [fileEntry(file("one.md", marp()))]),
        dirEntry("two", [fileEntry(file("two.md", marp()))]),
      ]);
      expect(keepImported).toHaveBeenCalledTimes(2);
      expect(onImport).not.toHaveBeenCalled();
      cleanup();
      const bare = setup();
      await drop(zone(), [
        dirEntry("one", [fileEntry(file("one.md", marp()))]),
        dirEntry("two", [fileEntry(file("two.md", marp()))]),
      ]);
      expect(bare.onImport).toHaveBeenCalledTimes(2);
      hoisted.convert = async () => null;
      await drop(zone(), [dirEntry("one", [fileEntry(file("one.md", marp()))])]);
      expect(bare.onImport).toHaveBeenCalledTimes(2);
    });
  });
});

describe("MarpPicturesDialog", () => {
  const deck = marp("![](img/a.png)");
  const open = (markdown = deck, paths = ["img/a.png"]) => {
    const onDone = vi.fn();
    const utils = render(<MarpPicturesDialog markdown={markdown} name="deck.md" paths={paths} onDone={onDone} />);
    const input = utils.container.querySelector<HTMLInputElement>("input[type=file]")!;
    return { onDone, input };
  };

  it("cancels from the overlay, Escape or the close button", () => {
    const { onDone } = open();
    fireEvent.click(screen.getByRole("dialog"));
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel import" }));
    fireEvent.click(document.querySelector(".modal-overlay")!);
    expect(onDone.mock.calls).toEqual([["cancel"], ["cancel"], ["cancel"]]);
  });

  it("explains a folder without the pictures, then accepts the right one", async () => {
    const { onDone, input } = open();
    const click = vi.spyOn(input, "click");
    fireEvent.click(screen.getByRole("button", { name: /Choose folder/ }));
    expect(click).toHaveBeenCalled();
    await choose(input, []);
    await choose(input, [file("other/deck.md", deck), file("other/b.png")]);
    expect((await screen.findByRole("alert")).textContent).toContain("None of those assets were in that folder.");
    await choose(input, [file("deck/deck.md", deck), file("deck/img/a.png", "png")]);
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ "img/a.png": expect.stringMatching(/^data:image\/png/) }));
  });

  it("finds the deck among copies and refuses an ambiguous folder", async () => {
    const { onDone, input } = open();
    await choose(input, [
      file("root/a/deck.md", deck),
      file("root/b/deck.md", deck),
      file("root/a/img/a.png"),
    ]);
    expect((await screen.findByRole("alert")).textContent).toContain("more than one copy of this deck");
    await choose(input, [
      file("root/a/deck.md", deck),
      file("root/b/deck.md", "different"),
      file("root/a/img/a.png"),
    ]);
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ "img/a.png": expect.any(String) }));
  });

  it("asks for a missing theme and keeps the pictures already chosen", async () => {
    const themed = `---\nmarp: true\ntheme: garden\n---\n![](img/a.png)\n`;
    const { onDone, input } = open(themed, ["img/a.png", "garden.css"]);
    await choose(input, [file("deck/deck.md", themed), file("deck/img/a.png")]);
    expect((await screen.findByRole("alert")).textContent).toContain("The garden theme was not in that selection.");
    await choose(input, [file("themes/garden.css", "/* @theme garden */ section { color: green; }")]);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(Object.keys(onDone.mock.calls[0]![0]).sort()).toEqual(["garden.css", "img/a.png"]);
  });

  it("uses the directory picker when the browser has one", async () => {
    const listing = (files: Record<string, File>) => ({
      async *entries() {
        for (const [name, f] of Object.entries(files)) yield [name, { kind: "file", getFile: async () => f }];
      },
    });
    const picker = vi.fn();
    (window as { showDirectoryPicker?: unknown }).showDirectoryPicker = picker;
    const { onDone } = open();
    picker.mockRejectedValueOnce(new DOMException("closed", "AbortError"));
    fireEvent.click(screen.getByRole("button", { name: /Choose folder/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Choose folder/ })).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
    picker.mockRejectedValueOnce(new Error("Permission denied."));
    fireEvent.click(screen.getByRole("button", { name: /Choose folder/ }));
    expect((await screen.findByRole("alert")).textContent).toBe("Permission denied.");
    picker.mockRejectedValueOnce("odd");
    fireEvent.click(screen.getByRole("button", { name: /Choose folder/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Could not read that folder."));
    picker.mockResolvedValueOnce(listing({ "deck.md": file("deck.md", deck) }));
    fireEvent.click(screen.getByRole("button", { name: /Choose folder/ }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("None of those assets"));
    expect(onDone).not.toHaveBeenCalled();
  });
});
