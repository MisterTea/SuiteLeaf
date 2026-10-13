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
  collapseAllColumns,
  collapseColumnLabel,
  collapsedColumns,
  columnSpanLabel,
  columnsInGroups,
  contiguousColumnRanges,
  expandAllColumns,
  expandColumnLabel,
  makeColumnGroup,
  planGroupColumns,
  readColumnGroups,
  replaceColumnGroups,
  showOnlyColumn,
  showOnlyColumnLabel,
  withColumnGroups,
  type ColumnGroup,
} from "./sheet-column-groups";

const MUTATION = "suiteleaf.mutation.set-column-groups";
const UNDO_ID = "suiteleaf.column-groups";
const HIDE = "sheet.mutation.set-col-hidden";
const SHOW = "sheet.mutation.set-col-visible";

type Engine = { get: (id: unknown) => any };
type Mutation = { id: string; params: Record<string, unknown> };

export type SheetColumnGroupsHandle = { groupColumns: () => void };

type Dialog = { title: string; message: string };
type Selection = { sheetId: string; startColumn: number; endColumn: number };
type Model = {
  sheetId: string;
  groups: ColumnGroup[];
  selection: Selection | null;
  labels: Record<number, string>;
};
type Button = {
  key: string;
  label: string;
  text: string;
  left: number;
  top: number;
  depth: number;
  kind: "toggle" | "only";
  run: () => void;
};
type Line = { key: string; left: number; top: number; width: number; depth: number };

function controlWidth(text: string): number {
  return Math.max(22, Math.ceil(text.length * 6.7 + 18));
}

function groupDepth(group: ColumnGroup, groups: ColumnGroup[]): number {
  return groups.filter(
    (other) =>
      other.id !== group.id &&
      other.startColumn <= group.startColumn &&
      other.endColumn >= group.endColumn &&
      (other.startColumn < group.startColumn || other.endColumn > group.endColumn),
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

function readGroups(engine: Engine, unitId: string, sheetId: string): ColumnGroup[] {
  return readColumnGroups(worksheetOf(engine, unitId, sheetId)?.getCustomMetadata());
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
      const groups = readColumnGroups({ suiteleafColumnGroups: params.groups });
      sheet.setCustomMetadata(withColumnGroups(sheet.getCustomMetadata(), groups));
      return true;
    },
  });
}

function visibility(
  unitId: string,
  subUnitId: string,
  columns: number[],
  id: string,
): Mutation | null {
  const ranges = contiguousColumnRanges(columns);
  if (!ranges.length) return null;
  return { id, params: { unitId, subUnitId, ranges } };
}

/**
 * Collapse and expand rewrite the group undo item instead of pushing another,
 * so one Undo removes the group and shows every column.
 */
function applyGroups(
  engine: Engine,
  unitId: string,
  subUnitId: string,
  before: ColumnGroup[],
  after: ColumnGroup[],
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
    throw new Error("Could not update column groups.");
  const wasHidden = new Set(collapsedColumns(before));
  const nowHidden = new Set(collapsedColumns(after));
  const beforeColumns = new Set(columnsInGroups(before));
  const afterColumns = new Set(columnsInGroups(after));
  const hide = [...nowHidden].filter((column) => !wasHidden.has(column));
  const show = [...wasHidden].filter((column) => !nowHidden.has(column));
  for (const column of beforeColumns) if (!afterColumns.has(column)) show.push(column);
  const showMutation = visibility(unitId, subUnitId, show, SHOW);
  const hideMutation = visibility(unitId, subUnitId, hide, HIDE);
  if (showMutation) commands.syncExecuteCommand(showMutation.id, showMutation.params);
  if (hideMutation) commands.syncExecuteCommand(hideMutation.id, hideMutation.params);
  const redo = [
    { id: MUTATION, params: { unitId, subUnitId, groups: after } },
    visibility(unitId, subUnitId, collapsedColumns(after), HIDE),
  ].filter((item): item is Mutation => !!item);
  const undoRedo = engine.get(IUndoRedoService);
  if (recordUndo) {
    const affected = [...new Set([...beforeColumns, ...afterColumns])];
    undoRedo.pushUndoRedo({
      unitID: unitId,
      id: UNDO_ID,
      undoMutations: [
        { id: MUTATION, params: { unitId, subUnitId, groups: before } },
        visibility(unitId, subUnitId, affected, SHOW),
        visibility(unitId, subUnitId, collapsedColumns(before), HIDE),
      ].filter((item): item is Mutation => !!item),
      redoMutations: redo,
    });
    return;
  }
  const top = undoRedo.pitchTopUndoElement();
  if (top?.id === UNDO_ID && top.unitID === unitId) top.redoMutations = redo;
}

export default function SheetColumnGroups({
  api,
  engine,
  persist,
  ref,
}: {
  api: any;
  engine: Engine;
  persist: () => void;
  ref?: Ref<SheetColumnGroupsHandle>;
}) {
  const persistRef = useRef(persist);
  persistRef.current = persist;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [model, setModel] = useState<Model | null>(null);
  const [buttons, setButtons] = useState<Button[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const modelRef = useRef(model);
  modelRef.current = model;
  const actions = useRef<(group: ColumnGroup, next: ColumnGroup) => void>(() => {});
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
      ? { sheetId, startColumn: range.startColumn, endColumn: range.endColumn }
      : null;
    const labels: Record<number, string> = {};
    if (selection && selection.startColumn === selection.endColumn) {
      try {
        labels[selection.startColumn] = String(
          facade.getRange(0, selection.startColumn).getValue() ?? "",
        );
      } catch {
        // The grid may not have a rect for this column yet.
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
      groupColumns() {
        const workbook = api.getActiveWorkbook();
        const facade = workbook?.getActiveSheet();
        if (!workbook || !facade) return;
        const range = workbook.getActiveRange()?.getRange() ?? null;
        const selection = range
          ? {
              startColumn: Math.min(range.startColumn, range.endColumn),
              endColumn: Math.max(range.startColumn, range.endColumn),
            }
          : null;
        let formulas: string[] = [];
        let firstColumn: { values: unknown[]; formulas: string[] } | undefined;
        if (selection && selection.endColumn > selection.startColumn) {
          try {
            const height = Math.max(1, facade.getLastRow() + 1);
            const cells = (matrix: unknown) =>
              (Array.isArray(matrix) ? matrix : []).map((row: unknown) => {
                const value = Array.isArray(row) ? row[0] : row;
                return value ?? "";
              });
            formulas = cells(
              facade.getRange(0, selection.endColumn, height, 1).getFormulas(),
            ).map((formula) => (formula ? String(formula) : ""));
            firstColumn = {
              values: cells(
                facade.getRange(0, selection.startColumn, height, 1).getRawValues(),
              ),
              formulas: cells(
                facade.getRange(0, selection.startColumn, height, 1).getFormulas(),
              ).map((formula) => (formula ? String(formula) : "")),
            };
          } catch {
            formulas = [];
          }
        }
        const plan = planGroupColumns(selection, formulas, firstColumn);
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
              group.startColumn === plan.startColumn &&
              group.endColumn === plan.endColumn,
          )
        ) {
          setDialog({
            title: "Already grouped",
            message:
              "Those columns are already grouped. Use the minus above them to collapse the months and leave the label on screen.",
          });
          return;
        }
        applyGroups(
          engine,
          unitId,
          sheetId,
          before,
          replaceColumnGroups(before, makeColumnGroup(plan.startColumn, plan.endColumn)),
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
        return;
      }
      const origin = gridCanvas(host);
      const hostBox = host.getBoundingClientRect();
      const snap = worksheetOf(engine, workbook.getId(), current.sheetId)?.getSnapshot?.();
      let scrollLeft = Number(snap?.scrollLeft) || 0;
      let scrollTop = Number(snap?.scrollTop) || 0;
      try {
        const state = facade.getScrollState?.();
        if (state) {
          scrollLeft = Number(state.offsetX) || scrollLeft;
          scrollTop = Number(state.offsetY) || scrollTop;
        }
      } catch {
        // The snapshot scroll is enough when the facade has no scroll state yet.
      }
      const zoom = Number(snap?.zoomRatio) || 1;
      const nextButtons: Button[] = [];
      const nextLines: Line[] = [];
      const place = (row: number, column: number) => {
        try {
          const rect = facade.getRange(row, column).getCellRect();
          if (!rect || rect.width < 2 || rect.height < 2 || !origin) return null;
          return sceneToView(rect, origin, scrollLeft, scrollTop, zoom);
        } catch {
          return null;
        }
      };
      const px = (value: number) => Math.round(value / 2) * 2;
      const hiddenByAny = new Set(current.groups.flatMap((group) => group.collapsed));
      const onScreen = (left: number, top: number) =>
        left >= hostBox.left + 4 &&
        left <= hostBox.right - 28 &&
        top >= hostBox.top &&
        top <= hostBox.bottom - 28;
      for (const group of current.groups) {
        const hidden = new Set(group.collapsed);
        const open = hidden.size < group.endColumn - group.startColumn + 1;
        const closed = hidden.size > 0;
        const depth = groupDepth(group, current.groups);
        const anchor = group.startColumn > 0 ? group.startColumn - 1 : group.startColumn;
        if (hiddenByAny.has(anchor)) continue;
        const visible: number[] = [];
        for (let column = group.startColumn; column <= group.endColumn; column++)
          if (!hiddenByAny.has(column)) visible.push(column);
        const span = columnSpanLabel(group);
        const toggles: Button[] = [];
        if (open)
          toggles.push({
            key: `${group.id}-collapse`,
            label: collapseColumnLabel(group),
            text: `− ${span}`,
            left: 0,
            top: 0,
            depth,
            kind: "toggle",
            run: () => actions.current(group, collapseAllColumns(group)),
          });
        if (closed)
          toggles.push({
            key: `${group.id}-expand`,
            label: expandColumnLabel(group),
            text: `+ ${span}`,
            left: 0,
            top: 0,
            depth,
            kind: "toggle",
            run: () => actions.current(group, expandAllColumns(group)),
          });
        const anchorRect = place(0, anchor);
        if (anchorRect && anchorRect.width > 2) {
          const pillHeight = 22;
          let left = anchorRect.left + 8;
          const top = anchorRect.top - pillHeight - depth * 4;
          if (onScreen(left, top)) {
            toggles.forEach((button) => {
              button.left = px(left);
              button.top = px(top);
              left += controlWidth(button.text) + 6;
              if (onScreen(button.left, button.top)) nextButtons.push(button);
            });
          }
        }
        if (visible.length) {
          const placed = visible
            .map((column) => place(0, column))
            .filter((rect): rect is SceneRect => !!rect);
          if (placed.length) {
            const lineLeft = Math.max(placed[0]!.left, hostBox.left + 4);
            const lineRight = Math.min(placed[placed.length - 1]!.right, hostBox.right - 8);
            if (lineRight - lineLeft > 8)
              nextLines.push({
                key: group.id,
                left: px(lineLeft),
                top: px(placed[0]!.top - 1 - depth * 7),
                width: px(lineRight - lineLeft),
                depth,
              });
          }
        }
        const selected = current.selection;
        if (
          selected &&
          selected.sheetId === current.sheetId &&
          selected.startColumn === selected.endColumn &&
          selected.startColumn >= group.startColumn &&
          selected.startColumn <= group.endColumn &&
          !hidden.has(selected.startColumn) &&
          hidden.size < group.endColumn - group.startColumn
        ) {
          const column = selected.startColumn;
          const cell = place(1, column);
          const label = showOnlyColumnLabel(current.labels[column], column);
          if (cell && origin && cell.top < hostBox.bottom - 20 && cell.left < origin.right - 40)
            nextButtons.push({
              key: `${group.id}-only-${column}`,
              label,
              text: label,
              left: px(Math.min(Math.max(cell.left + 4, hostBox.left + 4), hostBox.right - 180)),
              top: px(cell.top + Math.max(0, (cell.height - 26) / 2)),
              depth: 0,
              kind: "only",
              run: () => actions.current(group, showOnlyColumn(group, column)),
            });
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
        nextLines.map((line) => [
          line.key,
          Math.round(line.left),
          Math.round(line.top),
          Math.round(line.width),
          line.depth,
        ]),
      );
      setLines((prev) => {
        const prevSignature = JSON.stringify(
          prev.map((line) => [
            line.key,
            Math.round(line.left),
            Math.round(line.top),
            Math.round(line.width),
            line.depth,
          ]),
        );
        return prevSignature === lineSignature ? prev : nextLines;
      });
    };
    frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [api, engine, model]);

  const collapsed = model ? collapsedColumns(model.groups).join(",") : "";
  const span = model
    ? model.groups.map((group) => `${group.startColumn}-${group.endColumn}`).join(",")
    : "";
  return (
    <>
      <div className="column-group-controls" data-collapsed={collapsed} data-span={span}>
        {lines.map((line) => (
          <span
            key={line.key}
            className="column-group-line"
            data-depth={line.depth}
            style={{ left: line.left, top: line.top, width: line.width }}
          />
        ))}
        {buttons.map((button) => (
          <button
            key={button.key}
            type="button"
            className={button.kind === "only" ? "column-group-only" : "column-group-toggle"}
            data-depth={button.kind === "toggle" ? button.depth : undefined}
            aria-label={button.label}
            style={{ left: button.left, top: button.top }}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
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
