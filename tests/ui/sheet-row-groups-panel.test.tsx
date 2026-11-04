// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, expect, it } from "vitest";
import { IUniverInstanceService, UniverInstanceType } from "@univerjs/core";
import SheetRowGroups, { type SheetRowGroupsHandle } from "../../apps/web/src/editors/sheet-row-groups-ui";
import { headlessWorkbook, select, stubRenderFacade, type CellSeed, type Headless } from "../sheet-editor-univer";
import { frame, gridHost } from "./sheet-group-layout";

let h: Headless;
let facade: ReturnType<typeof stubRenderFacade>;
let saves: number;

const ledger: CellSeed = {
  0: { 0: { v: "Item" }, 1: { v: "Cost" } },
  1: { 0: { v: "Travel" }, 1: { v: 9, f: "=SUM(B3:B5)" } },
  2: { 0: { v: "Train" }, 1: { v: 2 } },
  3: { 0: { v: "Hotel" }, 1: { v: 3 } },
  4: { 0: { v: "Meals" }, 1: { v: 4 } },
  5: { 0: { v: "Office" }, 1: { v: 1 } },
};

async function mount(cells: CellSeed = ledger, host = true) {
  h = headlessWorkbook([{ id: "s1", cells }, { id: "s2", name: "Other" }]);
  facade = stubRenderFacade(h, { width: 100, height: 20 });
  saves = 0;
  if (host) gridHost();
  const ref = createRef<SheetRowGroupsHandle>();
  render(<SheetRowGroups api={h.api} engine={h.injector} persist={() => saves++} ref={ref} />);
  await act(frame);
  return ref;
}

afterEach(() => {
  cleanup();
  facade?.restore();
  h?.dispose();
  document.body.innerHTML = "";
});

const model = () =>
  h.injector.get(IUniverInstanceService).getUnit("book", UniverInstanceType.UNIVER_SHEET).getSheetBySheetId("s1");
const hidden = () => [0, 1, 2, 3, 4, 5].filter((row) => !model().getRowVisible(row));
const controls = () => document.querySelector(".row-group-controls") as HTMLElement;

it("groups the detail rows under a total, collapses them, and one Undo removes the group", async () => {
  const ref = await mount();
  select(h, 1, 0, 4, 2);
  await act(async () => ref.current!.groupRows());
  expect(model().getCustomMetadata().suiteleafRowGroups[0]).toMatchObject({ startRow: 2, endRow: 4 });
  expect(saves).toBe(1);
  await act(frame);
  expect(document.querySelector(".row-group-line")).toBeTruthy();
  fireEvent.mouseDown(screen.getByRole("button", { name: "Collapse rows 3 to 5" }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Collapse rows 3 to 5" })));
  expect(hidden()).toEqual([2, 3, 4]);
  expect(controls().dataset.collapsed).toBe("2,3,4");
  await act(frame);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Expand rows 3 to 5" })));
  expect(hidden()).toEqual([]);
  await act(frame);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Collapse rows 3 to 5" })));
  await act(async () => void (await h.api.undo()));
  expect(hidden()).toEqual([]);
  expect(model().getCustomMetadata()?.suiteleafRowGroups).toBeUndefined();
});

it("explains a single row, an existing group, and a missing selection", async () => {
  const ref = await mount();
  select(h, 2, 0);
  await act(async () => ref.current!.groupRows());
  expect(screen.getByRole("dialog", { name: "Nothing to group" }).textContent).toContain("Select the detail rows");
  fireEvent.click(screen.getByRole("button", { name: "OK" }));
  expect(ref.current!.groupSpan(2, 4)).toEqual({ ok: true, startRow: 2, endRow: 4, keptTotal: false, already: false });
  select(h, 2, 0, 3, 1);
  await act(async () => ref.current!.groupRows());
  expect(screen.getByRole("dialog", { name: "Already grouped" })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await act(async () => ref.current!.groupRows());
  fireEvent.click(screen.getByRole("dialog"));
  fireEvent.click(document.querySelector(".gdocs-modal-overlay")!);
  expect(screen.queryByRole("dialog")).toBeNull();
  await act(async () => ref.current!.groupRows());
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(ref.current!.groupSpan(2, 4)).toMatchObject({ already: true });
  expect(ref.current!.groupSpan(3, 3)).toMatchObject({ ok: false });
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("shows only one detail row and explains rows outside the group", async () => {
  const ref = await mount();
  expect(ref.current!.showOnlyRow(3)).toMatchObject({ ok: false, message: expect.stringContaining("no row group yet") });
  expect(ref.current!.groupSpan(1, 4)).toMatchObject({ ok: true, startRow: 2, keptTotal: true });
  expect(ref.current!.showOnlyRow(1.5)).toMatchObject({ ok: false, message: "Give a detail row to keep, such as row 2." });
  expect(ref.current!.showOnlyRow(0)).toMatchObject({ ok: false, message: expect.stringContaining("Row 1 is outside") });
  expect(ref.current!.showOnlyRow(9)).toMatchObject({ ok: false, message: expect.stringContaining("no row group yet") });
  let result: unknown;
  await act(async () => {
    result = ref.current!.showOnlyRow(3);
  });
  expect(result).toEqual({ ok: true, startRow: 2, endRow: 4, kept: 3, collapsed: [2, 4], label: "Hotel" });
  expect(hidden()).toEqual([2, 4]);
});

it("offers Show only for the selected detail row", async () => {
  const ref = await mount();
  await act(async () => void ref.current!.groupSpan(2, 4));
  await act(async () => select(h, 3, 0));
  await act(frame);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Show only Hotel" })));
  expect(hidden()).toEqual([2, 4]);
  await act(frame);
  expect(screen.queryByRole("button", { name: "Show only Hotel" })).toBeNull();
  expect(screen.getByRole("button", { name: "Expand rows 3 to 5" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Collapse rows 3 to 5" })).toBeTruthy();
});

it("a group at the top row anchors on itself, and other sheets show no controls", async () => {
  const ref = await mount(ledger, false);
  await act(async () => void ref.current!.groupSpan(0, 2));
  await act(frame);
  expect(document.querySelectorAll(".row-group-toggle")).toHaveLength(0);
  gridHost();
  await act(frame);
  expect(screen.getByRole("button", { name: "Collapse rows 1 to 3" })).toBeTruthy();
  await act(async () => h.book().setActiveSheet("s2"));
  await act(frame);
  expect(document.querySelectorAll(".row-group-toggle")).toHaveLength(0);
});
