import { useEffect, useState } from "react";
import { Check, Folder } from "lucide-react";
import { drive, type DriveItem } from "../node-client";
import { DriveDialog } from "./drive-dialog";
import {
  moveDestinations,
  type MoveDestination,
} from "./folder-paths";

/** Pick a destination folder for multiple selected SuiteDrive files. */
export function BulkMoveDialog({
  items,
  onClose,
  onConfirm,
}: {
  items: readonly DriveItem[];
  onClose: () => void;
  onConfirm: (destination: MoveDestination) => void;
}) {
  const [folders, setFolders] = useState<
    { id: string; name: string; parentId: string | null }[] | null
  >(null);
  const [choice, setChoice] = useState<MoveDestination | null>(null);
  const [error, setError] = useState("");

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

  const firstParent = items[0]?.parentId ?? null;
  const allSameParent = items.every((item) => item.parentId === firstParent);
  const includeMyDrive =
    items.every((item) => item.role === "owner") &&
    items.some((item) => item.parentId != null);

  const destinations = folders
    ? moveDestinations(folders, allSameParent ? firstParent : "__mixed__", {
        includeMyDrive,
      })
    : [];

  const submit = () => {
    if (!choice) return;
    onConfirm(choice);
  };

  return (
    <DriveDialog
      title="Move"
      submitLabel="Move here"
      canSubmit={!!choice}
      onSubmit={submit}
      onClose={onClose}
    >
      <p className="dialog-note">
        Move {items.length} {items.length === 1 ? "file" : "files"} to a folder.
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
