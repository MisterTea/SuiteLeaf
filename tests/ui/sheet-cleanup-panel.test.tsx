// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, expect, it } from "vitest";
import SheetCleanup from "../../apps/web/src/editors/sheet-cleanup-ui";
import { headlessWorkbook, select, type CellSeed, type Headless } from "../sheet-editor-univer";

type Handle = { trim: () => void; duplicates: () => void; split: () => void };

let h: Headless;
let errors: string[];
let saves: number;

function mount(cells: CellSeed, { engine = true, api }: { engine?: boolean; api?: any } = {}) {
  h = headlessWorkbook([{ id: "s1", cells }]);
  errors = [];
  saves = 0;
  const ref = createRef<Handle>();
  render(
    <SheetCleanup
      api={api ?? h.api}
      engine={engine ? h.injector : null}
      persist={() => saves++}
      onError={(message) => errors.push(message)}
      ref={ref}
    />,
  );
  return ref;
}

afterEach(() => {
  cleanup();
  h?.dispose();
});

const value = (row: number, column: number) => h.sheet().getRange(row, column).getValue();
const fill = (row: number, column: number) => h.sheet().getRange(row, column).getCellStyleData()?.bg?.rgb;
const column = (index: number, rows: number) =>
  Array.from({ length: rows }, (_, row) => value(row, index));
const undo = () => act(async () => void (await h.api.undo()));

it("asks for a selection when the grid has none", () => {
  const ref = mount({}, { engine: false });
  act(() => ref.current!.trim());
  expect(screen.getByRole("status").textContent).toContain("Select the cells to clean up first.");
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(screen.queryByRole("status")).toBeNull();
});

it("trims spaces in one undo step and leaves formulas and numbers alone", async () => {
  const ref = mount({
    0: { 0: { v: "  Ada  " }, 1: { v: 7 } },
    1: { 0: { v: "Bob\u00A0" }, 1: { v: 2, f: "=1+1" } },
    2: { 0: { v: "Cy" } },
  });
  select(h, 0, 0, 3, 2);
  act(() => ref.current!.trim());
  expect(column(0, 3)).toEqual(["Ada", "Bob", "Cy"]);
  expect(value(0, 1)).toBe(7);
  expect(h.sheet().getRange(1, 1).getFormula()).toBe("=1+1");
  const notice = screen.getByRole("status");
  expect(notice.textContent).toMatch(/2 cells/);
  expect(saves).toBe(1);
  await act(async () => fireEvent.click(within(notice).getByRole("button", { name: "Undo" })));
  expect(column(0, 3)).toEqual(["  Ada  ", "Bob\u00A0", "Cy"]);
  expect(screen.queryByRole("status")).toBeNull();
});

it("a clean selection reports nothing to undo", () => {
  const ref = mount({ 0: { 0: { v: "tidy" } } });
  select(h, 0, 0);
  act(() => ref.current!.trim());
  expect(screen.getByRole("status").textContent).not.toContain("Undo");
});

it("an undo from the menu clears the cleanup notice", async () => {
  const ref = mount({ 0: { 0: { v: " x " } } });
  select(h, 0, 0);
  act(() => ref.current!.trim());
  expect(screen.getByRole("status")).toBeTruthy();
  await undo();
  expect(screen.queryByRole("status")).toBeNull();
  expect(value(0, 0)).toBe(" x ");
});

it("a failure while cleaning goes to the editor's error line", () => {
  let broken = false;
  const ref = mount(
    {},
    {
      api: {
        getActiveWorkbook: () => {
          if (broken) throw new Error("grid went away");
          return h.api.getActiveWorkbook();
        },
      },
    },
  );
  broken = true;
  act(() => ref.current!.trim());
  expect(errors).toEqual(["grid went away"]);
  expect(saves).toBe(0);
});

const people: CellSeed = {
  0: { 0: { v: "Name" }, 1: { v: "City" } },
  1: { 0: { v: "Ada" }, 1: { v: "Rome" } },
  2: { 0: { v: "ada" }, 1: { v: "Oslo" } },
  3: { 0: { v: "Bob" }, 1: { v: "Rome" } },
  4: { 0: { v: "Ada" }, 1: { v: "Rome" } },
};

it("previews duplicate rows in the sheet and removes them as one undo step", async () => {
  const ref = mount(people);
  select(h, 0, 0, 5, 2);
  act(() => ref.current!.duplicates());
  const dialog = screen.getByRole("dialog", { name: "Remove duplicates" });
  expect(document.activeElement).toBe(dialog);
  expect(within(dialog).getByRole("checkbox", { name: "Data has header row" })).toHaveProperty("checked", true);
  expect(within(dialog).getByRole("checkbox", { name: "Name" })).toBeTruthy();
  const summary = within(dialog).getByRole("status");
  expect(summary.textContent).toContain("highlighted in the sheet");
  expect(fill(4, 0)).toBe("#fde293");
  expect(fill(4, 1)).toBe("#fde293");
  expect(fill(2, 0)).toBeUndefined();
  fireEvent.click(within(dialog).getByRole("button", { name: "Only Name" }));
  expect(fill(2, 0)).toBe("#fde293");
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "Ignore case" }));
  expect(fill(2, 0)).toBeFalsy();
  fireEvent.click(within(dialog).getByRole("radio", { name: "Last row" }));
  expect(fill(1, 0)).toBe("#fde293");
  expect(fill(4, 0)).toBeFalsy();
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "Name" }));
  expect(summary.textContent).toContain("Choose at least one column");
  expect(within(dialog).getByRole("button", { name: "Remove" })).toHaveProperty("disabled", true);
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "Name" }));
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "City" }));
  fireEvent.click(within(dialog).getByRole("radio", { name: "First row" }));
  fireEvent.click(within(dialog).getByRole("radio", { name: "The row with the most filled cells" }));
  fireEvent.click(within(dialog).getByRole("radio", { name: "First row" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(column(0, 5)).toEqual(["Name", "Ada", "ada", "Bob", null]);
  expect(fill(1, 0)).toBeFalsy();
  const notice = screen.getByRole("status");
  expect(notice.textContent).toContain("1");
  await undo();
  expect(column(0, 5)).toEqual(["Name", "Ada", "ada", "Bob", "Ada"]);
});

it("highlights duplicates instead of deleting them", async () => {
  const ref = mount(people);
  select(h, 0, 0, 5, 2);
  act(() => ref.current!.duplicates());
  fireEvent.click(screen.getByRole("button", { name: "Highlight duplicates" }));
  expect(fill(1, 0)).toBe("#d2e3fc");
  expect(fill(4, 1)).toBe("#d2e3fc");
  expect(fill(3, 0)).toBeFalsy();
  expect(column(0, 5)).toEqual(["Name", "Ada", "ada", "Bob", "Ada"]);
  expect(screen.getByRole("status").textContent).toContain("Nothing was deleted");
  await undo();
  expect(fill(1, 0)).toBeFalsy();
});

it("closing the duplicates panel puts the original fills back", () => {
  const ref = mount({
    ...people,
    4: { 0: { v: "Ada", s: { bg: { rgb: "#00ff00" } } }, 1: { v: "Rome" } },
  });
  select(h, 0, 0, 5, 2);
  act(() => ref.current!.duplicates());
  expect(fill(4, 0)).toBe("#fde293");
  fireEvent.click(screen.getByRole("checkbox", { name: "Data has header row" }));
  expect(screen.getByRole("checkbox", { name: "Column A" })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(fill(4, 0)).toBe("#00ff00");
  expect(fill(4, 1)).toBeFalsy();
  act(() => ref.current!.duplicates());
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(fill(4, 0)).toBe("#00ff00");
});

it("leaves rows hidden by a filter out of the duplicate check", () => {
  const ref = mount(people);
  const filter = h.sheet().getRange(0, 0, 5, 2).createFilter();
  filter.setColumnFilterCriteria(1, { colId: 1, filters: { filters: ["Rome"] } });
  expect(filter.getFilteredOutRows()).toEqual([2]);
  select(h, 0, 0, 5, 2);
  act(() => ref.current!.duplicates());
  fireEvent.click(screen.getByRole("button", { name: "Only Name" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  expect(column(0, 4)).toEqual(["Name", "Ada", "ada", "Bob"]);
  expect(screen.getByRole("status").textContent).toContain("idden");
});

const addresses: CellSeed = {
  0: { 0: { v: "Place" } },
  1: { 0: { v: "Rome, Italy" } },
  2: { 0: { v: "Oslo, Norway" } },
  3: { 0: { v: "Lima,,Peru" } },
};

it("splits a column on the detected separator and names the new header cells", async () => {
  const ref = mount(addresses);
  select(h, 1, 0, 3, 1);
  act(() => ref.current!.split());
  const dialog = screen.getByRole("dialog", { name: "Split text to columns" });
  expect((within(dialog).getByLabelText("Separator") as HTMLSelectElement).value).toBe("comma");
  const preview = within(dialog).getByLabelText("Split preview");
  expect([...preview.querySelectorAll("tr")].map((row) => row.textContent)).toEqual([
    "RomeItaly",
    "OsloNorway",
    "LimaPeru",
  ]);
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "Treat consecutive separators as one" }));
  expect(preview.querySelectorAll("tr")[2].textContent).toBe("Lima—Peru");
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "Treat consecutive separators as one" }));
  expect((within(dialog).getByLabelText("Header 1") as HTMLInputElement).value).toBe("Place");
  fireEvent.change(within(dialog).getByLabelText("Header 2"), { target: { value: "Country" } });
  expect(within(dialog).getByRole("radio", { name: "Overwrite cells to the right" })).toHaveProperty("checked", true);
  fireEvent.click(within(dialog).getByRole("button", { name: "Split" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect([0, 1, 2, 3].map((row) => [value(row, 0), value(row, 1)])).toEqual([
    ["Place", "Country"],
    ["Rome", "Italy"],
    ["Oslo", "Norway"],
    ["Lima", "Peru"],
  ]);
  expect(h.sheet().getRange(1, 1).getCellStyleData()?.n?.pattern).toBe("@");
  expect(screen.getByRole("status").textContent).toContain("3");
  await undo();
  expect(value(1, 0)).toBe("Rome, Italy");
  expect(value(1, 1)).toBe(null);
});

it("inserts columns when the cells to the right are not empty", () => {
  const ref = mount({
    0: { 0: { v: "a;b" }, 1: { v: "keep" } },
    1: { 0: { v: "c;d" } },
  });
  select(h, 0, 0, 2, 1);
  act(() => ref.current!.split());
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("radio", { name: "Insert columns" })).toHaveProperty("checked", true);
  expect(within(dialog).queryByRole("checkbox", { name: "Rename the header row" })).toBeNull();
  fireEvent.click(within(dialog).getByRole("radio", { name: "Overwrite cells to the right" }));
  expect(dialog.querySelector(".cleanup-warning")!.textContent).toContain("Column B isn't empty");
  fireEvent.click(within(dialog).getByRole("radio", { name: "Insert columns" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Split" }));
  expect([value(0, 0), value(0, 1), value(0, 2)]).toEqual(["a", "b", "keep"]);
});

it("a custom separator, a renamed header, and Cancel leave the sheet as it was", () => {
  const ref = mount({ 0: { 0: { v: "Code" } }, 1: { 0: { v: "A-1" } }, 2: { 0: { v: "B-2" } } });
  select(h, 1, 0, 2, 1);
  act(() => ref.current!.split());
  const dialog = screen.getByRole("dialog");
  expect(dialog.querySelector(".cleanup-hint")!.textContent).toContain("Couldn't detect a separator");
  fireEvent.click(within(dialog).getByRole("button", { name: "Split" }));
  expect(screen.getByRole("status").textContent).toContain("Nothing to split");
  fireEvent.change(within(dialog).getByLabelText("Separator"), { target: { value: "custom" } });
  fireEvent.change(within(dialog).getByLabelText("Custom separator"), { target: { value: "-" } });
  expect(within(dialog).getByLabelText("Split preview").querySelectorAll("td")).toHaveLength(4);
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "Rename the header row" }));
  expect(within(dialog).queryByLabelText("Header 1")).toBeNull();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(value(1, 0)).toBe("A-1");
  act(() => ref.current!.split());
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("a split with more than twenty parts keeps the rest in the last column", () => {
  const ref = mount({ 0: { 0: { v: Array.from({ length: 25 }, (_, i) => `p${i}`).join(",") } } });
  select(h, 0, 0);
  act(() => ref.current!.split());
  fireEvent.click(screen.getByRole("button", { name: "Split" }));
  expect(value(0, 18)).toBe("p18");
  expect(value(0, 19)).toBe("p19,p20,p21,p22,p23,p24");
});
