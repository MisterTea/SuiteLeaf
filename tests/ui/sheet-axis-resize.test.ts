// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { ICommandService, RANGE_TYPE } from "@univerjs/core";
import { IRenderManagerService } from "@univerjs/engine-render";
import { SheetsSelectionsService } from "@univerjs/sheets";
import { Subject } from "rxjs";
import { watchSheetAxisResize } from "../../apps/web/src/editors/sheet-axis-resize";

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
const frame = () =>
  new Promise((done) =>
    requestAnimationFrame(() => requestAnimationFrame(done)),
  );

function setup() {
  const changes = new Subject<void>();
  let range = { rangeType: RANGE_TYPE.ROW, endRow: 1, endColumn: 3 };
  let locked = false;
  let painted = true;
  let commandListener: () => void = () => {};
  const dispose = vi.fn(),
    disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect = disconnect;
    },
  );
  const host = document.createElement("div");
  document.body.append(host);
  const canvas = document.createElement("canvas");
  canvas.style.width = "800px";
  canvas.getBoundingClientRect = () =>
    ({ left: 10, top: 60, width: 800, height: 600 }) as DOMRect;
  host.getBoundingClientRect = () =>
    ({ left: 10, top: 40, width: 800, height: 620 }) as DOMRect;
  host.append(canvas);
  const viewport = { viewportScrollX: 0, viewportScrollY: 0 };
  const scale = { scaleX: 1, scaleY: 1 };
  const worksheet = { getFreeze: () => ({ startRow: 0, startColumn: 0 }) };
  const sheet = {
    getRange: (row: number, column: number) => ({
      getCellRect: () => ({
        left: 46 + column * 100,
        right: 146 + column * 100,
        top: 20 + row * 24,
        bottom: 44 + row * 24,
      }),
    }),
    getRowHeight: () => 24,
    getColumnWidth: () => 100,
  };
  const render = {
    engine: { getCanvasElement: () => canvas },
    scene: { getAncestorScale: () => scale, getViewport: () => viewport },
    with: () => ({
      getCurrentSkeleton: () => ({
        worksheet,
        rowHeaderWidthAndMarginLeft: 46,
        columnHeaderHeightAndMarginTop: 20,
      }),
    }),
  };
  const executeCommand = vi.fn(async () => true);
  const onError = vi.fn();
  const injector = {
    get: (token: unknown) => {
      if (token === ICommandService)
        return {
          executeCommand,
          onCommandExecuted: (fn: () => void) => {
            commandListener = fn;
            return { dispose };
          },
        };
      if (token === SheetsSelectionsService)
        return {
          selectionChanged$: changes,
          getCurrentSelections: () => [{ range }],
        };
      if (token === IRenderManagerService)
        return { getRenderUnitById: () => (painted ? render : null) };
      throw new Error("Unexpected service");
    },
  };
  stop = watchSheetAxisResize({
    host,
    injector: injector as never,
    workbook: { getId: () => "book", getActiveSheet: () => sheet } as never,
    readOnly: () => locked,
    onError,
  });
  return {
    host,
    viewport,
    scale,
    executeCommand,
    onError,
    dispose,
    disconnect,
    select: (next: typeof range) => {
      range = next;
      changes.next();
    },
    lock: () => {
      locked = true;
      commandListener();
    },
    paint: (value: boolean) => {
      painted = value;
      commandListener();
    },
    refresh: () => commandListener(),
    border: () => host.querySelector<HTMLElement>(".sheet-resize-border")!,
  };
}
function pointer(
  type: string,
  target: EventTarget,
  x: number,
  y: number,
  id = 1,
) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: id,
      button: 0,
      clientX: x,
      clientY: y,
    }),
  );
}

it("places selected row and column borders and two accessible mobile handles", async () => {
  const h = setup();
  await frame();
  expect(h.border().style.top).toBe("88px");
  expect(h.border().getAttribute("aria-label")).toBe("Resize row 2");
  expect(h.border().querySelectorAll("button")).toHaveLength(2);
  h.select({ rangeType: RANGE_TYPE.COLUMN, endRow: 10, endColumn: 1 });
  await frame();
  expect(h.border().style.left).toBe("246px");
  expect(h.border().getAttribute("aria-orientation")).toBe("vertical");
  h.select({ rangeType: RANGE_TYPE.NORMAL, endRow: 1, endColumn: 1 });
  await frame();
  expect(h.border()).toBeNull();
});

it("previews a row drag and commits one undoable grid command on release", async () => {
  const h = setup();
  await frame();
  pointer("pointerdown", h.border().querySelector("button")!, 25, 88);
  pointer("pointermove", window, 25, 118);
  expect(
    h.host
      .querySelector<HTMLElement>(".sheet-axis-resize")!
      .style.getPropertyValue("--resize-delta"),
  ).toBe("30px");
  expect(h.executeCommand).not.toHaveBeenCalled();
  pointer("pointerup", window, 25, 118);
  expect(h.executeCommand).toHaveBeenCalledExactlyOnceWith(
    "sheet.command.delta-row-height",
    { anchorRow: 1, deltaY: 30 },
  );
});

it("uses sheet zoom for column resizing and prevents zero or excessive sizes", async () => {
  const h = setup();
  h.scale.scaleX = 2;
  h.select({ rangeType: RANGE_TYPE.COLUMN, endRow: 1, endColumn: 1 });
  await frame();
  pointer("pointerdown", h.border(), 490, 10);
  pointer("pointermove", window, 530, 10);
  pointer("pointerup", window, 530, 10);
  expect(h.executeCommand).toHaveBeenLastCalledWith(
    "sheet.command.delta-column-width",
    { anchorCol: 1, deltaX: 20 },
  );
  await frame();
  pointer("pointerdown", h.border(), 490, 10);
  pointer("pointermove", window, -1000, 10);
  pointer("pointerup", window, -1000, 10);
  expect(h.executeCommand).toHaveBeenLastCalledWith(
    "sheet.command.delta-column-width",
    { anchorCol: 1, deltaX: -76 },
  );
});

it("cancels without writes and ignores unrelated pointer ids and taps", async () => {
  const h = setup();
  await frame();
  pointer("pointerdown", h.border(), 25, 88);
  pointer("pointermove", window, 25, 120, 2);
  pointer("pointerup", window, 25, 120, 2);
  pointer("pointercancel", window, 25, 120);
  expect(h.executeCommand).not.toHaveBeenCalled();
  await frame();
  pointer("pointerdown", h.border(), 25, 88);
  pointer("pointerup", window, 25, 88);
  expect(h.executeCommand).not.toHaveBeenCalled();
});

it("supports arrow keys, scroll geometry, read-only changes, and cleanup", async () => {
  const h = setup();
  await frame();
  h.border().dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "ArrowDown",
      shiftKey: true,
      bubbles: true,
    }),
  );
  expect(h.executeCommand).toHaveBeenLastCalledWith(
    "sheet.command.delta-row-height",
    { anchorRow: 1, deltaY: 10 },
  );
  h.viewport.viewportScrollY = 24;
  h.refresh();
  await frame();
  expect(h.border().style.top).toBe("64px");
  h.lock();
  await frame();
  expect(h.border()).toBeNull();
  stop?.();
  stop = undefined;
  expect(h.dispose).toHaveBeenCalledOnce();
  expect(h.disconnect).toHaveBeenCalledOnce();
  expect(h.host.querySelector(".sheet-axis-resize")).toBeNull();
});

it("hides offscreen borders and handles temporarily unavailable renders", async () => {
  const h = setup();
  await frame();
  h.viewport.viewportScrollY = 200;
  h.refresh();
  await frame();
  expect(h.border()).toBeNull();
  h.viewport.viewportScrollY = 0;
  h.paint(false);
  await frame();
  expect(h.border()).toBeNull();
  h.paint(true);
  await frame();
  expect(h.border()).not.toBeNull();
});

it("reports failed grid commands", async () => {
  const h = setup();
  await frame();
  h.executeCommand.mockRejectedValueOnce(new Error("Protected row"));
  h.border().dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
  );
  await frame();
  expect(h.onError).toHaveBeenCalledWith("Protected row");
});
