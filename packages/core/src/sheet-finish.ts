/** AND, OR, and a direct cell copy after the other formulas have been written. */

export function applyPairs(input: {
  boths: string[];
  targets: string[];
  formula: (address: string) => string;
  value: (address: string) => unknown;
  write: (address: string, next: unknown) => boolean;
  pair: (formula: string) => { op: "and" | "or"; left: string; right: string } | null;
  ref: (formula: string) => string | null;
  numberOf: (value: unknown) => number | null;
}): { calculated: string[]; left: string[] } {
  const calculated: string[] = [];
  const left: string[] = [];
  const waiting = new Set(input.boths);
  for (let pass = 0; pass < input.boths.length && waiting.size > 0; pass += 1) {
    let wrote = false;
    for (const address of [...waiting]) {
      const pair = input.pair(input.formula(address));
      if (!pair) continue;
      if ([pair.left, pair.right].some((part) => part !== address && waiting.has(part))) continue;
      const leftNumber = input.numberOf(input.value(pair.left));
      const rightNumber = input.numberOf(input.value(pair.right));
      if (leftNumber === null || rightNumber === null) continue;
      const truth = pair.op === "or" ? leftNumber !== 0 || rightNumber !== 0 : leftNumber !== 0 && rightNumber !== 0;
      const changed = input.write(address, truth ? 1 : 0);
      waiting.delete(address);
      calculated.push(address);
      if (changed) wrote = true;
    }
    if (!wrote) break;
  }
  left.push(...waiting);
  for (let pass = 0; pass < input.targets.length; pass += 1) {
    let wrote = false;
    for (const address of input.targets) {
      const ref = input.ref(input.formula(address));
      if (!ref) continue;
      const changed = input.write(address, input.value(ref));
      if (changed) wrote = true;
    }
    if (!wrote) break;
  }
  calculated.push(...input.targets);
  return { calculated, left };
}
