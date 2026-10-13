import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import {
  CommandType,
  ICommandService,
  IUndoRedoService,
  IUniverInstanceService,
  UniverInstanceType,
} from "@univerjs/core";
import { X } from "lucide-react";

import {
  collapseAll,
  collapseLabel,
  collapsedRows,
  contiguousRanges,
  expandAll,
  expandLabel,
  makeGroup,
  planGroupRows,
  readRowGroups,
  replaceGroups,
  rowSpanLabel,
  rowsInGroups,
  showOnly,
  showOnlyLabel,
  type RowGroup,
} from "./sheet-row-groups";

const MUTATION = "suiteleaf.mutation.set-row-groups";
const UNDO_ID = "suiteleaf.row-groups";
const HIDE = "sheet.mutation.set-row-hidden";
const SHOW = "sheet.mutation.set-row-visible";

type Engine = { get: (id: unknown) => any };
type Mutation = { id: string; params: Record<string, unknown> };

export type SheetRowGroupsHandle = { groupRows: () => void };

type Dialog = { title: string; message: string };
type Selection = { sheetId: string; startRow: number; endRow: number };
type Model = {
  sheetId: string;
  groups: RowGroup[];
  selection: Selection | null;
  labels: Record<number, string>;
};
type Button = {
  key: string;
  label: string;
  text: string;
  left: number;
  top: number;
  width?: number;
  depth: number;
  kind: "toggle" | "only";
  run: () => void;
};
type Line = { key: string; left: number; top: number; height: number; depth: number };
type Tick = { key: string; left: number; top: number; text: string; depth: number };

function controlWidth(text: string): number {
  return Math.max(22, Math.ceil(text.length * 6.7 + 18));
}

function groupDepth(group: RowGroup, groups: RowGroup[]): number {
  return groups.filter(
    (other) =>
      other.id !== group.id &&
      other.startRow <= group.startRow &&
      other.endRow >= group.endRow &&
      (other.startRow < group.startRow || other.endRow > group.endRow),
  ).length;
}

function worksheetOf(engine: Engine, unitId: string, sheetId: string) {
  return engine
    .get(IUniverInstanceService)
    .getUnit(unitId, UniverInstanceType.UNIVER_SHEET)
    ?.getSheetBySheetId(sheetId);
}

type SceneRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

/** Univer's cell rects are sheet-scene coordinates. The grid canvas is the scene origin. */
function sceneToView(
  scene: SceneRect,
  origin: DOMRect,
  scrollLeft: number,
  scrollTop: number,
  zoom: number,
): SceneRect {
  const left = origin.left + (scene.left - scrollLeft) * zoom;
  const top = origin.top + (scene.top - scrollTop) * zoom;
  const width = scene.width * zoom;
  const height = scene.height * zoom;
  return { left, top, right: left + width, bottom: top + height, width, height };
}

function gridCanvas(host: Element): DOMRect | null {
  const canvas = [...host.querySelectorAll("canvas")]
    .filter((item) => item.getBoundingClientRect().width > 20)
    .sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return br.width * br.height - ar.width * ar.height;
    })[0];
  return canvas ? canvas.getBoundingClientRect() : null;
}

function readGroups(engine: Engine, unitId: string, sheetId: string): RowGroup[] {
  return readRowGroups(worksheetOf(engine, unitId, sheetId)?.getCustomMetadata());
}

function ensureMutation(engine: Engine) {
  const commands = engine.get(ICommandService);
  if (commands.hasCommand(MUTATION)) return;
  commands.registerCommand({
    id: MUTATION,
    type: CommandType.MUTATION,
    handler: (
      accessor: { get: (id: unknown) => any },
      params: { unitId: string; subUnitId: string; groups: unknown },
    ) => {
      const sheet = accessor
        .get(IUniverInstanceService)
        .getUnit(params.unitId, UniverInstanceType.UNIVER_SHEET)
        ?.getSheetBySheetId(params.subUnitId);
      if (!sheet) return false;
      const groups = readRowGroups({ suiteleafRowGroups: params.groups });
      const custom = { ...(sheet.getCustomMetadata() ?? {}) };
      if (groups.length) custom.suiteleafRowGroups = groups;
      else delete custom.suiteleafRowGroups;
      sheet.setCustomMetadata(Object.keys(custom).length ? custom : undefined);
      return true;
    },
  });
}

function visibility(unitId: string, subUnitId: string, rows: number[], id: string): Mutation | null {
  const ranges = contiguousRanges(rows);
  if (!ranges.length) return null;
  return { id, params: { unitId, subUnitId, ranges } };
}

/**
 * Collapse and expand rewrite the group undo item instead of pushing another,
 * so one Undo removes the group and shows every row.
 */
function applyGroups(
  engine: Engine,
  unitId: string,
  subUnitId: string,
  before: RowGroup[],
  after: RowGroup[],
  recordUndo: boolean,
) {
  const commands = engine.get(ICommandService);
  if (
    !commands.syncExecuteCommand(MUTATION, {
      unitId,
      subUnitId,
      groups: after,
    })
  )
    throw new Error("Could not update row groups.");
  const wasHidden = new Set(collapsedRows(before));
  const nowHidden = new Set(collapsedRows(after));
  const beforeRows = new Set(rowsInGroups(before));
  const afterRows = new Set(rowsInGroups(after));
  const hide = [...nowHidden].filter((row) => !wasHidden.has(row));
  const show = [...wasHidden].filter((row) => !nowHidden.has(row));
  for (const row of beforeRows) if (!afterRows.has(row)) show.push(row);
  const showMutation = visibility(unitId, subUnitId, show, SHOW);
  const hideMutation = visibility(unitId, subUnitId, hide, HIDE);
  if (showMutation) commands.syncExecuteCommand(showMutation.id, showMutation.params);
  if (hideMutation) commands.syncExecuteCommand(hideMutation.id, hideMutation.params);
  const redo = [
    { id: MUTATION, params: { unitId, subUnitId, groups: after } },
    visibility(unitId, subUnitId, collapsedRows(after), HIDE),
  ].filter((item): item is Mutation => !!item);
  const undoRedo = engine.get(IUndoRedoService);
  if (recordUndo) {
    const affected = [...new Set([...beforeRows, ...afterRows])];
    undoRedo.pushUndoRedo({
      unitID: unitId,
      id: UNDO_ID,
      undoMutations: [
        { id: MUTATION, params: { unitId, subUnitId, groups: before } },
        visibility(unitId, subUnitId, affected, SHOW),
        visibility(unitId, subUnitId, collapsedRows(before), HIDE),
      ].filter((item): item is Mutation => !!item),
      redoMutations: redo,
    });
    return;
  }
  const top = undoRedo.pitchTopUndoElement();
  if (top?.id === UNDO_ID && top.unitID === unitId) top.redoMutations = redo;
}

export default function SheetRowGroups({
  api,
  engine,
  persist,
  ref,
}: {
  api: any;
  engine: Engine;
  persist: () => void;
  ref?: Ref<SheetRowGroupsHandle>;
}) {
  const persistRef = useRef(persist);
  persistRef.current = persist;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [model, setModel] = useState<Model | null>(null);
  const [buttons, setButtons] = useState<Button[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [ticks, setTicks] = useState<Tick[]>([]);
  const modelRef = useRef(model);
  modelRef.current = model;
  const actions = useRef<(group: RowGroup, next: RowGroup) => void>(() => {});
  const refreshRef = useRef(() => {});
  refreshRef.current = () => {
    const workbook = api.getActiveWorkbook();
    const facade = workbook?.getActiveSheet();
    if (!workbook || !facade) return;
    const unitId = workbook.getId();
    const sheetId = facade.getSheetId();
    const groups = readGroups(engine, unitId, sheetId);
    const range = workbook.getActiveRange()?.getRange();
    const selection: Selection | null = range
      ? { sheetId, startRow: range.startRow, endRow: range.endRow }
      : null;
    const labels: Record<number, string> = {};
    if (selection && selection.startRow === selection.endRow) {
      try {
        labels[selection.startRow] = String(
          facade.getRange(selection.startRow, 0).getValue() ?? "",
        );
      } catch {
        // The grid may not have a rect for this row yet.
      }
    }
    const next = { sheetId, groups, selection, labels };
    setModel((prev) =>
      JSON.stringify(prev) === JSON.stringify(next) ? prev : next,
    );
  };

  useEffect(() => {
    ensureMutation(engine);
    refreshRef.current();
    const workbook = api.getActiveWorkbook();
    const sub = workbook?.onCommandExecuted(() => refreshRef.current());
    return () => sub?.dispose();
  }, [api, engine]);

  actions.current = (group, next) => {
    const workbook = api.getActiveWorkbook();
    const facade = workbook?.getActiveSheet();
    if (!workbook || !facade) return;
    const unitId = workbook.getId();
    const sheetId = facade.getSheetId();
    const before = readGroups(engine, unitId, sheetId);
    applyGroups(
      engine,
      unitId,
      sheetId,
      before,
      before.map((item) => (item.id === group.id ? next : item)),
      false,
    );
    persistRef.current();
    refreshRef.current();
  };

  useImperativeHandle(
    ref,
    () => ({
      groupRows() {
        const workbook = api.getActiveWorkbook();
        const facade = workbook?.getActiveSheet();
        if (!workbook || !facade) return;
        const range = workbook.getActiveRange()?.getRange() ?? null;
        const selection = range
          ? { startRow: range.startRow, endRow: range.endRow }
          : null;
        let formulas: string[] = [];
        if (selection) {
          const last = Math.max(0, facade.getLastColumn());
          formulas = (
            facade.getRange(selection.startRow, 0, 1, last + 1).getFormulas()?.[0] ??
            []
          ).map((formula: unknown) => (formula ? String(formula) : ""));
        }
        const plan = planGroupRows(selection, formulas);
        if (!plan.ok) {
          setDialog({ title: "Nothing to group", message: plan.message });
          return;
        }
        const unitId = workbook.getId();
        const sheetId = facade.getSheetId();
        const before = readGroups(engine, unitId, sheetId);
        if (
          before.some(
            (group) =>
              group.startRow === plan.startRow && group.endRow === plan.endRow,
          )
        ) {
          setDialog({
            title: "Already grouped",
            message:
              "Those rows are already grouped. Use the minus beside them to collapse the rows under the total.",
          });
          return;
        }
        applyGroups(
          engine,
          unitId,
          sheetId,
          before,
          replaceGroups(before, makeGroup(plan.startRow, plan.endRow)),
          true,
        );
        persistRef.current();
        setDialog(null);
        refreshRef.current();
      },
    }),
    [api, engine],
  );

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = requestAnimationFrame(measure);
      const current = modelRef.current;
      const host = document.querySelector(".sheet-host");
      const workbook = api.getActiveWorkbook();
      const facade = workbook?.getActiveSheet();
      if (!current?.groups.length || !host || !facade || facade.getSheetId() !== current.sheetId) {
        setButtons((prev) => (prev.length ? [] : prev));
        setLines((prev) => (prev.length ? [] : prev));
        setTicks((prev) => (prev.length ? [] : prev));
        return;
      }
      const origin = gridCanvas(host);
      if (!origin) return;
      const hostBox = host.getBoundingClientRect();
      const snap = worksheetOf(engine, workbook.getId(), current.sheetId)?.getSnapshot?.();
      const scrollLeft = Number(snap?.scrollLeft) || 0;
      const scrollTop = Number(snap?.scrollTop) || 0;
      const zoom = Number(snap?.zoomRatio) || 1;
      const nextButtons: Button[] = [];
      const nextLines: Line[] = [];
      const nextTicks: Tick[] = [];
      const hiddenByAny = new Set(current.groups.flatMap((group) => group.collapsed));
      const maxDepth = Math.max(...current.groups.map((group) => groupDepth(group, current.groups)));
      const place = (rect: SceneRect | null) =>
        rect && origin ? sceneToView(rect, origin, scrollLeft, scrollTop, zoom) : null;
      const onGrid = (rect: SceneRect) =>
        !!origin &&
        rect.bottom > origin.top + 4 &&
        rect.top < Math.min(origin.bottom, hostBox.bottom) - 28;
      for (const group of current.groups) {
        const hidden = new Set(group.collapsed);
        const open = hidden.size < group.endRow - group.startRow + 1;
        const closed = hidden.size > 0;
        const depth = groupDepth(group, current.groups);
        const anchor = group.startRow > 0 ? group.startRow - 1 : group.startRow;
        if (hiddenByAny.has(anchor)) continue;
        let anchorRect: SceneRect | null = null;
        try {
          if (anchor !== group.startRow || !hidden.has(anchor))
            anchorRect = place(facade.getRange(anchor, 0).getCellRect());
        } catch {
          anchorRect = null;
        }
        if (!anchorRect || anchorRect.height < 2 || !onGrid(anchorRect)) continue;
        const span = rowSpanLabel(group);
        const toggles: Button[] = [];
        if (open)
          toggles.push({
            key: `${group.id}-collapse`,
            label: collapseLabel(group),
            text: `− ${span}`,
            left: 0,
            top: 0,
            depth,
            kind: "toggle",
            run: () => actions.current(group, collapseAll(group)),
          });
        if (closed)
          toggles.push({
            key: `${group.id}-expand`,
            label: expandLabel(group),
            text: `+ ${span}`,
            left: 0,
            top: 0,
            depth,
            kind: "toggle",
            run: () => actions.current(group, expandAll(group)),
          });
        const markSize = 18;
        const lane = maxDepth - depth;
        const lineLeft = anchorRect.left - 6 - lane * 12;
        const markLeft = Math.max(origin!.left + 2, lineLeft - markSize / 2);
        const markTop = anchorRect.top + (anchorRect.height - markSize) / 2;
        nextTicks.push({
          key: group.id,
          left: markLeft,
          top: markTop,
          text: open ? "−" : "+",
          depth,
        });
        let labelLeft = anchorRect.left + 8 + depth * 18;
        try {
          const slot = place(facade.getRange(anchor, 2).getCellRect());
          if (slot) labelLeft = slot.left + 8 + depth * 18;
        } catch {
          // Column C may not have a rect yet.
        }
        const pillHeight = 22;
        const pillTop = anchorRect.top + (anchorRect.height - pillHeight) / 2;
        toggles.forEach((button) => {
          button.left = labelLeft;
          button.top = pillTop;
          labelLeft += controlWidth(button.text) + 6;
          nextButtons.push(button);
        });
        const visible: number[] = [];
        for (let row = group.startRow; row <= group.endRow; row++)
          if (!hiddenByAny.has(row)) visible.push(row);
        if (visible.length) {
          try {
            const last = place(facade.getRange(visible[visible.length - 1]!, 0).getCellRect());
            if (last) {
              const lineTop = anchor < group.startRow ? anchorRect.bottom - 1 : anchorRect.top + markSize / 2;
              const height = last.bottom - lineTop;
              if (height > 4)
                nextLines.push({
                  key: group.id,
                  left: lineLeft,
                  top: lineTop,
                  height,
                  depth,
                });
            }
          } catch {
            // A row that just became visible may not have a rect this frame.
          }
        }
        const selected = current.selection;
        if (
          selected &&
          selected.sheetId === current.sheetId &&
          selected.startRow === selected.endRow &&
          selected.startRow >= group.startRow &&
          selected.startRow <= group.endRow &&
          !hidden.has(selected.startRow) &&
          hidden.size < group.endRow - group.startRow
        ) {
          try {
            const row = selected.startRow;
            const cell = place(facade.getRange(row, 2).getCellRect());
            const label = showOnlyLabel(current.labels[row], row);
            if (cell && onGrid(cell))
              nextButtons.push({
                key: `${group.id}-only-${row}`,
                label,
                text: label,
                left: Math.min(cell.left + 8, hostBox.right - 180),
                top: cell.top + (cell.height - 26) / 2,
                depth: 0,
                kind: "only",
                run: () => actions.current(group, showOnly(group, row)),
              });
          } catch {
            // The selected row is not on screen.
          }
        }
      }
      const signature = JSON.stringify(
        nextButtons.map(({ key, left, top, text }) => [key, Math.round(left), Math.round(top), text]),
      );
      setButtons((prev) => {
        const prevSignature = JSON.stringify(
          prev.map(({ key, left, top, text }) => [key, Math.round(left), Math.round(top), text]),
        );
        return prevSignature === signature ? prev : nextButtons;
      });
      const lineSignature = JSON.stringify(
        nextLines.map((line) => [line.key, Math.round(line.left), Math.round(line.top), Math.round(line.height), line.depth]),
      );
      setLines((prev) => {
        const prevSignature = JSON.stringify(
          prev.map((line) => [line.key, Math.round(line.left), Math.round(line.top), Math.round(line.height), line.depth]),
        );
        return prevSignature === lineSignature ? prev : nextLines;
      });
      const tickSignature = JSON.stringify(
        nextTicks.map((tick) => [tick.key, Math.round(tick.left), Math.round(tick.top), tick.text, tick.depth]),
      );
      setTicks((prev) => {
        const prevSignature = JSON.stringify(
          prev.map((tick) => [tick.key, Math.round(tick.left), Math.round(tick.top), tick.text, tick.depth]),
        );
        return prevSignature === tickSignature ? prev : nextTicks;
      });
    };
    frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [api, engine, model]);

  const collapsed = model ? collapsedRows(model.groups).join(",") : "";
  const groupSpans = model?.groups.map((group) => `${group.startRow + 1}-${group.endRow + 1}`).join(",") ?? "";
  return (
    <>
      <div className="row-group-controls" data-collapsed={collapsed} data-groups={groupSpans}>
        {lines.map((line) => (
          <span
            key={line.key}
            className="row-group-line"
            data-depth={line.depth}
            style={{ left: line.left, top: line.top, height: line.height }}
          />
        ))}
        {ticks.map((tick) => (
          <span
            key={tick.key}
            className="row-group-mark"
            data-depth={tick.depth}
            aria-hidden="true"
            style={{ left: tick.left, top: tick.top }}
          >
            {tick.text}
          </span>
        ))}
        {buttons.map((button) => (
          <button
            key={button.key}
            type="button"
            className={button.kind === "only" ? "row-group-only" : "row-group-toggle"}
            data-depth={button.kind === "toggle" ? button.depth : undefined}
            aria-label={button.label}
            style={{ left: button.left, top: button.top }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={button.run}
          >
            {button.text}
          </button>
        ))}
      </div>
      {dialog ? (
        <div className="gdocs-modal-overlay" onClick={() => setDialog(null)}>
          <div
            className="gdocs-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={dialog.title}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") setDialog(null);
            }}
          >
            <div className="dialog-header">
              <h2>{dialog.title}</h2>
              <button
                type="button"
                className="dialog-close-btn"
                aria-label="Close"
                onClick={() => setDialog(null)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="dialog-body">
              <p className="dialog-note">{dialog.message}</p>
            </div>
            <div className="dialog-footer">
              <button
                type="button"
                className="dialog-primary-btn"
                autoFocus
                onClick={() => setDialog(null)}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
