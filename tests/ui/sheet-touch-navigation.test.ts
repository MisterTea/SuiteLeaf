// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  DOCS_NORMAL_EDITOR_UNIT_ID_KEY,
  ICommandService,
} from "@univerjs/core";
import { watchSheetTouchNavigation } from "../../apps/web/src/editors/sheet-touch-navigation";

let stop: (() => void) | undefined;
const originalWidth = window.innerWidth;
afterEach(() => {
  stop?.();
  stop = undefined;
  document.body.innerHTML = "";
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: originalWidth,
  });
});

function setup() {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 390,
  });
  const host = document.createElement("div");
  const canvas = document.createElement("canvas");
  canvas.style.width = "400px";
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 400, height: 500 }) as DOMRect;
  host.append(canvas);
  const editor = document.createElement("div");
  editor.id = `__editor_${DOCS_NORMAL_EDITOR_UNIT_ID_KEY}`;
  editor.contentEditable = "true";
  document.body.append(host, editor);
  let active = { row: 1, column: 1, height: 1, width: 1 };
  const setActiveRange = vi.fn((next) => {
    active = next;
  });
  const sheet = {
    getSelection: () => ({
      getActiveRange: () => ({
        getRow: () => active.row,
        getLastRow: () => active.row + active.height - 1,
        getColumn: () => active.column,
        getLastColumn: () => active.column + active.width - 1,
      }),
    }),
    getRange: (row: number, column: number, height = 1, width = 1) => ({
      row,
      column,
      height,
      width,
    }),
    setActiveRange,
  };
  let onCommand: (command: any) => void = () => {};
  const executeCommand = vi.fn();
  const dispose = vi.fn();
  const commands = {
    executeCommand,
    onCommandExecuted: (fn: typeof onCommand) => {
      onCommand = fn;
      return { dispose };
    },
  };
  const viewport = {
    viewportKey: "viewMain",
    viewportScrollX: 0,
    viewportScrollY: 0,
  };
  const render = {
    engine: { getCanvasElement: () => canvas },
    scene: {
      getActiveViewportByCoord: () => viewport,
      getAncestorScale: () => ({ scaleX: 1, scaleY: 1 }),
    },
    with: () => ({
      getCurrentSkeleton: () => ({
        getCellIndexByOffset: (x: number, y: number) => ({
          row: Math.floor(y / 20),
          column: Math.floor(x / 100),
        }),
        worksheet: { getMergedCell: () => null },
      }),
    }),
  };
  const injector = {
    get: (token: unknown) =>
      token === ICommandService
        ? commands
        : { getRenderUnitById: () => render },
  };
  stop = watchSheetTouchNavigation(
    host,
    injector as never,
    { getId: () => "book", getActiveSheet: () => sheet } as never,
  );
  const pointer = (
    type: string,
    x: number,
    y: number,
    id = 1,
    pointerType = "touch",
  ) =>
    canvas.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: id,
        pointerType,
        clientX: x,
        clientY: y,
      }),
    );
  const tap = (x: number, y: number) => {
    pointer("pointerdown", x, y);
    pointer("pointerup", x, y);
  };
  return {
    host,
    canvas,
    editor,
    pointer,
    tap,
    setActiveRange,
    executeCommand,
    onCommand: (visible: boolean) =>
      onCommand({
        id: "sheet.operation.set-cell-edit-visible",
        params: { visible },
      }),
    viewport,
    dispose,
  };
}

it("selects on a tap without a keyboard, then opens editing on a double tap", () => {
  const h = setup();
  expect(h.editor.getAttribute("inputmode")).toBe("none");
  h.tap(250, 50);
  expect(h.setActiveRange).toHaveBeenLastCalledWith({
    row: 2,
    column: 2,
    height: 1,
    width: 1,
  });
  expect(h.executeCommand).not.toHaveBeenCalled();
  h.tap(250, 50);
  expect(h.executeCommand).toHaveBeenCalledWith(
    "sheet.operation.set-cell-edit-visible",
    expect.objectContaining({ visible: true }),
  );
  expect(h.editor.getAttribute("inputmode")).toBe("text");
  h.onCommand(false);
  expect(h.editor.getAttribute("inputmode")).toBe("none");
  stop?.();
  stop = undefined;
  expect(h.editor.hasAttribute("inputmode")).toBe(false);
  expect(h.dispose).toHaveBeenCalled();
});

it("pans from an unselected cell without moving the selection", () => {
  const h = setup();
  h.pointer("pointerdown", 250, 90);
  h.pointer("pointermove", 200, 50);
  h.pointer("pointerup", 200, 50);
  expect(h.executeCommand).toHaveBeenCalledWith(
    "sheet.command.set-scroll-relative",
    { offsetX: 50, offsetY: 40 },
  );
  expect(h.setActiveRange).not.toHaveBeenCalled();
});

it("lassos from a selected cell in either direction without panning", () => {
  const h = setup();
  h.pointer("pointerdown", 150, 30);
  h.pointer("pointermove", 350, 90);
  h.pointer("pointerup", 350, 90);
  expect(h.setActiveRange).toHaveBeenLastCalledWith({
    row: 1,
    column: 1,
    height: 4,
    width: 3,
  });
  expect(h.executeCommand).not.toHaveBeenCalled();
  h.pointer("pointerdown", 350, 90);
  h.pointer("pointermove", 150, 30);
  h.pointer("pointerup", 150, 30);
  expect(h.setActiveRange).toHaveBeenLastCalledWith({
    row: 1,
    column: 1,
    height: 4,
    width: 3,
  });
});

it("ignores mouse gestures, headers, editing, and canceled gestures", () => {
  const h = setup();
  h.pointer("pointerdown", 150, 30, 1, "mouse");
  h.pointer("pointerup", 150, 30, 1, "mouse");
  h.viewport.viewportKey = "header";
  h.tap(150, 30);
  h.viewport.viewportKey = "viewMain";
  h.onCommand(true);
  h.tap(150, 30);
  h.onCommand(false);
  h.pointer("pointerdown", 150, 30);
  h.pointer("pointercancel", 150, 30);
  h.pointer("pointerup", 150, 30);
  expect(h.setActiveRange).not.toHaveBeenCalled();
});

it("ignores small movements and releases pinch gestures to the grid", () => {
  const h = setup();
  h.pointer("pointerdown", 150, 30);
  h.pointer("pointermove", 152, 32);
  h.pointer("pointerup", 152, 32);
  expect(h.executeCommand).not.toHaveBeenCalled();
  h.setActiveRange.mockClear();
  h.pointer("pointerdown", 150, 30);
  h.pointer("pointerdown", 250, 30, 2);
  h.pointer("pointerup", 150, 30);
  expect(h.setActiveRange).not.toHaveBeenCalled();
});
