import { ICommandService, type Injector } from "@univerjs/core";
import { IRenderManagerService } from "@univerjs/engine-render";
import { SetRangeValuesCommand } from "@univerjs/sheets";
import { SheetDataValidationModel } from "@univerjs/sheets-data-validation";
import { SheetsNoteModel } from "@univerjs/sheets-note";
import { SheetsSelectionsService } from "@univerjs/preset-sheets-core";
import { SheetsNotePopupService } from "@univerjs/preset-sheets-note";
import {
  phoneCheckboxWrite,
  pointInBox,
  pointerScrolled,
  shouldOpenPhoneHeaderFilter,
  type ScreenBox,
} from "./sheet-phone-gestures";
import { sheetSelectionLabel, type RemoteSheetSelection, type SheetSelection } from "../collab/selection";
import { paintRemoteSheetSelections } from "./sheet-remote-selection";
import type { SheetWorkbook } from "./sheet-workbook-startup";

/**
 * Follows the grid selection: reports it to collaborators, keeps notes in step
 * with it, and places the active-cell and remote-selection boxes on screen.
 */
export function watchSheetSelection({
  injector,
  workbook,
  sheetHost,
  reportSelection,
  placeRemoteRef,
  remoteSelectionsRef,
  onSelectionRange,
}: {
  injector: Injector;
  workbook: SheetWorkbook;
  sheetHost: HTMLDivElement | null;
  reportSelection: { current: ((selection: SheetSelection) => void) | undefined };
  placeRemoteRef: { current: () => void };
  remoteSelectionsRef: { current: RemoteSheetSelection[] };
  onSelectionRange?: (type: number | undefined) => void;
}) {
  let fillScroll: { unsubscribe: () => void } | undefined;
  // Univer closes an open note only when a selection move ends, not when the
  // name box or a command sets the selection.
  const notePopups = injector.get(SheetsNotePopupService);
  const noteModel = injector.get(SheetsNoteModel);
  const closeNoteOnMove = injector
    .get(SheetsSelectionsService)
    .selectionChanged$.subscribe((selections) => {
      const popup = notePopups.activePopup,
        range = selections?.[0]?.range,
        sheet = workbook.getActiveSheet(),
        sheetId = sheet.getSheetId();
      if (range) {
        onSelectionRange?.(range.rangeType);
        reportSelection.current?.({
          sheetId,
          startRow: range.startRow,
          startColumn: range.startColumn,
          endRow: range.endRow,
          endColumn: range.endColumn,
        });
      }
      if (
        popup &&
        range &&
        !(
          popup.subUnitId === sheetId &&
          range.startRow === popup.row &&
          range.startColumn === popup.col
        )
      )
        notePopups.hidePopup(true);
      // A phone has no hover. Selecting the cell opens its note.
      if (
        window.innerWidth <= 700 &&
        range &&
        range.startRow === range.endRow &&
        range.startColumn === range.endColumn
      ) {
        const note = noteModel.getNote(workbook.getId(), sheetId, {
          row: range.startRow,
          col: range.startColumn,
        });
        if (note)
          notePopups.showPopup({
            unitId: workbook.getId(),
            subUnitId: sheetId,
            noteId: note.id,
            row: range.startRow,
            col: range.startColumn,
          });
      }
      publishActiveCell(range);
    });
  // The fill handle is a few canvas pixels at the selection's corner.
  // Store that corner in screen coordinates, including the sheet's scroll.
  const publishActiveCell = (
    range: { startRow: number; startColumn: number; endRow: number; endColumn: number } | null | undefined,
  ) => {
    if (!sheetHost || !range) return;
    followScroll();
    try {
      const corner = workbook.getActiveSheet()?.getRange(range.endRow, range.endColumn).getCellRect();
      if (!corner) return;
      const render = injector.get(IRenderManagerService).getRenderUnitById(workbook.getId());
      const viewport = render?.scene.getViewport("viewMain");
      const canvas = render?.engine.getCanvasElement();
      if (!render || !viewport || !canvas) return;
      const { scaleX, scaleY } = render.scene.getAncestorScale();
      const bounds = canvas.getBoundingClientRect();
      const painted = Number.parseFloat(canvas.style.width) || bounds.width;
      const scaleAdjust = bounds.width / painted || 1;
      const toX = (value: number) =>
        (value - viewport.viewportScrollX) * scaleAdjust * scaleX + bounds.left;
      const toY = (value: number) =>
        (value - viewport.viewportScrollY) * scaleAdjust * scaleY + bounds.top;
      sheetHost.dataset.activeCell = JSON.stringify({
        left: toX(corner.left),
        top: toY(corner.top),
        right: toX(corner.right),
        bottom: toY(corner.bottom),
      });
      placeRemoteRef.current();
    } catch {
      delete sheetHost.dataset.activeCell;
    }
  };
  placeRemoteRef.current = () => {
    if (!sheetHost) return;
    const sheet = workbook.getActiveSheet();
    if (!sheet) {
      paintRemoteSheetSelections(sheetHost, []);
      return;
    }
    const sheetId = sheet.getSheetId();
    try {
      const render = injector.get(IRenderManagerService).getRenderUnitById(workbook.getId());
      const viewport = render?.scene.getViewport("viewMain");
      const canvas = render?.engine.getCanvasElement();
      if (!render || !viewport || !canvas) {
        paintRemoteSheetSelections(sheetHost, []);
        return;
      }
      const { scaleX, scaleY } = render.scene.getAncestorScale();
      const bounds = canvas.getBoundingClientRect();
      const painted = Number.parseFloat(canvas.style.width) || bounds.width;
      const scaleAdjust = bounds.width / painted || 1;
      const toX = (value: number) =>
        (value - viewport.viewportScrollX) * scaleAdjust * scaleX + bounds.left;
      const toY = (value: number) =>
        (value - viewport.viewportScrollY) * scaleAdjust * scaleY + bounds.top;
      const boxes = [];
      for (const selection of remoteSelectionsRef.current) {
        if (selection.sheetId !== sheetId) continue;
        const start = sheet.getRange(selection.startRow, selection.startColumn).getCellRect();
        const end = sheet.getRange(selection.endRow, selection.endColumn).getCellRect();
        if (!start || !end) continue;
        const left = toX(Math.min(start.left, end.left));
        const top = toY(Math.min(start.top, end.top));
        const right = toX(Math.max(start.right, end.right));
        const bottom = toY(Math.max(start.bottom, end.bottom));
        if (!(right > left) || !(bottom > top)) continue;
        boxes.push({
          name: sheetSelectionLabel(selection),
          left,
          top,
          width: right - left,
          height: bottom - top,
        });
      }
      paintRemoteSheetSelections(sheetHost, boxes);
    } catch {
      paintRemoteSheetSelections(sheetHost, []);
    }
  };
  let scrollFrame = 0;
  const publishScrolledCell = () => {
    const active = workbook.getActiveSheet()?.getSelection()?.getActiveRange();
    publishActiveCell(active ? {
      startRow: active.getRow(), startColumn: active.getColumn(),
      endRow: active.getLastRow(), endColumn: active.getLastColumn(),
    } : null);
  };
  function followScroll() {
    // The viewport may be created after the workbook. Bind when the first
    // painted selection arrives instead of losing scroll updates at startup.
    fillScroll ??= injector
      .get(IRenderManagerService)
      .getRenderUnitById(workbook.getId())
      ?.scene.getViewport("viewMain")
      ?.onScrollAfter$.subscribeEvent(() => {
        publishScrolledCell();
        cancelAnimationFrame(scrollFrame);
        scrollFrame = requestAnimationFrame(publishScrolledCell);
      });
  }
  followScroll();
  return () => {
    closeNoteOnMove.unsubscribe();
    cancelAnimationFrame(scrollFrame);
    fillScroll?.unsubscribe();
  };
}

/** Phone taps: a header tap opens its filter, and a checkbox tap toggles once. */
export function watchPhoneTaps({
  injector,
  workbook,
  sheetHost,
}: {
  injector: Injector;
  workbook: SheetWorkbook;
  sheetHost: HTMLDivElement | null;
}) {
  // The filter funnel is a 16px mark on the right of the header. On a phone
  // that mark is often off the screen, so a tap in the header cell opens
  // the same panel. A scroll or a lift elsewhere must not: opening the
  // panel closes the cell editor.
  const validations = injector.get(SheetDataValidationModel);
  // Univer ticks the box when the cell equals the rule's checked value, reading TRUE and FALSE as 1 and 0.
  const checkboxText = (value: unknown) => {
    const text = String(value ?? "");
    const lower = text.toLowerCase();
    return lower === "true" ? "1" : lower === "false" ? "0" : text;
  };
  const isTicked = (value: unknown, checked: unknown) => checkboxText(value) === checkboxText(checked);
  const readActiveBox = (): ScreenBox | null => {
    const raw = sheetHost?.dataset.activeCell;
    if (!raw) return null;
    try {
      const box = JSON.parse(raw) as Partial<ScreenBox>;
      if (
        typeof box.left !== "number" ||
        typeof box.top !== "number" ||
        typeof box.right !== "number" ||
        typeof box.bottom !== "number"
      )
        return null;
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
    } catch {
      return null;
    }
  };
  // Univer toggles a checkbox on pointer down when the tap hits its box,
  // including the first time that cell is selected. That write is not
  // repeated. A tap that misses the box on an already-selected cell still
  // flips it. A scroll does not.
  const checkboxCell = () => {
    const sheet = workbook.getActiveSheet();
    const cell = sheet?.getActiveCell();
    if (!sheet || !cell) return null;
    const row = cell.getRow();
    const col = cell.getColumn();
    const rule = validations.getRuleByLocation(workbook.getId(), sheet.getSheetId(), row, col);
    if (rule?.type !== "checkbox") return null;
    return {
      row,
      col,
      on: isTicked(cell.getValue(), rule.formula1 ?? "TRUE"),
      checked: rule.formula1 ?? "TRUE",
      unchecked: rule.formula2 ?? "FALSE",
    };
  };
  let phoneGesture = 0;
  const phoneBoxWrites: { gesture: number; row: number; col: number }[] = [];
  const watchPhoneBoxWrite = injector.get(ICommandService).onCommandExecuted((command) => {
    if (command.id !== SetRangeValuesCommand.id) return;
    const params = command.params as {
      suiteleafPhoneWrite?: boolean;
      range?: {
        startRow?: number;
        endRow?: number;
        startColumn?: number;
        endColumn?: number;
      };
    } | undefined;
    if (params?.suiteleafPhoneWrite) return;
    const range = params?.range;
    if (!range) return;
    const { startRow, endRow, startColumn, endColumn } = range;
    if (
      typeof startRow !== "number" ||
      typeof startColumn !== "number" ||
      startRow !== endRow ||
      startColumn !== endColumn
    )
      return;
    phoneBoxWrites.push({ gesture: phoneGesture, row: startRow, col: startColumn });
    if (phoneBoxWrites.length > 8) phoneBoxWrites.shift();
  });
  let press: {
    x: number;
    y: number;
    gesture: number;
    checkbox: ReturnType<typeof checkboxCell>;
  } | null = null;
  const onPhonePointerDown = (event: PointerEvent) => {
    if (window.innerWidth > 700 || event.button === 2) return;
    phoneGesture += 1;
    press = {
      x: event.clientX,
      y: event.clientY,
      gesture: phoneGesture,
      checkbox: checkboxCell(),
    };
  };
  const onPhonePointerUp = (event: PointerEvent) => {
    const start = press;
    press = null;
    if (window.innerWidth > 700) return;
    const up = { x: event.clientX, y: event.clientY };
    const down = start ? { x: start.x, y: start.y } : null;
    const scrolled = pointerScrolled(down, up);
    const before = start?.checkbox ?? null;
    window.setTimeout(() => {
      const sheet = workbook.getActiveSheet();
      const range = sheet?.getSelection()?.getActiveRange();
      const singleHeaderCell =
        !!range &&
        range.getRow() === 0 &&
        range.getLastRow() === range.getRow() &&
        range.getLastColumn() === range.getColumn();
      if (
        sheet &&
        range &&
        shouldOpenPhoneHeaderFilter({
          narrow: true,
          singleHeaderCell,
          down,
          up,
          headerBox: singleHeaderCell ? readActiveBox() : null,
        })
      ) {
        injector.get(ICommandService).executeCommand("sheet.operation.open-filter-panel", {
          unitId: workbook.getId(),
          subUnitId: sheet.getSheetId(),
          col: range.getColumn(),
        });
      }
    }, 0);
    window.setTimeout(() => {
      const after = checkboxCell();
      const box = readActiveBox();
      const tapOnCell =
        !!box && !!down && pointInBox(down, box) && pointInBox(up, box);
      const alreadyToggled =
        !!after &&
        !!start &&
        phoneBoxWrites.some(
          (entry) =>
            entry.gesture === start.gesture &&
            entry.row === after.row &&
            entry.col === after.col,
        );
      const write = phoneCheckboxWrite({
        before,
        after,
        scrolled,
        tapOnCell,
        alreadyToggled,
        checked: after?.checked ?? "TRUE",
        unchecked: after?.unchecked ?? "FALSE",
      });
      if (!write || !after) return;
      injector.get(ICommandService).executeCommand(SetRangeValuesCommand.id, {
        suiteleafPhoneWrite: true,
        range: {
          startRow: after.row,
          endRow: after.row,
          startColumn: after.col,
          endColumn: after.col,
        },
        value: write,
      });
    }, 180);
  };
  sheetHost?.addEventListener("pointerdown", onPhonePointerDown, true);
  sheetHost?.addEventListener("pointerup", onPhonePointerUp, true);
  return () => {
    watchPhoneBoxWrite.dispose();
    sheetHost?.removeEventListener("pointerdown", onPhonePointerDown, true);
    sheetHost?.removeEventListener("pointerup", onPhonePointerUp, true);
  };
}
