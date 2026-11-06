// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from "vitest";
import { IRenderManagerService } from "@univerjs/engine-render";
import { SheetsNoteModel } from "@univerjs/sheets-note";
import { SheetsNotePopupService } from "@univerjs/preset-sheets-note";
import { watchPhoneTaps, watchSheetSelection } from "../../apps/web/src/editors/sheet-grid-watchers";
import type { RemoteSheetSelection, SheetSelection } from "../../apps/web/src/collab/selection";
import { headlessWorkbook, select, stubRenderFacade, type Headless } from "../sheet-editor-univer";

let h: Headless;
let facade: ReturnType<typeof stubRenderFacade>;
let stop: (() => void) | undefined;
let width: number;

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

function canvasAt(left: number, top: number) {
  const canvas = document.createElement("canvas");
  canvas.style.width = "800px";
  canvas.getBoundingClientRect = () =>
    ({ left, top, right: left + 800, bottom: top + 600, width: 800, height: 600 }) as DOMRect;
  return canvas;
}

function setup({ render = true }: { render?: boolean } = {}) {
  h = headlessWorkbook([{ id: "s1", cells: { 0: { 0: { v: "Head" } } } }, { id: "s2", name: "Other" }]);
  facade = stubRenderFacade(h, { width: 100, height: 20 });
  const scroll: (() => void)[] = [];
  const popups = { active: null as any, shown: [] as unknown[], hidden: 0 };
  const notes = new Map<string, { id: string }>([["s1:2:2", { id: "n1" }]]);
  const viewport = {
    viewportScrollX: 0,
    viewportScrollY: 0,
    onScrollAfter$: {
      subscribeEvent: (fn: () => void) => {
        scroll.push(fn);
        return { unsubscribe: () => scroll.splice(scroll.indexOf(fn), 1) };
      },
    },
  };
  const unit = {
    scene: { getViewport: () => viewport, getAncestorScale: () => ({ scaleX: 1, scaleY: 1 }) },
    engine: { getCanvasElement: () => canvasAt(10, 30) },
  };
  const injector = {
    get: (token: unknown) => {
      if (token === SheetsNotePopupService)
        return {
          get activePopup() {
            return popups.active;
          },
          hidePopup: () => {
            popups.hidden++;
            popups.active = null;
          },
          showPopup: (popup: unknown) => {
            popups.shown.push(popup);
            popups.active = popup;
          },
        };
      if (token === SheetsNoteModel)
        return {
          getNote: (_unit: string, sheet: string, at: { row: number; col: number }) =>
            notes.get(`${sheet}:${at.row}:${at.col}`) ?? null,
        };
      if (token === IRenderManagerService) return { getRenderUnitById: () => (render ? unit : null) };
      return h.injector.get(token);
    },
  };
  const host = document.createElement("div");
  document.body.append(host);
  return { injector, host, popups, scroll, viewport };
}

beforeEach(() => {
  width = window.innerWidth;
});

afterEach(() => {
  stop?.();
  stop = undefined;
  facade?.restore();
  h?.dispose();
  document.body.innerHTML = "";
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
});

const phone = () => Object.defineProperty(window, "innerWidth", { configurable: true, value: 400 });

function selection(injector: any, host: HTMLDivElement, remote: RemoteSheetSelection[] = []) {
  const reported: SheetSelection[] = [];
  const placeRemoteRef = { current: () => {} };
  stop = watchSheetSelection({
    injector,
    workbook: h.book(),
    sheetHost: host,
    reportSelection: { current: (next) => reported.push(next) },
    placeRemoteRef,
    remoteSelectionsRef: { current: remote },
  });
  return { reported, placeRemoteRef };
}

it("attaches scroll tracking when the viewport appears after workbook startup", () => {
  const { injector, host, scroll, viewport } = setup();
  let painted = false;
  const lazyInjector = { get: (token: unknown) => {
    const service = injector.get(token);
    return token === IRenderManagerService ? { getRenderUnitById: () => painted ? service.getRenderUnitById() : null } : service;
  } };
  selection(lazyInjector, host);
  expect(scroll).toHaveLength(0);
  painted = true;
  select(h, 1, 1);
  expect(scroll).toHaveLength(1);
  viewport.viewportScrollY = 20;
  scroll[0]();
  expect(JSON.parse(host.dataset.activeCell!).top).toBe(30);
});

it("reports each selection and places the active cell's corner on screen", () => {
  const { injector, host, scroll, viewport } = setup();
  const { reported } = selection(injector, host);
  select(h, 1, 1, 2, 2);
  expect(reported.at(-1)).toEqual({ sheetId: "s1", startRow: 1, startColumn: 1, endRow: 2, endColumn: 2 });
  expect(JSON.parse(host.dataset.activeCell!)).toEqual({ left: 210, top: 70, right: 310, bottom: 90 });
  viewport.viewportScrollY = 20;
  scroll[0]();
  expect(JSON.parse(host.dataset.activeCell!).top).toBe(50);
});

it("closes a note when the selection leaves its cell and opens a note on a phone tap", () => {
  const { injector, host, popups } = setup();
  selection(injector, host);
  popups.active = { subUnitId: "s1", row: 0, col: 0 };
  select(h, 0, 0);
  expect(popups.hidden).toBe(0);
  select(h, 4, 4);
  expect(popups.hidden).toBe(1);
  select(h, 2, 2);
  expect(popups.shown).toEqual([]);
  phone();
  select(h, 5, 5);
  select(h, 2, 2);
  expect(popups.shown).toEqual([{ unitId: "book", subUnitId: "s1", noteId: "n1", row: 2, col: 2 }]);
  select(h, 3, 3);
  expect(popups.shown).toHaveLength(1);
});

it("draws other people's selections on this sheet only, with their names", () => {
  const { injector, host } = setup();
  const remote = [
    { sheetId: "s1", startRow: 0, startColumn: 0, endRow: 1, endColumn: 1, name: "Ana", clientId: 2 },
    { sheetId: "s2", startRow: 0, startColumn: 0, endRow: 0, endColumn: 0, name: "Ben", clientId: 3 },
  ] as unknown as RemoteSheetSelection[];
  const { placeRemoteRef } = selection(injector, host, remote);
  placeRemoteRef.current();
  const marks = [...host.querySelectorAll<HTMLElement>(".sheet-remote-range")];
  expect(marks).toHaveLength(1);
  expect(marks[0].style.left).toBe("10px");
  expect(marks[0].style.width).toBe("200px");
  expect(marks[0].style.height).toBe("40px");
  expect(marks[0].textContent).not.toBe("");
});

it("clears remote marks and the active cell when the grid is not painted", () => {
  const { injector, host } = setup({ render: false });
  const mark = document.createElement("div");
  mark.className = "sheet-remote-range";
  host.append(mark);
  const { placeRemoteRef } = selection(injector, host, []);
  placeRemoteRef.current();
  expect(host.querySelector(".sheet-remote-range")).toBeNull();
  select(h, 1, 1);
  expect(host.dataset.activeCell).toBeUndefined();
});

it("forgets the active cell when the grid cannot measure it", () => {
  const { injector, host } = setup();
  const remote = [{ sheetId: "s1", startRow: 0, startColumn: 0, endRow: 0, endColumn: 0, name: "Ana" }];
  const watch = selection(injector, host, remote as unknown as RemoteSheetSelection[]);
  Object.getPrototypeOf(h.sheet().getRange(0, 0)).getCellRect = () => {
    throw new Error("no canvas");
  };
  host.dataset.activeCell = "{}";
  select(h, 1, 1);
  expect(host.dataset.activeCell).toBeUndefined();
  watch.placeRemoteRef.current();
  expect(host.querySelectorAll(".sheet-remote-range")).toHaveLength(0);
});

function tap(host: HTMLElement, x: number, y: number, moveTo = { x, y }) {
  host.dispatchEvent(new PointerEvent("pointerdown", { clientX: x, clientY: y, button: 0, bubbles: true }));
  host.dispatchEvent(new PointerEvent("pointerup", { clientX: moveTo.x, clientY: moveTo.y, bubbles: true }));
}

function checkbox(row: number, column: number) {
  h.sheet()
    .getRange(row, column)
    .setDataValidation(h.api.newDataValidation().requireCheckbox("YES", "NO").build());
}

it("a phone tap on a selected checkbox flips it once, and a scroll leaves it", async () => {
  phone();
  const { injector, host } = setup();
  checkbox(3, 1);
  select(h, 3, 1);
  stop = watchPhoneTaps({ injector: injector as never, workbook: h.book(), sheetHost: host });
  host.dataset.activeCell = JSON.stringify({ left: 0, top: 0, right: 100, bottom: 20 });
  tap(host, 50, 10);
  await wait(200);
  expect(h.sheet().getRange(3, 1).getValue()).toBe("YES");
  tap(host, 50, 10, { x: 50, y: 80 });
  await wait(200);
  expect(h.sheet().getRange(3, 1).getValue()).toBe("YES");
  tap(host, 50, 10);
  await wait(200);
  expect(h.sheet().getRange(3, 1).getValue()).toBe("NO");
});

it("a phone tap flips a plain TRUE and FALSE checkbox both ways", async () => {
  phone();
  const { injector, host } = setup();
  h.sheet().getRange(1, 1).setDataValidation(h.api.newDataValidation().requireCheckbox().build());
  h.sheet().getRange(1, 1).setValue(true);
  select(h, 1, 1);
  stop = watchPhoneTaps({ injector: injector as never, workbook: h.book(), sheetHost: host });
  host.dataset.activeCell = JSON.stringify({ left: 0, top: 0, right: 100, bottom: 20 });
  tap(host, 50, 10);
  await wait(200);
  expect(String(h.sheet().getRange(1, 1).getValue()).toUpperCase()).toMatch(/^(FALSE|0)$/);
  tap(host, 50, 10);
  await wait(200);
  expect(String(h.sheet().getRange(1, 1).getValue()).toUpperCase()).toMatch(/^(TRUE|1)$/);
});

it("does not write again when the grid already toggled the box in that tap", async () => {
  phone();
  const { injector, host } = setup();
  checkbox(3, 1);
  select(h, 3, 1);
  stop = watchPhoneTaps({ injector: injector as never, workbook: h.book(), sheetHost: host });
  host.dataset.activeCell = JSON.stringify({ left: 0, top: 0, right: 100, bottom: 20 });
  host.dispatchEvent(new PointerEvent("pointerdown", { clientX: 50, clientY: 10, button: 0 }));
  await h.api.executeCommand("sheet.command.set-range-values", {
    range: { startRow: 3, endRow: 3, startColumn: 1, endColumn: 1 },
    value: { v: "YES" },
  });
  await h.api.executeCommand("sheet.command.set-range-values", {
    range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 },
    value: [[{ v: 1 }], [{ v: 2 }]],
  });
  host.dispatchEvent(new PointerEvent("pointerup", { clientX: 50, clientY: 10 }));
  await wait(200);
  expect(h.sheet().getRange(3, 1).getValue()).toBe("YES");
});

it("a phone tap on a header cell opens its filter, and a right click or a wide screen does nothing", async () => {
  const { injector, host } = setup();
  stop = watchPhoneTaps({ injector: injector as never, workbook: h.book(), sheetHost: host });
  select(h, 0, 2);
  host.dataset.activeCell = JSON.stringify({ left: 0, top: 0, right: 100, bottom: 20 });
  tap(host, 50, 10);
  await wait(10);
  expect(h.ui).toEqual([]);
  phone();
  host.dispatchEvent(new PointerEvent("pointerdown", { clientX: 50, clientY: 10, button: 2 }));
  tap(host, 50, 10);
  await wait(10);
  expect(h.ui).toEqual([
    { id: "sheet.operation.open-filter-panel", params: { unitId: "book", subUnitId: "s1", col: 2 } },
  ]);
  host.dataset.activeCell = "not json";
  tap(host, 50, 10);
  host.dataset.activeCell = JSON.stringify({ left: "0" });
  tap(host, 50, 10);
  await wait(200);
  expect(h.ui).toHaveLength(1);
  stop();
  stop = undefined;
  tap(host, 50, 10);
  await wait(10);
  expect(h.ui).toHaveLength(1);
});
