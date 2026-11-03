import { useSyncExternalStore } from "react";
import { acceptHeldEdits, rejectHeldEdits, toolReviewStore } from "./tool-review";

/** Accept or reject edits that have not been applied. Tool arguments are not shown. */
export function HeldEditsPrompt() {
  const held = useSyncExternalStore(toolReviewStore.subscribe, toolReviewStore.get);
  if (!held.length) return null;
  const count = held.length === 1 ? "1 edit is waiting." : `${held.length} edits are waiting.`;
  return (
    <div className="agent-approval" role="region" aria-label="Waiting edits">
      <span>{count}</span>
      <button type="button" className="primary" onClick={() => void acceptHeldEdits()}>
        Accept
      </button>
      <button type="button" onClick={() => rejectHeldEdits()}>
        Reject
      </button>
    </div>
  );
}
