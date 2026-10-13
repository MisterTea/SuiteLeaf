import { useEffect, useState } from "react";
import { drive } from "../node-client";
import { versionWhen } from "../editors/version-history-model";
import { DRIVE_SAVED, lastEditOf, type LastEdit } from "./last-edit";

/** Who last saved this SuiteDrive file, and when. Polls so another person's
 * save shows up without a reload, while version history stays closed. */
export function LastEdited({ itemId }: { itemId: string }) {
  const [edit, setEdit] = useState<LastEdit | null>(null);
  useEffect(() => {
    let alive = true;
    const pull = () => {
      void drive
        .get(itemId)
        .then((item) => {
          if (alive) setEdit(lastEditOf(item));
        })
        .catch(() => {});
    };
    pull();
    const timer = setInterval(pull, 2000);
    window.addEventListener(DRIVE_SAVED, pull);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener(DRIVE_SAVED, pull);
    };
  }, [itemId]);
  if (!edit) return null;
  return (
    <p className="last-edited">
      Last edited by <strong>{edit.name}</strong>
      {" · "}
      <time dateTime={edit.at}>{versionWhen(edit.at)}</time>
    </p>
  );
}
