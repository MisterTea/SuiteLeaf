import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { editorSaveTitle, type SaveRecord } from "../save-state";
import { StatusIcon, saveIconState } from "../status-icon";

/** Status changes announce themselves without reserving space above the editor. */
export function WorkspaceStatusToast({
  status,
  record,
  roomNotice,
  retry,
}: {
  status: string;
  record: SaveRecord;
  roomNotice: string | null;
  retry?: () => void;
}) {
  const [visible, setVisible] = useState(true);
  const needsRetry = !!retry;
  useEffect(() => {
    setVisible(true);
    if (needsRetry) return;
    const timer = window.setTimeout(() => setVisible(false), 5000);
    return () => window.clearTimeout(timer);
  }, [status, roomNotice, needsRetry]);

  return (
    <div
      className="workspace-status-toast"
      hidden={!visible || (!status && !roomNotice)}
    >
      <div role="status" aria-live="polite" aria-atomic="true">
        <span className="save-status">
          <StatusIcon
            state={needsRetry ? "error" : saveIconState(status)}
            label={status}
            detail={editorSaveTitle(status, record)}
          />
        </span>
        {roomNotice ? <p>{roomNotice}</p> : null}
      </div>
      {retry ? (
        <button type="button" onClick={retry}>
          Retry sync
        </button>
      ) : null}
      <button
        type="button"
        className="doc-icon-btn"
        aria-label="Dismiss notification"
        onClick={() => setVisible(false)}
      >
        <X size={16} />
      </button>
    </div>
  );
}
