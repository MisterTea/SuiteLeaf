import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DriveItem } from "../node-client";

export interface BulkSelectionSummary {
  files: DriveItem[];
  editable: DriveItem[];
  movableFiles: DriveItem[];
  canDownload: boolean;
  canCopy: boolean;
  canMove: boolean;
  canTrash: boolean;
  canRestore: boolean;
  canDeleteForever: boolean;
}

/** Which bulk actions apply to the currently selected items in a SuiteDrive view. */
export function bulkSelectionSummary(
  selected: readonly DriveItem[],
  view: "mine" | "shared" | "trash",
): BulkSelectionSummary {
  const files = selected.filter((item) => item.kind === "file");
  const editable = selected.filter(
    (item) => item.role === "owner" || item.role === "editor",
  );
  const movableFiles = files.filter(
    (item) => item.role === "owner" || item.role === "editor",
  );
  const inTrash = view === "trash";
  return {
    files,
    editable,
    movableFiles,
    canDownload: !inTrash && files.length > 0,
    canCopy: !inTrash && files.length > 0,
    canMove: !inTrash && movableFiles.length > 0,
    canTrash: !inTrash && editable.length > 0,
    canRestore: inTrash && selected.length > 0,
    canDeleteForever: inTrash && selected.length > 0,
  };
}

/** Multi-select state for the visible SuiteDrive list, with Shift-click range selection. */
export function useDriveSelection(
  visible: readonly DriveItem[],
  scopeKey: string,
) {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const lastToggledId = useRef<string | null>(null);

  useEffect(() => {
    setSelectedIds(new Set());
    lastToggledId.current = null;
  }, [scopeKey]);

  const selected = useMemo(
    () => visible.filter((item) => selectedIds.has(item.id)),
    [visible, selectedIds],
  );
  const allSelected = visible.length > 0 && selected.length === visible.length;
  const someSelected = selected.length > 0 && !allSelected;

  const isSelected = useCallback(
    (id: string) => selectedIds.has(id),
    [selectedIds],
  );

  const toggle = useCallback(
    (id: string, shiftKey = false) => {
      const anchorId = lastToggledId.current;
      lastToggledId.current = id;
      setSelectedIds((prev) => {
        const next = new Set(prev);
        const targetChecked = !prev.has(id);
        if (shiftKey && anchorId) {
          const anchor = visible.findIndex((item) => item.id === anchorId);
          const current = visible.findIndex((item) => item.id === id);
          if (anchor !== -1 && current !== -1) {
            const [start, end] =
              anchor < current ? [anchor, current] : [current, anchor];
            for (let i = start; i <= end; i++) {
              if (targetChecked) next.add(visible[i].id);
              else next.delete(visible[i].id);
            }
            return next;
          }
        }
        if (targetChecked) next.add(id);
        else next.delete(id);
        return next;
      });
    },
    [visible],
  );

  const toggleAll = useCallback(() => {
    lastToggledId.current = null;
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visible.map((item) => item.id)));
    }
  }, [allSelected, visible]);

  const clear = useCallback(() => {
    setSelectedIds(new Set());
    lastToggledId.current = null;
  }, []);

  return {
    selected,
    allSelected,
    someSelected,
    isSelected,
    toggle,
    toggleAll,
    clear,
  };
}
