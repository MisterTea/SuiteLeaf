// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, expect, it } from "vitest";
import SheetPrint, { type SheetPrintHandle } from "../../apps/web/src/editors/sheet-print-ui";
import type { PrintContent } from "../../apps/web/src/editors/sheet-print";
import { headlessWorkbook, select, type Headless } from "../sheet-editor-univer";

let h: Headless;
let restore: (() => void) | undefined;

const rows = {
  0: { 0: { v: "Name" }, 1: { v: "Paid" } },
  1: { 0: { v: "Ana" }, 1: { v: 12 } },
  2: { 0: { v: "Ben" }, 1: { v: true } },
  3: { 0: { v: "Cy" }, 1: { v: false } },
};

function mount() {
  h = headlessWorkbook([{ id: "s1", cells: rows }, { id: "s2", name: "Two" }]);
  const content = { current: {} as PrintContent };
  const calls = { persist: 0, print: 0 };
  const ref = createRef<SheetPrintHandle>();
  render(
    <SheetPrint
      api={h.api}
      engine={h.injector}
      content={content}
      persist={() => calls.persist++}
      onPrint={async () => void calls.print++}
      ref={ref}
    />,
  );
  return { ref, content, calls };
}

function paintable() {
  const gaps: unknown[] = [];
  const proto = Object.getPrototypeOf(h.sheet());
  const had = Object.getOwnPropertyDescriptor(proto, "getSkeleton");
  Object.defineProperty(proto, "getSkeleton", {
    configurable: true,
    value: () => ({ setGapConfig: (config: unknown) => gaps.push(config) }),
  });
  restore = () => {
    if (had) Object.defineProperty(proto, "getSkeleton", had);
    else delete proto.getSkeleton;
  };
  return gaps;
}

afterEach(() => {
  cleanup();
  restore?.();
  restore = undefined;
  h?.dispose();
});

const marker = () => document.querySelector(".sheet-print-marker") as HTMLElement;

it("adds and removes a page break above the selected row, with one undo step", async () => {
  const { ref, content, calls } = mount();
  const gaps = paintable();
  act(() => ref.current!.insertPageBreak());
  expect(screen.getByRole("status").textContent).toContain("Select a row below row 1.");
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(screen.queryByRole("status")).toBeNull();
  select(h, 2, 1);
  act(() => ref.current!.insertPageBreak());
  expect(screen.getByRole("status").textContent).toBe(
    "Page break above row 3. That row starts the next printed page.",
  );
  expect(content.current.print?.sheets.s1.breaksAbove).toEqual([2]);
  expect(marker().dataset.pageBreaks).toBe("2");
  expect(calls.persist).toBe(1);
  expect(gaps.at(-1)).toMatchObject({ rowGaps: { 2: { size: 12, color: "#1a73e8" } } });
  await act(async () => void (await h.api.undo()));
  expect(content.current.print?.sheets?.s1).toBeUndefined();
  expect(marker().dataset.pageBreaks).toBe("");
  expect(gaps.at(-1)).toMatchObject({ rowGaps: {} });
  await act(async () => void (await h.api.redo()));
  expect(marker().dataset.pageBreaks).toBe("2");
  act(() => ref.current!.insertPageBreak());
  expect(screen.getByRole("status").textContent).toBe("Removed the page break above row 3.");
  expect(marker().dataset.pageBreaks).toBe("");
});

it("keeps trying to draw the break line until the grid can paint it", async () => {
  const { ref } = mount();
  select(h, 1, 0);
  act(() => ref.current!.insertPageBreak());
  await act(() => new Promise((done) => setTimeout(done, 60)));
  const gaps = paintable();
  await act(() => new Promise((done) => setTimeout(done, 60)));
  expect(gaps).toHaveLength(1);
});

it("previews the printed pages and repeats row 1 when asked", async () => {
  const { ref, content, calls } = mount();
  act(() => ref.current!.openPrintSettings());
  const panel = screen.getByRole("complementary", { name: "Print settings" });
  const repeat = within(panel).getByRole("checkbox", { name: "Repeat row 1 on each page" });
  expect(document.activeElement).toBe(repeat);
  expect(panel.textContent).toContain("One page. The sheet prints as a single flow.");
  expect([...panel.querySelectorAll("tr")].map((row) => row.textContent)).toEqual([
    "NamePaid",
    "Ana12",
    "BenTRUE",
    "CyFALSE",
  ]);
  select(h, 2, 0);
  act(() => ref.current!.insertPageBreak());
  expect(panel.querySelectorAll(".print-page")).toHaveLength(2);
  expect(panel.textContent).toContain("No column names on this page.");
  fireEvent.click(repeat);
  expect(content.current.print?.sheets.s1.repeatFirstRow).toBe(true);
  expect(marker().dataset.repeatRow).toBe("1");
  const second = panel.querySelectorAll(".print-page")[1];
  expect(second.querySelector("tr")!.className).toBe("print-header");
  expect(panel.textContent).not.toContain("No column names on this page.");
  await act(async () => void (await h.api.undo()));
  expect(content.current.print?.sheets.s1.repeatFirstRow).toBe(true);
  fireEvent.click(within(panel).getByRole("button", { name: "Print" }));
  expect(calls.print).toBe(1);
  expect(panel.querySelector(".print-sheet-id")!.textContent).toBe("s1");
  fireEvent.click(within(panel).getByRole("button", { name: "Close print settings" }));
  expect(screen.queryByRole("complementary", { name: "Print settings" })).toBeNull();
});

it("follows the active sheet's settings", async () => {
  const { ref, content } = mount();
  content.current.print = { sheets: { s2: { breaksAbove: [4], repeatFirstRow: true } } };
  await act(async () => h.book().setActiveSheet("s2"));
  expect(marker().dataset.pageBreaks).toBe("4");
  act(() => ref.current!.openPrintSettings());
  expect(screen.getByRole("checkbox", { name: "Repeat row 1 on each page" })).toHaveProperty("checked", true);
  expect(screen.getByRole("complementary", { name: "Print settings" }).textContent).toContain("One page.");
});
