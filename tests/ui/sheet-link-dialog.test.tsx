// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, expect, it } from "vitest";
import { cellHyperlink } from "@suiteleaf/core";
import SheetLinks, { type SheetLinkHandle } from "../../apps/web/src/editors/sheet-links";
import { headlessWorkbook, select, type CellSeed, type Headless } from "../sheet-editor-univer";

let h: Headless;
let saves: number;

const frame = () => act(() => new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0))));

function mount(cells: CellSeed = { 1: { 1: { v: "Docs" } }, 2: { 0: { v: 2, f: "=1+1" } } }, inEditor = true) {
  h = headlessWorkbook([{ id: "s1", cells }]);
  saves = 0;
  const editor = document.createElement("div");
  editor.className = "sheets-editor";
  editor.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 700 }) as DOMRect;
  const host = document.createElement("div");
  host.getBoundingClientRect = () => ({ left: 0, top: 40, width: 1000, height: 660 }) as DOMRect;
  if (inEditor) editor.append(host);
  document.body.append(editor);
  const ref = createRef<SheetLinkHandle>();
  render(<SheetLinks api={h.api} persist={() => saves++} host={{ current: host }} ref={ref} />);
  return { ref, editor, host };
}

afterEach(() => {
  cleanup();
  h?.dispose();
  document.body.innerHTML = "";
});

const cell = (row: number, column: number) => h.sheet().getRange(row, column).getCellData();

it("links a cell's text, then shows a card that opens it and edits or removes it", async () => {
  const { ref } = mount();
  select(h, 1, 1);
  await act(async () => ref.current!.open());
  expect(h.ui.map((call) => call.id)).toEqual(["sheet.operation.set-cell-edit-visible"]);
  const dialog = screen.getByRole("dialog", { name: "Insert link" });
  expect((screen.getByLabelText("Link text") as HTMLInputElement).value).toBe("Docs");
  await frame();
  expect(document.activeElement).toBe(screen.getByLabelText("Link address"));
  expect(screen.getByRole("button", { name: "Apply" })).toHaveProperty("disabled", true);
  fireEvent.change(screen.getByLabelText("Link address"), { target: { value: "not a link" } });
  fireEvent.submit(dialog);
  expect(screen.getByRole("alert").textContent).toContain("Enter a web address");
  expect(screen.getByLabelText("Link address").getAttribute("aria-invalid")).toBe("true");
  fireEvent.change(screen.getByLabelText("Link address"), { target: { value: "example.com/docs" } });
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.change(screen.getByLabelText("Link text"), { target: { value: "  Our docs  " } });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(cellHyperlink(cell(1, 1))).toBe("https://example.com/docs");
  expect(cell(1, 1).v).toBe("Our docs");
  expect(h.sheet().getRange(1, 1).getCellStyleData()?.cl?.rgb).toBe("#1a73e8");
  expect(saves).toBe(1);
  await frame();
  const card = screen.getByRole("group", { name: "Cell link" });
  const link = card.querySelector("a")!;
  expect(link.getAttribute("href")).toBe("https://example.com/docs");
  expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  expect(card.style.left).toBe(`${46 + 88 + 88 + 8}px`);
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.getByRole("dialog", { name: "Edit link" })).toBeTruthy();
  expect((screen.getByLabelText("Link address") as HTMLInputElement).value).toBe("https://example.com/docs");
  fireEvent.click(screen.getByRole("button", { name: "Remove link" }));
  expect(cellHyperlink(cell(1, 1))).toBeNull();
  expect(cell(1, 1).v).toBe("Our docs");
  expect(screen.queryByRole("group", { name: "Cell link" })).toBeNull();
});

it("refuses to link a formula cell and closes with Escape, Cancel, the X, or a click outside", async () => {
  const { ref } = mount();
  select(h, 5, 5);
  act(() => ref.current!.open());
  await frame();
  expect(document.activeElement).toBe(screen.getByLabelText("Link text"));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  select(h, 2, 0);
  act(() => ref.current!.open());
  fireEvent.change(screen.getByLabelText("Link address"), { target: { value: "https://a.example" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(screen.getByRole("alert").textContent).toBe("This cell is a formula. Link a cell that holds words.");
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  for (const close of [
    () => fireEvent.click(screen.getByRole("button", { name: "Cancel" })),
    () => fireEvent.click(screen.getByRole("button", { name: "Close link dialog" })),
    () => fireEvent.click(document.querySelector(".gdocs-modal-overlay")!),
  ]) {
    act(() => ref.current!.open());
    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    close();
    expect(screen.queryByRole("dialog")).toBeNull();
  }
  expect(saves).toBe(0);
});

it("Cmd+K in the grid opens the dialog, but not from inside a dialog or outside the editor", () => {
  const { editor } = mount();
  select(h, 1, 1);
  const outside = document.createElement("button");
  document.body.append(outside);
  fireEvent.keyDown(outside, { key: "k", metaKey: true });
  fireEvent.keyDown(editor, { key: "k" });
  fireEvent.keyDown(editor, { key: "k", ctrlKey: true, shiftKey: true });
  fireEvent.keyDown(editor, { key: "j", ctrlKey: true });
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.keyDown(editor, { key: "K", ctrlKey: true });
  const dialog = screen.getByRole("dialog", { name: "Insert link" });
  fireEvent.keyDown(screen.getByLabelText("Link text"), { key: "k", metaKey: true });
  expect(screen.getAllByRole("dialog")).toEqual([dialog]);
});

it("shows a card for a linked cell when the selection lands on it, and plain text for an internal link", async () => {
  const internal = {
    v: "Jump",
    t: 1,
    p: {
      id: "d",
      body: {
        dataStream: "Jump\r\n",
        customRanges: [{ rangeId: "r", rangeType: 0, startIndex: 0, endIndex: 3, properties: { url: "#gid=2" } }],
      },
      documentStyle: {},
    },
  };
  const { host } = mount({ 0: { 0: internal } });
  await act(async () => select(h, 0, 0));
  const card = screen.getByRole("group", { name: "Cell link" });
  expect(card.querySelector("a")).toBeNull();
  expect(card.querySelector("span")!.textContent).toBe("#gid=2");
  fireEvent.pointerDown(card);
  await act(async () => select(h, 3, 3));
  expect(screen.queryByRole("group", { name: "Cell link" })).toBeNull();
  h.sheet().getRange(0, 0).activate();
  host.dispatchEvent(new WheelEvent("wheel"));
  await frame();
  expect(screen.getByRole("group", { name: "Cell link" })).toBeTruthy();
  window.dispatchEvent(new Event("resize"));
  expect(screen.getByRole("group", { name: "Cell link" })).toBeTruthy();
});

it("shows no card when the grid is not inside the editor", async () => {
  const internal = { v: "x", custom: { hyperlink: "https://a.example" } };
  mount({ 0: { 0: internal } }, false);
  await act(async () => select(h, 0, 0));
  expect(screen.queryByRole("group", { name: "Cell link" })).toBeNull();
});
