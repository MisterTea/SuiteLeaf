/**
 * Structural spreadsheet capacity. The numbers are cell counts, not a measured
 * latency or memory budget on any computer.
 */

/** A workbook at or under this count stays in the interactive tier. */
export const INTERACTIVE_CELL_LIMIT = 50_000;

/** A workbook at or under this count is large. Past it, heavy work does not start. */
export const LARGE_CELL_LIMIT = 200_000;

const HEAVY = ["recalculate", "render", "refresh"] as const;

export type CapacityTier = "interactive" | "large" | "beyond" | "unusable";

export type CapacityDecision = {
  tier: CapacityTier;
  allowed: boolean;
  notice: string;
};

const NOT_MEASURED = "This count is not a measured latency or memory budget.";

function usableCount(cells: number): boolean {
  return Number.isInteger(cells) && cells >= 0;
}

/** Classify a cell count. A count that is not a whole number is unusable and is not repeated. */
export function capacityDecision(cells: number): CapacityDecision {
  if (!usableCount(cells)) {
    return {
      tier: "unusable",
      allowed: false,
      notice: "That cell count cannot be used. Recalculation, painting, and refresh do not start.",
    };
  }
  if (cells <= INTERACTIVE_CELL_LIMIT) {
    return {
      tier: "interactive",
      allowed: true,
      notice: `Interactive spreadsheet. ${NOT_MEASURED}`,
    };
  }
  if (cells <= LARGE_CELL_LIMIT) {
    return {
      tier: "large",
      allowed: true,
      notice: `This workbook is in the large tier. A query is the route when it no longer fits interactive editing. ${NOT_MEASURED}`,
    };
  }
  return {
    tier: "beyond",
    allowed: false,
    notice: `This workbook is past the spreadsheet limit. Recalculation, painting, and refresh do not start. Move the data to a query. ${NOT_MEASURED}`,
  };
}

/** Phases that must not start. An allowed workbook blocks none of them. */
export function phasesBlockedByCapacity(cells: number): readonly string[] {
  return capacityDecision(cells).allowed ? [] : [...HEAVY];
}

/**
 * Run heavy workbook work only when the count is allowed.
 * A refused count does not call `run`, so its return value is not kept.
 */
export function startWorkbookWork<T>(
  cells: number,
  run: () => T,
): { started: boolean; notice: string; value?: T } {
  const decision = capacityDecision(cells);
  if (!decision.allowed) return { started: false, notice: decision.notice };
  return { started: true, notice: decision.notice, value: run() };
}

/** How many stored cells the sheets have. Cell values are not copied. */
export function countStoredCells(
  sheets: readonly { cellData?: Record<string, Record<string, unknown> | undefined> }[],
): number {
  let cells = 0;
  for (const sheet of sheets) {
    for (const row of Object.values(sheet.cellData ?? {})) {
      if (!row) continue;
      cells += Object.keys(row).length;
    }
  }
  return cells;
}
