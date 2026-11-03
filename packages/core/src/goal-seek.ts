/**
 * Find an input that makes a formula reach a target.
 * The caller decides whether to write the guess. This function does not.
 */

export type GoalSeekInput = {
  evaluate: (guess: number) => number;
  target: number;
  /** Reported if the search stops before a guess is tried. Not written anywhere. */
  start: number;
  low: number;
  high: number;
  /** Absolute gap that counts as reaching the target. Default is 0.000001. */
  tolerance?: number;
  maxSteps?: number;
  shouldStop?: () => boolean;
  /** Called once per midpoint. The formula and cell text are not included. */
  onProgress?: (progress: { step: number; maxSteps: number }) => void;
};

export type GoalSeekResult = {
  ok: boolean;
  reason: "solved" | "infeasible" | "cancelled";
  guess: number;
  value: number | null;
  steps: number;
};

const DEFAULT_TOLERANCE = 1e-6;

/** What the search did, without the formula or a cell value. */
export function seekProgressText(result: GoalSeekResult, tolerance = DEFAULT_TOLERANCE): string {
  if (result.reason === "cancelled") {
    return `The search stopped after ${result.steps} steps. The input was not changed.`;
  }
  if (!result.ok) {
    return `No input reaches that target within ${tolerance}. The search tried ${result.steps} steps.`;
  }
  return `The search reached the target in ${result.steps} steps.`;
}
const DEFAULT_STEPS = 60;

/** Bisect between `low` and `high`. A target outside that range is infeasible. */
export function goalSeek(input: GoalSeekInput): GoalSeekResult {
  const tolerance = input.tolerance ?? DEFAULT_TOLERANCE;
  const maxSteps = input.maxSteps ?? DEFAULT_STEPS;
  if (input.shouldStop?.()) {
    return {
      ok: false,
      reason: "cancelled",
      guess: input.start,
      value: null,
      steps: 0,
    };
  }
  if (Number.isFinite(input.start)) {
    const startGap = input.evaluate(input.start) - input.target;
    if (Number.isFinite(startGap) && Math.abs(startGap) <= tolerance) {
      return { ok: true, reason: "solved", guess: input.start, value: input.target, steps: 1 };
    }
  }
  if (!(input.low < input.high) || !Number.isFinite(input.target)) {
    return {
      ok: false,
      reason: "infeasible",
      guess: input.start,
      value: null,
      steps: 0,
    };
  }
  const at = (guess: number) => input.evaluate(guess) - input.target;
  const lowValue = at(input.low);
  const highValue = at(input.high);
  if (lowValue === 0) {
    return {
      ok: true,
      reason: "solved",
      guess: input.low,
      value: input.target,
      steps: 1,
    };
  }
  if (highValue === 0) {
    return {
      ok: true,
      reason: "solved",
      guess: input.high,
      value: input.target,
      steps: 1,
    };
  }
  if (
    !Number.isFinite(lowValue) ||
    !Number.isFinite(highValue) ||
    Math.sign(lowValue) === Math.sign(highValue)
  ) {
    return {
      ok: false,
      reason: "infeasible",
      guess: input.start,
      value: null,
      steps: 1,
    };
  }
  let low = input.low;
  let high = input.high;
  let lowGap = lowValue;
  let guess = input.start;
  let value: number | null = null;
  for (let step = 1; step <= maxSteps; step += 1) {
    if (input.shouldStop?.()) {
      return { ok: false, reason: "cancelled", guess, value, steps: step };
    }
    input.onProgress?.({ step, maxSteps });
    guess = (low + high) / 2;
    const gap = at(guess);
    value = gap + input.target;
    if (!Number.isFinite(gap)) {
      return {
        ok: false,
        reason: "infeasible",
        guess: input.start,
        value: null,
        steps: step,
      };
    }
    if (Math.abs(gap) <= tolerance) {
      return { ok: true, reason: "solved", guess, value, steps: step };
    }
    if (Math.sign(gap) === Math.sign(lowGap)) {
      low = guess;
      lowGap = gap;
    } else {
      high = guess;
    }
  }
  return {
    ok: false,
    reason: "infeasible",
    guess: input.start,
    value: null,
    steps: maxSteps,
  };
}

/** The same search when each guess has to wait for the sheet to recalculate. */
export async function goalSeekAsync(
  input: Omit<GoalSeekInput, "evaluate"> & {
    evaluate: (guess: number) => Promise<number>;
  },
): Promise<GoalSeekResult> {
  const tolerance = input.tolerance ?? DEFAULT_TOLERANCE;
  const maxSteps = input.maxSteps ?? DEFAULT_STEPS;
  if (input.shouldStop?.()) {
    return { ok: false, reason: "cancelled", guess: input.start, value: null, steps: 0 };
  }
  if (Number.isFinite(input.start)) {
    const startGap = (await input.evaluate(input.start)) - input.target;
    if (Number.isFinite(startGap) && Math.abs(startGap) <= tolerance) {
      return { ok: true, reason: "solved", guess: input.start, value: input.target, steps: 1 };
    }
  }
  if (!(input.low < input.high) || !Number.isFinite(input.target)) {
    return { ok: false, reason: "infeasible", guess: input.start, value: null, steps: 0 };
  }
  const at = async (guess: number) => (await input.evaluate(guess)) - input.target;
  const lowValue = await at(input.low);
  const highValue = await at(input.high);
  if (lowValue === 0) {
    return { ok: true, reason: "solved", guess: input.low, value: input.target, steps: 1 };
  }
  if (highValue === 0) {
    return { ok: true, reason: "solved", guess: input.high, value: input.target, steps: 1 };
  }
  if (
    !Number.isFinite(lowValue) ||
    !Number.isFinite(highValue) ||
    Math.sign(lowValue) === Math.sign(highValue)
  ) {
    return { ok: false, reason: "infeasible", guess: input.start, value: null, steps: 1 };
  }
  let low = input.low;
  let high = input.high;
  let lowGap = lowValue;
  let guess = input.start;
  let value: number | null = null;
  for (let step = 1; step <= maxSteps; step += 1) {
    if (input.shouldStop?.()) {
      return { ok: false, reason: "cancelled", guess, value, steps: step };
    }
    input.onProgress?.({ step, maxSteps });
    guess = (low + high) / 2;
    const gap = await at(guess);
    value = gap + input.target;
    if (!Number.isFinite(gap)) {
      return { ok: false, reason: "infeasible", guess: input.start, value: null, steps: step };
    }
    if (Math.abs(gap) <= tolerance) {
      return { ok: true, reason: "solved", guess, value, steps: step };
    }
    if (Math.sign(gap) === Math.sign(lowGap)) {
      low = guess;
      lowGap = gap;
    } else {
      high = guess;
    }
  }
  return { ok: false, reason: "infeasible", guess: input.start, value: null, steps: maxSteps };
}

export type SeekCell = {
  v?: string | number | boolean | null;
  f?: string | null;
} | null;

export type SeekGrid = Record<string, Record<string, SeekCell>>;

export type SeekWrite = {
  grid: SeekGrid;
  wrote: boolean;
  error?: string;
};

function cloneGrid(grid: SeekGrid): SeekGrid {
  const next: SeekGrid = {};
  for (const [row, columns] of Object.entries(grid)) {
    next[row] = {};
    for (const [column, cell] of Object.entries(columns)) {
      next[row][column] = cell ? { ...cell } : cell;
    }
  }
  return next;
}

/**
 * Write a solved guess into one cell. A formula cell is left alone, and a
 * search that did not succeed does not write. The input grid is not changed.
 */
export function writeGoalSeek(
  grid: SeekGrid,
  cell: { row: number; column: number },
  result: GoalSeekResult,
): SeekWrite {
  if (cell.row < 0 || cell.column < 0) {
    return { grid, wrote: false, error: "That cell is not on the sheet." };
  }
  const current = grid[String(cell.row)]?.[String(cell.column)];
  if (typeof current?.f === "string" && current.f !== "") {
    return { grid, wrote: false, error: "That cell has a formula." };
  }
  if (!result.ok) {
    return {
      grid,
      wrote: false,
      error: seekProgressText(result),
    };
  }
  const written = cloneGrid(grid);
  const rowKey = String(cell.row);
  const columnKey = String(cell.column);
  written[rowKey] = written[rowKey] ?? {};
  written[rowKey][columnKey] = { ...(current ?? {}), v: result.guess };
  return { grid: written, wrote: true };
}
