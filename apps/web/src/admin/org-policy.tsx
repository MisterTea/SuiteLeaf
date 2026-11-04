import { useState } from "react";
import { policyImpact, type PolicyImpactChange } from "../policy-impact";

export interface OrgPolicyPlan {
  changes: PolicyImpactChange[];
  effects: PolicyImpactChange[];
  stamp: string;
  recovery: string;
}

/** Review an organization editor policy before it is written. */
export function OrgPolicyReview({
  onReview,
  onApply,
}: {
  onReview: () => Promise<OrgPolicyPlan>;
  onApply: (stamp: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [stamp, setStamp] = useState("");
  const [error, setError] = useState("");

  return (
    <section>
      <h2>Editor access</h2>
      <button
        type="button"
        onClick={() => {
          setError("");
          void onReview()
            .then((plan) => {
              setStamp(plan.stamp);
              setNote(policyImpact(plan));
            })
            .catch((reason: unknown) => {
              setStamp("");
              setNote("");
              const message = reason instanceof Error ? reason.message : "";
              setError(message === "The access plan changed. Review it again." ? message : "The access plan could not be read.");
            });
        }}
      >
        Review editor access
      </button>
      {note ? <p>{note}</p> : null}
      {error ? <p>{error}</p> : null}
      <button
        type="button"
        disabled={!stamp}
        onClick={() => {
          setError("");
          void onApply(stamp)
            .then(() => {
              setStamp("");
              setNote("Those editor grants are now viewer.");
            })
            .catch((reason: unknown) => {
              const message = reason instanceof Error ? reason.message : "";
              setError(
                message === "The access plan changed. Review it again."
                  ? message
                  : "The reviewed plan was not applied.",
              );
            });
        }}
      >
        Apply reviewed plan
      </button>
    </section>
  );
}
