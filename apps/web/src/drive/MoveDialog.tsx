import { useEffect, useState } from "react";
import { Check, Folder } from "lucide-react";
import { drive, type AccessGrant, type DriveItem } from "../node-client";
import { DriveDialog } from "./drive-dialog";
import { commitFolderMove, folderMovePreview, type FolderMovePreview, type MoveGrant } from "./folder-move-preview";
import {
  MY_DRIVE,
  moveDestinations,
  type MoveDestination,
} from "./folder-paths";

/** Grants the preview can name. An expired row is not access. Ids stay off the note. */
export function grantsForMovePreview(grants: readonly AccessGrant[]): MoveGrant[] {
  return grants
    .filter((grant) => grant.expired !== true)
    .map((grant) => ({
      principalId: grant.principalId,
      name: (grant.name ?? "").replace(/\s+/g, " ").trim(),
      inherited: grant.inheritedFrom != null,
    }));
}

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
  const [preview, setPreview] = useState<FolderMovePreview | null>(null);
  const [checking, setChecking] = useState(false);
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
  useEffect(() => {
    if (!choice) {
      setPreview(null);
      setChecking(false);
      return;
    }
    let alive = true;
    setChecking(true);
    setPreview(null);
    void Promise.all([
      drive.access(item.id),
      choice.id ? drive.access(choice.id) : Promise.resolve({ grants: [] as AccessGrant[] }),
    ])
      .then(([current, next]) => {
        if (!alive) return;
        setPreview(
          folderMovePreview({
            current: grantsForMovePreview(current.grants),
            nextFolder: grantsForMovePreview(next.grants),
          }),
        );
        setChecking(false);
      })
      .catch(() => {
        if (!alive) return;
        setPreview(null);
        setChecking(false);
        setError("The access plan could not be read.");
      });
    return () => {
      alive = false;
    };
  }, [choice, item.id]);
  const destinations = folders
    ? moveDestinations(folders, item.parentId, {
        movingId: item.kind === "folder" ? item.id : undefined,
        includeMyDrive,
      })
    : [];

  const submit = () => {
    if (!choice || !preview || busy) return;
    setBusy(true);
    setError("");
    const previousParentId = item.parentId;
    const destinationId = choice.id;
    void Promise.all([
      drive.access(item.id),
      destinationId ? drive.access(destinationId) : Promise.resolve({ grants: [] as AccessGrant[] }),
    ])
      .then(([current, next]) => {
        const decision = commitFolderMove({
          stamp: preview.stamp,
          current: grantsForMovePreview(current.grants),
          nextFolder: grantsForMovePreview(next.grants),
        });
        if (!decision.ok) {
          setBusy(false);
          setError(decision.note);
          setPreview(
            folderMovePreview({
              current: grantsForMovePreview(current.grants),
              nextFolder: grantsForMovePreview(next.grants),
            }),
          );
          return null;
        }
        return drive.update(item.id, { parentId: destinationId });
      })
      .then((updated) => {
        if (!updated) return;
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
      canSubmit={!!choice && !!preview && !busy}
      onSubmit={submit}
      onClose={onClose}
    >
      <p className="dialog-note">
        {item.name} is in {currentName}.
      </p>
      {checking ? <p className="dialog-note">Checking who would have access.</p> : null}
      {preview ? (
        <p className="dialog-note">
          {preview.note}
          {preview.gain.length > 0 ? ` ${preview.gain.join(", ")} would gain access.` : ""}
          {preview.lose.length > 0 ? ` ${preview.lose.join(", ")} would lose access.` : ""}
        </p>
      ) : null}
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
