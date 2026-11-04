/**
 * `=INT(A1)`, `=SQRT(A1)`, `=MOD(A1, B1)`, and `=POWER(A1, B1)`.
 * Text is left for the caller. A negative square root is `#NUM!`.
 * A divisor of 0 is `#DIV/0!`.
 */

export type MathOp = "int" | "sqrt" | "mod" | "power";
export type MathFormula = { op: MathOp; cells: string[]; sheet: string | null };

function namedSheet(token: string): { sheet: string; rest: string } | null {
  const match = /^(?:'((?:[^']|'')*)'|([A-Za-z_][A-Za-z0-9_-]*))!(.+)$/i.exec(token.trim());
  if (!match) return null;
  const sheet = (match[1] ?? match[2] ?? "").replaceAll("''", "'").trim();
  if (!sheet || /[\r\n]/.test(sheet)) return null;
  return { sheet, rest: match[3] };
}

function oneCell(token: string): { sheet: string | null; address: string } | null {
  const named = namedSheet(token);
  const match = /^\$?([A-Z]+)\$?(\d+)$/i.exec((named?.rest ?? token).trim());
  if (!match) return null;
  const row = Number(match[2]);
  if (!Number.isInteger(row) || row < 1) return null;
  return { sheet: named?.sheet ?? null, address: `${match[1].toUpperCase()}${row}` };
}

/** One cell, or two cells on the same sheet. */
export function parseMath(formula: string): MathFormula | null {
  const match = /^=\s*(INT|SQRT|MOD|POWER)\s*\((.+)\)\s*$/i.exec(formula.trim());
  if (!match) return null;
  const op = match[1].toLowerCase() as MathOp;
  const parts = match[2].split(",").map((item) => item.trim());
  const expected = op === "mod" || op === "power" ? 2 : 1;
  if (parts.length !== expected) return null;
  const cells = parts.map(oneCell);
  if (cells.some((cell) => !cell)) return null;
  const parsed = cells as { sheet: string | null; address: string }[];
  const sheet = parsed.find((cell) => cell.sheet)?.sheet ?? null;
  if (sheet && parsed.some((cell) => cell.sheet !== sheet)) return null;
  return { op, cells: parsed.map((cell) => cell.address), sheet };
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The middle number. An even count averages the two middle numbers. No number is `#NUM!`. */
export function medianOf(numbers: number[]): number | string {
  if (!numbers.length) return "#NUM!";
  const sorted = [...numbers].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** The number, an error string, or null when an input is not a number. */
export function mathValue(parsed: MathFormula, read: (address: string) => unknown): number | string | null {
  const numbers = parsed.cells.map((address) => finite(read(address)));
  if (numbers.some((number) => number === null)) return null;
  const [left, right] = numbers as number[];
  if (parsed.op === "int") return Math.floor(left);
  if (parsed.op === "sqrt") return left < 0 ? "#NUM!" : Math.sqrt(left);
  if (parsed.op === "mod") {
    if (right === 0) return "#DIV/0!";
    return left - right * Math.floor(left / right);
  }
  const powered = left ** right;
  return Number.isFinite(powered) ? powered : "#NUM!";
}

/** Writes same-sheet math formulas. A null result stays uncalculated. */
export function applyMath(input: {
  addresses: string[];
  formula: (address: string) => string;
  value: (address: string) => unknown;
  write: (address: string, next: unknown) => boolean;
}): { calculated: string[]; left: string[] } {
  const calculated: string[] = [];
  const left: string[] = [];
  const waiting = new Set(input.addresses);
  for (let pass = 0; pass < input.addresses.length && waiting.size > 0; pass += 1) {
    let wrote = false;
    for (const address of [...waiting]) {
      const parsed = parseMath(input.formula(address));
      if (!parsed || parsed.sheet) continue;
      if (parsed.cells.some((part) => part !== address && waiting.has(part))) continue;
      const next = mathValue(parsed, input.value);
      if (next === null) continue;
      const changed = input.write(address, next);
      calculated.push(address);
      waiting.delete(address);
      if (changed) wrote = true;
    }
    if (!wrote) break;
  }
  left.push(...waiting);
  return { calculated, left };
}
