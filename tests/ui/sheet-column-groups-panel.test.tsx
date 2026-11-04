// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, expect, it } from "vitest";
import { IUniverInstanceService, UniverInstanceType } from "@univerjs/core";
import SheetColumnGroups, { type SheetColumnGroupsHandle } from "../../apps/web/src/editors/sheet-column-groups-ui";
import { headlessWorkbook, select, stubRenderFacade, type CellSeed, type Headless } from "../sheet-editor-univer";
import { frame, gridHost } from "./sheet-group-layout";

let h: Headless;
let facade: ReturnType<typeof stubRenderFacade>;
let saves: number;

const budget: CellSeed = {
  0: { 0: { v: "Team" }, 1: { v: "Jan" }, 2: { v: "Feb" }, 3: { v: "Mar" }, 4: { v: "Year" } },
  1: { 0: { v: "Ops" }, 1: { v: 1 }, 2: { v: 2 }, 3: { v: 3 }, 4: { v: 6, f: "=SUM(B2:D2)" } },
  2: { 0: { v: "Sales" }, 1: { v: 4 }, 2: { v: 5 }, 3: { v: 6 }, 4: { v: 15, f: "=SUM(B3:D3)" } },
};

async function mount(cells: CellSeed = budget, host = true) {
  h = headlessWorkbook([{ id: "s1", cells }, { id: "s2", name: "Other" }]);
  facade = stubRenderFacade(h, { width: 100, height: 20 });
  saves = 0;
  if (host) gridHost();
  const ref = createRef<SheetColumnGroupsHandle>();
  const view = render(<SheetColumnGroups api={h.api} engine={h.injector} persist={() => saves++} ref={ref} />);
  await act(frame);
  return { ref, view };
}

afterEach(() => {
  cleanup();
  facade?.restore();
  h?.dispose();
  document.body.innerHTML = "";
});

const model = () =>
  h.injector.get(IUniverInstanceService).getUnit("book", UniverInstanceType.UNIVER_SHEET).getSheetBySheetId("s1");
const hidden = () => [0, 1, 2, 3, 4].filter((column) => !model().getColVisible(column));
const controls = () => document.querySelector(".column-group-controls") as HTMLElement;

it("groups the month columns, keeps the label and the year total out, and one Undo removes it", async () => {
  const { ref } = await mount();
  select(h, 0, 0, 3, 5);
  await act(async () => ref.current!.groupColumns());
  expect(controls().dataset.span).toBe("1-3");
  expect(model().getCustomMetadata().suiteleafColumnGroups[0]).toMatchObject({ startColumn: 1, endColumn: 3 });
  expect(saves).toBe(1);
  await act(frame);
  expect(document.querySelector(".column-group-line")).toBeTruthy();
  fireEvent.mouseDown(screen.getByRole("button", { name: "Collapse columns B to D" }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Collapse columns B to D" })));
  expect(hidden()).toEqual([1, 2, 3]);
  expect(controls().dataset.collapsed).toBe("1,2,3");
  await act(frame);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Expand columns B to D" })));
  expect(hidden()).toEqual([]);
  await act(frame);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Collapse columns B to D" })));
  await act(async () => void (await h.api.undo()));
  expect(hidden()).toEqual([]);
  expect(model().getCustomMetadata()?.suiteleafColumnGroups).toBeUndefined();
  expect(controls().dataset.span).toBe("");
});

it("explains why a single column or an existing group is not grouped again", async () => {
  const { ref } = await mount();
  select(h, 0, 2);
  await act(async () => ref.current!.groupColumns());
  const dialog = screen.getByRole("dialog", { name: "Nothing to group" });
  expect(dialog.textContent).toContain("Select the detail columns");
  fireEvent.click(screen.getByRole("button", { name: "OK" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(ref.current!.groupSpan(1, 3)).toMatchObject({ ok: true, already: false, keptTotal: false, keptLabel: false });
  select(h, 0, 1, 1, 3);
  await act(async () => ref.current!.groupColumns());
  expect(screen.getByRole("dialog", { name: "Already grouped" })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  await act(async () => ref.current!.groupColumns());
  fireEvent.click(document.querySelector(".gdocs-modal-overlay")!);
  expect(screen.queryByRole("dialog")).toBeNull();
  await act(async () => ref.current!.groupColumns());
  fireEvent.click(screen.getByRole("dialog"));
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(ref.current!.groupSpan(1, 3)).toMatchObject({ ok: true, already: true });
  expect(ref.current!.groupSpan(-1, 3)).toMatchObject({ ok: false });
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("shows only one detail column and reports what stayed out", async () => {
  const { ref } = await mount();
  expect(ref.current!.showOnlyColumn(2)).toEqual({
    ok: false,
    message:
      'There is no column group yet. Call group_columns first, for example {"range":"B:M"}, then show_only_column.',
  });
  expect(ref.current!.groupSpan(0, 4)).toMatchObject({ ok: true, startColumn: 1, endColumn: 3, keptTotal: true, keptLabel: true });
  expect(ref.current!.showOnlyColumn(-1)).toMatchObject({ ok: false });
  expect(ref.current!.showOnlyColumn(4)).toMatchObject({
    ok: false,
    message: expect.stringContaining("Column E is outside the group"),
  });
  let result: unknown;
  await act(async () => {
    result = ref.current!.showOnlyColumn(2);
  });
  expect(result).toEqual({ ok: true, startColumn: 1, endColumn: 3, kept: 2, collapsed: [1, 3], label: "Feb" });
  expect(hidden()).toEqual([1, 3]);
});

it("offers Show only for the selected month and puts the toggle beside the label when all are hidden", async () => {
  const { ref } = await mount();
  await act(async () => void ref.current!.groupSpan(1, 3));
  await act(async () => select(h, 0, 2));
  await act(frame);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Show only Feb" })));
  expect(hidden()).toEqual([1, 3]);
  await act(frame);
  expect(screen.queryByRole("button", { name: "Show only Feb" })).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Collapse columns B to D" })));
  await act(frame);
  const expand = screen.getByRole("button", { name: "Expand columns B to D" });
  expect(Number.parseFloat(expand.style.left)).toBeLessThan(140);
});

it("hides the controls on another sheet and when the grid is not on the page", async () => {
  const { ref } = await mount(budget, false);
  await act(async () => void ref.current!.groupSpan(1, 3));
  await act(frame);
  expect(document.querySelectorAll(".column-group-toggle")).toHaveLength(0);
  gridHost();
  await act(frame);
  expect(document.querySelectorAll(".column-group-toggle")).toHaveLength(1);
  await act(async () => h.book().setActiveSheet("s2"));
  await act(frame);
  expect(document.querySelectorAll(".column-group-toggle")).toHaveLength(0);
});
