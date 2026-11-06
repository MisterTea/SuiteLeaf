import { ICommandService, RANGE_TYPE, type Injector } from "@univerjs/core";
import { IRenderManagerService } from "@univerjs/engine-render";
import {
  getViewportByCell,
  SheetSkeletonManagerService,
} from "@univerjs/sheets-ui";
import { SheetsSelectionsService } from "@univerjs/sheets";
import type { SheetWorkbook } from "./sheet-workbook-startup";

type Axis = "row" | "column";
type Edge = {
  axis: Axis;
  index: number;
  size: number;
  scale: number;
  position: number;
  left: number;
  top: number;
  width: number;
  height: number;
  header: number;
};

/** Selected-axis borders share the grid's resize commands, including undo and collaboration. */
export function watchSheetAxisResize({
  host,
  injector,
  workbook,
  readOnly,
  onError,
}: {
  host: HTMLElement;
  injector: Injector;
  workbook: SheetWorkbook;
  readOnly: () => boolean;
  onError: (message: string) => void;
}) {
  const commands = injector.get(ICommandService);
  const selections = injector.get(SheetsSelectionsService);
  const layer = document.createElement("div");
  layer.className = "sheet-axis-resize";
  host.append(layer);
  let frame = 0;
  let disposed = false;
  let drag: { edge: Edge; start: number; delta: number; id: number } | null =
    null;

  const apply = async (edge: Edge, delta: number) => {
    if (disposed || readOnly() || !delta) return;
    try {
      await commands.executeCommand(
        edge.axis === "row"
          ? "sheet.command.delta-row-height"
          : "sheet.command.delta-column-width",
        edge.axis === "row"
          ? { anchorRow: edge.index, deltaY: delta }
          : { anchorCol: edge.index, deltaX: delta },
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      schedule();
    }
  };
  const boundedDelta = (edge: Edge, delta: number) =>
    Math.max(
      edge.axis === "row" ? 12 : 24,
      Math.min(2000, Math.round(edge.size + delta)),
    ) - edge.size;
  const preview = () => {
    if (!drag) return;
    layer.style.setProperty(
      "--resize-delta",
      `${drag.delta * drag.edge.scale}px`,
    );
  };
  const down = (event: PointerEvent, edge: Edge) => {
    if (readOnly() || event.button !== 0 || drag) return;
    event.preventDefault();
    event.stopPropagation();
    drag = {
      edge,
      start: edge.axis === "row" ? event.clientY : event.clientX,
      delta: 0,
      id: event.pointerId,
    };
    layer.classList.add("resizing");
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  };
  const move = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return;
    event.preventDefault();
    event.stopPropagation();
    drag.delta = boundedDelta(
      drag.edge,
      ((drag.edge.axis === "row" ? event.clientY : event.clientX) -
        drag.start) /
        drag.edge.scale,
    );
    preview();
  };
  const finish = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return;
    event.preventDefault();
    event.stopPropagation();
    const current = drag;
    drag = null;
    layer.classList.remove("resizing");
    layer.style.removeProperty("--resize-delta");
    if (event.type !== "pointercancel") void apply(current.edge, current.delta);
    schedule();
  };
  const key = (event: KeyboardEvent, edge: Edge) => {
    const positive = edge.axis === "row" ? "ArrowDown" : "ArrowRight";
    const negative = edge.axis === "row" ? "ArrowUp" : "ArrowLeft";
    if (event.key !== positive && event.key !== negative) return;
    event.preventDefault();
    event.stopPropagation();
    void apply(
      edge,
      boundedDelta(
        edge,
        (event.key === positive ? 1 : -1) * (event.shiftKey ? 10 : 1),
      ),
    );
  };
  function render() {
    if (disposed || drag) return;
    // Univer mounts its workbench after the workbook facade is created.
    if (!host.contains(layer)) host.append(layer);
    layer.replaceChildren();
    if (readOnly()) return;
    const range = selections.getCurrentSelections()?.[0]?.range;
    const axis =
      range?.rangeType === RANGE_TYPE.ROW
        ? "row"
        : range?.rangeType === RANGE_TYPE.COLUMN
          ? "column"
          : null;
    if (!range || !axis) return;
    const sheet = workbook.getActiveSheet();
    const render = injector
      .get(IRenderManagerService)
      .getRenderUnitById(workbook.getId());
    const canvas = render?.engine.getCanvasElement();
    if (!render || !canvas || !sheet) return;
    const skeleton = render
      .with(SheetSkeletonManagerService)
      .getCurrentSkeleton();
    if (!skeleton) return;
    const index = axis === "row" ? range.endRow : range.endColumn;
    const row = axis === "row" ? index : 0;
    const column = axis === "column" ? index : 0;
    const rect = sheet.getRange(row, column).getCellRect();
    const viewport = getViewportByCell(
      row,
      column,
      render.scene,
      skeleton.worksheet,
    );
    if (!rect || !viewport) return;
    const bounds = canvas.getBoundingClientRect();
    const hostBounds = host.getBoundingClientRect();
    const ratio =
      bounds.width / (Number.parseFloat(canvas.style.width) || bounds.width) ||
      1;
    const { scaleX, scaleY } = render.scene.getAncestorScale();
    const scale = (axis === "row" ? scaleY : scaleX) * ratio;
    const edge: Edge = {
      axis,
      index,
      scale,
      size:
        axis === "row"
          ? sheet.getRowHeight(index)
          : sheet.getColumnWidth(index),
      position:
        axis === "row"
          ? (rect.bottom - viewport.viewportScrollY) * scale
          : (rect.right - viewport.viewportScrollX) * scale,
      left: bounds.left - hostBounds.left,
      top: bounds.top - hostBounds.top,
      width: bounds.width,
      height: bounds.height,
      header:
        axis === "row"
          ? skeleton.rowHeaderWidthAndMarginLeft * scaleX * ratio
          : skeleton.columnHeaderHeightAndMarginTop * scaleY * ratio,
    };
    const axisHeader =
      axis === "row"
        ? skeleton.columnHeaderHeightAndMarginTop * scaleY * ratio
        : skeleton.rowHeaderWidthAndMarginLeft * scaleX * ratio;
    if (
      edge.position <= axisHeader ||
      edge.position >= (axis === "row" ? edge.height : edge.width) - 16
    )
      return;
    const border = document.createElement("div");
    border.className = `sheet-resize-border ${axis}`;
    border.setAttribute("role", "separator");
    border.setAttribute("aria-label", `Resize ${axis} ${index + 1}`);
    border.setAttribute(
      "aria-orientation",
      axis === "row" ? "horizontal" : "vertical",
    );
    border.setAttribute("aria-valuenow", String(edge.size));
    border.tabIndex = 0;
    Object.assign(
      border.style,
      axis === "row"
        ? {
            left: `${edge.left}px`,
            top: `${edge.top + edge.position}px`,
            width: `${edge.width - 16}px`,
          }
        : {
            top: `${edge.top}px`,
            left: `${edge.left + edge.position}px`,
            height: `${edge.height - 24}px`,
          },
    );
    const bind = (element: HTMLElement) => {
      element.addEventListener("pointerdown", (event) => down(event, edge));
      element.addEventListener("keydown", (event) => key(event, edge));
    };
    bind(border);
    for (const side of ["start", "end"]) {
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = `sheet-resize-handle ${side}`;
      handle.setAttribute(
        "aria-label",
        `Resize ${axis} ${index + 1} (${side})`,
      );
      if (side === "start")
        handle.style[axis === "row" ? "left" : "top"] =
          `${Math.max(22, edge.header / 2)}px`;
      bind(handle);
      border.append(handle);
    }
    layer.append(border);
  }
  function schedule() {
    if (disposed) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(render);
  }
  const selectionSub = selections.selectionChanged$.subscribe(schedule);
  const commandSub = commands.onCommandExecuted(schedule);
  const observer = new ResizeObserver(schedule);
  observer.observe(host);
  window.addEventListener("resize", schedule);
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);
  host.addEventListener("scroll", schedule, true);
  schedule();
  return () => {
    disposed = true;
    drag = null;
    cancelAnimationFrame(frame);
    selectionSub.unsubscribe();
    commandSub.dispose();
    observer.disconnect();
    window.removeEventListener("resize", schedule);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    host.removeEventListener("scroll", schedule, true);
    layer.remove();
  };
}
