// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette, MenuSearchPill } from "../../apps/web/src/command-palette";
import { Menu, type EditorActions, type SheetView } from "../../apps/web/src/ui";
import { SheetViewMenu } from "../../apps/web/src/editors/SheetViewMenu";
import { ChartPivotMenu } from "../../apps/web/src/editors/chart-pivot-menu";
import SortRangeDialog from "../../apps/web/src/editors/SortRangeDialog";
import { remapStepColumn } from "../../apps/web/src/editors/query-remap";
import { guardFormulaSuggestions, rankFormulaSuggestions } from "../../apps/web/src/editors/formula-suggestions";
import { memoryStorage } from "./other-editors-env";

beforeEach(() => {
  memoryStorage();
  vi.stubGlobal("innerWidth", 600);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const view = (patch: Partial<SheetView> = {}): SheetView => ({
  frozenRows: 0,
  frozenColumns: 0,
  row: 5,
  column: 5,
  maxFrozenRows: 10,
  maxFrozenColumns: 10,
  gridlines: true,
  formulaBar: true,
  ...patch,
});

function sheetActions(current: SheetView) {
  return {
    view: () => current,
    freezeRows: vi.fn(),
    freezeColumns: vi.fn(),
    showGridlines: vi.fn(),
    showFormulaBar: vi.fn(),
    openSheetList: vi.fn(),
    openComments: vi.fn(),
    toggleFilter: vi.fn(),
  };
}

function openViewMenu(current: SheetView | null) {
  const sheet = current ? sheetActions(current) : null;
  const actions = { current: (sheet ? { sheetActions: sheet } : undefined) as EditorActions | undefined };
  const onPrint = vi.fn();
  render(
    <CommandPalette kind="sheet">
      <MenuSearchPill />
      <Menu label="View">
        <SheetViewMenu actions={actions} onPrint={onPrint} />
      </Menu>
    </CommandPalette>,
  );
  fireEvent.keyDown(screen.getByRole("button", { name: "View" }), { key: "ArrowDown" });
  return { sheet, onPrint };
}

const runFromSearch = async (query: string) => {
  fireEvent.click(screen.getByRole("button", { name: "Menus" }));
  const box = await screen.findByRole("textbox", { name: "Search the menus" });
  fireEvent.change(box, { target: { value: query } });
  fireEvent.keyDown(box, { key: "Enter" });
};

describe("the sheet View menu", () => {
  it("shows and hides gridlines and the formula bar", async () => {
    const { sheet } = openViewMenu(view({ gridlines: false }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Show/ }));
    const gridlines = await screen.findByRole("menuitemcheckbox", { name: /Gridlines/ });
    expect(gridlines.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(gridlines);
    expect(sheet!.showGridlines).toHaveBeenCalledWith(true);
  });

  it("offers freezing up to the active cell and only what fits", async () => {
    openViewMenu(view({ frozenRows: 5, row: 5, column: 3, maxFrozenRows: 6, maxFrozenColumns: 1 }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Freeze/ }));
    const items = await screen.findAllByRole("menuitemcheckbox");
    const byName = (name: string) => items.find((item) => item.textContent?.includes(name))!;
    expect(byName("Up to row 5").getAttribute("aria-checked")).toBe("true");
    expect(byName("Up to column C").hasAttribute("data-disabled")).toBe(true);
    expect(byName("2 columns").hasAttribute("data-disabled")).toBe(true);
    expect(byName("2 columns").getAttribute("title")).toBe("There isn't room to freeze that many.");
    expect(byName("2 rows").getAttribute("title")).toBeNull();
  });

  it("checks columns against the room for columns, not rows", async () => {
    const { sheet } = openViewMenu(view({ maxFrozenRows: 10, maxFrozenColumns: 1 }));
    await screen.findAllByRole("menuitem");
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await runFromSearch("2 columns");
    const box = screen.getByRole("textbox", { name: "Search the menus" });
    expect(sheet!.freezeColumns).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: "2 rows" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(sheet!.freezeRows).toHaveBeenCalledWith(2));
  });

  it("runs the list, comments, print, and filter commands", async () => {
    const { sheet, onPrint } = openViewMenu(view());
    fireEvent.click(await screen.findByRole("menuitem", { name: "Comments" }));
    expect(sheet!.openComments).toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("button", { name: "View" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Print layout" }));
    expect(onPrint).toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("button", { name: "View" }), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Toggle filter" }));
    expect(sheet!.toggleFilter).toHaveBeenCalled();
    await runFromSearch("sheet list");
    await waitFor(() => expect(sheet!.openSheetList).toHaveBeenCalled());
    await runFromSearch("formula bar");
    await waitFor(() => expect(sheet!.showFormulaBar).toHaveBeenCalledWith(false));
    await runFromSearch("up to column");
    await waitFor(() => expect(sheet!.freezeColumns).toHaveBeenCalledWith(5));
  });

  it("waits for the spreadsheet to open", async () => {
    openViewMenu(null);
    fireEvent.click(await screen.findByRole("menuitem", { name: /Freeze/ }));
    const items = await screen.findAllByRole("menuitemcheckbox");
    expect(items.every((item) => item.hasAttribute("data-disabled"))).toBe(true);
    expect(items[0].getAttribute("title")).toBe("The spreadsheet is still opening.");
  });
});

describe("charts and pivots in the Data menu", () => {
  function openList(load: Parameters<typeof ChartPivotMenu>[0]["load"]) {
    const handlers = { onEdit: vi.fn(), onDeleteChart: vi.fn(), onRefresh: vi.fn(), onCopy: vi.fn() };
    render(
      <Menu label="Data">
        <ChartPivotMenu load={load} {...handlers} />
      </Menu>,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "Data" }), { key: "ArrowDown" });
    return handlers;
  }

  it("says when there are none", async () => {
    openList(() => ({ charts: [], pivots: [] }));
    expect((await screen.findByRole("menuitem", { name: "None yet" })).hasAttribute("data-disabled")).toBe(true);
  });

  it("lists charts and pivots with their state and actions", async () => {
    const handlers = openList(() => ({
      charts: [
        { id: "c1", title: "Sales", invalid: false },
        { id: "c2", title: "Old", invalid: true },
      ],
      pivots: [
        { id: "p1", title: "By region", invalid: false, stale: true },
        { id: "p2", title: "Gone", invalid: true, stale: false },
        { id: "p3", title: "Fresh", invalid: false, stale: false },
      ],
    }));
    const names = (await screen.findAllByRole("menuitem")).map((item) => item.textContent);
    expect(names).toEqual([
      "Sales",
      "Delete Sales",
      "Old · source missing",
      "Delete Old",
      "By region · not updated",
      "Refresh By region",
      "Copy By region",
      "Gone · source missing",
      "Refresh Gone",
      "Copy Gone",
      "Fresh",
      "Refresh Fresh",
      "Copy Fresh",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Sales" }));
    expect(handlers.onEdit).toHaveBeenCalledWith("chart", "c1");
    const reopen = () => fireEvent.keyDown(screen.getByRole("button", { name: "Data" }), { key: "ArrowDown" });
    reopen();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete Old" }));
    expect(handlers.onDeleteChart).toHaveBeenCalledWith("c2");
    reopen();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Fresh" }));
    expect(handlers.onEdit).toHaveBeenCalledWith("pivot", "p3");
    reopen();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Refresh By region" }));
    expect(handlers.onRefresh).toHaveBeenCalledWith("p1");
    reopen();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy Gone" }));
    expect(handlers.onCopy).toHaveBeenCalledWith("p2");
  });
});

describe("the sort range dialog", () => {
  const values = [
    ["Name", "Plot", "Beds"],
    ["Rosa", "North", 3],
    ["Ada", "South", 1],
  ];
  const range = { startRow: 0, endRow: 2, startColumn: 0, endColumn: 2 };

  function openSort(props: Partial<Parameters<typeof SortRangeDialog>[0]> = {}) {
    const onSort = vi.fn();
    const onClose = vi.fn();
    render(<SortRangeDialog range={range} values={values} onSort={onSort} onClose={onClose} {...props} />);
    return { onSort, onClose, dialog: screen.getByRole("dialog", { name: "Sort range from A1 to C3" }) };
  }

  it("offers Sort for everyone only when other people have the sheet open", () => {
    const { onSort, dialog } = openSort();
    expect(within(dialog).queryByRole("checkbox", { name: "Sort for everyone" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Sort" }));
    expect(onSort).toHaveBeenCalledWith([{ column: 0, ascending: true }], true, false);
  });

  it("sorts by several columns, either way, for everyone or just here", () => {
    const { onSort, dialog } = openSort({ shared: true });
    expect(within(dialog).getByRole("checkbox", { name: "Data has header row" })).toHaveProperty("checked", true);
    expect(within(dialog).getAllByRole("option").map((option) => option.textContent)).toEqual(["Name", "Plot", "Beds"]);
    fireEvent.click(within(dialog).getByRole("button", { name: /Add another sort column/ }));
    fireEvent.change(within(dialog).getAllByRole("combobox")[1], { target: { value: "2" } });
    fireEvent.click(within(within(dialog).getByRole("radiogroup", { name: "Then by order" })).getByLabelText("Z → A"));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Sort for everyone" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Sort" }));
    expect(onSort).toHaveBeenCalledWith(
      [
        { column: 0, ascending: true },
        { column: 2, ascending: false },
      ],
      true,
      true,
    );
  });

  it("names columns by letter without a header row, and removes a sort column", () => {
    const { onSort, dialog } = openSort({ initialRules: [{ column: 1, ascending: true }, { column: 0, ascending: true }], initialHeader: true });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Data has header row" }));
    expect(within(dialog).getAllByRole("combobox")[0].textContent).toContain("Column A");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove sort column 2" }));
    fireEvent.click(within(within(dialog).getByRole("radiogroup", { name: "Sort order" })).getByLabelText("Z → A"));
    fireEvent.submit(dialog);
    expect(onSort).toHaveBeenCalledWith([{ column: 1, ascending: false }], false, false);
  });

  it("closes on Escape, Cancel, the close button, or a click outside", () => {
    const { onClose, dialog } = openSort();
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Enter" });
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    fireEvent.click(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(4);
  });

  it("keeps focus in the dialog when the menu hands it back", () => {
    const { dialog } = openSort();
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Sort" }));
  });
});

describe("renaming a column in a query step", () => {
  it("renames the column, says when it is not there, and refuses a bad name", () => {
    const step = { kind: "filter", column: "Plot", op: "equals", value: "North" } as never;
    const renamed = remapStepColumn(step, "Plot", " Bed ");
    expect(renamed.note).toBe("The step now uses Bed.");
    expect("step" in renamed && JSON.stringify(renamed.step)).toContain("Bed");
    expect(remapStepColumn(step, "Nope", "Bed")).toEqual({ note: "That name is not in this step." });
    expect(remapStepColumn({ kind: "nonsense" } as never, "Plot", "Bed").note).toMatch(/That (name is not in this step|column cannot be remapped)\./);
  });
});

describe("formula suggestions", () => {
  it("puts common functions first in Univer's list", () => {
    const descriptions: { getSearchListByNameFirstLetter: (text: string) => { name: string; desc: string }[] } = {
      getSearchListByNameFirstLetter: () => [
        { name: "SUMSQ", desc: "" },
        { name: "SUM", desc: "" },
        { name: "SUMIF", desc: "" },
      ],
    };
    rankFormulaSuggestions(descriptions as never);
    expect(descriptions.getSearchListByNameFirstLetter("S")[0].name).toBe("SUM");
  });

  it("lets Enter commit the typed cell while the suggestion list is out of date", () => {
    const listeners: (() => void)[] = [];
    const accept = { id: "sheet.formula-embedding-editor.search_function.cell", staticParameters: { keyCode: 13 }, preconditions: (() => true) as (context: unknown) => boolean };
    const other = { id: "sheet.formula-embedding-editor.search_function.cell", staticParameters: { keyCode: 40 }, preconditions: undefined };
    const unrelated = { id: "sheet.shortcut.bold", staticParameters: { keyCode: 13 } };
    const shortcuts = {
      getAllShortcuts: () => [accept, other, unrelated],
      shortcutChanged$: { subscribe: (listener: () => void) => (listeners.push(listener), { unsubscribe: vi.fn() }) },
    };
    let text = "=SUM(C";
    const editors = {
      getEditor: (id: string) =>
        id === "cell"
          ? {
              getSelectionRanges: () => [{ collapsed: true, startOffset: text.length }],
              getDocumentData: () => ({ body: { dataStream: text } }),
            }
          : null,
    };
    const stop = guardFormulaSuggestions(shortcuts as never, editors as never, [13, 9]);
    listeners.forEach((listener) => listener());
    listeners.forEach((listener) => listener());
    const list = document.createElement("ul");
    list.dataset.uComp = "sheets-formula-editor";
    list.innerHTML = "<li><span><span>SU</span></span></li>";
    document.body.append(list);
    expect(accept.preconditions({} as never)).toBe(false);
    text = "=SU";
    expect(accept.preconditions({} as never)).toBe(true);
    list.remove();
    text = "=SUM(C";
    expect(accept.preconditions({} as never)).toBe(true);
    expect(other.preconditions).toBeUndefined();
    stop();
  });
});
