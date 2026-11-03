import { useState } from "react";
import {
  COST_CATEGORIES,
  SOFTWARE_EDITION,
  applyExpansion,
  expansionWarning,
  featuresOn,
  storageBudgetNotice,
  type UsageChoice,
} from "@suiteleaf/core";

/** The packaging matrix for the web app. It does not invent a price. */
export function FeatureMatrix() {
  const features = featuresOn("web");
  return (
    <section className="settings-card" aria-labelledby="packaging-title">
      <h2 id="packaging-title">What SuiteLeaf includes</h2>
      <p>
        {SOFTWARE_EDITION.note} The software license has no charge. Other costs are not published
        here.
      </p>
      <ul>
        {COST_CATEGORIES.map((item) => (
          <li key={item.id}>{item.summary}</li>
        ))}
      </ul>
      <ul>
        {features.map((feature) => (
          <li key={feature.id}>
            {feature.name}. {feature.requiresAccount ? "Requires an account." : "No account."}{" "}
            {feature.requiresAssistant
              ? "Requires the assistant."
              : "Does not require the assistant."}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The warning before an optional expansion. Declining and acknowledging add no price. */
export function ExpansionNotice() {
  const [choice, setChoice] = useState<UsageChoice>("hosted-storage");
  const [notice, setNotice] = useState(expansionWarning("hosted-storage"));
  const [used, setUsed] = useState("");
  const [budget, setBudget] = useState("");
  const checkBudget = () => {
    const next = storageBudgetNotice(Number(used.trim()), Number(budget.trim()));
    setNotice(next.notice);
  };
  return (
    <section className="settings-card" aria-label="Optional expansion">
      <h2>Optional expansion</h2>
      <label>
        Choice
        <select
          aria-label="Expansion choice"
          value={choice}
          onChange={(event) => {
            const next = event.target.value === "ai" ? "ai" : "hosted-storage";
            setChoice(next);
            setNotice(expansionWarning(next));
          }}
        >
          <option value="hosted-storage">Hosted storage</option>
          <option value="ai">Assistant</option>
        </select>
      </label>
      {choice === "hosted-storage" ? (
        <>
          <label>
            Used bytes
            <input aria-label="Used bytes" value={used} onChange={(event) => setUsed(event.target.value)} />
          </label>
          <label>
            Budget bytes
            <input aria-label="Budget bytes" value={budget} onChange={(event) => setBudget(event.target.value)} />
          </label>
          <button type="button" onClick={checkBudget}>
            Check storage budget
          </button>
        </>
      ) : null}
      <p role="status">{notice}</p>
      <button type="button" onClick={() => setNotice(applyExpansion({ choice, acknowledged: false }).notice)}>
        Decline
      </button>
      <button type="button" onClick={() => setNotice(applyExpansion({ choice, acknowledged: true }).notice)}>
        Acknowledge
      </button>
    </section>
  );
}
