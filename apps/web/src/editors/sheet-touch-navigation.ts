import {
  DOCS_NORMAL_EDITOR_UNIT_ID_KEY,
  ICommandService,
  type Injector,
} from "@univerjs/core";
import {
  DeviceInputEventType,
  IRenderManagerService,
  Vector2,
} from "@univerjs/engine-render";
import { SheetSkeletonManagerService } from "@univerjs/sheets-ui";
import type { SheetWorkbook } from "./sheet-workbook-startup";
import { pointerScrolled } from "./sheet-phone-gestures";

/** Own single-finger cell gestures; headers, drawings and pinch zoom stay with Univer. */
export function watchSheetTouchNavigation(
  host: HTMLElement,
  injector: Injector,
  workbook: SheetWorkbook,
  readOnly: () => boolean = () => false,
) {
  const commands = injector.get(ICommandService);
  const editorId = `__editor_${DOCS_NORMAL_EDITOR_UNIT_ID_KEY}`;
  let editing = false;
  let lastTap: { row: number; column: number; time: number } | null = null;
  let press: {
    id: number;
    x: number;
    y: number;
    lastX: number;
    lastY: number;
    row: number;
    column: number;
    selected: boolean;
    moved: boolean;
  } | null = null;
  const syncKeyboard = () => {
    const editor = document.getElementById(editorId);
    if (editor)
      editor.setAttribute(
        "inputmode",
        window.innerWidth <= 700 && !editing ? "none" : "text",
      );
  };
  const observer = new MutationObserver(syncKeyboard);
  observer.observe(document.body, { childList: true, subtree: true });
  const commandWatch = commands.onCommandExecuted((command) => {
    if (command.id === "sheet.operation.set-cell-edit-visible") {
      editing = !!(command.params as { visible?: boolean })?.visible;
      syncKeyboard();
    }
  });
  const locate = (event: PointerEvent) => {
    const render = injector
      .get(IRenderManagerService)
      .getRenderUnitById(workbook.getId());
    const canvas = render?.engine.getCanvasElement();
    if (!render || event.target !== canvas) return null;
    const bounds = canvas.getBoundingClientRect();
    const ratio =
      (Number.parseFloat(canvas.style.width) || bounds.width) / bounds.width;
    const x = (event.clientX - bounds.left) * ratio;
    const y = (event.clientY - bounds.top) * ratio;
    const viewport = render.scene.getActiveViewportByCoord(new Vector2(x, y));
    // Let row/column headers and frozen corner controls use their own handlers.
    if (!viewport || viewport.viewportKey !== "viewMain") return null;
    const skeleton = render
      .with(SheetSkeletonManagerService)
      .getCurrentSkeleton();
    if (!skeleton) return null;
    const { scaleX, scaleY } = render.scene.getAncestorScale();
    const cell = skeleton.getCellIndexByOffset(x, y, scaleX, scaleY, {
      x: viewport.viewportScrollX,
      y: viewport.viewportScrollY,
    });
    const merged = skeleton.worksheet.getMergedCell(cell.row, cell.column);
    return {
      row: merged?.startRow ?? cell.row,
      column: merged?.startColumn ?? cell.column,
      scaleX,
      scaleY,
    };
  };
  const down = (event: PointerEvent) => {
    if (window.innerWidth > 700 || event.pointerType !== "touch" || editing)
      return;
    if (press) {
      press = null;
      lastTap = null;
      return;
    }
    const cell = locate(event);
    if (!cell) return;
    const range = workbook.getActiveSheet().getSelection()?.getActiveRange();
    press = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      ...cell,
      selected:
        !!range &&
        cell.row >= range.getRow() &&
        cell.row <= range.getLastRow() &&
        cell.column >= range.getColumn() &&
        cell.column <= range.getLastColumn(),
      moved: false,
    };
    syncKeyboard();
    event.stopPropagation();
  };
  const move = (event: PointerEvent) => {
    if (!press || press.id !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    press.moved ||= pointerScrolled(press, {
      x: event.clientX,
      y: event.clientY,
    });
    if (!press.moved) return;
    lastTap = null;
    const cell = locate(event);
    if (press.selected && cell) {
      const sheet = workbook.getActiveSheet();
      sheet.setActiveRange(
        sheet.getRange(
          Math.min(press.row, cell.row),
          Math.min(press.column, cell.column),
          Math.abs(press.row - cell.row) + 1,
          Math.abs(press.column - cell.column) + 1,
        ),
      );
    } else if (!press.selected) {
      void commands.executeCommand("sheet.command.set-scroll-relative", {
        offsetX: (press.lastX - event.clientX) / (cell?.scaleX || 1),
        offsetY: (press.lastY - event.clientY) / (cell?.scaleY || 1),
      });
    }
    press.lastX = event.clientX;
    press.lastY = event.clientY;
  };
  const up = (event: PointerEvent) => {
    if (!press || press.id !== event.pointerId) return;
    const start = press;
    press = null;
    event.stopPropagation();
    if (
      start.moved ||
      pointerScrolled(start, { x: event.clientX, y: event.clientY })
    )
      return;
    const sheet = workbook.getActiveSheet();
    sheet.setActiveRange(sheet.getRange(start.row, start.column));
    const now = performance.now();
    if (
      !readOnly() &&
      lastTap &&
      lastTap.row === start.row &&
      lastTap.column === start.column &&
      now - lastTap.time < 350
    ) {
      editing = true;
      syncKeyboard();
      void commands.executeCommand("sheet.operation.set-cell-edit-visible", {
        visible: true,
        eventType: DeviceInputEventType.Dblclick,
      });
      document.getElementById(editorId)?.focus();
      lastTap = null;
    } else lastTap = { row: start.row, column: start.column, time: now };
  };
  const cancel = () => {
    press = null;
    lastTap = null;
  };
  const touch = (event: TouchEvent) => {
    if (press && event.touches.length <= 1) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  host.addEventListener("pointerdown", down, true);
  host.addEventListener("pointermove", move, true);
  host.addEventListener("pointerup", up, true);
  host.addEventListener("pointercancel", cancel, true);
  host.addEventListener("touchstart", touch, { capture: true, passive: false });
  host.addEventListener("touchmove", touch, { capture: true, passive: false });
  window.addEventListener("resize", syncKeyboard);
  syncKeyboard();
  return () => {
    observer.disconnect();
    commandWatch.dispose();
    host.removeEventListener("pointerdown", down, true);
    host.removeEventListener("pointermove", move, true);
    host.removeEventListener("pointerup", up, true);
    host.removeEventListener("pointercancel", cancel, true);
    host.removeEventListener("touchstart", touch, true);
    host.removeEventListener("touchmove", touch, true);
    window.removeEventListener("resize", syncKeyboard);
    document.getElementById(editorId)?.removeAttribute("inputmode");
  };
}
