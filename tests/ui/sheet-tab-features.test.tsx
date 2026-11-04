// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import SheetFeatures from "../../apps/web/src/editors/sheet-features";
import SheetList from "../../apps/web/src/editors/sheet-list";
import { localName } from "../../apps/web/src/identity";
import { headlessWorkbook, select, type Headless } from "../sheet-editor-univer";

vi.hoisted(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    },
  });
});

let h: Headless;

afterEach(() => {
  cleanup();
  h?.dispose();
});

const settle = () => act(() => new Promise((done) => setTimeout(done, 0)));

function features() {
  h = headlessWorkbook([
    { id: "s1", name: "Budget", cells: { 0: { 0: { v: "x" } } } },
    { id: "s2", name: "Notes" },
  ]);
  const log = { saves: 0, errors: [] as string[] };
  const ref = createRef<{ openTabs: () => void; openCommentName: () => void }>();
  render(<SheetFeatures api={h.api} persist={() => log.saves++} onError={(e) => log.errors.push(e)} ref={ref} />);
  return { ref, log };
}

it("protects the sheet and a range, then lifts both", async () => {
  const { ref, log } = features();
  act(() => ref.current!.openTabs());
  await settle();
  const dialog = screen.getByRole("dialog", { name: "Tabs and protection" });
  expect(dialog.textContent).toContain("Active sheet: Budget");
  fireEvent.click(within(dialog).getByRole("button", { name: "Protect sheet" }));
  await settle();
  const permission = () => h.sheet().getWorksheetPermission();
  expect(permission().isProtected()).toBe(true);
  expect(h.sheet().getCustomMetadata().suiteleafProtection).toEqual({ sheet: true });
  fireEvent.click(within(dialog).getByRole("button", { name: "Unprotect sheet" }));
  await settle();
  expect(permission().isProtected()).toBe(false);
  expect(h.sheet().getCustomMetadata().suiteleafProtection).toEqual({ sheet: false });
  fireEvent.click(within(dialog).getByRole("button", { name: "Unprotect sheet" }));
  await settle();
  select(h, 0, 0, 2, 2);
  fireEvent.click(within(dialog).getByRole("button", { name: "Protect selected range" }));
  await settle();
  expect(dialog.textContent).toContain("A1:B2");
  const rules = await permission().listRangeProtectionRules({ ignoreCollaborators: true });
  expect(rules).toHaveLength(1);
  fireEvent.click(within(dialog).getByRole("button", { name: "Remove protection" }));
  await settle();
  expect(await permission().listRangeProtectionRules({ ignoreCollaborators: true })).toHaveLength(0);
  expect(dialog.textContent).not.toContain("A1:B2");
  expect(log.saves).toBe(5);
  expect(log.errors).toEqual([]);
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("hides and shows tabs, keeps one visible, colours a tab, and groups tabs", async () => {
  const { ref, log } = features();
  act(() => ref.current!.openTabs());
  await settle();
  const dialog = screen.getByRole("dialog", { name: "Tabs and protection" });
  const rows = () => [...dialog.querySelectorAll(".tab-settings-row")] as HTMLElement[];
  fireEvent.click(within(rows()[1]).getByRole("button", { name: "Hide" }));
  await settle();
  expect(h.book().getSheetBySheetId("s2").isSheetHidden()).toBe(true);
  expect(rows()[1].textContent).toContain("Notes (hidden)");
  fireEvent.click(within(rows()[0]).getByRole("button", { name: "Hide" }));
  await settle();
  expect(log.errors).toEqual(["Keep at least one sheet visible."]);
  fireEvent.click(within(rows()[1]).getByRole("button", { name: "Show" }));
  await settle();
  expect(h.book().getSheetBySheetId("s2").isSheetHidden()).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Tab color for Notes" }));
  const picker = screen.getByRole("dialog", { name: "Tab color for Notes" });
  fireEvent.change(within(picker).getByLabelText("Green"), { target: { value: "0" } });
  fireEvent.keyDown(within(picker).getByLabelText("Green"), { key: "Enter" });
  await settle();
  expect(h.book().getSheetBySheetId("s2").getTabColor()).toBe("#ff00ff");
  const assign = within(dialog).getByRole("button", { name: "Remove from group" });
  fireEvent.click(within(rows()[1]).getByRole("checkbox"));
  fireEvent.change(within(dialog).getByPlaceholderText("e.g. Quarterly reports"), { target: { value: " Q1 " } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Assign group" }));
  await settle();
  expect(h.book().getSheetBySheetId("s1").getCustomMetadata().suiteleafTabGroup).toBe("Q1");
  expect(h.book().getSheetBySheetId("s2").getCustomMetadata().suiteleafTabGroup).toBe("Q1");
  fireEvent.click(within(rows()[0]).getByRole("checkbox"));
  fireEvent.click(within(rows()[1]).getByRole("checkbox"));
  expect(assign).toHaveProperty("disabled", true);
  fireEvent.click(document.querySelector(".gdocs-modal-overlay")!);
  expect(screen.queryByRole("dialog", { name: "Tabs and protection" })).toBeNull();
  act(() => ref.current!.openTabs());
  expect((screen.getByPlaceholderText("e.g. Quarterly reports") as HTMLInputElement).value).toBe("Q1");
  fireEvent.click(screen.getByRole("button", { name: "Close tabs and protection" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("asks for a range before protecting one", async () => {
  const { ref, log } = features();
  act(() => ref.current!.openTabs());
  const proto = Object.getPrototypeOf(h.book());
  const spy = vi.spyOn(proto, "getActiveRange").mockReturnValue(null);
  fireEvent.click(screen.getByRole("button", { name: "Protect selected range" }));
  await settle();
  spy.mockRestore();
  expect(log.errors).toEqual(["Select a range first."]);
});

it("saves the name used to sign comments on this device", () => {
  const { ref } = features();
  act(() => ref.current!.openCommentName());
  const dialog = screen.getByRole("dialog", { name: "Your name on comments" });
  const field = within(dialog).getByLabelText("Your name");
  expect(document.activeElement).toBe(field);
  fireEvent.change(field, { target: { value: "  Robin Lee " } });
  fireEvent.submit(dialog);
  expect(localName()).toBe("Robin Lee");
  expect(screen.queryByRole("dialog")).toBeNull();
  for (const close of [
    () => fireEvent.click(screen.getByRole("button", { name: "Cancel" })),
    () => fireEvent.click(screen.getByRole("button", { name: "Close" })),
    () => fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }),
    () => fireEvent.click(document.querySelector(".gdocs-modal-overlay")!),
  ]) {
    act(() => ref.current!.openCommentName());
    expect((screen.getByLabelText("Your name") as HTMLInputElement).value).toBe("Robin Lee");
    fireEvent.click(screen.getByRole("dialog"));
    close();
    expect(screen.queryByRole("dialog")).toBeNull();
  }
});

it("renders nothing without a workbook", () => {
  const view = render(
    <SheetFeatures api={{ getActiveWorkbook: () => null } as never} persist={() => {}} onError={() => {}} />,
  );
  expect(view.container.innerHTML).toBe("");
});

it("lists every sheet with its first value and shows a hidden one when chosen", async () => {
  h = headlessWorkbook([
    { id: "s1", name: "Summary", cells: { 1: { 2: { v: "  Totals\nfor   2026 " } } } },
    { id: "s2", name: "Raw", hidden: true },
  ]);
  const log = { saves: 0, errors: [] as string[] };
  const ref = createRef<{ open: () => void }>();
  render(<SheetList api={h.api} persist={() => log.saves++} onError={(e) => log.errors.push(e)} ref={ref} />);
  expect(screen.queryByRole("dialog")).toBeNull();
  act(() => ref.current!.open());
  const dialog = screen.getByRole("dialog", { name: "Sheet list" });
  const items = within(dialog).getAllByRole("listitem");
  expect(items[0].getAttribute("aria-current")).toBe("true");
  expect(items[0].textContent).toBe("SummaryTotals for 2026Current");
  expect(items[1].textContent).toBe("RawEmptyHidden");
  expect(document.activeElement).toBe(within(items[0]).getByRole("button"));
  fireEvent.click(within(items[1]).getByRole("button"));
  expect(h.book().getSheetBySheetId("s2").isSheetHidden()).toBe(false);
  expect(h.book().getActiveSheet().getSheetId()).toBe("s2");
  expect(log.saves).toBe(1);
  expect(screen.queryByRole("dialog")).toBeNull();
  act(() => ref.current!.open());
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  act(() => ref.current!.open());
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  act(() => ref.current!.open());
  fireEvent.click(screen.getByRole("dialog"));
  fireEvent.click(document.querySelector(".sheet-list-overlay")!);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("reports a hidden sheet that will not show, and a sheet that cannot be read", () => {
  const sheet = (name: string, hidden: boolean, broken = false) => ({
    getSheetId: () => name,
    getSheetName: () => name,
    isSheetHidden: () => hidden,
    showSheet: () => {},
    activate: () => {},
    getLastRow: () => {
      if (broken) throw new Error("gone");
      return 0;
    },
    getLastColumn: () => 0,
    getRange: () => ({ getDisplayValue: () => "" }),
  });
  const sheets = [sheet("Main", false, true), sheet("Stuck", true)];
  const book = { getActiveSheet: () => sheets[0], getSheets: () => sheets };
  const errors: string[] = [];
  const ref = createRef<{ open: () => void }>();
  render(
    <SheetList api={{ getActiveWorkbook: () => book } as never} persist={() => {}} onError={(e) => errors.push(e)} ref={ref} />,
  );
  act(() => ref.current!.open());
  expect(screen.getAllByRole("listitem")[0].textContent).toContain("Empty");
  fireEvent.click(within(screen.getAllByRole("listitem")[1]).getByRole("button"));
  expect(errors).toEqual(["Couldn't show Stuck."]);
  expect(screen.getByRole("dialog")).toBeTruthy();
});

it("does not open the list without a workbook", () => {
  const ref = createRef<{ open: () => void }>();
  const view = render(<SheetList api={{ getActiveWorkbook: () => null } as never} persist={() => {}} onError={() => {}} ref={ref} />);
  act(() => ref.current!.open());
  expect(view.container.innerHTML).toBe("");
});
