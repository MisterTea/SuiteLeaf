// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("../../apps/web/src/ui", () => ({
  MenuItem: ({ children, onSelect }: { children: ReactNode; onSelect: () => void }) => (
    <button role="menuitem" onClick={onSelect}>
      {children}
    </button>
  ),
}));

const { FilterViewChoices } = await import("../../apps/web/src/editors/sheet-filter-view");
import { callWhenMounted, toggleFilterValueFromLabel } from "../../apps/web/src/editors/sheet-editor-util";
import { checkboxForFilterLabel } from "../../apps/web/src/editors/sheet-phone-gestures";
import { solveOnSheet } from "../../apps/web/src/editors/sheet-solver";
import { formulaTouchesDetail, planGroupRows } from "../../apps/web/src/editors/sheet-row-groups";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

it("lists filter view choices when the submenu opens and picks one", () => {
  const picked: string[] = [];
  let loads = 0;
  render(
    <FilterViewChoices
      load={() => {
        loads++;
        return [
          { label: "Team is Red", value: "Red" },
          { label: "Team is Blue", value: "Blue" },
        ];
      }}
      onPick={(value) => picked.push(value)}
    />,
  );
  expect(loads).toBe(1);
  expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Team is Red", "Team is Blue"]);
  fireEvent.click(screen.getByText("Team is Blue"));
  expect(picked).toEqual(["Blue"]);
});

it("runs a menu action as soon as its helper mounts, and gives up after eight seconds", () => {
  vi.useFakeTimers();
  const ran: string[] = [];
  const ref: { current: string | null } = { current: "ready" };
  callWhenMounted(ref, (value) => ran.push(value));
  ref.current = null;
  callWhenMounted(ref, (value) => ran.push(`late:${value}`));
  vi.advanceTimersByTime(120);
  ref.current = "mounted";
  vi.advanceTimersByTime(50);
  expect(ran).toEqual(["ready", "late:mounted"]);
  ref.current = null;
  callWhenMounted(ref, (value) => ran.push(`never:${value}`));
  vi.advanceTimersByTime(8100);
  ref.current = "too late";
  vi.advanceTimersByTime(100);
  expect(ran).toHaveLength(2);
});

it("ticks a filter value when its name is clicked in the desktop panel, but not from the checkbox itself", () => {
  document.body.innerHTML = `
    <div data-u-comp="sheets-filter-panel">
      <div class="row"><label data-u-comp="checkbox"><input type="checkbox" id="red"></label><span class="name">Red</span></div>
      <div class="row"><button class="expand">›</button><span class="date">2026</span></div>
    </div>`;
  const red = document.getElementById("red") as HTMLInputElement;
  toggleFilterValueFromLabel(new MouseEvent("click", { bubbles: true }));
  const name = document.querySelector(".name")!;
  name.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  toggleFilterValueFromLabel({ target: name } as unknown as MouseEvent);
  expect(red.checked).toBe(true);
  expect(checkboxForFilterLabel(document.querySelector(".date")!)).toBeNull();
  expect(checkboxForFilterLabel(red)).toBeNull();
});

it("ticks a phone filter value from a checkbox that sits before its name", () => {
  document.body.innerHTML = `
    <div data-u-comp="mobile-sheets-filter-by-values">
      <div class="row"><label data-u-comp="checkbox"><input type="checkbox" id="blue"></label><span></span><div class="univer-flex"><span class="name">Blue</span></div></div>
      <div class="row"><span>no box</span><div class="univer-flex"><span class="lonely">Gray</span></div></div>
    </div>`;
  expect(checkboxForFilterLabel(document.querySelector(".name")!)).toBe(document.getElementById("blue"));
  expect(checkboxForFilterLabel(document.querySelector(".lonely")!)).toBeNull();
});

it("refuses a solve with the wrong number of inputs or a formula as an input", async () => {
  const read = (cell: { row: number; column: number }) => ({
    formula: cell.column === 1 || cell.column === 2 ? "=A1*2" : "",
    value: 1,
  });
  const base = { formula: { row: 0, column: 1 }, target: 4, lows: [0, 0], highs: [9, 9], read, write: () => {}, calculate: async () => {} };
  expect(await solveOnSheet({ ...base, inputs: [{ row: 0, column: 0 }] })).toEqual({
    message: "Use one, two, or three inputs.",
    wrote: false,
  });
  expect(await solveOnSheet({ ...base, inputs: [{ row: 0, column: 0 }, { row: 0, column: 1 }] })).toEqual({
    message: "The input cell and the formula cell are the same.",
    wrote: false,
  });
  expect(await solveOnSheet({ ...base, inputs: [{ row: 0, column: 0 }, { row: 0, column: 2 }] })).toEqual({
    message: "That cell has a formula.",
    wrote: false,
  });
  const written: unknown[] = [];
  const failing = await solveOnSheet({
    ...base,
    inputs: [{ row: 0, column: 0 }, { row: 0, column: 3 }],
    write: (_cell, value) => void written.push(value),
    calculate: async () => {
      throw new Error("engine stopped");
    },
  });
  expect(failing).toEqual({ message: "The formula could not be calculated. The inputs were put back.", wrote: false });
  expect(written.slice(-2)).toEqual([1, 1]);
});

it("keeps a total out of a row group when it adds whole rows below it", () => {
  expect(formulaTouchesDetail(["=SUM(3:5)"], 1, 4)).toBe(true);
  expect(formulaTouchesDetail(['="3:5"', "=SUM(9:12)"], 1, 4)).toBe(false);
  expect(planGroupRows({ startRow: 1, endRow: 4 }, ["=SUM(3:5)"])).toEqual({ ok: true, startRow: 2, endRow: 4, keptTotal: true });
});
