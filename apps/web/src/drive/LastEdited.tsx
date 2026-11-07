import { useEffect, useState } from "react";
import { observeItem } from "./observe-item";
import { versionWhen } from "../editors/version-history-model";
import { lastEditOf, type LastEdit } from "./last-edit";

/** Who last saved this SuiteDrive file, and when. Polls so another person's
 * save shows up without a reload, while version history stays closed. */
export function LastEdited({ itemId }: { itemId: string }) {
  const [edit, setEdit] = useState<LastEdit | null>(null);
  useEffect(() => {
    setEdit(null);
    return observeItem(itemId, (item) => setEdit(lastEditOf(item)));
  }, [itemId]);
  if (!edit) return null;
  return (
    <p className="last-edited">
      <strong>
        <span className="last-edited-label">Last edited by </span>
        {edit.name}
      </strong>
      {" · "}
      <time dateTime={edit.at}>{versionWhen(edit.at)}</time>
    </p>
  );
}
