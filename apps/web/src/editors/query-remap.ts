import { queryDocument, remapQuery, type QueryStep } from "@suiteleaf/core";

/**
 * Rename one column in a query step. The step passed in is not changed.
 * A name that cannot be stored returns a fixed sentence and no step.
 */
export function remapStepColumn(
  step: QueryStep,
  from: string,
  to: string,
): { step: QueryStep; note: string } | { note: string } {
  const before = JSON.stringify(step);
  try {
    const next = remapQuery(queryDocument([step]), { [from]: to });
    const mapped = next.steps[0];
    if (!mapped || JSON.stringify(mapped) === before) {
      return { note: "That name is not in this step." };
    }
    const used = to.trim();
    return { step: mapped, note: `The step now uses ${used}.` };
  } catch {
    return { note: "That column cannot be remapped." };
  }
}
