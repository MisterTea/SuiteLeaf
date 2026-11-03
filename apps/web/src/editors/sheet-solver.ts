import { solveAsync } from "@suiteleaf/core";
import type { SeekAddress, SeekRead } from "./sheet-goal-panel";

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sameCell(a: SeekAddress, b: SeekAddress): boolean {
  return a.row === b.row && a.column === b.column;
}

function writable(value: unknown): string | number | boolean | null {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : null;
}

/**
 * Search two or three input cells until the formula cell reaches the target.
 * A formula in an input cell is not overwritten. A search that does not
 * solve puts the input cells back. The notice does not include the formula.
 */
export async function solveOnSheet(input: {
  inputs: SeekAddress[];
  formula: SeekAddress;
  target: number;
  lows: number[];
  highs: number[];
  /** The first input must stay at or below this. A missing limit accepts any guess inside the bounds. */
  atMost?: number;
  read: (cell: SeekAddress) => SeekRead;
  write: (cell: SeekAddress, value: string | number | boolean | null) => void;
  calculate: () => Promise<void>;
  shouldStop?: () => boolean;
}): Promise<{ message: string; wrote: boolean }> {
  if (input.inputs.length < 2 || input.inputs.length > 3) {
    return { message: "Use one, two, or three inputs.", wrote: false };
  }
  if (input.inputs.some((cell) => sameCell(cell, input.formula))) {
    return { message: "The input cell and the formula cell are the same.", wrote: false };
  }
  if (input.inputs.some((cell) => input.read(cell).formula.trim())) {
    return { message: "That cell has a formula.", wrote: false };
  }
  if (!input.read(input.formula).formula.trim()) {
    return { message: "That cell has no formula.", wrote: false };
  }
  const originals = input.inputs.map((cell) => input.read(cell).value);
  const restore = () => {
    input.inputs.forEach((cell, index) => input.write(cell, writable(originals[index])));
  };
  try {
    const limit = input.atMost;
    const result = await solveAsync({
      target: input.target,
      shouldStop: input.shouldStop,
      holds:
        limit === undefined
          ? undefined
          : (values) => values[0] !== undefined && values[0] <= limit,
      variables: input.inputs.map((cell, index) => {
        const value = input.read(cell).value;
        return {
          start: finite(value) ? value : input.lows[index]!,
          low: input.lows[index]!,
          high: input.highs[index]!,
        };
      }),
      evaluate: async (values) => {
        values.forEach((guess, index) => input.write(input.inputs[index]!, guess));
        await input.calculate();
        const value = input.read(input.formula).value;
        if (!finite(value)) throw new Error("The formula did not return a number.");
        return value;
      },
    });
    if (!result.ok) {
      restore();
      return { message: `${result.notice} The inputs were put back.`, wrote: false };
    }
    result.values.forEach((guess, index) => input.write(input.inputs[index]!, guess));
    return { message: result.notice, wrote: true };
  } catch {
    restore();
    return { message: "The formula could not be calculated. The inputs were put back.", wrote: false };
  }
}
