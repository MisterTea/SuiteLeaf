/**
 * A waterfall from a list of changes.
 * The numbers passed in are not modified. This is not an Excel waterfall chart.
 */

export type WaterfallStep = {
  label: string;
  change: number;
  start: number;
  end: number;
  kind: "rise" | "fall" | "total";
};

export type WaterfallResult = {
  steps: WaterfallStep[];
  total: number;
  mismatch: string | null;
};

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** Keep numeric changes. Text is counted as skipped and is not copied. */
export function waterfallRows(
  rows: readonly { label: string; change: unknown }[],
): { rows: { label: string; change: number }[]; skipped: number } {
  const kept: { label: string; change: number }[] = [];
  let skipped = 0;
  for (const row of rows) {
    if (typeof row.change === "number" && Number.isFinite(row.change)) {
      kept.push({ label: row.label, change: row.change });
    } else if (row.change != null && String(row.change).trim() !== "") {
      skipped += 1;
    }
  }
  return { rows: kept, skipped };
}

/** A sentence for skipped changes. The cell text is not included. */
export function waterfallSkipText(skipped: number): string {
  if (!Number.isFinite(skipped) || skipped <= 0) return "";
  const count = Math.floor(skipped);
  return count === 1 ? "1 change was not a number." : `${count} changes were not a number.`;
}

/** Running rises and falls, then a total bar. A stated Total that disagrees is named. */
export function waterfallSteps(
  rows: readonly { label: string; change: number }[],
): WaterfallResult {
  const stated = rows.find((row) => row.label.trim().toLowerCase() === "total");
  const changes = rows.filter((row) => row.label.trim().toLowerCase() !== "total");
  let running = 0;
  const steps: WaterfallStep[] = changes.map((row) => {
    const change = finite(row.change);
    const start = running;
    running += change;
    return {
      label: row.label,
      change,
      start,
      end: running,
      kind: change < 0 ? "fall" : "rise",
    };
  });
  const total = running;
  steps.push({
    label: "Total",
    change: total,
    start: Math.min(0, total),
    end: Math.max(0, total),
    kind: "total",
  });
  const statedChange = stated ? finite(stated.change) : null;
  return {
    steps,
    total,
    mismatch:
      statedChange !== null && statedChange !== total
        ? `The stated total is ${statedChange}. The changes add to ${total}.`
        : null,
  };
}

/** The number drawn on a bar. The category name is not included. */
export function waterfallBarLabel(step: Pick<WaterfallStep, "change">): string {
  return String(finite(step.change));
}

/** Excel export writes a waterfall, a histogram, or a stacked chart as a column chart. */
export function excelChartElement(
  type: "bar" | "line" | "pie" | "scatter" | "waterfall" | "histogram" | "area" | "stacked",
): string {
  return type === "waterfall" || type === "histogram" || type === "stacked"
    ? "barChart"
    : `${type}Chart`;
}
