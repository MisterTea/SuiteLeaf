import { afterEach, expect, it } from "vitest";
import { DataValidatorRegistryService } from "@univerjs/data-validation";
import { DataValidationListCacheService } from "@univerjs/sheets-data-validation";
import { patchListValidation } from "../apps/web/src/editors/sheet-dropdown-validation";
import { dropdownBook, notationOf } from "../apps/web/src/editors/sheet-dropdown-book";
import { syncDropdownSources } from "../apps/web/src/editors/sheet-dropdown-sync";
import {
  colorsForLabels,
  nextChipColor,
  parseDropdownMeta,
} from "../apps/web/src/editors/sheet-dropdown-source";
import {
  DROPDOWN_COLORS,
  chipTextColor,
  isRangeFormula,
  optionsFromRule,
  rewriteListValues,
} from "../apps/web/src/editors/sheet-dropdowns";
import { headlessWorkbook, select, type Headless } from "./sheet-editor-univer";

let h: Headless | undefined;
afterEach(() => {
  h?.dispose();
  h = undefined;
});

it("reads a workbook-prefixed range rule as a range, not as one label", () => {
  expect(isRangeFormula("=[e129dafd]Statuses!$A$2:$A$6")).toBe(true);
  expect(optionsFromRule("=[e129dafd]Statuses!$A$2:$A$6", "")).toEqual([]);
  expect(isRangeFormula('=["a","b"]')).toBe(false);
  expect(isRangeFormula("=")).toBe(false);
  expect(isRangeFormula("=SUM(A1:A2)")).toBe(false);
});

it("keeps Univer's list validator for values the tidied options do not cover", async () => {
  h = headlessWorkbook();
  let refreshed = 0;
  const optionsFromMeta = () => [{ id: "1", label: "Kept", color: "#b7e1cd" }];
  patchListValidation(h.injector, optionsFromMeta, () => ({ refreshCanvas: () => refreshed++ }));
  patchListValidation(h.injector, optionsFromMeta, () => ({ refreshCanvas: () => refreshed++ }));
  expect(refreshed).toBe(1);
  const registry = h.injector.get(DataValidatorRegistryService);
  const list = registry.getValidatorItem("list");
  const rule = { type: "list", formula1: "Open,Closed", formula2: "" };
  expect(await list.isValidType({ value: "open " }, {}, rule)).toBe(true);
  expect(await list.isValidType({ value: "  " }, {}, rule)).toBe(false);
  expect(await list.isValidType({ value: "Pending" }, {}, rule)).toBe(false);
  const ranged = { type: "list", formula1: "=Lists!$A$1:$A$3", formula2: "" };
  expect(await list.isValidType({ value: "kept" }, {}, ranged)).toBe(true);
});

it("caches each list label once, trimmed, with the rule's colours", () => {
  h = headlessWorkbook();
  patchListValidation(h.injector, () => [], () => null);
  const cache = h.injector.get(DataValidationListCacheService);
  const item = cache.computeAndCache("book", "s1", {
    uid: "r1",
    type: "list",
    formula1: " Open ,open,Closed,",
    formula2: "#ff0000,#00ff00,#0000ff",
  });
  expect(item.list).toEqual(["Open", "Closed"]);
  expect(item.colorMap).toEqual({ Open: "#ff0000", Closed: "#00ff00" });
  expect(item.set.has("Closed")).toBe(true);
  const stored = cache.computeAndCache("book", "s1", {
    uid: "r2",
    type: "listMultiple",
    formula1: "High,Low",
    formula2: "",
    bizInfo: { suiteleafDropdown: { colors: { low: "#123456" }, sources: [] } },
  });
  expect(stored.listWithColor).toEqual([
    { label: "High", color: DROPDOWN_COLORS[0].value },
    { label: "Low", color: "#123456" },
  ]);
  const other = cache.computeAndCache("book", "s1", { uid: "r3", type: "checkbox", formula1: "a,b" });
  expect(other.list).toEqual(["a", "b"]);
});

it("reads the cells, rules, and sources of a dropdown from the workbook", () => {
  h = headlessWorkbook([
    {
      id: "s1",
      cells: {
        0: { 0: { v: "Open" }, 1: { v: 2, f: "=1+1" } },
        1: { 0: { v: "Closed" } },
      },
    },
    { id: "s2", name: "Lists", cells: { 0: { 0: { v: "Open" } }, 1: { 0: { v: "open" } }, 2: { 0: { v: "Closed" } } } },
  ]);
  const book = dropdownBook(h.api);
  select(h, 0, 0, 2, 2);
  const range = h.book().getActiveRange();
  expect(notationOf(range)).toBe("A1:B2");
  expect(notationOf({})).toBe("");
  expect(book.readCells(range)).toEqual([
    { row: 0, column: 0, value: "Open" },
    { row: 1, column: 0, value: "Closed" },
    { row: 1, column: 1, value: null },
  ]);
  expect(book.singleListCell()).toBeNull();
  expect(book.hitAt(0, 0)).toBeNull();
  expect(book.targetRanges()).toHaveLength(1);
  expect(book.sheetByName(null)?.getSheetId()).toBe("s1");
  expect(book.sheetByName("Missing")).toBeNull();
  expect(book.readRefCells({ sheet: "Missing", startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 })).toBeNull();
  expect(book.optionsFromMeta("=Missing!A1:A2", "")).toEqual([]);
  expect(book.optionsFromMeta("=Lists!", "")).toEqual([]);
  const donors = [{ id: "keep", label: "closed", color: "#f4cccc" }];
  expect(book.optionsFromMeta("=Lists!$A$1:$A$3", "", donors)).toEqual([
    { id: "src-0", label: "Open", color: DROPDOWN_COLORS[0].value },
    { id: "keep", label: "Closed", color: "#f4cccc" },
  ]);
  expect(book.growDown({ sheet: "Lists", startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 }).endRow).toBe(0);
  expect(book.growDown({ sheet: "Missing", startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }).endRow).toBe(0);
  expect(book.growDown({ sheet: "Lists", startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }).endRow).toBe(2);
  expect(book.loadRange("not a range", donors)).toEqual({
    options: donors,
    error: "Enter a range like Statuses!A2:A5.",
    sources: [],
  });
  const loaded = book.loadRange("Lists!A1:A3", donors);
  expect(loaded.error).toBe("");
  expect(loaded.options.map((option) => [option.label, option.color])).toEqual([
    ["Open", DROPDOWN_COLORS[0].value],
    ["Closed", "#f4cccc"],
  ]);
  expect(loaded.sources.map((cell) => cell.label)).toEqual(["Open", "open", "Closed"]);
  expect(book.currentLabel(1, 0)).toBe("Closed");
});

it("follows a range-sourced list to a renamed source and moves the cells to the new name", async () => {
  h = headlessWorkbook([
    { id: "s1", cells: { 0: { 0: { v: "Low" } }, 1: { 0: { v: "Low, High" } } } },
    { id: "s2", name: "Lists", cells: { 0: { 0: { v: "Minor" } }, 1: { 0: { v: "High" } }, 2: { 0: { v: "Urgent" } } } },
  ]);
  const single = h.api.newDataValidation().requireValueInList(["Low", "High"]).build();
  single.rule.formula1 = "=Lists!$A$1:$A$2";
  single.rule.formula2 = JSON.stringify({
    colors: { low: "#f4cccc", High: "#c9daf8" },
    sources: [
      { row: 0, column: 0, label: "Low" },
      { row: 1, column: 0, label: "High" },
    ],
  });
  h.sheet().getRange(0, 0).setDataValidation(single);
  const multiple = h.api.newDataValidation().requireValueInList(["Low", "High"], true).build();
  multiple.rule.type = "listMultiple";
  multiple.rule.formula1 = "=Lists!$A$1:$A$2";
  multiple.rule.bizInfo = { suiteleafDropdown: parseDropdownMeta(single.rule.formula2) };
  h.sheet().getRange(1, 0).setDataValidation(multiple);
  const writes: { updates: unknown[]; target: unknown }[] = [];
  const syncing = { current: false };
  await syncDropdownSources({
    api: h.api,
    injector: h.injector,
    syncing,
    draftRef: { current: null },
    reader: dropdownBook(h.api),
    writeCells: async (updates, target) => {
      writes.push({ updates, target });
    },
  });
  expect(syncing.current).toBe(false);
  const [rule] = h.sheet().getRange(0, 0).getDataValidations();
  expect(rule.rule.formula1).toBe("=Lists!$A$1:$A$3");
  expect(rule.rule.bizInfo.suiteleafDropdown.colors).toEqual({
    Minor: "#f4cccc",
    High: "#c9daf8",
    Urgent: expect.stringMatching(/^#/),
  });
  expect(writes).toEqual([
    {
      target: { unitId: "book", subUnitId: "s1" },
      updates: [
        { row: 0, column: 0, value: "Low", label: "Minor", color: "#f4cccc" },
        { row: 1, column: 0, value: "Low, High", label: "Minor, High", color: "#ffffff" },
      ],
    },
  ]);
});

it("leaves the rules alone while a sync runs or the editor is open", async () => {
  h = headlessWorkbook();
  let wrote = false;
  const args = {
    api: h.api,
    injector: h.injector,
    reader: dropdownBook(h.api),
    writeCells: async () => {
      wrote = true;
    },
  };
  await syncDropdownSources({ ...args, syncing: { current: true }, draftRef: { current: null } });
  await syncDropdownSources({ ...args, syncing: { current: false }, draftRef: { current: {} } });
  await syncDropdownSources({
    ...args,
    api: { getActiveWorkbook: () => null },
    reader: dropdownBook({ getActiveWorkbook: () => null }),
    syncing: { current: false },
    draftRef: { current: null },
  });
  expect(wrote).toBe(false);
});

it("colours labels from stored names first, then the rule's positional colours", () => {
  expect(parseDropdownMeta('{"colors":{"A":"#111111"}}')).toEqual({ colors: { A: "#111111" }, sources: [] });
  expect(parseDropdownMeta("{bad json")).toBeNull();
  expect(parseDropdownMeta('{"sources":[]}')).toBeNull();
  expect(colorsForLabels(["A", " ", "a", "B"], '{"colors":{"a":"#222222"}}')).toEqual({
    A: "#222222",
    B: DROPDOWN_COLORS[1].value,
  });
  expect(colorsForLabels(["Big"], "", { colors: { BIG: "#333333" }, sources: [] })).toEqual({ Big: "#333333" });
  expect(colorsForLabels(["X", "Y"], "#444444,nope")).toEqual({ X: "#444444", Y: DROPDOWN_COLORS[1].value });
  expect(nextChipColor(DROPDOWN_COLORS.map((color) => color.value))).toBe(DROPDOWN_COLORS[0].value);
});

it("chip text stays readable on light, dark, and mid-tone chips", () => {
  expect(chipTextColor("#ffffff")).toBe("#111111");
  expect(chipTextColor("#000000")).toBe("#ffffff");
  expect(chipTextColor("#777777")).toBe("#ffffff");
  expect(chipTextColor("not a colour")).toBe("#111111");
});

it("tidies pasted arrays and single cells and ignores what is not a cell", () => {
  const options = [{ id: "1", label: "Yes", color: "#b7e1cd" }];
  const at = (row: number) => (row === 0 ? options : null);
  const grid = [[{ v: " yes" }, "plain"], "not a row", [{ v: "yes" }]];
  expect(rewriteListValues({ range: { startRow: 0, endRow: 2, startColumn: 0, endColumn: 1 }, value: grid }, at)).toBe(
    true,
  );
  expect(grid[0]).toEqual([{ v: "Yes", t: 1 }, "plain"]);
  expect(rewriteListValues({ value: grid }, at)).toBe(false);
  const cell = { v: "YES" };
  expect(rewriteListValues({ range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 }, value: cell }, at)).toBe(
    false,
  );
  expect(rewriteListValues({ range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }, value: cell }, at)).toBe(
    true,
  );
  expect(cell.v).toBe("Yes");
  expect(rewriteListValues({ value: { 0: null, 1: { 0: { v: "yes" } } } }, at)).toBe(false);
});
