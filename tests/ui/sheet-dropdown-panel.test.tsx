// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ICommandService } from "@univerjs/core";
import { IMenuManagerService } from "@univerjs/ui";
import { DROPDOWN_COLORS } from "../../apps/web/src/editors/sheet-dropdowns";
import SheetDropdowns, { type SheetDropdownHandle } from "../../apps/web/src/editors/sheet-dropdown-panel";
import { headlessWorkbook, select, stubRenderFacade, type CellSeed, type Headless } from "../sheet-editor-univer";

let h: Headless;
let facade: ReturnType<typeof stubRenderFacade>;
let menus: unknown[];
let saves: number;

const wait = (ms = 0) => act(() => new Promise((done) => setTimeout(done, ms)));

function mount(cells: CellSeed, lists: CellSeed = {}) {
  h = headlessWorkbook([
    { id: "s1", name: "Tasks", cells },
    { id: "s2", name: "Lists", cells: lists },
  ]);
  facade = stubRenderFacade(h);
  menus = [];
  saves = 0;
  const injector = {
    get: (token: unknown) =>
      token === IMenuManagerService ? { mergeMenu: (menu: unknown) => menus.push(menu) } : h.injector.get(token),
  };
  const host = document.createElement("div");
  host.className = "sheet-host";
  document.body.append(host);
  const ref = createRef<SheetDropdownHandle>();
  render(
    <SheetDropdowns api={h.api} injector={injector} persist={() => saves++} host={{ current: host }} ref={ref} />,
  );
  return { ref, host };
}

const value = (row: number, column: number, sheet = h.sheet()) => sheet.getRange(row, column).getValue();
const rules = (row: number, column: number) => h.sheet().getRange(row, column).getDataValidations();
const key = (k: string, target: EventTarget = document.body) => fireEvent.keyDown(target, { key: k });

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  cleanup();
  facade?.restore();
  h?.dispose();
});

function listRule(labels: string[], { multiple = false, reject = true } = {}) {
  return h.api
    .newDataValidation()
    .requireValueInList(labels, multiple, true)
    .setAllowInvalid(!reject)
    .setOptions({ errorStyle: reject ? 1 : 2 })
    .build();
}

it("turns a selection into a dropdown with tidied options and fixes the cells", async () => {
  const { ref } = mount({
    0: { 0: { v: " done" } },
    1: { 0: { v: "Done" } },
    2: { 0: { v: "todo " } },
    3: { 0: { v: "Todo" } },
  });
  select(h, 0, 0, 4, 1);
  act(() => ref.current!.openNew());
  const panel = screen.getByRole("dialog", { name: "Dropdown" });
  expect(panel.querySelector(".dropdown-range")!.textContent).toBe("A1:A4");
  expect((screen.getByLabelText("Option 1") as HTMLInputElement).value).toBe("Done");
  expect((screen.getByLabelText("Option 2") as HTMLInputElement).value).toBe("Todo");
  expect(screen.queryByLabelText("Option 3")).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Done" })));
  expect(screen.queryByRole("dialog", { name: "Dropdown" })).toBeNull();
  expect([value(0, 0), value(1, 0), value(2, 0), value(3, 0)]).toEqual(["Done", "Done", "Todo", "Todo"]);
  const [rule] = rules(2, 0);
  expect(rule.getCriteriaType()).toBe("list");
  expect(JSON.parse(rule.rule.formula1)).toEqual(["Done", "Todo"]);
  expect(rule.rule.error).toContain("Done");
  expect(facade.scrolled.at(-1)).toEqual([0, 0]);
  expect(saves).toBeGreaterThan(0);
});

it("refuses an option with a comma and lets the person fix it", async () => {
  const { ref } = mount({ 0: { 0: { v: "Yes" } } });
  select(h, 0, 0);
  act(() => ref.current!.openNew());
  fireEvent.change(screen.getByLabelText("Option 1"), { target: { value: "Yes, please" } });
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.getByRole("alert").textContent).toContain("can't include a comma");
  fireEvent.change(screen.getByLabelText("Option 1"), { target: { value: "Yes" } });
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Add option" }));
  await wait(20);
  expect(document.activeElement).toBe(screen.getByLabelText("Option 2"));
  fireEvent.change(screen.getByLabelText("Option 2"), { target: { value: " yes " } });
  fireEvent.click(screen.getByRole("button", { name: "Add option" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove option" }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Done" })));
  expect(JSON.parse(rules(0, 0)[0].rule.formula1)).toEqual(["Yes"]);
});

it("edits an existing list, keeps the colour picked for an option, and renames the cells that used it", async () => {
  const { ref } = mount({ 0: { 0: { v: "Open" } }, 1: { 0: { v: "Closed" } } });
  select(h, 0, 0, 2, 1);
  h.sheet().getRange(0, 0, 2, 1).setDataValidation(listRule(["Open", "Closed"]));
  act(() => {
    expect(ref.current!.openExisting()).toBe(true);
  });
  expect(screen.getByRole("dialog", { name: "Dropdown" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Option 1"), { target: { value: "Active" } });
  const swatches = screen.getByRole("group", { name: "Color for Active" });
  fireEvent.click(within(swatches).getByRole("button", { name: "Blue" }));
  expect(within(swatches).getByRole("button", { name: "Blue" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("checkbox", { name: "Reject other values" }));
  expect(document.querySelector(".dropdown-help")!.textContent).toContain("kept and marked");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Done" })));
  expect(value(0, 0)).toBe("Active");
  expect(value(1, 0)).toBe("Closed");
  const [rule] = rules(0, 0);
  expect(JSON.parse(rule.rule.formula1)).toEqual(["Active", "Closed"]);
  expect(rule.rule.formula2.split(",")[0]).toBe(DROPDOWN_COLORS.find((color) => color.name === "Blue")!.value);
  expect(rule.rule.errorStyle).toBe(2);
});

it("opening an existing list without a selection does nothing", () => {
  const { ref } = mount({});
  h.sheet().getRange(0, 0).activate();
  expect(ref.current!.openExisting()).toBe(false);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("reviews the cells that do not match and accepts or skips each suggestion", async () => {
  const { ref } = mount({
    0: { 0: { v: "Paid" } },
    1: { 0: { v: "Piad" } },
    2: { 0: { v: "Unpaid" } },
    3: { 0: { v: "Unpayed" } },
    4: { 0: { v: "Paid" } },
  });
  select(h, 0, 0, 5, 1);
  act(() => ref.current!.openNew());
  for (const label of ["Piad", "Unpayed"]) {
    const index = [...document.querySelectorAll<HTMLInputElement>(".dropdown-options input")].findIndex(
      (input) => input.value === label,
    );
    fireEvent.click(screen.getByRole("button", { name: `Remove ${label}` }));
    expect(index).toBeGreaterThanOrEqual(0);
  }
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Done" })));
  const notice = screen.getByRole("status");
  expect(notice.textContent).toContain("2");
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  const review = screen.getByRole("dialog", { name: "Review values" });
  expect(review.textContent).toContain("1 of 2");
  expect(review.querySelector(".dropdown-bad")!.textContent).toBe("Piad");
  expect(review.textContent).toContain("Use Paid?");
  expect(h.book().getActiveRange().getA1Notation()).toBe("A2");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Accept" })));
  expect(value(1, 0)).toBe("Paid");
  expect(screen.getByRole("dialog", { name: "Review values" }).textContent).toContain("1 of 1");
  expect(h.book().getActiveRange().getA1Notation()).toBe("A4");
  fireEvent.click(screen.getByRole("button", { name: "Skip" }));
  expect(screen.queryByRole("dialog", { name: "Review values" })).toBeNull();
  expect(value(3, 0)).toBe("Unpayed");
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  fireEvent.click(screen.getByRole("button", { name: "Close review" }));
  expect(screen.queryByRole("dialog", { name: "Review values" })).toBeNull();
});

it("skipping through several mismatches walks to the next one", async () => {
  const { ref } = mount({ 0: { 0: { v: "A" } }, 1: { 0: { v: "x1" } }, 2: { 0: { v: "x2" } } });
  select(h, 0, 0, 3, 1);
  act(() => ref.current!.openNew());
  fireEvent.click(screen.getByRole("button", { name: "Remove x1" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove x2" }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Done" })));
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  expect(screen.getByRole("dialog", { name: "Review values" }).textContent).toContain("1 of 2");
  fireEvent.click(screen.getByRole("button", { name: "Skip" }));
  expect(screen.getByRole("dialog", { name: "Review values" }).textContent).toContain("2 of 2");
  expect(h.book().getActiveRange().getA1Notation()).toBe("A3");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Accept" })));
  expect(value(2, 0)).toBe("A");
  expect(screen.queryByRole("dialog", { name: "Review values" })).toBeNull();
});

it("builds a dropdown from a range on another sheet and stores its colours", async () => {
  const { ref } = mount(
    { 0: { 0: { v: "high" } }, 1: { 0: { v: "Low" } } },
    { 0: { 0: { v: "High" } }, 1: { 0: { v: "Low" } }, 2: { 0: { v: "" } } },
  );
  select(h, 0, 0, 2, 1);
  act(() => ref.current!.openNew());
  fireEvent.click(screen.getByRole("radio", { name: "From a range" }));
  expect(screen.getByRole("button", { name: "Done" }).hasAttribute("disabled")).toBe(true);
  const field = screen.getByLabelText("Source range");
  fireEvent.change(field, { target: { value: "Nope!A1:A2" } });
  expect(screen.getByRole("alert").textContent).toBe("No sheet named Nope.");
  fireEvent.change(field, { target: { value: "Lists!C1:C3" } });
  expect(screen.getByRole("alert").textContent).toBe("That range has no values. Blank cells are skipped.");
  fireEvent.change(field, { target: { value: "Lists!A" } });
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.change(field, { target: { value: "Lists!A1:A3" } });
  expect([...document.querySelectorAll(".dropdown-chip")].map((chip) => chip.textContent)).toEqual(["High", "Low"]);
  expect(screen.queryByLabelText("Option 1")).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Done" })));
  expect(value(0, 0)).toBe("High");
  const [rule] = rules(0, 0);
  expect(rule.rule.formula1).toBe("=Lists!$A$1:$A$3");
  expect(Object.keys(rule.rule.bizInfo.suiteleafDropdown.colors)).toEqual(["High", "Low"]);
  expect(rule.rule.bizInfo.suiteleafDropdown.sources).toEqual([
    { row: 0, column: 0, label: "High" },
    { row: 1, column: 0, label: "Low" },
  ]);
  act(() => {
    ref.current!.openExisting();
  });
  expect((screen.getByLabelText("Source range") as HTMLInputElement).value).toBe("Lists!A1:A3");
  fireEvent.click(screen.getByRole("radio", { name: "List" }));
  expect(screen.getByLabelText("Option 1")).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: "From a range" }));
  fireEvent.keyDown(screen.getByRole("dialog", { name: "Dropdown" }), { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "Dropdown" })).toBeNull();
});

it("a range that cannot be read keeps the editor open with the reason", async () => {
  const { ref } = mount({ 0: { 0: { v: "a" } } });
  select(h, 0, 0);
  act(() => ref.current!.openNew());
  fireEvent.click(screen.getByRole("radio", { name: "From a range" }));
  fireEvent.change(screen.getByLabelText("Source range"), { target: { value: "Missing!A1" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Done" })));
  expect(screen.getByRole("alert").textContent).toBe("No sheet named Missing.");
  expect(rules(0, 0)).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog", { name: "Dropdown" })).toBeNull();
});

it("a range list grows when a name is typed under it, and opening it widens the rule", async () => {
  const { ref } = mount({ 0: { 0: { v: "Red" } } }, { 0: { 0: { v: "Red" } }, 1: { 0: { v: "Blue" } } });
  select(h, 0, 0);
  const rule = h.api.newDataValidation().requireValueInRange(h.book().getSheetByName("Lists").getRange("A1:A2")).build();
  h.sheet().getRange(0, 0).setDataValidation(rule);
  expect(rules(0, 0)[0].rule.formula1).toBe("=[book]Lists!A1:A2");
  h.book().getSheetByName("Lists").getRange(2, 0).setValue("Green");
  act(() => {
    ref.current!.openExisting();
  });
  await wait();
  expect([...document.querySelectorAll(".dropdown-chip")].map((chip) => chip.textContent)).toEqual([
    "Red",
    "Blue",
    "Green",
  ]);
  expect(rules(0, 0)[0].rule.formula1).toBe("=Lists!$A$1:$A$3");
});

it("typing on a single dropdown cell filters its options and Enter picks one", async () => {
  const { ref } = mount({ 0: { 0: { v: "" } } });
  h.sheet().getRange(0, 0).setDataValidation(listRule(["Apple", "Banana", "Cherry"]));
  select(h, 0, 0);
  expect(ref.current).toBeTruthy();
  key("a");
  const list = screen.getByRole("listbox", { name: "Dropdown options" });
  expect(list.querySelector("p")!.textContent).toBe("Matching “a”");
  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Apple", "Banana"]);
  expect(screen.getAllByRole("option")[0].querySelector("strong")!.textContent).toBe("A");
  key("ArrowDown");
  key("ArrowDown");
  expect(screen.getAllByRole("option")[1].getAttribute("aria-selected")).toBe("true");
  key("ArrowUp");
  expect(screen.getAllByRole("option")[0].getAttribute("aria-selected")).toBe("true");
  fireEvent.mouseEnter(screen.getAllByRole("option")[1]);
  expect(screen.getAllByRole("option")[1].getAttribute("aria-selected")).toBe("true");
  key("n");
  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Banana"]);
  key("Backspace");
  expect(screen.getAllByRole("option")).toHaveLength(2);
  key("Enter");
  await wait();
  expect(value(0, 0)).toBe("Apple");
  expect(screen.queryByRole("listbox")).toBeNull();
});

it("Escape and a final Backspace close the filter without writing", async () => {
  mount({ 0: { 0: { v: "" } } });
  h.sheet().getRange(0, 0).setDataValidation(listRule(["Apple", "Banana"]));
  select(h, 0, 0);
  key("b");
  key("Escape");
  expect(screen.queryByRole("listbox")).toBeNull();
  key("b");
  key("Backspace");
  expect(screen.queryByRole("listbox")).toBeNull();
  key("x");
  expect(screen.getByRole("listbox").textContent).toContain("No option matches");
  key("Control");
  expect(screen.getByRole("listbox")).toBeTruthy();
  expect(value(0, 0)).toBe("");
});

it("Enter on text that matches nothing is refused when the list rejects others", async () => {
  mount({ 0: { 0: { v: "" } } });
  h.sheet().getRange(0, 0).setDataValidation(listRule(["Apple", "Banana"]));
  select(h, 0, 0);
  key("z");
  key("Enter");
  const refusal = screen.getByRole("alertdialog", { name: "Value not allowed" });
  expect(refusal.textContent).toContain("A1 is marked.");
  expect(refusal.textContent).toContain("Apple");
  fireEvent.click(screen.getByRole("button", { name: "OK" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(value(0, 0)).toBe("");
});

it("Enter on unknown text keeps it in a warning list and says what is allowed", async () => {
  mount({ 0: { 0: { v: "" } } });
  h.sheet().getRange(0, 0).setDataValidation(listRule(["Apple", "Banana"], { reject: false }));
  select(h, 0, 0);
  key("z");
  key("Enter");
  await wait();
  expect(value(0, 0)).toBe("z");
  expect(screen.getByRole("alertdialog").textContent).toContain("Apple");
});

it("a multiple-choice cell adds each pick and keeps the list open", async () => {
  mount({ 0: { 0: { v: "Red" } } });
  h.sheet().getRange(0, 0).setDataValidation(listRule(["Red", "Green", "Blue"], { multiple: true }));
  select(h, 0, 0);
  key("g");
  key("Enter");
  await wait();
  expect(value(0, 0)).toBe("Red, Green");
  const list = screen.getByRole("listbox");
  expect(list.querySelector("p")!.textContent).toBe("Enter adds one. Escape closes the list.");
  key("Backspace");
  expect(screen.getByRole("listbox")).toBeTruthy();
  await act(async () => fireEvent.click(screen.getAllByRole("option")[2]));
  expect(value(0, 0)).toBe("Red, Green, Blue");
  key("Escape");
  expect(screen.queryByRole("listbox")).toBeNull();
});

it("typing into a text field or with a modifier does not open the filter", () => {
  mount({ 0: { 0: { v: "" } } });
  h.sheet().getRange(0, 0).setDataValidation(listRule(["Apple"]));
  select(h, 0, 0);
  const input = document.createElement("input");
  document.body.append(input);
  key("a", input);
  fireEvent.keyDown(document.body, { key: "a", metaKey: true });
  const bar = document.createElement("div");
  bar.dataset.uComp = "formula-bar";
  document.body.append(bar);
  key("a", bar);
  expect(screen.queryByRole("listbox")).toBeNull();
  select(h, 0, 0, 2, 1);
  key("a");
  expect(screen.queryByRole("listbox")).toBeNull();
});

it("arrow keys move through Univer's own dropdown list and Enter picks the highlighted item", () => {
  mount({});
  const list = document.createElement("div");
  list.dataset.uComp = "sheets-dropdown-list";
  const picked: string[] = [];
  for (const name of ["one", "two", "three"]) {
    const item = document.createElement("div");
    item.className = "univer-cursor-pointer";
    item.textContent = name;
    item.addEventListener("click", () => picked.push(name));
    list.append(item);
  }
  document.body.append(list);
  key("ArrowDown");
  key("ArrowDown");
  key("ArrowDown");
  expect(list.querySelectorAll(".suiteleaf-drop-active")[0]?.textContent).toBe("three");
  key("ArrowUp");
  expect(list.querySelector(".suiteleaf-drop-active")!.textContent).toBe("two");
  key("Enter");
  expect(picked).toEqual(["two"]);
});

it("tidies typed values on a dropdown cell and refuses unknown tokens in a multiple list", async () => {
  mount({});
  h.sheet().getRange(0, 0).setDataValidation(listRule(["Ready", "Blocked"]));
  h.sheet().getRange(0, 1).setDataValidation(listRule(["Red", "Blue"], { multiple: true }));
  await act(async () => {
    await h.api.executeCommand("sheet.command.set-range-values", {
      range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
      value: { v: " ready " },
    });
  });
  expect(value(0, 0)).toBe("Ready");
  await act(async () => {
    await h.api.executeCommand("sheet.command.set-range-values", {
      range: { startRow: 0, endRow: 0, startColumn: 1, endColumn: 1 },
      value: { v: "red, purple" },
    });
  });
  expect(screen.getByRole("alertdialog").textContent).toContain("B1 is marked.");
  expect(screen.getByRole("alertdialog").textContent).toContain("purple");
});

it("renaming a source cell renames the cells that chose it", async () => {
  const { ref } = mount(
    { 0: { 0: { v: "Low" } }, 1: { 0: { v: "High" } } },
    { 0: { 0: { v: "Low" } }, 1: { 0: { v: "High" } } },
  );
  select(h, 0, 0, 2, 1);
  act(() => ref.current!.openNew());
  fireEvent.click(screen.getByRole("radio", { name: "From a range" }));
  fireEvent.change(screen.getByLabelText("Source range"), { target: { value: "Lists!A1:A2" } });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Done" })));
  const lists = h.book().getSheetByName("Lists");
  await act(async () => {
    await h.api.executeCommand("sheet.command.set-range-values", {
      subUnitId: lists.getSheetId(),
      range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
      value: { v: "Minor" },
    });
  });
  await wait(120);
  expect(value(0, 0)).toBe("Minor");
  expect(value(1, 0)).toBe("High");
  const [rule] = rules(0, 0);
  expect(rule.rule.bizInfo.suiteleafDropdown.sources.map((cell: { label: string }) => cell.label)).toEqual([
    "Minor",
    "High",
  ]);
});

it("the grid's context menu opens the editor on the block that was right-clicked", async () => {
  const { host } = mount({ 0: { 0: { v: "a" } }, 1: { 0: { v: "b" } } });
  const item = (menus[0] as any)["contextMenu.mainArea"]["contextMenu.others"]["suiteleaf.command.sheet-dropdown"];
  expect(item.menuItemFactory().title).toBe("Dropdown");
  select(h, 0, 0, 2, 1);
  fireEvent.pointerDown(host, { button: 2 });
  select(h, 1, 0);
  await act(async () => {
    await h.injector.get(ICommandService).executeCommand("suiteleaf.command.sheet-dropdown");
  });
  expect(h.book().getActiveRange().getA1Notation()).toBe("A1:A2");
  expect(screen.getByRole("dialog", { name: "Dropdown" }).querySelector(".dropdown-range")!.textContent).toBe(
    "A1:A2",
  );
});

it("Univer's list validator accepts the tidied spelling of an option", async () => {
  mount({});
  const { DataValidatorRegistryService } = await import("@univerjs/data-validation");
  const validator = h.injector.get(DataValidatorRegistryService).getValidatorItem("list");
  const rule = { type: "list", formula1: "Apple,Banana", formula2: "" };
  expect(await validator.isValidType({ value: " apple " }, {}, rule)).toBe(true);
  const multiple = h.injector.get(DataValidatorRegistryService).getValidatorItem("listMultiple");
  expect(await multiple.isValidType({ value: "apple, banana" }, {}, { ...rule, type: "listMultiple" })).toBe(true);
});
