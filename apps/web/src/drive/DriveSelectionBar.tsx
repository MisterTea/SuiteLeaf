import { useEffect, useRef } from "react";
import {
  Copy,
  Download,
  FolderInput,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import type { DriveItem } from "../node-client";
import type { DriveSort } from "./drive-sort";
import { DriveSortMenu } from "./DriveSortMenu";
import { bulkSelectionSummary } from "./drive-selection";

export interface DriveSelectionBarProps {
  selectable: boolean;
  view: "mine" | "shared" | "trash";
  sort: DriveSort;
  onSortChange: (next: DriveSort) => void;
  totalCount: number;
  selected: readonly DriveItem[];
  allSelected: boolean;
  someSelected: boolean;
  disabled?: boolean;
  onToggleAll: () => void;
  onClearSelection: () => void;
  onDownload: (files: DriveItem[]) => void;
  onMove: (files: DriveItem[]) => void;
  onCopy: (files: DriveItem[]) => void;
  onTrash: (items: DriveItem[]) => void;
  onRestore: (items: DriveItem[]) => void;
  onDeleteForever: (items: DriveItem[]) => void;
}

/** Header row above the SuiteDrive file list: select-all checkbox, sort menu, and bulk actions. */
export function DriveSelectionBar({
  selectable,
  view,
  sort,
  onSortChange,
  totalCount,
  selected,
  allSelected,
  someSelected,
  disabled = false,
  onToggleAll,
  onClearSelection,
  onDownload,
  onMove,
  onCopy,
  onTrash,
  onRestore,
  onDeleteForever,
}: DriveSelectionBarProps) {
  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  const summary = bulkSelectionSummary(selected, view);

  return (
    <div className="drive-list-bar">
      {selectable ? (
        <label className="drive-select-cell" title="Select all">
          <input
            ref={selectAllRef}
            type="checkbox"
            className="drive-checkbox"
            aria-label="Select all"
            checked={allSelected}
            disabled={disabled || totalCount === 0}
            onChange={onToggleAll}
          />
        </label>
      ) : null}
      <DriveSortMenu sort={sort} onChange={onSortChange} disabled={disabled} />
      {selectable && selected.length > 0 ? (
        <div
          className="drive-bulk-actions"
          role="toolbar"
          aria-label="Selected items actions"
        >
          <span className="drive-bulk-count" aria-live="polite">
            {selected.length} selected
          </span>
          {summary.canDownload ? (
            <button
              type="button"
              className="drive-bulk-btn"
              disabled={disabled}
              onClick={() => onDownload(summary.files)}
            >
              <Download size={14} aria-hidden="true" />
              <span>Download</span>
            </button>
          ) : null}
          {summary.canMove ? (
            <button
              type="button"
              className="drive-bulk-btn"
              disabled={disabled}
              onClick={() => onMove(summary.movableFiles)}
            >
              <FolderInput size={14} aria-hidden="true" />
              <span>Move</span>
            </button>
          ) : null}
          {summary.canCopy ? (
            <button
              type="button"
              className="drive-bulk-btn"
              disabled={disabled}
              onClick={() => onCopy(summary.files)}
            >
              <Copy size={14} aria-hidden="true" />
              <span>Copy</span>
            </button>
          ) : null}
          {summary.canTrash ? (
            <button
              type="button"
              className="drive-bulk-btn danger"
              disabled={disabled}
              onClick={() => onTrash(summary.editable)}
            >
              <Trash2 size={14} aria-hidden="true" />
              <span>Move to trash</span>
            </button>
          ) : null}
          {summary.canRestore ? (
            <button
              type="button"
              className="drive-bulk-btn"
              disabled={disabled}
              onClick={() => onRestore([...selected])}
            >
              <RotateCcw size={14} aria-hidden="true" />
              <span>Restore</span>
            </button>
          ) : null}
          {summary.canDeleteForever ? (
            <button
              type="button"
              className="drive-bulk-btn danger"
              disabled={disabled}
              onClick={() => onDeleteForever([...selected])}
            >
              <Trash2 size={14} aria-hidden="true" />
              <span>Delete forever</span>
            </button>
          ) : null}
          <button
            type="button"
            className="drive-bulk-clear"
            aria-label="Clear selection"
            title="Clear selection"
            disabled={disabled}
            onClick={onClearSelection}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
