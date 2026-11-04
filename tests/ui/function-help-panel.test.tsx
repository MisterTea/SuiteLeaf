// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  IDescriptionService,
  IEditorBridgeService,
  IEditorService,
  SheetsSelectionsService,
} from "@univerjs/preset-sheets-core";
import { useImperativeHandle, type Ref } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette, MenuSearchPill } from "../../apps/web/src/command-palette";
import { Menu } from "../../apps/web/src/ui";
import { FunctionMenu, useSheetFunctions } from "../../apps/web/src/editors/function-help-ui";
import { memoryStorage } from "./other-editors-env";

beforeEach(() => {
  memoryStorage();
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("the function menu", () => {
  function openMenu(onInsert = vi.fn()) {
    render(
      <CommandPalette kind="sheet">
        <MenuSearchPill />
        <Menu label="Insert">
          <FunctionMenu onInsert={onInsert} />
        </Menu>
      </CommandPalette>,
    );
    const trigger = screen.getByRole("button", { name: "Insert" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    return onInsert;
  }

  it("lists common functions and the categories", async () => {
    openMenu();
    expect(await screen.findByLabelText("Search functions")).toBeTruthy();
    expect(screen.getByText("Common")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "SUM" })).toBeTruthy();
    const categories = screen.getAllByRole("menuitem").filter((item) => item.getAttribute("aria-haspopup") === "menu");
    expect(categories.length).toBeGreaterThan(3);
  });

  it("inserts the first search result on Enter, after the menu closes", async () => {
    const onInsert = openMenu();
    const search = await screen.findByLabelText("Search functions");
    fireEvent.change(search, { target: { value: "vlook" } });
    const first = screen.getAllByRole("menuitem")[0];
    expect(first.textContent).toContain("VLOOKUP");
    expect(first.querySelector("small")?.textContent).not.toBe("");
    fireEvent.keyDown(search, { key: "Enter" });
    await waitFor(() => expect(onInsert).toHaveBeenCalledWith("VLOOKUP"));
  });

  it("says when no function matches, and ignores Enter then", async () => {
    const onInsert = openMenu();
    const search = await screen.findByLabelText("Search functions");
    fireEvent.change(search, { target: { value: "zzzzqq" } });
    expect(screen.getByText("No functions match that.")).toBeTruthy();
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onInsert).not.toHaveBeenCalled();
  });

  it("puts every function in the menu search", async () => {
    const onInsert = vi.fn();
    render(
      <CommandPalette kind="sheet">
        <MenuSearchPill />
        <Menu label="Insert">
          <FunctionMenu onInsert={onInsert} />
        </Menu>
      </CommandPalette>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Menus" }));
    const box = await screen.findByRole("textbox", { name: "Search the menus" });
    fireEvent.change(box, { target: { value: "insert xlookup" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(onInsert).toHaveBeenCalledWith("XLOOKUP"));
  });
});

type Listener<T> = (value: T) => void;
function subject<T>() {
  const listeners = new Set<Listener<T>>();
  return {
    subscribe(listener: Listener<T>) {
      listeners.add(listener);
      return { unsubscribe: () => listeners.delete(listener) };
    },
    next(value: T) {
      listeners.forEach((listener) => listener(value));
    },
    get size() {
      return listeners.size;
    },
  };
}

function fakeEditor(text: string, focused: boolean) {
  const state = { text, caret: text.length, focused };
  return {
    state,
    input$: subject<void>(),
    selectionChange$: subject<void>(),
    isFocus: () => state.focused,
    getDocumentData: () => ({ body: { dataStream: `${state.text}\r\n` } }),
    getSelectionRanges: () => [{ startOffset: state.caret }],
    replaceText: vi.fn((next: string) => {
      state.text = next;
      state.caret = next.length;
    }),
  };
}

type Cell = { value?: unknown; formula?: string };

function fakeSheet(cells: Record<string, Cell>) {
  const written: { row: number; column: number; value: string }[] = [];
  const activated: [number, number][] = [];
  const sheet = {
    filtered: [] as number[],
    getFilter: () => ({ getFilteredOutRows: () => sheet.filtered }),
    getRange: (row: number, column: number) => {
      const cell = cells[`${row},${column}`] ?? {};
      return {
        getFormula: () => cell.formula ?? "",
        getValue: () => cell.value ?? null,
        setValue: (value: string) => {
          written.push({ row, column, value });
          cells[`${row},${column}`] = { formula: value };
        },
        activate: () => activated.push([row, column]),
      };
    },
  };
  return { sheet, written, activated };
}

type Grid = { startRow: number; endRow: number; startColumn: number; endColumn: number };

function setup(options: { cells?: Record<string, Cell>; grid?: Grid | null; values?: unknown[][]; formulaNote?: (text: string) => string; ready?: boolean } = {}) {
  const host = document.createElement("div");
  host.innerHTML =
    '<div data-u-comp="formula-bar"></div><footer><span data-u-comp="status-bar-statistic-picker"></span></footer>';
  document.body.append(host);
  const cell = fakeEditor("", false);
  const bar = fakeEditor("", false);
  const bridge = { visible$: subject<{ visible: boolean }>() };
  const selections = { selectionChanged$: subject<void>() };
  const descriptions = {
    getSearchListByNameFirstLetter: vi.fn<(text: string) => { name: string; desc: string }[]>(() => [{ name: "SUM", desc: "" }]),
    getFunctionInfo: vi.fn(() => undefined),
  };
  const editors = {
    getEditor: (id: string) => (id === "__INTERNAL_EDITOR__DOCS_NORMAL" ? cell : id === "__INTERNAL_EDITOR__DOCS_FORMULA_BAR" ? bar : null),
  };
  const injector = {
    get: (token: unknown) =>
      token === IEditorService
        ? editors
        : token === IEditorBridgeService
          ? bridge
          : token === SheetsSelectionsService
            ? selections
            : token === IDescriptionService
              ? descriptions
              : null,
  };
  const { sheet, written, activated } = fakeSheet(options.cells ?? {});
  const commandListeners: ((command: { id?: string }) => void)[] = [];
  const state = { grid: options.grid === undefined ? { startRow: 0, endRow: 2, startColumn: 0, endColumn: 0 } : options.grid, values: options.values ?? [[1], [2], [3]], throwValues: false };
  const book = {
    getActiveRange: () =>
      state.grid
        ? {
            getRange: () => state.grid,
            getValues: () => {
              if (state.throwValues) throw new Error("not loaded");
              return state.values;
            },
          }
        : null,
    getActiveSheet: () => sheet,
    onCommandExecuted: (listener: (command: { id?: string }) => void) => {
      commandListeners.push(listener);
      return { dispose: vi.fn() };
    },
  };
  const api = { executeCommand: vi.fn(async () => true) };
  const persist = vi.fn();
  const notify = vi.fn();
  const handle: { current: ReturnType<typeof useSheetFunctions> | null } = { current: null };
  const hostRef = { current: host };
  const bookRef = { current: book };
  const apiRef = { current: api };
  const injectorRef = { current: injector };
  function Harness({ handleRef }: { handleRef: Ref<ReturnType<typeof useSheetFunctions>> }) {
    const result = useSheetFunctions({
      ready: options.ready ?? true,
      hostRef,
      bookRef,
      apiRef,
      injectorRef,
      persist,
      notify,
      formulaNote: options.formulaNote,
    });
    useImperativeHandle(handleRef, () => result);
    return (
      <>
        {result.panel}
        {result.stats}
      </>
    );
  }
  render(<Harness handleRef={handle} />);
  return {
    host,
    sheet,
    cell,
    bar,
    bridge,
    selections,
    descriptions,
    state,
    written,
    activated,
    api,
    persist,
    notify,
    handle,
    reselect: () => act(() => selections.selectionChanged$.next()),
    filterCommand: () => act(() => commandListeners.forEach((listener) => listener({ id: "sheet.command.set-filter" }))),
    type: (editor: ReturnType<typeof fakeEditor>, text: string) =>
      act(() => {
        cell.state.focused = false;
        bar.state.focused = false;
        editor.state.text = text;
        editor.state.caret = text.length;
        editor.state.focused = true;
        editor.input$.next();
      }),
  };
}

const helpPanel = () => document.querySelector<HTMLElement>("[data-function-help='panel']");

describe("help while typing a formula", () => {
  it("explains the function and argument under the caret", () => {
    const view = setup();
    act(() => view.bridge.visible$.next({ visible: true }));
    expect(helpPanel()).toBeNull();
    view.type(view.cell, "=SUM(A1, ");
    const panel = helpPanel()!;
    expect(panel.dataset.function).toBe("SUM");
    expect(view.host.querySelector("[data-u-comp='formula-bar']")!.contains(panel)).toBe(true);
    expect(panel.querySelector("[data-current='true']")?.textContent).not.toBe("");
    expect(panel.querySelector("[data-example]")).not.toBeNull();
    view.type(view.bar, "=VLOOKUP(");
    expect(helpPanel()!.dataset.function).toBe("VLOOKUP");
    act(() => view.bridge.visible$.next({ visible: false }));
    expect(helpPanel()).toBeNull();
  });

  it("folds the help away and remembers it, with F1 and Shift+F1 too", () => {
    const view = setup();
    view.type(view.cell, "=AVERAGE(");
    fireEvent.click(screen.getByRole("button", { name: "Hide function help" }));
    expect(helpPanel()!.dataset.collapsed).toBe("true");
    expect(localStorage.getItem("suiteleaf_function_help")).toBe("collapsed");
    fireEvent.keyDown(window, { key: "F1" });
    expect(helpPanel()!.dataset.collapsed).toBe("false");
    fireEvent.keyDown(window, { key: "F1", shiftKey: true });
    expect(helpPanel()!.dataset.collapsed).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Show function help" }));
    expect(helpPanel()!.dataset.collapsed).toBe("false");
    expect(localStorage.getItem("suiteleaf_function_help")).toBeNull();
    fireEvent.mouseDown(helpPanel()!);
  });

  it("leaves F1 alone outside a formula", () => {
    const view = setup();
    view.type(view.cell, "plain words");
    const event = new KeyboardEvent("keydown", { key: "F1", cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(helpPanel()).toBeNull();
  });

  it("notes when a formula reads a table", () => {
    const view = setup({ formulaNote: (text) => (text.includes("Table1") ? "Table1 grows with its rows." : "") });
    view.type(view.cell, "=Table1");
    expect(screen.getByText("Table1 grows with its rows.").getAttribute("role")).toBe("status");
  });

  it("fills blank suggestion descriptions from the curated help", () => {
    const view = setup();
    const list = view.descriptions.getSearchListByNameFirstLetter("S");
    expect(list[0].desc).not.toBe("");
  });

  it("waits until the grid is ready", () => {
    const view = setup({ ready: false });
    expect(view.selections.selectionChanged$.size).toBe(0);
    expect(screen.queryByRole("status", { name: "Selection summary" })).toBeNull();
  });
});

describe("the selection summary", () => {
  it("sums the numbers in the selection and writes an aggregate below it", () => {
    const view = setup({ values: [[1], ["text"], [5]] });
    const summary = screen.getByRole("status", { name: "Selection summary" });
    expect(view.host.querySelector("footer")!.classList.contains("sheet-stats-slot")).toBe(true);
    expect(summary.dataset.insertSide).toBe("below");
    expect(within(summary).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Sum 6Insert below",
      "Average 3Insert below",
      "Min 1Insert below",
      "Max 5Insert below",
      "Count 2Insert below",
    ]);
    fireEvent.click(within(summary).getByText("Max 5"));
    expect(view.written).toEqual([{ row: 3, column: 0, value: "=MAX(A1:A3)" }]);
    expect(view.activated).toEqual([[3, 0]]);
    expect(view.persist).toHaveBeenCalledTimes(1);
  });

  it("offers to insert to the right of a row, and skips filtered-out rows", () => {
    const view = setup({ grid: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 2 }, values: [[2, 4, 6]] });
    expect(screen.getByRole("status", { name: "Selection summary" }).dataset.insertSide).toBe("right");
    expect(screen.getAllByText("Insert to the right")).toHaveLength(5);
    view.state.grid = { startRow: 0, endRow: 2, startColumn: 0, endColumn: 0 };
    view.state.values = [[1], [10], [100]];
    view.reselect();
    expect(screen.getByText("Sum 111")).toBeTruthy();
    expect(screen.getByRole("status", { name: "Selection summary" }).dataset.insertSide).toBe("below");
  });

  it("recounts after a filter hides rows", () => {
    const view = setup({ values: [[1], [10], [100]] });
    expect(screen.getByText("Sum 111")).toBeTruthy();
    view.sheet.filtered = [1];
    view.filterCommand();
    expect(screen.getByText("Sum 101")).toBeTruthy();
  });

  it("hides the summary when nothing numeric is selected or the values cannot be read", () => {
    const view = setup({ values: [["a"]] });
    expect(screen.queryByRole("status", { name: "Selection summary" })).toBeNull();
    view.state.values = [[3]];
    view.reselect();
    expect(screen.getByRole("status", { name: "Selection summary" })).toBeTruthy();
    view.state.throwValues = true;
    view.reselect();
    expect(screen.queryByRole("status", { name: "Selection summary" })).toBeNull();
    view.state.grid = null;
    view.reselect();
    expect(screen.queryByRole("status", { name: "Selection summary" })).toBeNull();
  });

  it("says when there is no empty cell for the aggregate", () => {
    const cells: Record<string, Cell> = {};
    for (let row = 3; row < 60; row++) cells[`${row},0`] = { value: 1 };
    const view = setup({ cells });
    fireEvent.click(screen.getByText("Sum 6"));
    expect(view.notify).toHaveBeenCalledWith("There is no empty cell for that formula.");
    expect(view.written).toEqual([]);
  });
});

describe("AutoSum and inserting a function", () => {
  it("starts =SUM( with the numbers above an empty cell", async () => {
    const view = setup({
      cells: { "0,0": { value: 1 }, "1,0": { value: 2 } },
      grid: { startRow: 2, endRow: 2, startColumn: 0, endColumn: 0 },
    });
    act(() => view.handle.current!.autoSum());
    await waitFor(() => expect(view.cell.replaceText).toHaveBeenCalledWith("=SUM(A1:A2"));
    expect(view.api.executeCommand).toHaveBeenCalledWith("sheet.operation.set-cell-edit-visible", { visible: true, eventType: 3 });
    expect(view.bar.replaceText).toHaveBeenCalledWith("=SUM(A1:A2", false);
  });

  it("leaves a cell that already has a value", () => {
    const view = setup({ cells: { "0,0": { value: 9 } }, grid: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 } });
    act(() => view.handle.current!.autoSum());
    expect(view.notify).toHaveBeenCalledWith("That cell already has a value, so nothing was replaced.");
    const formula = setup({ cells: { "0,0": { formula: "=1" } }, grid: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 } });
    act(() => formula.handle.current!.autoSum());
    expect(formula.notify).toHaveBeenCalledWith("That cell already has a value, so nothing was replaced.");
  });

  it("writes the sum under a range, or says there is no room", () => {
    const view = setup();
    act(() => view.handle.current!.autoSum());
    expect(view.written).toEqual([{ row: 3, column: 0, value: "=SUM(A1:A3)" }]);
    const cells: Record<string, Cell> = {};
    for (let row = 3; row < 60; row++) cells[`${row},0`] = { value: 1 };
    const full = setup({ cells });
    act(() => full.handle.current!.autoSum());
    expect(full.notify).toHaveBeenCalledWith("There is no empty cell for the sum.");
  });

  it("does nothing without a selection", () => {
    const view = setup({ grid: null });
    act(() => view.handle.current!.autoSum());
    expect(view.notify).not.toHaveBeenCalled();
    expect(view.written).toEqual([]);
  });

  it("opens the cell editor on a known function only", async () => {
    const view = setup();
    act(() => view.handle.current!.insertFunction("vlookup"));
    await waitFor(() => expect(view.cell.replaceText).toHaveBeenCalledWith("=VLOOKUP("));
    expect(helpPanel()?.dataset.function).toBe("VLOOKUP");
    view.cell.replaceText.mockClear();
    act(() => view.handle.current!.insertFunction("NOTAFUNCTION"));
    await act(async () => {});
    expect(view.cell.replaceText).not.toHaveBeenCalled();
  });
});
