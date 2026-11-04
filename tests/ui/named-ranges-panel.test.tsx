// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { IDefinedNamesService, IFunctionService, LexerTreeBuilder } from "@univerjs/engine-formula";
import { afterEach, describe, expect, it, vi } from "vitest";
import NamedRanges, { type NamedRangesHandle } from "../../apps/web/src/editors/named-ranges-ui";

afterEach(cleanup);

type Range = { startRow: number; startColumn: number; endRow: number; endColumn: number };

function fakeWorkbook(options: { current?: Range | null; names?: Record<string, { id: string; name: string; formulaOrRefString: string; hidden?: boolean }> } = {}) {
  let current: Range | null = options.current === undefined ? { startRow: 0, startColumn: 0, endRow: 1, endColumn: 1 } : options.current;
  const names = options.names ?? {
    b: { id: "b", name: "Rent", formulaOrRefString: "Budget!$A$1:$B$2" },
    a: { id: "a", name: "Food", formulaOrRefString: "Costs!$C$3" },
    h: { id: "h", name: "Secret", formulaOrRefString: "Budget!$D$1", hidden: true },
    p: { id: "p", name: "_xlnm.Print_Area", formulaOrRefString: "Budget!$A$1" },
  };
  const commandListeners: ((command: { id?: string }) => void)[] = [];
  const updateListeners: (() => void)[] = [];
  const rangeListeners: (() => void)[] = [];
  const sheet = { getSheetName: () => "Budget" };
  const workbook = {
    getId: () => "wb",
    getActiveSheet: () => sheet,
    getActiveRange: () => (current ? { getRange: () => current } : null),
    getSheets: () => [sheet, { getSheetName: () => "Costs" }],
    onCommandExecuted: (listener: (command: { id?: string }) => void) => {
      commandListeners.push(listener);
      return { dispose: vi.fn() };
    },
    getDefinedName: vi.fn((name: string) =>
      Object.values(names).some((item) => item.name === name)
        ? { toBuilder: () => ({ setName: (next: string) => ({ build: () => ({ renamedTo: next }) }) }) }
        : null,
    ),
    updateDefinedNameBuilder: vi.fn(),
    insertDefinedName: vi.fn(),
  };
  const defined = {
    getDefinedNameMap: vi.fn(() => names),
    getCurrentRange: () => undefined,
    setCurrentRange: vi.fn(),
    focusRange: vi.fn(),
    update$: { subscribe: (listener: () => void) => (updateListeners.push(listener), { unsubscribe: vi.fn() }) },
    currentRange$: { subscribe: (listener: () => void) => (rangeListeners.push(listener), { unsubscribe: vi.fn() }) },
  };
  const lexer = {
    convertRefersToAbsolute: (raw: string) => raw.replace(/([A-Z]+)(\d+)/g, "$$$1$$$2"),
  };
  const functions = { hasExecutor: (name: string) => name === "SUM" };
  const engine = {
    get: (token: unknown) =>
      token === IDefinedNamesService ? defined : token === LexerTreeBuilder ? lexer : token === IFunctionService ? functions : null,
  };
  return {
    api: { getActiveWorkbook: () => workbook },
    engine,
    workbook,
    defined,
    names,
    select: (range: Range | null) => {
      current = range;
    },
    command: (id: string) => act(() => commandListeners.forEach((listener) => listener({ id }))),
    update: () => act(() => updateListeners.forEach((listener) => listener())),
    rangeChanged: () => act(() => rangeListeners.forEach((listener) => listener())),
  };
}

function openPanel(fake = fakeWorkbook(), engine: unknown = fake.engine) {
  const ref = createRef<NamedRangesHandle>();
  const persist = vi.fn();
  render(<NamedRanges api={fake.api} engine={engine as never} persist={persist} ref={ref} />);
  expect(screen.queryByRole("dialog")).toBeNull();
  act(() => ref.current!.open());
  return { fake, persist, ref, field: () => screen.getByLabelText("Range name") as HTMLInputElement };
}

const typeName = (name: string) => fireEvent.change(screen.getByLabelText("Range name"), { target: { value: name } });

describe("named ranges", () => {
  it("lists the visible names in order and shows the selection", () => {
    openPanel();
    expect(screen.getByRole("dialog", { name: "Named ranges" })).toBeTruthy();
    expect(screen.getByText(/This selection is/).textContent).toBe("This selection is Rent · A1:B2");
    const jumps = screen.getAllByRole("button", { name: /^Go to / }).map((button) => button.getAttribute("aria-label"));
    expect(jumps).toEqual(["Go to Food, Costs!C3", "Go to Rent, A1:B2"]);
    expect(screen.getByRole("button", { name: "Add" })).toHaveProperty("disabled", true);
  });

  it("adds a name for the selection and saves", () => {
    const { fake, persist } = openPanel();
    fake.select({ startRow: 4, startColumn: 2, endRow: 4, endColumn: 2 });
    fake.command("sheet.operation.set-selections");
    expect(screen.getByText(/^Selection/).textContent).toBe("Selection C5");
    typeName("Water");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(fake.workbook.insertDefinedName).toHaveBeenCalledWith("Water", "Budget!$C$5");
    expect(screen.getByText("Added Water for C5.")).toBeTruthy();
    expect(fake.defined.setCurrentRange).toHaveBeenCalled();
    expect(persist).toHaveBeenCalled();
    expect(screen.getByLabelText("Range name")).toHaveProperty("value", "");
  });

  it("explains names that cannot be used", () => {
    openPanel();
    typeName("SUM");
    expect(screen.getByRole("alert").textContent).toContain("SUM is a formula function");
    typeName("Costs");
    expect(screen.getByRole("alert").textContent).toContain("Costs is already a sheet");
    typeName("rent");
    expect(screen.getByRole("alert").textContent).toBe("Rent is already a named range. That name was kept.");
    expect(screen.getByLabelText("Range name").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("button", { name: "Add" })).toHaveProperty("disabled", true);
    fireEvent.submit(screen.getByLabelText("Range name").closest("form")!);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("renames a name, and clears the note once the new name is undone", () => {
    const { fake, persist } = openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Rename Rent" }));
    expect(screen.getByText("New name for Rent")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rename" })).toHaveProperty("disabled", true);
    typeName("Lease");
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(fake.workbook.updateDefinedNameBuilder).toHaveBeenCalledWith({ renamedTo: "Lease" });
    expect(screen.getByText(/Formulas that used Rent now use Lease/)).toBeTruthy();
    expect(persist).toHaveBeenCalled();
    fake.update();
    expect(screen.queryByText(/now use Lease/)).toBeNull();
  });

  it("keeps the rename note while the new name still exists", () => {
    const { fake } = openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Rename Rent" }));
    typeName("Lease");
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fake.names.b = { ...fake.names.b, name: "Lease" };
    fake.update();
    expect(screen.getByText(/now use Lease/)).toBeTruthy();
    fake.command("univer.command.undo");
    expect(screen.queryByText(/now use Lease/)).toBeNull();
  });

  it("cancels a rename", () => {
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Rename Food" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Name")).toBeTruthy();
    expect(screen.getByLabelText("Range name")).toHaveProperty("value", "");
  });

  it("does nothing when the name being renamed has gone", () => {
    const { fake } = openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Rename Rent" }));
    fake.workbook.getDefinedName.mockReturnValueOnce(null);
    typeName("Lease");
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(fake.workbook.updateDefinedNameBuilder).not.toHaveBeenCalled();
  });

  it("jumps to a named range", () => {
    const { fake } = openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Go to Food, Costs!C3" }));
    expect(fake.defined.focusRange).toHaveBeenCalledWith("wb", "a");
  });

  it("reports a name the workbook refused", () => {
    const { fake } = openPanel(fakeWorkbook({ current: { startRow: 2, startColumn: 2, endRow: 2, endColumn: 2 } }));
    fake.workbook.insertDefinedName.mockImplementationOnce(() => {
      throw new Error("The workbook is locked.");
    });
    typeName("Water");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("alert").textContent).toBe("The workbook is locked.");
    fake.workbook.insertDefinedName.mockImplementationOnce(() => {
      throw new Error("Invalid name");
    });
    typeName("Water2");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("alert").textContent).toBe("Water2 can't be used as a name. Try a word like Rent.");
  });

  it("asks for a selection when nothing is selected", () => {
    const { fake } = openPanel(fakeWorkbook({ current: null, names: {} }));
    expect(screen.getByText("Select the cells you want to name.")).toBeTruthy();
    expect(screen.getByText(/No named ranges yet/)).toBeTruthy();
    typeName("Water");
    expect(screen.getByRole("button", { name: "Add" })).toHaveProperty("disabled", true);
    fake.select({ startRow: 0, startColumn: 0, endRow: 0, endColumn: 0 });
    fake.rangeChanged();
    expect(screen.getByRole("button", { name: "Add" })).toHaveProperty("disabled", false);
  });

  it("closes with Escape and with the close button", () => {
    const { ref } = openPanel();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => ref.current!.open());
    fireEvent.click(screen.getByRole("button", { name: "Close named ranges" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stays empty until the engine is there", () => {
    openPanel(fakeWorkbook(), null);
    expect(screen.getByText("Select the cells you want to name.")).toBeTruthy();
    typeName("SUM");
    expect(screen.queryByText(/formula function/)).toBeNull();
  });
});
