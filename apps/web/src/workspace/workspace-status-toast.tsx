import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { editorSaveTitle, type SaveRecord } from "../save-state";
import { StatusIcon, saveIconState } from "../status-icon";

/** Routine saves stay quiet; failures announce themselves above the editor. */
export function WorkspaceStatusToast({
  status,
  record,
  roomNotice,
  retry,
  target,
}: {
  status: string;
  record: SaveRecord;
  roomNotice: string | null;
  retry?: () => void;
  target?: HTMLElement | null;
}) {
  const [visible, setVisible] = useState(true);
  const needsRetry = !!retry;
  const iconState = needsRetry ? "error" : saveIconState(status);
  const failed = iconState === "error";
  useEffect(() => {
    setVisible(true);
    if (!failed || needsRetry) return;
    const timer = window.setTimeout(() => setVisible(false), 5000);
    return () => window.clearTimeout(timer);
  }, [status, roomNotice, needsRetry, failed]);

  const toast = (
    <div
      className="workspace-status-toast"
      hidden={!visible || !failed}
    >
      <div role="status" aria-live="polite" aria-atomic="true">
        <span className="save-status">
          <StatusIcon
            state={iconState}
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
  return target ? createPortal(toast, target) : toast;
}
