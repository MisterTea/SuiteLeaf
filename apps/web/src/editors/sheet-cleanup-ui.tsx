import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { CellValueType, ICommandService, IUndoRedoService } from "@univerjs/core";
import { X } from "lucide-react";

import {
  cellsConflict,
  columnLabel,
  defaultColumnNames,
  detectSeparator,
  highlightMessage,
  looksLikeHeader,
  overwriteWarning,
  planDuplicates,
  removeMessage,
  rowGroups,
  SEPARATORS,
  separatorChar,
  splitColumn,
  splitMessage,
  trimMessage,
  trimValue,
  type KeepRule,
  type SeparatorKind,
} from "./sheet-cleanup";

const PREVIEW_FILL = "#fde293";
const MARK_FILL = "#d2e3fc";
const MAX_PARTS = 20;

type CellData = {
  v?: unknown;
  f?: string | null;
  p?: unknown;
  t?: number;
  s?: unknown;
};

type Bounds = {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
};

type Notice = { text: string; undo: boolean };

type DupPanel = {
  kind: "duplicates";
  sheetId: string;
  unitId: string;
  startRow: number;
  startColumn: number;
  endColumn: number;
  rows: unknown[][];
  hidden: number[];
  header: boolean;
  keys: boolean[];
  keep: KeepRule;
  ignoreCase: boolean;
};

type SplitPanel = {
  kind: "split";
  sheetId: string;
  unitId: string;
  rows: { row: number; text: string }[];
  column: number;
  /** Values to the right of each source row, used to warn before overwriting. */
  right: unknown[][];
  headerRight: unknown[];
  filtered: boolean;
  headerRow: number | null;
  renameHeader: boolean;
  names: string[];
  separator: SeparatorKind;
  custom: string;
  collapse: boolean;
  detected: boolean;
  destination: "insert" | "overwrite";
  destinationTouched: boolean;
};

type Engine = { get: (id: any) => any };

export default function SheetCleanup({
  api,
  engine,
  persist,
  onError,
  ref,
}: {
  api: any;
  engine: Engine | null;
  persist: () => void;
  onError: (message: string) => void;
  ref?: Ref<{ trim: () => void; duplicates: () => void; split: () => void }>;
}) {
  const [panel, setPanel] = useState<DupPanel | SplitPanel | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const painted = useRef<{ sheetId: string; unitId: string; cells: { row: number; col: number; data: CellData | null }[] } | null>(null);
  /** First-seen cell contents, so a later preview never treats its own fill as the original. */
  const originals = useRef(new Map<string, CellData | null>());
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const book = api.getActiveWorkbook?.();
    const commands = engine?.get(ICommandService);
    const clear = (command: { id?: string }) => {
      if (command.id === "univer.command.undo" || command.id === "univer.command.redo")
        setNotice(null);
    };
    const fromBook = book?.onCommandExecuted?.(clear);
    const fromCommands = commands?.onCommandExecuted?.(clear);
    return () => {
      fromBook?.dispose?.();
      fromCommands?.dispose?.();
    };
  }, [api, engine]);

  const panelKind = panel?.kind ?? null;
  useEffect(() => {
    if (!panelKind) return;
    dialog.current?.focus();
  }, [panelKind]);

  const restorePaint = () => {
    const snap = painted.current;
    if (!snap || !engine) return;
    painted.current = null;
    writeCells(
      engine,
      snap.unitId,
      snap.sheetId,
      snap.cells.map((cell) => ({
        row: cell.row,
        col: cell.col,
        data: cell.data?.s ? cell.data : { ...(cell.data ?? { v: null }), s: null },
      })),
      true,
    );
  };

  const paintRows = (
    sheet: any,
    unitId: string,
    rows: number[],
    startColumn: number,
    endColumn: number,
    color: string,
  ) => {
    restorePaint();
    if (!engine || !rows.length) return;
    const cells: { row: number; col: number; data: CellData | null }[] = [];
    const writes: { row: number; col: number; data: CellData }[] = [];
    for (const row of rows) {
      for (let col = startColumn; col <= endColumn; col++) {
        const key = `${row}:${col}`;
        if (!originals.current.has(key))
          originals.current.set(key, cloneCell(sheet.getRange(row, col).getCellData()));
        const data = originals.current.get(key) ?? null;
        cells.push({ row, col, data });
        writes.push({ row, col, data: withFill(data, color) });
      }
    }
    writeCells(engine, unitId, sheet.getSheetId(), writes);
    painted.current = { sheetId: sheet.getSheetId(), unitId, cells };
  };

  const closePanel = () => {
    restorePaint();
    originals.current.clear();
    setPanel(null);
  };

  const run = (work: () => void) => {
    try {
      work();
      persist();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  };

  useImperativeHandle(ref, () => ({
    trim: () => run(() => trimSelection()),
    duplicates: () => run(() => openDuplicates()),
    split: () => run(() => openSplit()),
  }));

  const trimSelection = () => {
    const found = activeSelection();
    if (!found || !engine) {
      setNotice({ text: "Select the cells to clean up first.", undo: false });
      return;
    }
    const { sheet, bounds, unitId } = found;
    const hidden = hiddenRows(sheet, bounds);
    const height = bounds.endRow - bounds.startRow + 1;
    const width = bounds.endColumn - bounds.startColumn + 1;
    const grid = sheet.getRange(bounds.startRow, bounds.startColumn, height, width).getCellDatas() as (CellData | null)[][];
    const matrix: Record<number, Record<number, CellData>> = {};
    let changed = 0;
    let nonBreaking = 0;
    for (let r = 0; r < height; r++) {
      const row = bounds.startRow + r;
      if (hidden.has(row)) continue;
      for (let c = 0; c < width; c++) {
        const cell = grid[r]?.[c];
        if (!cell || cell.f || typeof cell.v !== "string") continue;
        const trimmed = trimValue(cell.v);
        if (!trimmed) continue;
        changed++;
        nonBreaking += trimmed.nonBreaking;
        (matrix[row] ??= {})[bounds.startColumn + c] = {
          v: trimmed.text,
          t: CellValueType.STRING,
        };
      }
    }
    if (changed)
      withOneUndo(engine, unitId, () => sheet.getRange(0, 0).setValues(matrix));
    setNotice({
      text: trimMessage(changed, nonBreaking, hidden.size > 0),
      undo: changed > 0,
    });
  };

  const openDuplicates = () => {
    restorePaint();
    originals.current.clear();
    const found = activeSelection();
    if (!found) {
      setNotice({ text: "Select the table to check for duplicates.", undo: false });
      return;
    }
    const { sheet, bounds, unitId } = found;
    const hidden = hiddenRows(sheet, bounds);
    const height = bounds.endRow - bounds.startRow + 1;
    const width = bounds.endColumn - bounds.startColumn + 1;
    const grid = readValues(sheet, bounds.startRow, bounds.startColumn, height, width);
    const header = looksLikeHeader(grid[0] ?? [], grid[1]);
    setPanel({
      kind: "duplicates",
      sheetId: sheet.getSheetId(),
      unitId,
      startRow: bounds.startRow,
      startColumn: bounds.startColumn,
      endColumn: bounds.endColumn,
      rows: grid,
      hidden: [...hidden],
      header,
      keys: Array.from({ length: width }, () => true),
      keep: "first",
      ignoreCase: true,
    });
  };

  const openSplit = () => {
    restorePaint();
    originals.current.clear();
    const found = activeSelection();
    if (!found) {
      setNotice({ text: "Select the column to split.", undo: false });
      return;
    }
    const { sheet, bounds, unitId } = found;
    const column = bounds.startColumn;
    const hidden = hiddenRows(sheet, bounds);
    const columnValues = readValues(
      sheet,
      bounds.startRow,
      column,
      bounds.endRow - bounds.startRow + 1,
      1,
    );
    const rows: { row: number; text: string }[] = [];
    columnValues.forEach((cells, index) => {
      const row = bounds.startRow + index;
      if (hidden.has(row)) return;
      const value = cells[0];
      rows.push({ row, text: value === null || value === undefined ? "" : String(value) });
    });
    const detected = detectSeparator(rows.map((row) => row.text).filter(Boolean));
    const headerRow = bounds.startRow > 0 ? bounds.startRow - 1 : null;
    const headerValue = headerRow === null ? null : sheet.getRange(headerRow, column).getCellData()?.v;
    const headerText = typeof headerValue === "string" && headerValue.trim() ? headerValue.trim() : null;
    const first = rows[0]?.row ?? bounds.startRow;
    const last = rows[rows.length - 1]?.row ?? bounds.endRow;
    const block = rows.length
      ? readValues(sheet, first, column + 1, last - first + 1, MAX_PARTS - 1)
      : [];
    const right = rows.map((source) => block[source.row - first] ?? []);
    const headerRight = headerRow === null
      ? []
      : readValues(sheet, headerRow, column + 1, 1, MAX_PARTS - 1)[0] ?? [];
    const preview = splitColumn(
      rows.map((row) => row.text),
      separatorChar(detected.kind, ""),
      true,
    );
    const width = preview[0]?.length ?? 1;
    const conflict = neighborsConflict(right, headerRight, width, headerText !== null);
    setPanel({
      kind: "split",
      sheetId: sheet.getSheetId(),
      unitId,
      rows,
      column,
      right,
      headerRight,
      filtered: hidden.size > 0,
      headerRow,
      renameHeader: headerText !== null,
      names: defaultColumnNames(width, headerText),
      separator: detected.kind,
      custom: "",
      collapse: true,
      detected: detected.found,
      destination: conflict ? "insert" : "overwrite",
      destinationTouched: false,
    });
  };

  const duplicatePlan = panel?.kind === "duplicates"
    ? planDuplicates({
        rows: panel.rows,
        startRow: panel.startRow,
        header: panel.header,
        keyColumns: panel.keys.flatMap((on, index) => (on ? [index] : [])),
        keep: panel.keep,
        ignoreCase: panel.ignoreCase,
        hidden: new Set(panel.hidden),
      })
    : null;

  const splitView = panel?.kind === "split" ? describeSplit(panel) : null;

  const duplicateKey = duplicatePlan ? `${duplicatePlan.preview}|${duplicatePlan.removeRows.join(",")}` : "";
  const panelRef = useRef(panel);
  const planRef = useRef(duplicatePlan);
  panelRef.current = panel;
  planRef.current = duplicatePlan;
  useEffect(() => {
    const current = panelRef.current;
    const plan = planRef.current;
    if (current?.kind !== "duplicates" || !plan) return;
    const sheet = api.getActiveWorkbook()?.getSheetBySheetId(current.sheetId);
    if (sheet)
      paintRows(
        sheet,
        current.unitId,
        plan.removeRows,
        current.startColumn,
        current.endColumn,
        PREVIEW_FILL,
      );
    return () => restorePaint();
    // The highlight is derived from the plan key. Depending on the plan object would repaint every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duplicateKey, api]);

  const commitRemove = () => {
    if (panel?.kind !== "duplicates" || !duplicatePlan || !engine) return;
    const sheet = api.getActiveWorkbook()?.getSheetBySheetId(panel.sheetId);
    if (!sheet) return;
    const removed = duplicatePlan.removeRows.length;
    if (!removed) return;
    restorePaint();
    run(() => {
      withOneUndo(engine, panel.unitId, () => {
        for (const [start, end] of rowGroups(duplicatePlan.removeRows).reverse())
          sheet.deleteRows(start, end - start + 1);
      });
      setNotice({
        text: removeMessage(removed, duplicatePlan.remain, panel.hidden.length > 0),
        undo: true,
      });
      setPanel(null);
    });
  };

  const commitHighlight = () => {
    if (panel?.kind !== "duplicates" || !duplicatePlan || !engine) return;
    const sheet = api.getActiveWorkbook()?.getSheetBySheetId(panel.sheetId);
    if (!sheet) return;
    const rows = duplicatePlan.duplicateRows;
    if (!rows.length) return;
    restorePaint();
    run(() => {
      withOneUndo(engine, panel.unitId, () => {
        const matrix: Record<number, Record<number, CellData>> = {};
        for (const row of rows)
          for (let col = panel.startColumn; col <= panel.endColumn; col++)
            (matrix[row] ??= {})[col] = { s: { bg: { rgb: MARK_FILL } } };
        sheet.getRange(0, 0).setValues(matrix);
      });
      setNotice({
        text: highlightMessage(rows.length, panel.hidden.length > 0),
        undo: true,
      });
      setPanel(null);
    });
  };

  const commitSplit = () => {
    if (panel?.kind !== "split" || !splitView || !engine) return;
    const sheet = api.getActiveWorkbook()?.getSheetBySheetId(panel.sheetId);
    if (!sheet) return;
    const width = splitView.grid[0]?.length ?? 1;
    if (width < 2) {
      setNotice({ text: "Nothing to split. Choose a separator that appears in the cells.", undo: false });
      return;
    }
    const extra = width - 1;
    const insert = panel.destination === "insert";
    run(() => {
      withOneUndo(engine, panel.unitId, () => {
        if (insert && extra > 0) sheet.insertColumns(panel.column + 1, extra);
        const matrix: Record<number, Record<number, CellData>> = {};
        panel.rows.forEach((source, index) => {
          const parts = splitView.grid[index] ?? [];
          parts.forEach((part, offset) => {
            (matrix[source.row] ??= {})[panel.column + offset] = textCell(part);
          });
        });
        if (panel.renameHeader && panel.headerRow !== null)
          panel.names.slice(0, width).forEach((name, offset) => {
            (matrix[panel.headerRow!] ??= {})[panel.column + offset] = textCell(name);
          });
        sheet.getRange(0, 0).setValues(matrix);
      });
      setNotice({
        text: splitMessage(panel.rows.length, width, panel.filtered),
        undo: true,
      });
      setPanel(null);
    });
  };

  return (
    <>
      {notice ? (
        <div className="sheet-notice cleanup-notice" role="status">
          <span>{notice.text}</span>
          {notice.undo ? (
            <>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                className="sheet-notice-undo"
                onClick={() => {
                  setNotice(null);
                  void api.undo();
                }}
              >
                Undo
              </button>
            </>
          ) : null}
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}>
            <X size={14} />
          </button>
        </div>
      ) : null}
      {panel?.kind === "duplicates" && duplicatePlan ? (
        <div
          className="gdocs-dialog cleanup-panel"
          role="dialog"
          aria-modal="false"
          aria-label="Remove duplicates"
          ref={dialog}
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === "Escape") closePanel();
          }}
        >
          <div className="dialog-header">
            <h2>Remove duplicates</h2>
            <button type="button" className="dialog-close-btn" aria-label="Close" onClick={closePanel}>
              <X size={18} />
            </button>
          </div>
          <div className="cleanup-body">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={panel.header}
                onChange={(event) =>
                  setPanel({ ...panel, header: event.target.checked })
                }
              />
              Data has header row
            </label>
            <fieldset className="cleanup-columns">
              <legend>Columns to match</legend>
              {panel.keys.map((checked, index) => {
                const label = columnTitle(panel, index);
                return (
                  <div className="cleanup-column" key={index}>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          const keys = panel.keys.slice();
                          keys[index] = event.target.checked;
                          setPanel({ ...panel, keys });
                        }}
                      />
                      {label}
                    </label>
                    <button
                      type="button"
                      className="dialog-text-btn"
                      aria-label={`Only ${label}`}
                      onClick={() =>
                        setPanel({
                          ...panel,
                          keys: panel.keys.map((_, i) => i === index),
                        })
                      }
                    >
                      Only
                    </button>
                  </div>
                );
              })}
            </fieldset>
            <fieldset className="cleanup-keep">
              <legend>Keep</legend>
              {(
                [
                  ["first", "First row"],
                  ["last", "Last row"],
                  ["filled", "The row with the most filled cells"],
                ] as const
              ).map(([value, label]) => (
                <label className="checkbox-row" key={value}>
                  <input
                    type="radio"
                    name="keep-duplicate"
                    checked={panel.keep === value}
                    onChange={() => setPanel({ ...panel, keep: value })}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={panel.ignoreCase}
                onChange={(event) =>
                  setPanel({ ...panel, ignoreCase: event.target.checked })
                }
              />
              Ignore case
            </label>
          </div>
          <p className="cleanup-summary" role="status">
            {duplicatePlan.preview}
            {duplicatePlan.removeRows.length
              ? " Those rows are highlighted in the sheet."
              : ""}
          </p>
          <div className="dialog-footer">
            <button
              type="button"
              className="dialog-text-btn"
              disabled={!duplicatePlan.duplicateRows.length}
              onClick={commitHighlight}
            >
              Highlight duplicates
            </button>
            <button
              type="button"
              className="dialog-primary-btn"
              disabled={!duplicatePlan.removeRows.length || !panel.keys.some(Boolean)}
              onClick={commitRemove}
            >
              Remove
            </button>
          </div>
        </div>
      ) : null}
      {panel?.kind === "split" && splitView ? (
        <div
          className="gdocs-dialog cleanup-panel"
          role="dialog"
          aria-modal="false"
          aria-label="Split text to columns"
          ref={dialog}
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === "Escape") closePanel();
          }}
        >
          <div className="dialog-header">
            <h2>Split text to columns</h2>
            <button type="button" className="dialog-close-btn" aria-label="Close" onClick={closePanel}>
              <X size={18} />
            </button>
          </div>
          <div className="cleanup-body">
            <label className="cleanup-field">
              Separator
              <select
                aria-label="Separator"
                value={panel.separator}
                onChange={(event) =>
                  resizeSplit({ ...panel, separator: event.target.value as SeparatorKind })
                }
              >
                {SEPARATORS.map((separator) => (
                  <option key={separator.kind} value={separator.kind}>
                    {separator.label}
                  </option>
                ))}
                <option value="custom">Custom</option>
              </select>
            </label>
            {panel.separator === "custom" ? (
              <label className="cleanup-field">
                Custom separator
                <input
                  aria-label="Custom separator"
                  value={panel.custom}
                  onChange={(event) => resizeSplit({ ...panel, custom: event.target.value })}
                />
              </label>
            ) : null}
            {!panel.detected && panel.separator !== "custom" ? (
              <p className="cleanup-hint">Couldn't detect a separator. Pick one, or type a custom separator.</p>
            ) : null}
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={panel.collapse}
                onChange={(event) => resizeSplit({ ...panel, collapse: event.target.checked })}
              />
              Treat consecutive separators as one
            </label>
            <div className="cleanup-preview" aria-label="Split preview">
              <table>
                <tbody>
                  {splitView.sample.map((row, index) => (
                    <tr key={index}>
                      {row.map((part, column) => (
                        <td key={column}>{part || "—"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {panel.headerRow !== null ? (
              <>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={panel.renameHeader}
                    onChange={(event) =>
                      setPanel({ ...panel, renameHeader: event.target.checked })
                    }
                  />
                  Rename the header row
                </label>
                {panel.renameHeader ? (
                  <div className="cleanup-names">
                    {panel.names.map((name, index) => (
                      <label className="cleanup-field" key={index}>
                        {`Column ${index + 1}`}
                        <input
                          aria-label={`Header ${index + 1}`}
                          value={name}
                          onChange={(event) => {
                            const names = panel.names.slice();
                            names[index] = event.target.value;
                            setPanel({ ...panel, names });
                          }}
                        />
                      </label>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
            {splitView.warning ? <p className="cleanup-warning">{splitView.warning}</p> : null}
            <fieldset className="cleanup-keep">
              <legend>Where the new columns go</legend>
              <label className="checkbox-row">
                <input
                  type="radio"
                  name="split-destination"
                  checked={panel.destination === "insert"}
                  onChange={() =>
                    setPanel({ ...panel, destination: "insert", destinationTouched: true })
                  }
                />
                Insert columns
              </label>
              <label className="checkbox-row">
                <input
                  type="radio"
                  name="split-destination"
                  checked={panel.destination === "overwrite"}
                  onChange={() =>
                    setPanel({ ...panel, destination: "overwrite", destinationTouched: true })
                  }
                />
                Overwrite cells to the right
              </label>
            </fieldset>
          </div>
          <div className="dialog-footer">
            <button type="button" className="dialog-text-btn" onClick={closePanel}>
              Cancel
            </button>
            <button type="button" className="dialog-primary-btn" onClick={commitSplit}>
              Split
            </button>
          </div>
        </div>
      ) : null}
    </>
  );

  function resizeSplit(next: SplitPanel) {
    const grid = splitGrid(next);
    const width = grid[0]?.length ?? 1;
    const names = defaultColumnNames(width, next.names[0] && next.headerRow !== null ? next.names[0] : null);
    // Keep names the user already typed when the width is unchanged.
    const kept = next.names.length === width ? next.names : names.map((name, i) => next.names[i] ?? name);
    const conflict = splitConflict(next, width);
    setPanel({
      ...next,
      names: kept,
      destination: next.destinationTouched ? next.destination : conflict ? "insert" : "overwrite",
    });
  }

  function activeSelection(): { sheet: any; bounds: Bounds; unitId: string } | null {
    const book = api.getActiveWorkbook?.();
    const sheet = book?.getActiveSheet?.();
    const bounds = sheet?.getSelection?.()?.getActiveRange?.()?.getRange?.() as Bounds | undefined;
    if (!book || !sheet || !bounds) return null;
    const data = sheet.getDataRange?.().getRange?.() as Bounds | undefined;
    const endRow = data && bounds.endRow - bounds.startRow > 2000
      ? Math.max(bounds.startRow, Math.min(bounds.endRow, data.endRow))
      : bounds.endRow;
    return { sheet, unitId: book.getId(), bounds: { ...bounds, endRow } };
  }
}

function describeSplit(panel: SplitPanel) {
  const grid = splitGrid(panel);
  const width = grid[0]?.length ?? 1;
  const sample = grid.filter((row) => row.some(Boolean)).slice(0, 3);
  const warning = width > 1 && splitConflict(panel, width)
    ? overwriteWarning(panel.column + 1, width - 1)
    : "";
  return { grid, sample: sample.length ? sample : grid.slice(0, 3), warning, conflict: warning !== "" };
}

function splitGrid(panel: SplitPanel): string[][] {
  const delimiter = separatorChar(panel.separator, panel.custom);
  return splitColumn(panel.rows.map((row) => row.text), delimiter, panel.collapse).map((row) =>
    row.length > MAX_PARTS
      ? [...row.slice(0, MAX_PARTS - 1), row.slice(MAX_PARTS - 1).join(delimiter || " ")]
      : row,
  );
}

function splitConflict(panel: SplitPanel, width: number): boolean {
  return neighborsConflict(panel.right, panel.headerRight, width, panel.renameHeader);
}

function neighborsConflict(
  right: unknown[][],
  headerRight: unknown[],
  width: number,
  includeHeader: boolean,
): boolean {
  const extra = width - 1;
  if (extra <= 0) return false;
  const cells = right.flatMap((row) => row.slice(0, extra));
  if (includeHeader) cells.push(...headerRight.slice(0, extra));
  return cellsConflict(cells);
}

function columnTitle(panel: DupPanel, index: number): string {
  if (panel.header) {
    const value = panel.rows[0]?.[index];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return `Column ${columnLabel(panel.startColumn + index)}`;
}

function readValues(sheet: any, startRow: number, startColumn: number, height: number, width: number): unknown[][] {
  const grid = sheet.getRange(startRow, startColumn, height, width).getCellDatas() as (CellData | null)[][];
  return Array.from({ length: height }, (_, r) =>
    Array.from({ length: width }, (_, c) => {
      const value = grid[r]?.[c]?.v;
      return value === undefined || value === "" ? null : value;
    }),
  );
}

function hiddenRows(sheet: any, bounds: Bounds): Set<number> {
  let hidden: number[] = [];
  try {
    hidden = sheet.getFilter?.()?.getFilteredOutRows?.() ?? [];
  } catch {
    hidden = [];
  }
  const inSelection = hidden.filter((row) => row >= bounds.startRow && row <= bounds.endRow);
  return new Set(inSelection);
}

function textCell(value: string): CellData {
  if (!value) return { v: null, f: null, p: null };
  // Text type plus an @ format, so values like 00123 are not parsed as numbers.
  return {
    v: value,
    t: CellValueType.STRING,
    f: null,
    p: null,
    s: { n: { pattern: "@" } },
  };
}

function withFill(cell: CellData | null, color: string): CellData {
  const style = cell?.s && typeof cell.s === "object" ? { ...(cell.s as object), bg: { rgb: color } } : { bg: { rgb: color } };
  return { ...(cell ?? {}), s: style };
}

function cloneCell(cell: CellData | null): CellData | null {
  if (!cell) return null;
  try {
    return structuredClone(cell);
  } catch {
    return { ...cell };
  }
}

function writeCells(
  engine: Engine,
  unitId: string,
  sheetId: string,
  cells: { row: number; col: number; data: CellData }[],
  overrideStyle = false,
) {
  if (!cells.length) return;
  const cellValue: Record<number, Record<number, CellData>> = {};
  for (const cell of cells) (cellValue[cell.row] ??= {})[cell.col] = cell.data;
  engine.get(ICommandService).syncExecuteCommand("sheet.mutation.set-range-values", {
    unitId,
    subUnitId: sheetId,
    cellValue,
    // Replacing the style is what actually removes a preview fill. Merging leaves it.
    isOverrideStyle: overrideStyle,
  });
}

let cleanupSteps = 0;

/** Several sheet commands become the one undo step the user expects. */
function withOneUndo(engine: Engine, unitId: string, work: () => void) {
  const undo = engine.get(IUndoRedoService);
  // A repeated group id would merge with the previous cleanup, so each action gets its own.
  const group = undo.beginUndoRedoGroup(unitId, `suiteleaf.sheet.cleanup.${++cleanupSteps}`, "append");
  try {
    work();
  } finally {
    group.dispose();
  }
}
