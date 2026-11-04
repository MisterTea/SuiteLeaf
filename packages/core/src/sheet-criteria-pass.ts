/**
 * Same-sheet COUNTIFS, AVERAGEIF, SUMIFS, and AVERAGEIFS.
 * A range on another sheet is left for the cross-sheet pass.
 */

import {
  averageMatching,
  averageMatchingMany,
  countMatchingRows,
  criterionCells,
  parseAverageIf,
  parseAverageIfs,
  parseCountIf,
  parseCountIfs,
  parseSumIf,
  parseSumIfs,
  sumMatching,
} from "./sheet-countifs";

type Step = {
  addresses: string[];
  /** Null while a dependency is still waiting. True when the stored value changed. */
  ready: (address: string, waiting: Set<string>) => boolean | null;
};

function settle(step: Step, calculated: string[], left: string[]): void {
  const waiting = new Set(step.addresses);
  for (let pass = 0; pass < step.addresses.length && waiting.size > 0; pass += 1) {
    let wrote = false;
    for (const address of [...waiting]) {
      const changed = step.ready(address, waiting);
      if (changed === null) continue;
      calculated.push(address);
      waiting.delete(address);
      if (changed) wrote = true;
    }
    if (!wrote) break;
  }
  left.push(...waiting);
}

/** Writes the criteria formulas that stay on this sheet. */
export function applySameSheetCriteria(input: {
  countIfsMany: string[];
  averageIfs: string[];
  sumIfsMany: string[];
  averageIfsMany: string[];
  formula: (address: string) => string;
  value: (address: string) => unknown;
  write: (address: string, next: unknown) => boolean;
  same: (left: unknown, right: unknown) => boolean;
  numberOf: (value: unknown) => number | null;
  isError: (value: unknown) => boolean;
}): { calculated: string[]; left: string[] } {
  const calculated: string[] = [];
  const left: string[] = [];
  const numberOf = (value: unknown) =>
    value === undefined || value === null || value === "" ? null : input.numberOf(value);
  settle(
    {
      addresses: input.countIfsMany,
      ready: (address, waiting) => {
        const parsed = parseCountIfs(input.formula(address)) ?? parseCountIf(input.formula(address));
        if (!parsed || parsed.sheet) return null;
        const watched = parsed.pairs.flatMap((pair) => [...criterionCells(pair.criteria), ...pair.cells]);
        if (watched.some((part) => part !== address && waiting.has(part))) return null;
        const next = countMatchingRows(parsed.pairs, input.value, input.same);
        return input.write(address, next);
      },
    },
    calculated,
    left,
  );
  settle(
    {
      addresses: input.averageIfs,
      ready: (address, waiting) => {
        const parsed = parseAverageIf(input.formula(address));
        if (!parsed || parsed.sheet) return null;
        const watched = [...criterionCells(parsed.criteria), ...parsed.criteriaCells, ...parsed.sumCells];
        if (watched.some((part) => part !== address && waiting.has(part))) return null;
        const next = averageMatching(parsed, input.value, input.same, numberOf, input.isError);
        return input.write(address, next);
      },
    },
    calculated,
    left,
  );
  settle(
    {
      addresses: input.sumIfsMany,
      ready: (address, waiting) => {
        const parsed = parseSumIfs(input.formula(address)) ?? parseSumIf(input.formula(address));
        if (!parsed || parsed.sheet) return null;
        const watched = [...parsed.sumCells, ...parsed.pairs.flatMap((pair) => [...criterionCells(pair.criteria), ...pair.cells])];
        if (watched.some((part) => part !== address && waiting.has(part))) return null;
        const next = sumMatching(parsed, input.value, input.same, numberOf, input.isError);
        return input.write(address, next);
      },
    },
    calculated,
    left,
  );
  settle(
    {
      addresses: input.averageIfsMany,
      ready: (address, waiting) => {
        const parsed = parseAverageIfs(input.formula(address));
        if (!parsed || parsed.sheet) return null;
        const watched = [...parsed.sumCells, ...parsed.pairs.flatMap((pair) => [...criterionCells(pair.criteria), ...pair.cells])];
        if (watched.some((part) => part !== address && waiting.has(part))) return null;
        const next = averageMatchingMany(parsed, input.value, input.same, numberOf, input.isError);
        return input.write(address, next);
      },
    },
    calculated,
    left,
  );
  return { calculated, left };
}
