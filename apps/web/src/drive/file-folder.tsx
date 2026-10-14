import { useEffect, useState } from "react";
import { Folder } from "lucide-react";
import { drive, type DriveItem } from "../node-client";
import { MY_DRIVE, movedToFolderText } from "./folder-paths";
import type { MoveResult } from "./MoveDialog";

export interface DrivePlace {
  parentId: string | null;
  name: string;
}

export interface MoveNotice {
  fileName: string;
  folderName: string;
  previousParentId: string | null;
}

function placeFrom(item: DriveItem, fallbackName?: string): DrivePlace {
  return {
    parentId: item.parentId,
    name: item.parentId
      ? item.parentName || fallbackName || "A folder"
      : MY_DRIVE,
  };
}

/** The open file's folder. Loaded from the drive item, then updated when it moves. */
export function useDriveFolder(itemId: string | undefined, active: boolean) {
  const [place, setPlace] = useState<DrivePlace | null>(null);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<MoveNotice | null>(null);

  useEffect(() => {
    setPlace(null);
    setOpen(false);
    setNotice(null);
    if (!itemId || !active) return;
    let alive = true;
    void drive
      .get(itemId)
      .then((item) => {
        if (alive) setPlace(placeFrom(item));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [itemId, active]);

  const moved = (result: MoveResult) => {
    const next = placeFrom(result.item, result.folderName);
    setPlace(next);
    setNotice({
      fileName: result.item.name,
      folderName: next.name,
      previousParentId: result.previousParentId,
    });
    setOpen(false);
  };

  const undo = async () => {
    if (!itemId || !notice) return;
    const item = await drive.update(itemId, {
      parentId: notice.previousParentId,
    });
    setPlace(
      placeFrom(item, notice.previousParentId == null ? MY_DRIVE : undefined),
    );
    setNotice(null);
  };

  return {
    place,
    open,
    setOpen,
    notice,
    moved,
    undo,
    dismiss: () => setNotice(null),
  };
}

export function FolderControls({
  place,
  canMove,
  onOpen,
  onMove,
}: {
  place: DrivePlace | null;
  canMove: boolean;
  onOpen: () => void;
  onMove: () => void;
}) {
  if (!place) return null;
  return (
    <div className="title-folder-row">
      <button
        type="button"
        className="folder-chip"
        aria-label={`Folder ${place.name}`}
        onClick={onOpen}
      >
        <Folder size={14} aria-hidden="true" />
        <span>{place.name}</span>
      </button>
      {canMove ? (
        <button type="button" className="header-move" onClick={onMove}>
          Move
        </button>
      ) : null}
    </div>
  );
}

/** Stays until Undo or Dismiss. It does not clear itself. */
export function MoveBanner({
  notice,
  busy = false,
  onUndo,
  onDismiss,
}: {
  notice: MoveNotice;
  busy?: boolean;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="drive-move-banner" role="status">
      <p>{movedToFolderText(notice.fileName, notice.folderName)}</p>
      <span className="drive-move-banner-actions">
        <button type="button" onClick={onUndo} disabled={busy}>
          Undo
        </button>
        <button type="button" onClick={onDismiss} disabled={busy}>
          Dismiss
        </button>
      </span>
    </div>
  );
}
