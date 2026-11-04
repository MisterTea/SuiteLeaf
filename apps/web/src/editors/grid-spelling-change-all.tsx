import { IUndoRedoService } from "@univerjs/core";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { changeAllValues, plainCellText, type Box, type ChangeAllCell } from "./grid-spelling";
import type { Mark } from "./grid-spelling-marks";

function markedText(text: string, hits: { from: number; to: number }[]) {
  const ordered = [...hits].sort((a, b) => a.from - b.from);
  const parts: ReactNode[] = [];
  let cursor = 0;
  ordered.forEach((hit, index) => {
    if (hit.from > cursor) parts.push(text.slice(cursor, hit.from));
    parts.push(<mark key={index}>{text.slice(hit.from, hit.to)}</mark>);
    cursor = hit.to;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

let changeAllSteps = 0;

/** One set of cell writes, so Undo restores every cell Change all edited. */
export function applyChangeAll(workbook: any, engine: any, cells: ChangeAllCell[], replacement: string) {
  const values = changeAllValues(
    cells,
    (cell) => {
      const sheet = workbook?.getSheetBySheetId?.(cell.sheetId);
      if (!sheet) return null;
      try {
        return plainCellText(sheet.getRange(cell.row, cell.column, 1, 1).getCellData?.());
      } catch {
        return null;
      }
    },
    replacement,
  );
  if (!values.size) return false;
  const write = () => {
    for (const [sheetId, matrix] of values)
      workbook.getSheetBySheetId?.(sheetId)?.getRange(0, 0).setValues(matrix);
  };
  const unitId = workbook?.getId?.();
  if (engine?.get && unitId) {
    const undo = engine.get(IUndoRedoService);
    const group = undo.beginUndoRedoGroup(
      unitId,
      `suiteleaf.sheet.change-all.${++changeAllSteps}`,
      "append",
    );
    try {
      write();
    } finally {
      group.dispose();
    }
  } else write();
  return true;
}

export function previewHighlights(marks: Mark[], cells: ChangeAllCell[]) {
  const wanted = new Set(cells.map((cell) => cell.key));
  const seen = new Set<string>();
  const boxes: { key: string; label: string; box: Box }[] = [];
  for (const mark of marks) {
    if (!wanted.has(mark.cellKey) || seen.has(mark.cellKey)) continue;
    seen.add(mark.cellKey);
    boxes.push({ key: mark.cellKey, label: mark.label, box: mark.cell });
  }
  return boxes;
}

export function ChangeAllDialog({
  replacement,
  cells,
  onConfirm,
  onCancel,
  onFocusCell,
}: {
  replacement: string;
  cells: ChangeAllCell[];
  onConfirm: () => void;
  onCancel: () => void;
  onFocusCell: (cell: ChangeAllCell) => void;
}) {
  const title = `Change all to ${replacement}`;
  const count =
    cells.length === 1 ? "1 cell will change" : `${cells.length} cells will change`;
  return (
    <div className="gdocs-modal-overlay spelling-layer">
      <form
        className="gdocs-dialog spelling-panel change-all-panel"
        role="dialog"
        aria-modal="false"
        aria-labelledby="change-all-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (cells.length) onConfirm();
        }}
      >
        <div className="dialog-header">
          <h2 id="change-all-title">{title}</h2>
          <button type="button" className="dialog-close-btn" aria-label="Cancel change all" onClick={onCancel}>
            <X size={18} />
          </button>
        </div>
        <p className="spelling-progress" data-change-count={cells.length}>
          {count}
        </p>
        <p className="word-count-hint">
          Nothing changes until you confirm. Other spellings stay as they are.
        </p>
        <ul className="change-all-list">
          {cells.map((cell) => (
            <li key={cell.key}>
              <button
                type="button"
                className="change-all-cell"
                data-change-cell={cell.label}
                onClick={() => onFocusCell(cell)}
              >
                <span className="change-all-ref">{cell.label}</span>
                <span className="spelling-quote">{markedText(cell.text, cell.hits)}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="dialog-footer">
          <button type="button" className="dialog-text-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="dialog-primary-btn" disabled={!cells.length} autoFocus>
            Change all
          </button>
        </div>
      </form>
    </div>
  );
}
