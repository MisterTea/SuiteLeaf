/**
 * Find several inputs that make a formula reach a target.
 * Each input stays inside its low and high bounds. The caller's variables
 * are not changed. This function does not write cells.
 */

import { goalSeek, goalSeekAsync } from "./goal-seek";
import type { SeekGrid, SeekWrite } from "./goal-seek";

export type SolverVariable = {
  start: number;
  low: number;
  high: number;
  /** When set, only a whole number inside the bounds is an answer. */
  integer?: boolean;
};

export type SolverResult = {
  ok: boolean;
  reason: "solved" | "infeasible" | "cancelled";
  values: number[];
  value: number | null;
  tried: number;
  /** Why the search stopped. The formula and cell text are not included. */
  notice: string;
};

const MAX_VARIABLES = 3;
/** Inclusive span. 0 through 999 is 1,000 guesses; 0 through 1,000 is not searched. */
const MAX_INTEGERS = 1000;

function pinValue(variable: SolverVariable, end: 0 | 1): number | null {
  if (!variable.integer) return end === 0 ? variable.low : variable.high;
  const value = end === 0 ? Math.ceil(variable.low) : Math.floor(variable.high);
  if (!Number.isFinite(value) || value < variable.low || value > variable.high) return null;
  return value;
}

function starts(variables: SolverVariable[]): number[] {
  return variables.map((variable) => variable.start);
}

function allowed(holds: ((values: number[]) => boolean) | undefined, values: number[]): boolean {
  if (!holds) return true;
  try {
    return holds(values) === true;
  } catch {
    return false;
  }
}

function finish(
  reason: SolverResult["reason"],
  values: number[],
  value: number | null,
  tried: number,
  notice: string,
): SolverResult {
  return { ok: reason === "solved", reason, values, value, tried, notice };
}

/**
 * Pin every variable but one at a bound, then bisect the free variable.
 * A target no combination can reach is infeasible, and the result values
 * stay the original starts.
 */
export function solve(input: {
  evaluate: (values: number[]) => number;
  target: number;
  variables: SolverVariable[];
  /** When this returns false, that guess is not an answer. A throw is not an answer. */
  holds?: (values: number[]) => boolean;
  tolerance?: number;
  shouldStop?: () => boolean;
  /** Called once per try. The formula and cell text are not included. */
  onProgress?: (progress: { tried: number }) => void;
}): SolverResult {
  const original = starts(input.variables);
  let tried = 0;
  let wide = false;
  const report = () => input.onProgress?.({ tried });
  if (input.shouldStop?.()) {
    return finish(
      "cancelled",
      original,
      null,
      0,
      "The search stopped before the first try. The inputs were not changed.",
    );
  }
  if (input.variables.length < 1 || input.variables.length > MAX_VARIABLES) {
    return finish("infeasible", original, null, 0, "Use one, two, or three inputs.");
  }
  const tolerance = input.tolerance ?? 1e-6;
  if (original.every((value) => Number.isFinite(value))) {
    const current = input.evaluate(original);
    if (
      Number.isFinite(current) &&
      Math.abs(current - input.target) <= tolerance &&
      allowed(input.holds, original)
    ) {
      tried = 1;
      report();
      return finish("solved", original, current, tried, "The search reached the target.");
    }
  }
  const pinsFor = (count: number): number[][] => {
    const pins: number[][] = [[]];
    for (let index = 0; index < count; index += 1) {
      const next: number[][] = [];
      for (const pin of pins) {
        next.push([...pin, 0], [...pin, 1]);
      }
      pins.splice(0, pins.length, ...next);
    }
    return pins;
  };
  for (let free = 0; free < input.variables.length; free += 1) {
    const others = input.variables.filter((_, index) => index !== free);
    for (const pin of pinsFor(others.length)) {
      if (input.shouldStop?.()) {
        return finish(
          "cancelled",
          starts(input.variables),
          null,
          tried,
          `The search stopped after ${tried} tries. The inputs were not changed.`,
        );
      }
      const pinned = input.variables.map((variable, index) => {
        if (index === free) return variable.start;
        const otherIndex = index < free ? index : index - 1;
        return pinValue(variable, pin[otherIndex] === 0 ? 0 : 1);
      });
      if (pinned.some((value) => value == null)) continue;
      const placed = pinned as number[];
      const variable = input.variables[free];
      if (variable.integer) {
        const first = Math.ceil(variable.low);
        const last = Math.floor(variable.high);
        if (!Number.isFinite(first) || !Number.isFinite(last) || last - first > MAX_INTEGERS - 1) {
          wide = true;
          continue;
        }
        const tolerance = input.tolerance ?? 1e-6;
        for (let guess = first; guess <= last; guess += 1) {
          if (input.shouldStop?.()) {
            return finish(
              "cancelled",
              starts(input.variables),
              null,
              tried,
              `The search stopped after ${tried} tries. The inputs were not changed.`,
            );
          }
          tried += 1;
          report();
          const values = [...placed];
          values[free] = guess;
          const value = input.evaluate(values);
          if (
            Number.isFinite(value) &&
            Math.abs(value - input.target) <= tolerance &&
            allowed(input.holds, values)
          ) {
            return finish("solved", values, value, tried, "The search reached the target.");
          }
        }
        continue;
      }
      const result = goalSeek({
        target: input.target,
        start: variable.start,
        low: variable.low,
        high: variable.high,
        tolerance: input.tolerance,
        shouldStop: input.shouldStop,
        onProgress: () => {
          tried += 1;
          report();
        },
        evaluate: (guess) => {
          const values = [...placed];
          values[free] = guess;
          return input.evaluate(values);
        },
      });
      if (result.reason === "cancelled") {
        return finish(
          "cancelled",
          starts(input.variables),
          null,
          tried,
          `The search stopped after ${tried} tries. The inputs were not changed.`,
        );
      }
      if (result.ok) {
        const values = [...placed];
        values[free] = result.guess;
        if (allowed(input.holds, values)) {
          return finish("solved", values, result.value, tried, "The search reached the target.");
        }
      }
    }
  }
  if (wide && tried === 0) {
    return finish(
      "infeasible",
      starts(input.variables),
      null,
      0,
      "That whole-number span is too wide to search. The start was left as it was.",
    );
  }
  const notice = input.holds
    ? `No inputs inside the bounds meet the constraint and the target. The search tried ${tried} times.`
    : `No inputs inside the bounds reach the target. The search tried ${tried} times.`;
  return finish("infeasible", starts(input.variables), null, tried, notice);
}

/**
 * The same search as `solve`, waiting for each formula result.
 * The caller's variables are not changed.
 */
export async function solveAsync(input: {
  evaluate: (values: number[]) => Promise<number>;
  target: number;
  variables: SolverVariable[];
  /** When this returns false, that guess is not an answer. A throw is not an answer. */
  holds?: (values: number[]) => boolean;
  tolerance?: number;
  shouldStop?: () => boolean;
  onProgress?: (progress: { tried: number }) => void;
}): Promise<SolverResult> {
  const original = starts(input.variables);
  let tried = 0;
  let wide = false;
  const report = () => input.onProgress?.({ tried });
  if (input.shouldStop?.()) {
    return finish(
      "cancelled",
      original,
      null,
      0,
      "The search stopped before the first try. The inputs were not changed.",
    );
  }
  if (input.variables.length < 1 || input.variables.length > MAX_VARIABLES) {
    return finish("infeasible", original, null, 0, "Use one, two, or three inputs.");
  }
  const tolerance = input.tolerance ?? 1e-6;
  if (original.every((value) => Number.isFinite(value))) {
    const current = await input.evaluate(original);
    if (
      Number.isFinite(current) &&
      Math.abs(current - input.target) <= tolerance &&
      allowed(input.holds, original)
    ) {
      tried = 1;
      report();
      return finish("solved", original, current, tried, "The search reached the target.");
    }
  }
  const pinsFor = (count: number): number[][] => {
    const pins: number[][] = [[]];
    for (let index = 0; index < count; index += 1) {
      const next: number[][] = [];
      for (const pin of pins) next.push([...pin, 0], [...pin, 1]);
      pins.splice(0, pins.length, ...next);
    }
    return pins;
  };
  for (let free = 0; free < input.variables.length; free += 1) {
    const others = input.variables.filter((_, index) => index !== free);
    for (const pin of pinsFor(others.length)) {
      if (input.shouldStop?.()) {
        return finish(
          "cancelled",
          starts(input.variables),
          null,
          tried,
          `The search stopped after ${tried} tries. The inputs were not changed.`,
        );
      }
      const pinned = input.variables.map((variable, index) => {
        if (index === free) return variable.start;
        const otherIndex = index < free ? index : index - 1;
        return pinValue(variable, pin[otherIndex] === 0 ? 0 : 1);
      });
      if (pinned.some((value) => value == null)) continue;
      const placed = pinned as number[];
      const variable = input.variables[free];
      if (variable.integer) {
        const first = Math.ceil(variable.low);
        const last = Math.floor(variable.high);
        if (!Number.isFinite(first) || !Number.isFinite(last) || last - first > MAX_INTEGERS - 1) {
          wide = true;
          continue;
        }
        const tolerance = input.tolerance ?? 1e-6;
        for (let guess = first; guess <= last; guess += 1) {
          if (input.shouldStop?.()) {
            return finish(
              "cancelled",
              starts(input.variables),
              null,
              tried,
              `The search stopped after ${tried} tries. The inputs were not changed.`,
            );
          }
          tried += 1;
          report();
          const values = [...placed];
          values[free] = guess;
          const value = await input.evaluate(values);
          if (
            Number.isFinite(value) &&
            Math.abs(value - input.target) <= tolerance &&
            allowed(input.holds, values)
          ) {
            return finish("solved", values, value, tried, "The search reached the target.");
          }
        }
        continue;
      }
      const result = await goalSeekAsync({
        target: input.target,
        start: variable.start,
        low: variable.low,
        high: variable.high,
        tolerance: input.tolerance,
        shouldStop: input.shouldStop,
        onProgress: () => {
          tried += 1;
          report();
        },
        evaluate: async (guess) => {
          const values = [...placed];
          values[free] = guess;
          return input.evaluate(values);
        },
      });
      if (result.reason === "cancelled") {
        return finish(
          "cancelled",
          starts(input.variables),
          null,
          tried,
          `The search stopped after ${tried} tries. The inputs were not changed.`,
        );
      }
      if (result.ok) {
        const values = [...placed];
        values[free] = result.guess;
        if (allowed(input.holds, values)) {
          return finish("solved", values, result.value, tried, "The search reached the target.");
        }
      }
    }
  }
  if (wide && tried === 0) {
    return finish(
      "infeasible",
      starts(input.variables),
      null,
      0,
      "That whole-number span is too wide to search. The start was left as it was.",
    );
  }
  const notice = input.holds
    ? `No inputs inside the bounds meet the constraint and the target. The search tried ${tried} times.`
    : `No inputs inside the bounds reach the target. The search tried ${tried} times.`;
  return finish("infeasible", starts(input.variables), null, tried, notice);
}

/**
 * Write a solved set of guesses. A formula in any of those cells writes nothing.
 * A search that did not succeed writes nothing. The input grid is not changed.
 */
export function writeSolver(
  grid: SeekGrid,
  cells: { row: number; column: number }[],
  result: SolverResult,
): SeekWrite {
  if (!result.ok) {
    return {
      grid,
      wrote: false,
      error: result.notice,
    };
  }
  if (cells.length !== result.values.length) {
    return { grid, wrote: false, error: "The cells do not match the inputs." };
  }
  for (const cell of cells) {
    if (cell.row < 0 || cell.column < 0) return { grid, wrote: false, error: "That cell is not on the sheet." };
    const current = grid[String(cell.row)]?.[String(cell.column)];
    if (typeof current?.f === "string" && current.f !== "") {
      return { grid, wrote: false, error: "That cell has a formula." };
    }
  }
  const written: SeekGrid = {};
  for (const [row, columns] of Object.entries(grid)) {
    written[row] = {};
    for (const [column, cell] of Object.entries(columns)) {
      written[row][column] = cell ? { ...cell } : cell;
    }
  }
  cells.forEach((cell, index) => {
    const rowKey = String(cell.row);
    const columnKey = String(cell.column);
    written[rowKey] = written[rowKey] ?? {};
    const current = written[rowKey][columnKey];
    written[rowKey][columnKey] = { ...(current ?? {}), v: result.values[index] };
  });
  return { grid: written, wrote: true };
}
