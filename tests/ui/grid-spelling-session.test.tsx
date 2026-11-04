// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { IUndoRedoService } from "@univerjs/core";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SheetSpelling,
  SlideSpellMirror,
  SlideSpelling,
  type SpellingHandle,
} from "../../apps/web/src/editors/grid-spelling-ui";
import { readIgnoredCells, readIgnoredWords } from "../../apps/web/src/editors/grid-spelling";
import { readPersonalDictionary } from "../../apps/web/src/editors/doc-spelling";
import { memoryStorage } from "./other-editors-env";

/** Univer measures text on a canvas, which jsdom does not have: 7px a character, one line per cell. */
vi.mock("@univerjs/engine-render", async (original) => ({
  ...(await original<typeof import("@univerjs/engine-render")>()),
  DocSimpleSkeleton: class {
    constructor(private text: string) {}
    calculate() {
      return [{ text: this.text, width: this.text.length * 7, height: 16, baseline: 12 }];
    }
  },
  FontCache: { getMeasureText: (value: string) => ({ width: value.length * 7 }) },
}));

beforeEach(() => {
  memoryStorage();
  vi.stubGlobal("requestAnimationFrame", (done: FrameRequestCallback) => {
    done(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

type CellData = { v?: unknown; f?: string } | null;

function fakeBook(rows: CellData[][], sheetName = "Sheet1") {
  const cells = rows.map((row) => [...row]);
  const listeners: ((command: { id?: string }) => void)[] = [];
  const activated: [number, number][] = [];
  const scrolled: [number, number][] = [];
  const undoGroups: string[] = [];
  const sheet = {
    getSheetId: () => "s1",
    getSheetName: () => sheetName,
    getDataRange: () => ({
      getRange: () => ({ startRow: 0, startColumn: 0 }),
      getCellDatas: () => cells,
    }),
    getVisibleRange: () => ({ startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 }),
    scrollToCell: (row: number, column: number) => scrolled.push([row, column]),
    getFreeze: () => ({}),
    getScrollState: () => ({}),
    getRange: (row: number, column: number) => ({
      activate: () => activated.push([row, column]),
      getCellData: () => cells[row]?.[column] ?? null,
      setValue: (value: string) => {
        (cells[row] ??= [])[column] = { v: value };
      },
      setValues: (matrix: Record<number, Record<number, string>>) => {
        for (const [r, columns] of Object.entries(matrix))
          for (const [c, value] of Object.entries(columns)) (cells[Number(r)] ??= [])[Number(c)] = { v: value };
      },
      getCellRect: () => ({
        toJSON: () => JSON.stringify({ left: 50 + column * 200, top: 40 + row * 30, width: 200, height: 30 }),
      }),
      getCellStyleData: () => ({}),
    }),
  };
  const other = { ...sheet, getSheetId: () => "s2" };
  let active: typeof sheet = sheet;
  const book = {
    getId: () => "wb",
    getSheets: () => [sheet],
    getActiveSheet: () => active,
    setActiveSheet: (next: typeof sheet) => {
      active = next;
    },
    getSheetBySheetId: (id: string) => (id === "s1" ? sheet : id === "s2" ? other : null),
    onCommandExecuted: (listener: (command: { id?: string }) => void) => {
      listeners.push(listener);
      return { dispose: () => listeners.splice(listeners.indexOf(listener), 1) };
    },
  };
  const engine = {
    get: (token: unknown) =>
      token === IUndoRedoService
        ? {
            beginUndoRedoGroup: (_unit: string, name: string) => {
              undoGroups.push(name);
              return { dispose: () => {} };
            },
          }
        : null,
  };
  return {
    book,
    engine,
    cells,
    activated,
    scrolled,
    undoGroups,
    showOther: () => (active = other),
    edited: () => listeners.forEach((listener) => listener({ id: "sheet.mutation.set-range-values" })),
  };
}

function openSheetSpelling(rows: CellData[][], props: { ready?: boolean } = {}) {
  const fake = fakeBook(rows);
  const host = document.createElement("div");
  const canvas = document.createElement("canvas");
  canvas.getBoundingClientRect = () => new DOMRect(0, 0, 900, 600);
  host.append(canvas);
  document.body.append(host);
  const ref = createRef<SpellingHandle>();
  const persist = vi.fn();
  render(
    <SheetSpelling
      bookRef={{ current: fake.book }}
      hostRef={{ current: host }}
      engineRef={{ current: fake.engine }}
      fileId="budget"
      ready={props.ready ?? true}
      persist={persist}
      ref={ref}
    />,
  );
  const open = () => act(() => ref.current!.open());
  return { ...fake, host, ref, persist, open };
}

const progress = () => document.querySelector(".spelling-progress")?.textContent ?? "";

describe("checking a spreadsheet", () => {
  it("underlines misspelled text cells but leaves formulas alone", () => {
    openSheetSpelling([[{ v: "I recieve it" }, { v: "=seperate", f: "=seperate" }]]);
    const marks = [...document.querySelectorAll<HTMLElement>(".sheet-spell-mark")];
    expect(marks.map((mark) => mark.dataset.spellWord)).toEqual(["recieve"]);
    expect(marks[0].dataset.spellCell).toBe("A1");
    expect(marks[0].style.left).toBe(`${50 + 2 + 2 * 7}px`);
  });

  it("walks through each word: change, ignore, add, then finishes", () => {
    const view = openSheetSpelling([[{ v: "I recieve it" }, { v: "seperate zxqv" }], [{ v: "definately" }]]);
    view.open();
    expect(progress()).toBe("1 of 4 · A1 · recieve → receive");
    expect(view.activated.at(-1)).toEqual([0, 0]);
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(view.cells[0][0]).toEqual({ v: "I receive it" });
    expect(view.persist).toHaveBeenCalledTimes(1);
    expect(progress()).toBe("1 of 3 · B1 · seperate → separate");
    fireEvent.click(screen.getByRole("button", { name: "Ignore" }));
    expect(readIgnoredWords("budget")).toEqual(["seperate"]);
    expect(progress()).toBe("1 of 2 · B1 · zxqv → …");
    expect(screen.getByText(/No suggestion/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Add to dictionary" }));
    expect(readPersonalDictionary().added).toContain("zxqv");
    expect(progress()).toMatch(/^1 of 1 · A2 · definately → /);
    expect(view.scrolled).toEqual([]);
    fireEvent.submit(screen.getByRole("dialog"));
    expect(progress()).toBe("Spelling check finished");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says when there was nothing to check, and closes with Escape", () => {
    const view = openSheetSpelling([[{ v: "All fine here" }]]);
    view.open();
    expect(progress()).toBe("No spelling issues");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("scrolls to a word outside the visible cells, and switches to its sheet", () => {
    const view = openSheetSpelling([[null, null, null], [null, null, { v: "recieve" }]]);
    view.showOther();
    view.open();
    expect(view.book.getActiveSheet().getSheetId()).toBe("s1");
    expect(view.scrolled).toEqual([[1, 1]]);
  });

  it("does not overwrite a cell that changed since it was checked", () => {
    const view = openSheetSpelling([[{ v: "I recieve it" }]]);
    view.open();
    view.cells[0][0] = { v: "Something else" };
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(view.cells[0][0]).toEqual({ v: "Something else" });
    expect(view.persist).not.toHaveBeenCalled();
  });

  it("previews Change all, lists every cell, and writes them as one undo step", () => {
    const view = openSheetSpelling([[{ v: "recieve one" }, { v: "Recieve two recieve" }]]);
    view.open();
    fireEvent.click(screen.getByRole("button", { name: "Change all" }));
    const dialog = screen.getByRole("dialog", { name: "Change all to receive" });
    expect(within(dialog).getByText("2 cells will change")).toBeTruthy();
    expect([...dialog.querySelectorAll("mark")].map((mark) => mark.textContent)).toEqual(["recieve", "Recieve", "recieve"]);
    expect(document.querySelectorAll(".sheet-spell-preview")).toHaveLength(2);
    fireEvent.click(within(dialog).getByRole("button", { name: /B1/ }));
    expect(view.activated.at(-1)).toEqual([0, 1]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Change all" }));
    expect(view.cells[0]).toEqual([{ v: "receive one" }, { v: "Receive two receive" }]);
    expect(view.undoGroups).toHaveLength(1);
    expect(view.persist).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "Change all to receive" })).toBeNull();
  });

  it("cancels Change all with Escape or the close button", () => {
    const view = openSheetSpelling([[{ v: "recieve" }, { v: "recieve" }]]);
    view.open();
    fireEvent.click(screen.getByRole("button", { name: "Change all" }));
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Change all to receive" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Change all to receive" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Change all" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel change all" }));
    expect(screen.getByRole("dialog", { name: "Spelling" })).toBeTruthy();
    expect(view.cells[0]).toEqual([{ v: "recieve" }, { v: "recieve" }]);
  });

  it("rescans shortly after a cell is edited, but not for formula results", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const view = openSheetSpelling([[{ v: "fine" }]]);
      expect(document.querySelectorAll(".sheet-spell-mark")).toHaveLength(0);
      view.cells[0][0] = { v: "recieve" };
      act(() => view.edited());
      act(() => vi.advanceTimersByTime(100));
      expect(document.querySelectorAll(".sheet-spell-mark")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays quiet until the grid is ready", () => {
    openSheetSpelling([[{ v: "recieve" }]], { ready: false });
    expect(document.querySelectorAll(".sheet-spell-mark")).toHaveLength(0);
  });
});

describe("the right-click menu on an underlined word", () => {
  function rightClick(target: EventTarget = window) {
    const down = new MouseEvent("pointerdown", { button: 2, clientX: 0, clientY: 0, bubbles: true, cancelable: true });
    Object.defineProperty(down, "button", { value: 2 });
    target.dispatchEvent(down);
    const menu = new MouseEvent("contextmenu", { clientX: 0, clientY: 0, bubbles: true, cancelable: true });
    act(() => {
      target.dispatchEvent(menu);
    });
    return { down, menu };
  }

  it("offers suggestions and replaces the word from the menu", () => {
    const view = openSheetSpelling([[{ v: "I recieve it" }]]);
    const { menu } = rightClick();
    expect(menu.defaultPrevented).toBe(true);
    const list = screen.getByRole("menu", { name: "Spelling for recieve" });
    expect(within(list).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "receive",
      "Change all to receive",
      "Ignore",
      "Ignore this cell",
      "Add to dictionary",
    ]);
    fireEvent.click(within(list).getByRole("menuitem", { name: "receive" }));
    expect(view.cells[0][0]).toEqual({ v: "I receive it" });
    expect(view.persist).toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("ignores the word, the cell, or adds it to the dictionary", () => {
    openSheetSpelling([[{ v: "recieve" }, { v: "recieve" }, { v: "seperate" }]]);
    rightClick();
    fireEvent.click(screen.getByRole("menuitem", { name: "Ignore this cell" }));
    expect(readIgnoredCells("budget")).toEqual([{ sheetId: "s1", row: 0, column: 0, word: "recieve" }]);
    expect(document.querySelectorAll(".sheet-spell-mark")).toHaveLength(2);
    rightClick();
    expect(screen.getByRole("menu").getAttribute("aria-label")).toBe("Spelling for recieve");
    fireEvent.click(screen.getByRole("menuitem", { name: "Ignore" }));
    expect(readIgnoredWords("budget")).toEqual(["recieve"]);
    rightClick();
    fireEvent.click(screen.getByRole("menuitem", { name: "Add to dictionary" }));
    expect(readPersonalDictionary().added).toContain("seperate");
    expect(document.querySelectorAll(".sheet-spell-mark")).toHaveLength(0);
  });

  it("opens Change all from the menu", () => {
    openSheetSpelling([[{ v: "recieve" }, { v: "recieve" }]]);
    rightClick();
    fireEvent.click(screen.getByRole("menuitem", { name: "Change all to receive" }));
    expect(screen.getByRole("dialog", { name: "Change all to receive" })).toBeTruthy();
  });

  it("moves through the menu with the arrow keys and closes on Escape or outside", () => {
    openSheetSpelling([[{ v: "recieve" }]]);
    rightClick();
    const list = screen.getByRole("menu");
    const items = within(list).getAllByRole("menuitem");
    items[0].focus();
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(list, { key: "ArrowUp" });
    fireEvent.keyDown(list, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items.at(-1));
    fireEvent.keyDown(list, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    rightClick();
    const backdrop = document.querySelector(".context-menu-backdrop")!;
    fireEvent.mouseDown(screen.getByRole("menu"));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.mouseDown(backdrop, { button: 2 });
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.mouseDown(backdrop, { button: 0 });
    expect(screen.queryByRole("menu")).toBeNull();
    rightClick();
    fireEvent.contextMenu(document.querySelector(".context-menu-backdrop")!, { clientX: 500, clientY: 500 });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("says when there is no suggestion", () => {
    openSheetSpelling([[{ v: "zxqv" }]]);
    rightClick();
    expect(screen.getByText("No suggestions").getAttribute("aria-disabled")).toBe("true");
  });

  it("leaves the grid's own menu alone in a text field, the menu, or a locked view", () => {
    const view = openSheetSpelling([[{ v: "recieve" }]]);
    const field = document.createElement("input");
    document.body.append(field);
    expect(rightClick(field).menu.defaultPrevented).toBe(false);
    view.host.classList.add("view-locked");
    expect(rightClick().menu.defaultPrevented).toBe(false);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes when its word is fixed elsewhere", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const view = openSheetSpelling([[{ v: "recieve" }]]);
      rightClick();
      expect(screen.getByRole("menu")).toBeTruthy();
      view.cells[0][0] = { v: "receive" };
      act(() => view.edited());
      act(() => vi.advanceTimersByTime(100));
      expect(screen.queryByRole("menu")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("checking a presentation", () => {
  const deck = () => ({
    slideOrder: ["a", "b"],
    slides: {
      a: { elements: [{ id: "t1", type: "text", content: "We recieve" }, { id: "pic", type: "image" }] },
      b: { elements: [{ id: "t2", type: "text", content: "seperate notes" }] },
    },
  });

  function openSlides(current = deck()) {
    const ref = createRef<SpellingHandle>();
    const onFocus = vi.fn();
    const onReplace = vi.fn();
    const view = render(<SlideSpelling deck={current} fileId="talk" onFocus={onFocus} onReplace={onReplace} ref={ref} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => ref.current!.open());
    return { ...view, ref, onFocus, onReplace };
  }

  it("goes slide by slide and hands each correction to the deck", () => {
    const { onFocus, onReplace } = openSlides();
    expect(progress()).toBe("1 of 2 · Slide 1 · recieve → receive");
    expect(onFocus).toHaveBeenCalledWith(expect.objectContaining({ slideId: "a", elementId: "t1", word: "recieve" }));
    fireEvent.click(screen.getByRole("button", { name: "receive" }));
    expect(onReplace).toHaveBeenCalledWith(expect.objectContaining({ word: "recieve" }), "receive");
    fireEvent.click(screen.getByRole("button", { name: "Ignore" }));
    expect(readIgnoredWords("talk")).toEqual(["recieve"]);
    expect(progress()).toBe("1 of 1 · Slide 2 · seperate → separate");
    fireEvent.click(screen.getByRole("button", { name: "Add to dictionary" }));
    expect(readPersonalDictionary().added).toContain("seperate");
    expect(progress()).toBe("Spelling check finished");
    fireEvent.click(screen.getByRole("button", { name: "Close spelling" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not replace a word whose text box changed", () => {
    const current = deck();
    const { onReplace } = openSlides(current);
    current.slides.a.elements[0].content = "We received";
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(onReplace).not.toHaveBeenCalled();
  });
});

describe("the slide text underline", () => {
  it("marks misspelled words, but not the word being typed", () => {
    const { container, rerender } = render(<SlideSpellMirror text="We recieve seperate" fileId="talk" />);
    expect([...container.querySelectorAll(".spelling-misspelling")].map((node) => node.textContent)).toEqual(["recieve", "seperate"]);
    expect(container.textContent).toBe("We recieve seperate");
    rerender(<SlideSpellMirror text="We recieve seperate" fileId="talk" caret={19} />);
    expect([...container.querySelectorAll(".spelling-misspelling")].map((node) => node.textContent)).toEqual(["recieve"]);
    rerender(<SlideSpellMirror text="All good" fileId="talk" />);
    expect(container.querySelector(".slide-spell-mirror")).toBeNull();
  });
});
