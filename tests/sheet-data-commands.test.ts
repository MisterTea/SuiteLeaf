import { afterEach, expect, it } from "vitest";
import { CommandType, ICommandService } from "@univerjs/core";
import { sheetDataCommands, type SheetFilterView, type SheetSorting } from "../apps/web/src/editors/sheet-data-commands";
import type { SortView } from "../apps/web/src/collab/sheet-sort";
import { headlessWorkbook, select, stubRenderFacade, type CellSeed, type Headless } from "./sheet-editor-univer";

let h: Headless;
let facade: ReturnType<typeof stubRenderFacade>;

const fruit: CellSeed = {
  0: { 0: { v: "Fruit" }, 1: { v: "Kind" } },
  1: { 0: { v: "pear" }, 1: { v: "tree" } },
  2: { 0: { v: "apple" }, 1: { v: "tree" } },
  3: { 0: { v: "grape" }, 1: { v: "vine" } },
  4: { 0: { v: "kiwi" }, 1: { v: "vine" } },
};

function setup(cells: CellSeed = fruit, { readOnly = false } = {}) {
  h = headlessWorkbook([{ id: "s1", cells }]);
  facade = stubRenderFacade(h);
  const state = {
    persist: 0,
    errors: [] as string[],
    notices: [] as string[],
    views: [] as (SheetFilterView | null)[],
    sorting: [] as (SheetSorting | null)[],
  };
  const refs = {
    copiedRange: { current: null as any },
    readOnlyRef: { current: readOnly },
    pendingMutations: { current: [] as { id: string; params?: unknown }[] },
    sharedSort: { current: false },
    personalView: { current: null as SortView | null },
    sharedRoom: { current: true },
  };
  const make = (sorting: SheetSorting | null = null, book: unknown = h.book()) =>
    sheetDataCommands({
      book: { current: book },
      api: { current: h.api },
      persist: { current: () => state.persist++ },
      onError: (message) => state.errors.push(message),
      error: { current: (message) => state.errors.push(`error:${message}`) },
      ...refs,
      setNotice: (notice) => state.notices.push(notice),
      setFilterView: (view) => state.views.push(view),
      sorting,
      setSorting: (next) => state.sorting.push(next),
    });
  return { state, refs, make };
}

afterEach(() => {
  facade?.restore();
  h?.dispose();
});

const value = (row: number, column: number) => h.sheet().getRange(row, column).getValue();

it("explains a menu copy the browser blocks, and keeps the copied cells for a transpose", async () => {
  const { state, refs, make } = setup({ 0: { 0: { v: 1 }, 1: { v: 3, f: "=A1+2" } } });
  select(h, 0, 0, 1, 2);
  await make().clipboard("copy");
  expect(state.notices[0]).toMatch(/^Your browser doesn't let the Edit menu copy here\. Use (⌘|Ctrl\+)C to copy\.$/);
  expect(refs.copiedRange.current).toEqual({
    source: { row: 0, column: 0 },
    cells: [[{ formula: null, value: 1 }, { formula: "=A1+2", value: null }]],
  });
  await make().clipboard("paste");
  expect(state.notices[1]).toContain("paste");
  h.injector.get(ICommandService).registerCommand({
    id: "univer.command.cut",
    type: CommandType.COMMAND,
    handler: () => true,
  });
  await make().clipboard("cut");
  expect(state.notices).toHaveLength(2);
});

it("transposes the copied cells at the active cell", () => {
  const { state, refs, make } = setup({ 0: { 0: { v: "a" }, 1: { v: "b" } } });
  make().pasteTranspose();
  expect(state.notices).toEqual(["Copy a range before you transpose it."]);
  refs.copiedRange.current = {
    source: { row: 0, column: 0 },
    cells: [[{ value: "a", formula: null }, { value: "b", formula: null }]],
  };
  select(h, 3, 3);
  make().pasteTranspose();
  expect([value(3, 3), value(4, 3)]).toEqual(["a", "b"]);
  expect(state.notices.at(-1)).toBe("");
  expect(state.persist).toBe(1);
  refs.readOnlyRef.current = true;
  select(h, 6, 6);
  make().pasteTranspose();
  expect(value(6, 6)).toBe(null);
});

it("reports a transpose the sheet refuses", () => {
  const { state, refs, make } = setup();
  refs.copiedRange.current = { source: { row: 0, column: 0 }, cells: [[{ value: "x", formula: null }]] };
  const book = {
    getActiveSheet: () => ({
      getRange: () => ({
        setValues: () => {
          throw new Error("protected");
        },
      }),
    }),
    getActiveCell: () => ({ getRow: () => 0, getColumn: () => 0 }),
  };
  make(null, book).pasteTranspose();
  expect(state.errors).toEqual(["error:protected"]);
  refs.copiedRange.current = { source: { row: 0, column: 0 }, cells: [[]] };
  make(null, book).pasteTranspose();
  expect(state.errors).toHaveLength(1);
});

it("clears the selected values and toggles a filter on the data", () => {
  const { state, make } = setup();
  select(h, 1, 0, 1, 2);
  make().deleteValues();
  expect([value(1, 0), value(1, 1)]).toEqual([null, null]);
  select(h, 0, 0);
  make().toggleFilter();
  expect(h.sheet().getFilter()?.getRange().getA1Notation()).toBe("A1:B5");
  make().toggleFilter();
  expect(h.sheet().getFilter()).toBeNull();
  select(h, 0, 0, 3, 1);
  make().toggleFilter();
  expect(h.sheet().getFilter()?.getRange().getA1Notation()).toBe("A1:A3");
  expect(state.persist).toBe(4);
  expect(state.errors).toEqual([]);
});

it("does not filter a read-only sheet, and reports a filter that cannot be made", () => {
  const { state, make, refs } = setup();
  refs.readOnlyRef.current = true;
  make().toggleFilter();
  expect(h.sheet().getFilter()).toBeNull();
  refs.readOnlyRef.current = false;
  const book = {
    getActiveSheet: () => ({ getFilter: () => null, getDataRange: () => ({ createFilter: () => null }) }),
    getActiveRange: () => null,
  };
  make(null, book).toggleFilter();
  expect(state.errors).toEqual(["Select a range with a header row to create a filter."]);
});

it("lets a viewer filter their own view by a repeated value and clear it", () => {
  const { state, make } = setup(fruit, { readOnly: true });
  expect(make().sheetRows()[3]).toEqual(["grape", "vine"]);
  make().createFilterView();
  expect(state.views).toEqual([{ header: "", value: "", hidden: 0 }]);
  make().applyFilterView("vine");
  expect(state.views.at(-1)).toEqual({ header: "Kind", value: "vine", hidden: 2 });
  make().applyFilterView("nothing");
  expect(state.views).toHaveLength(2);
  make().clearFilterView();
  expect(h.sheet().getFilter()).toBeNull();
  expect(state.views.at(-1)).toBeNull();
  make().applyFilterView("tree");
  expect(state.views.at(-1)).toMatchObject({ value: "tree", hidden: 2 });
  expect(state.errors).toEqual([]);
});

it("an editor's filter view does nothing, and a sheet without a header is explained", () => {
  const { state, make, refs } = setup();
  make().createFilterView();
  make().applyFilterView("vine");
  expect(state.views).toEqual([]);
  refs.readOnlyRef.current = true;
  const range = { getFilter: () => null, createFilter: () => null, getRange: () => ({ startColumn: 0 }) };
  const book = { getActiveSheet: () => ({ getDataRange: () => range }) };
  make(null, book).createFilterView();
  expect(state.errors).toEqual(["This sheet has no header row to filter."]);
  make(null, { getActiveSheet: () => null }).createFilterView();
  expect(make(null, { getActiveSheet: () => null }).sheetRows()).toEqual([]);
});

it("opens the sort dialog on the data and sorts the body under the header", () => {
  const { state, refs, make } = setup();
  select(h, 0, 0);
  make().openSortRange();
  const sorting = state.sorting[0]!;
  expect(sorting.range).toMatchObject({ startRow: 0, endRow: 4, startColumn: 0, endColumn: 1 });
  expect(sorting.values[2]).toEqual(["apple", "tree"]);
  refs.pendingMutations.current.push({
    id: "sheet.mutation.reorder-range",
    params: { subUnitId: "s1", range: { startRow: 1, endRow: 4, startColumn: 0, endColumn: 1 }, order: { 1: 2, 2: 1 } },
  });
  make(sorting).sortRange([{ column: 0, ascending: true }], true);
  expect([1, 2, 3, 4].map((row) => value(row, 0))).toEqual(["apple", "grape", "kiwi", "pear"]);
  expect(value(0, 0)).toBe("Fruit");
  expect(refs.personalView.current).toMatchObject({ sheetId: "s1" });
  expect(state.sorting.at(-1)).toBeNull();
  make(sorting).sortRange([{ column: 0, ascending: false }], true, true);
  expect(refs.personalView.current).toBeNull();
  expect(refs.sharedSort.current).toBe(false);
  // With nobody else in the sheet, a sort changes the saved cells.
  refs.sharedRoom.current = false;
  refs.pendingMutations.current.push({
    id: "sheet.mutation.reorder-range",
    params: { subUnitId: "s1", range: { startRow: 1, endRow: 4, startColumn: 0, endColumn: 1 }, order: { 1: 2, 2: 1 } },
  });
  make(sorting).sortRange([{ column: 0, ascending: true }], true);
  expect(refs.personalView.current).toBeNull();
  refs.sharedRoom.current = true;
  make({ ...sorting, range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 } }).sortRange([], true);
  expect(state.errors).toEqual(["Select at least two rows to sort, not counting the header."]);
  select(h, 1, 0, 2, 2);
  make().openSortRange();
  expect(state.sorting.at(-1)!.range).toMatchObject({ startRow: 1, endRow: 2 });
});

it("describes the view and freezes rows and columns", () => {
  const { make } = setup();
  select(h, 2, 1);
  expect(make().view()).toMatchObject({ frozenRows: 0, frozenColumns: 0, row: 3, column: 2, gridlines: true });
  make().setFrozen("rows", 1);
  make().setFrozen("columns", 2);
  const view = make().view();
  expect([view.frozenRows, view.frozenColumns]).toEqual([1, 2]);
  expect(view.maxFrozenRows).toBe(1 + 30 - 1);
  h.sheet().setHiddenGridlines(true);
  expect(make().view().gridlines).toBe(false);
  const none = make(null, { getActiveSheet: () => null, getActiveCell: () => null });
  none.setFrozen("rows", 3);
  expect(none.view()).toMatchObject({ row: 1, column: 1, maxFrozenRows: 0 });
});
