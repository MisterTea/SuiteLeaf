import { useState } from "react";
import { api, json } from "../node-client";

export type MemberPlanChange = {
  principalId: string;
  itemId: string;
  itemName: string;
  before: string | null;
  after: string | null;
};

export type MemberPlan = {
  groupId: string;
  groupName: string;
  changes: MemberPlanChange[];
};

const ROLES = new Set(["viewer", "commenter", "responder", "editor", "owner"]);

function roleWord(value: string | null): string {
  if (!value) return "no role";
  return ROLES.has(value) ? value : "another role";
}

/** A sentence for a group-member preview. Ids and file bodies are left out. Nothing is changed. */
export function memberPlanText(plan: MemberPlan, personName: string, adding: boolean): string {
  const name = personName.trim() || "That person";
  const group = plan.groupName.trim() || "this group";
  const verb = adding ? "Adding" : "Removing";
  const prep = adding ? "to" : "from";
  if (!plan.changes.length) {
    return `${verb} ${name} ${prep} ${group} would not change access. Nothing is changed.`;
  }
  const changes = plan.changes
    .map((change) => {
      const item = change.itemName.trim() || "a file";
      const before = roleWord(change.before);
      const after = roleWord(change.after);
      return `${item} from ${before} to ${after}`;
    })
    .join("; ");
  return `${verb} ${name} ${prep} ${group} would change ${changes}. Nothing is changed.`;
}

/** Apply one reviewed membership plan. The response body is discarded. */
export async function commitMember(
  groupId: string,
  memberId: string,
  adding: boolean,
  changes: MemberPlanChange[],
): Promise<void> {
  await api(`/api/admin/groups/${encodeURIComponent(groupId)}/member-commit`, {
    method: "POST",
    ...json({ memberId, adding, changes }),
  });
}

/** Shows a preview sentence. Apply uses the plan the caller just reviewed. */
export function MemberPlanPreview({
  disabled,
  onPreview,
  onApply,
}: {
  disabled: boolean;
  onPreview: () => Promise<string>;
  onApply?: () => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [failed, setFailed] = useState("");
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setFailed("");
          void onPreview()
            .then((next) => {
              setNote(next);
            })
            .catch((error: unknown) => {
              setNote("");
              setFailed(error instanceof Error ? error.message : "The preview could not be read.");
            });
        }}
      >
        Preview
      </button>
      {note ? <p role="status">{note}</p> : null}
      {onApply && note ? (
        <button
          type="button"
          onClick={() => {
            setFailed("");
            void onApply()
              .then(() => {
                setNote("The reviewed plan was applied.");
              })
              .catch((error: unknown) => {
                const message = error instanceof Error ? error.message : "";
                setFailed(
                  message === "The access plan changed. Review it again."
                    ? message
                    : "The reviewed plan was not applied.",
                );
              });
          }}
        >
          Apply reviewed plan
        </button>
      ) : null}
      {failed ? <p role="alert">{failed}</p> : null}
    </>
  );
}
