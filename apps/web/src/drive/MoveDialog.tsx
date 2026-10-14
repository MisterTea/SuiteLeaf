import { useEffect, useState } from "react";
import { Check, Folder } from "lucide-react";
import { drive, type DriveItem } from "../node-client";
import { DriveDialog } from "./drive-dialog";
import {
  MY_DRIVE,
  moveDestinations,
  type MoveDestination,
} from "./folder-paths";

export interface MoveResult {
  item: DriveItem;
  previousParentId: string | null;
  folderName: string;
}

/** Pick a folder by its path. The pressed row is the one that will receive the file. */
export function MoveDialog({
  item,
  currentName,
  includeMyDrive,
  onClose,
  onMoved,
}: {
  item: {
    id: string;
    name: string;
    parentId: string | null;
    kind: string;
  };
  currentName: string;
  /** Owners may move a file back to the top of My Drive. */
  includeMyDrive: boolean;
  onClose: () => void;
  onMoved: (result: MoveResult) => void;
}) {
  const [folders, setFolders] = useState<
    { id: string; name: string; parentId: string | null }[] | null
  >(null);
  const [choice, setChoice] = useState<MoveDestination | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    void drive
      .listFolders()
      .then((next) => {
        if (alive) setFolders(next);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);
  const destinations = folders
    ? moveDestinations(folders, item.parentId, {
        movingId: item.kind === "folder" ? item.id : undefined,
        includeMyDrive,
      })
    : [];

  const submit = () => {
    if (!choice || busy) return;
    setBusy(true);
    setError("");
    const previousParentId = item.parentId;
    void drive
      .update(item.id, { parentId: choice.id })
      .then((updated) => {
        onMoved({
          item: updated,
          previousParentId,
          folderName:
            choice.id == null ? MY_DRIVE : updated.parentName || choice.name,
        });
        onClose();
      })
      .catch((e) => {
        setBusy(false);
        setError(e instanceof Error ? e.message : String(e));
      });
  };

  return (
    <DriveDialog
      title="Move"
      submitLabel="Move here"
      canSubmit={!!choice && !busy}
      onSubmit={submit}
      onClose={onClose}
    >
      <p className="dialog-note">
        {item.name} is in {currentName}.
      </p>
      {error ? (
        <p className="dialog-error" role="alert">
          {error}
        </p>
      ) : null}
      {folders == null && !error ? (
        <p className="drive-empty">Loading…</p>
      ) : destinations.length === 0 ? (
        <p className="drive-empty">There are no other folders.</p>
      ) : (
        <ul className="move-folder-list">
          {destinations.map((dest) => {
            const pressed =
              choice?.id === dest.id && choice?.path === dest.path;
            return (
              <li key={dest.id ?? "my-drive"}>
                <button
                  type="button"
                  aria-pressed={pressed}
                  className={pressed ? "is-chosen" : ""}
                  onClick={() => setChoice(dest)}
                >
                  <Folder size={16} aria-hidden="true" />
                  <span>{dest.path}</span>
                  {pressed ? <Check size={16} aria-hidden="true" /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </DriveDialog>
  );
}
