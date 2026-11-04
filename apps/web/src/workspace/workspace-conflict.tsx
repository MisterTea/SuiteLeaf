import { CircleAlert } from "lucide-react";
import { ConflictCells } from "../conflict-cells";
import type { DriveItem } from "../node-client";
import { message } from "../error-message";

/** "A newer version was saved at 2:14 PM." (or "on Oct 12 at 2:14 PM."). */
function savedWhen(iso: string) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const time = at.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const day =
    at.toDateString() === new Date().toDateString()
      ? ""
      : `on ${at.toLocaleDateString(undefined, { month: "short", day: "numeric" })} `;
  return `A newer version was saved ${day}at ${time}.`;
}
export function DriveConflictBanner({
  driveConflict,
  saveDriveCopy,
  combineDriveChanges,
  reloadFromDrive,
  setError,
}: {
  driveConflict: DriveItem;
  saveDriveCopy: () => Promise<void>;
  combineDriveChanges: (
    keepBoth?: boolean,
    cells?: readonly string[],
  ) => Promise<string | null>;
  reloadFromDrive: () => Promise<void>;
  setError: (error: string) => void;
}) {
  return (
    <div className="error drive-conflict" role="alert">
      <CircleAlert size={18} />
      <span className="drive-conflict-text">
        <strong>
          This file was changed in SuiteDrive after you opened it.
        </strong>{" "}
        {savedWhen(driveConflict.updatedAt)} Your edits weren't uploaded
        and are safe on this device. Save them as a copy to keep both
        versions, combine them when they are in different parts of a
        document, or reload the SuiteDrive version. Your edits stay on this
        device as a separate file.
      </span>
      <span className="drive-conflict-actions">
        <button
          title="Upload your edits as a new file and leave the SuiteDrive version as it is"
          onClick={() =>
            void saveDriveCopy().catch((e) => setError(message(e)))
          }
        >
          Save as copy
        </button>
        <button
          title="Keep a copy of your edits, then save a document that includes both sides where they do not overlap"
          onClick={() =>
            void combineDriveChanges().catch((e) => setError(message(e)))
          }
        >
          Combine separate edits
        </button>
        <button
          title="Keep a copy of your edits, then save a document that includes both versions of a part both sides changed"
          onClick={() =>
            void combineDriveChanges(true).catch((e) => setError(message(e)))
          }
        >
          Keep both parts
        </button>
        <ConflictCells
          onTake={(addresses) => combineDriveChanges(false, addresses)}
        />
        <button
          title="Keep your edits as a separate file on this device and open the newer SuiteDrive version here"
          onClick={() => {
            if (
              window.confirm(
                "Open the SuiteDrive version in this file? Your edits will be kept on this device as a separate file.",
              )
            )
              void reloadFromDrive().catch((e) => setError(message(e)));
          }}
        >
          Reload from SuiteDrive
        </button>
      </span>
    </div>
  );
}
