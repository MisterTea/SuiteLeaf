/**
 * `=IFS(A1, B1, C1, D1)`.
 * A test of 0 is skipped. The first other number uses its value cell.
 * No true test is `#N/A`. Text and formula errors are left for the caller.
 */

const FORMULA_ERRORS = new Set(["#DIV/0!", "#REF!", "#VALUE!", "#NAME?", "#N/A", "#NUM!", "#NULL!"]);

export type IfsPair = {
  test: string;
  value: string;
  truth?: boolean;
  valueLiteral?: { kind: "number"; value: number } | { kind: "text"; value: string };
  compare?: { op: CompareOp; right: CompareSide };
};
export type Ifs = { pairs: IfsPair[]; sheet: string | null };

function cellToken(token: string): { sheet: string | null; address: string } | null {
  const qualified =
    /^(?:'((?:[^']|'')*)'|([A-Za-z_][A-Za-z0-9_-]*))!(\$?[A-Z]+)\$?(\d+)$/i.exec(token.trim());
  if (qualified) {
    const sheet = (qualified[1] ?? qualified[2] ?? "").replaceAll("''", "'").trim();
    const row = Number(qualified[4]);
    if (!sheet || /[\r\n]/.test(sheet) || !Number.isInteger(row) || row < 1) return null;
    return { sheet, address: `${qualified[3].toUpperCase()}${row}` };
  }
  const local = /^\$?([A-Z]+)\$?(\d+)$/i.exec(token.trim());
  if (!local) return null;
  const row = Number(local[2]);
  if (!Number.isInteger(row) || row < 1) return null;
  return { sheet: null, address: `${local[1].toUpperCase()}${row}` };
}

/** Two to four test and value pairs. Every cell names the same sheet, or none does. */
export function parseIfs(formula: string): Ifs | null {
  const match = /^=\s*IFS\s*\((.+)\)\s*$/i.exec(formula.trim());
  if (!match) return null;
  const parts = splitArgs(match[1]);
  if (!parts || parts.length < 4 || parts.length > 8 || parts.length % 2 !== 0) return null;
  const pairs: IfsPair[] = [];
  let sheet: string | null | undefined = undefined;
  for (let index = 0; index < parts.length; index += 2) {
    const built = ifsPair(parts[index] ?? "", parts[index + 1] ?? "", sheet);
    if (!built) return null;
    sheet = built.sheet;
    pairs.push(built.pair);
  }
  return { pairs, sheet: sheet ?? null };
}

function mergeSheet(
  current: string | null | undefined,
  ...incoming: (string | null | undefined)[]
): string | null | undefined | "mismatch" {
  let sheet = current;
  for (const item of incoming) {
    if (item === undefined) continue;
    if (sheet === undefined) sheet = item;
    else if (sheet !== item) return "mismatch";
  }
  return sheet;
}

function ifsPair(
  testToken: string,
  valueToken: string,
  sheet: string | null | undefined,
): { pair: IfsPair; sheet: string | null | undefined } | null {
  const valueSide = parseSide(valueToken);
  if (!valueSide) return null;
  const valueLiteral = valueSide.kind === "cell" ? undefined : valueSide;
  const valueAddress = valueSide.kind === "cell" ? valueSide.address : "";
  const valueSheet = valueSide.kind === "cell" ? valueSide.sheet : undefined;
  const flag = /^(true|false)$/i.exec(testToken.trim());
  if (flag) {
    const next = mergeSheet(sheet, valueSheet);
    if (next === "mismatch") return null;
    return { pair: { test: "", truth: flag[1].toLowerCase() === "true", value: valueAddress, valueLiteral }, sheet: next };
  }
  const cell = cellToken(testToken);
  if (cell) {
    const next = mergeSheet(sheet, cell.sheet, valueSheet);
    if (next === "mismatch") return null;
    return { pair: { test: cell.address, value: valueAddress, valueLiteral }, sheet: next };
  }
  const compared = splitCompare(testToken);
  if (!compared?.left || !compared.right) return null;
  const left = parseSide(compared.left);
  const right = parseSide(compared.right);
  if (!left || left.kind !== "cell" || !right) return null;
  const next = mergeSheet(sheet, left.sheet, right.kind === "cell" ? right.sheet : undefined, valueSheet);
  if (next === "mismatch") return null;
  return {
    pair: {
      test: left.address,
      value: valueAddress,
      valueLiteral,
      compare: { op: compared.op, right: storedSide(right) },
    },
    sheet: next,
  };
}

/** Cells a test reads, including the right side of a comparison. */
export function ifsWatch(parsed: Ifs): string[] {
  const cells: string[] = [];
  for (const pair of parsed.pairs) {
    if (pair.test) cells.push(pair.test);
    if (pair.value) cells.push(pair.value);
    if (pair.compare?.right.kind === "cell") cells.push(pair.compare.right.address);
  }
  return cells;
}

/** Zero, blank, and a numeric string are conditions. Text and errors are not. */
export function conditionOf(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && FORMULA_ERRORS.has(value)) return null;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export type CompareOp = ">" | "<" | ">=" | "<=" | "=" | "<>";
type CompareSide =
  | { kind: "cell"; address: string }
  | { kind: "number"; value: number }
  | { kind: "text"; value: string };
export type CompareIf = {
  left: string;
  op: CompareOp;
  right: CompareSide;
  yes: CompareSide;
  no: CompareSide;
  sheet: string | null;
};
export type CompareDecision = { decided: true; held: boolean; value: unknown } | { decided: false };

/** `=IF(A1, B1, C1)`. A comparison such as `A1>10` is a different formula. */
export function plainIf(formula: string): { test: string; yes: string; no: string } | null {
  const match = /^=IF\(\s*\$?([A-Z]+)\$?(\d+)\s*,\s*\$?([A-Z]+)\$?(\d+)\s*,\s*\$?([A-Z]+)\$?(\d+)\s*\)$/i.exec(
    formula.trim(),
  );
  if (!match) return null;
  return {
    test: `${match[1].toUpperCase()}${match[2]}`,
    yes: `${match[3].toUpperCase()}${match[4]}`,
    no: `${match[5].toUpperCase()}${match[6]}`,
  };
}

function splitArgs(body: string): string[] | null {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of body) {
    if (char === '"') {
      quoted = !quoted;
      current += char;
      continue;
    }
    if (char === "," && !quoted) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (quoted) return null;
  parts.push(current.trim());
  return parts;
}

function parseSide(token: string): (CompareSide & { sheet?: string | null }) | null {
  const quoted = /^"((?:[^"]|"")*)"$/.exec(token.trim());
  if (quoted) return { kind: "text", value: quoted[1].replaceAll('""', '"') };
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(token.trim())) {
    const value = Number(token);
    if (!Number.isFinite(value)) return null;
    return { kind: "number", value };
  }
  const cell = cellToken(token);
  if (!cell) return null;
  return { kind: "cell", address: cell.address, sheet: cell.sheet };
}

function splitCompare(test: string): { left: string; op: CompareOp; right: string } | null {
  let quoted = false;
  for (let index = 0; index < test.length; index += 1) {
    const char = test[index] ?? "";
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    const pair = test.slice(index, index + 2);
    if (pair === ">=" || pair === "<=" || pair === "<>") {
      return { left: test.slice(0, index).trim(), op: pair, right: test.slice(index + 2).trim() };
    }
    if (char === ">" || char === "<" || char === "=") {
      return { left: test.slice(0, index).trim(), op: char, right: test.slice(index + 1).trim() };
    }
  }
  return null;
}

function storedSide(side: CompareSide & { sheet?: string | null }): CompareSide {
  if (side.kind === "cell") return { kind: "cell", address: side.address };
  return side;
}

/** `=IF(A1>10, B1, C1)` or `=IF(A1="Beds", "Yes", "No")`. Every cell names one sheet. */
export function parseCompareIf(formula: string): CompareIf | null {
  const match = /^=\s*IF\s*\((.*)\)\s*$/i.exec(formula.trim());
  if (!match) return null;
  const parts = splitArgs(match[1]);
  if (!parts || parts.length !== 3) return null;
  const compared = splitCompare(parts[0] ?? "");
  if (!compared?.left || !compared.right) return null;
  const left = parseSide(compared.left);
  const right = parseSide(compared.right);
  const yes = parseSide(parts[1] ?? "");
  const no = parseSide(parts[2] ?? "");
  if (!left || left.kind !== "cell" || !right || !yes || !no) return null;
  const sheets = [left.sheet, right.kind === "cell" ? right.sheet : undefined, yes.kind === "cell" ? yes.sheet : undefined, no.kind === "cell" ? no.sheet : undefined];
  const named = sheets.filter((item): item is string | null => item !== undefined);
  const sheet = named[0] ?? null;
  if (named.some((item) => item !== sheet)) return null;
  return { left: left.address, op: compared.op, right: storedSide(right), yes: storedSide(yes), no: storedSide(no), sheet };
}

export function compareCells(parsed: CompareIf): string[] {
  const cells = [parsed.left];
  for (const side of [parsed.right, parsed.yes, parsed.no]) {
    if (side.kind === "cell") cells.push(side.address);
  }
  return cells;
}

function sideReading(
  side: CompareSide,
  read: (address: string) => unknown,
): { kind: "number"; n: number } | { kind: "text"; t: string } | null {
  if (side.kind === "number") return { kind: "number", n: side.value };
  if (side.kind === "text") return { kind: "text", t: side.value };
  const value = read(side.address);
  if (typeof value === "string" && FORMULA_ERRORS.has(value)) return null;
  if (value === undefined || value === null || value === "") return { kind: "number", n: 0 };
  if (typeof value === "number" && Number.isFinite(value)) return { kind: "number", n: value };
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return { kind: "number", n: Number(value) };
  if (typeof value === "string") return { kind: "text", t: value };
  return null;
}

function comparisonHolds(
  op: CompareOp,
  left: { kind: "number"; n: number } | { kind: "text"; t: string },
  right: { kind: "number"; n: number } | { kind: "text"; t: string },
): boolean | null {
  if (left.kind === "number" && right.kind === "number") {
    if (op === ">") return left.n > right.n;
    if (op === ">=") return left.n >= right.n;
    if (op === "<") return left.n < right.n;
    if (op === "<=") return left.n <= right.n;
    if (op === "=") return left.n === right.n;
    return left.n !== right.n;
  }
  if (left.kind === "text" && right.kind === "text" && (op === "=" || op === "<>")) {
    const same = left.t.trim().toLowerCase() === right.t.trim().toLowerCase();
    return op === "=" ? same : !same;
  }
  return null;
}

function branchValue(side: CompareSide, read: (address: string) => unknown): unknown {
  if (side.kind === "number") return side.value;
  if (side.kind === "text") return side.value;
  return read(side.address);
}

/** True or false picks a branch. Text ordered against a number is not decided. */
export function compareResult(parsed: CompareIf, read: (address: string) => unknown): CompareDecision {
  const left = sideReading({ kind: "cell", address: parsed.left }, read);
  const right = sideReading(parsed.right, read);
  if (!left || !right) return { decided: false };
  const held = comparisonHolds(parsed.op, left, right);
  if (held === null) return { decided: false };
  return { decided: true, held, value: branchValue(held ? parsed.yes : parsed.no, read) };
}

/** The note names the outcome and a numeric result. It does not copy text. */
export function compareNote(parsed: CompareIf, read: (address: string) => unknown): string {
  const result = compareResult(parsed, read);
  if (!result.decided) return "The comparison was not decided.";
  const outcome = result.held ? "The comparison is true." : "The comparison is false.";
  if (typeof result.value === "number" && Number.isFinite(result.value)) return `${outcome} The result is ${result.value}.`;
  if (typeof result.value === "string" && FORMULA_ERRORS.has(result.value)) return `${outcome} The result is an error.`;
  return `${outcome} The result is text.`;
}

/**
 * Settle plain IF cells and same-sheet comparisons.
 * A test that is not a number stays unsettled. The caller writes the chosen value.
 */
export function settleChoices(
  addresses: readonly string[],
  formulaOf: (address: string) => string,
  readValue: (address: string) => unknown,
  writeValue: (address: string, value: unknown) => boolean,
): { calculated: string[]; left: string[] } {
  const waiting = new Set(addresses);
  const calculated: string[] = [];
  for (let pass = 0; pass < addresses.length && waiting.size > 0; pass += 1) {
    let wrote = false;
    for (const address of [...waiting]) {
      const formula = formulaOf(address);
      const plain = plainIf(formula);
      const compared = plain ? null : parseCompareIf(formula);
      if (compared?.sheet || (!plain && !compared)) continue;
      const deps = plain ? [plain.test, plain.yes, plain.no] : compareCells(compared!);
      if (deps.some((part) => part !== address && waiting.has(part))) continue;
      let next: unknown;
      if (plain) {
        const condition = conditionOf(readValue(plain.test));
        if (condition === null) continue;
        next = readValue(condition === 0 ? plain.no : plain.yes);
      } else {
        const result = compareResult(compared!, readValue);
        if (!result.decided) continue;
        next = result.value;
      }
      if (writeValue(address, next)) wrote = true;
      waiting.delete(address);
      calculated.push(address);
    }
    if (!wrote) break;
  }
  return { calculated, left: [...waiting] };
}

/** The value for the first true test, `#N/A` when none are true, or null while a test is not a number. */
export function firstMatching(
  parsed: Ifs,
  read: (address: string) => unknown,
): unknown | null {
  for (const pair of parsed.pairs) {
    const held =
      pair.truth !== undefined
        ? pair.truth
        : pair.compare
          ? compareHolds(pair.test, pair.compare, read)
          : cellHolds(read(pair.test));
    if (held === null) return null;
    if (held) {
      if (pair.valueLiteral?.kind === "number") return pair.valueLiteral.value;
      if (pair.valueLiteral?.kind === "text") return pair.valueLiteral.value;
      return read(pair.value);
    }
  }
  return "#N/A";
}

function cellHolds(value: unknown): boolean | null {
  const condition = conditionOf(value);
  if (condition === null) return null;
  return condition !== 0;
}

function compareHolds(
  left: string,
  compare: { op: CompareOp; right: CompareSide },
  read: (address: string) => unknown,
): boolean | null {
  const leftSide = sideReading({ kind: "cell", address: left }, read);
  const rightSide = sideReading(compare.right, read);
  if (!leftSide || !rightSide) return null;
  return comparisonHolds(compare.op, leftSide, rightSide);
}

export type LogicCall = { op: "and" | "or" | "not"; tests: LogicTest[]; sheet: string | null };
type LogicTest =
  | { kind: "cell"; address: string; sheet: string | null }
  | { kind: "compare"; left: string; op: CompareOp; right: CompareSide; sheet: string | null };

function parseLogicTest(token: string): LogicTest | null {
  const cell = cellToken(token);
  if (cell) return { kind: "cell", address: cell.address, sheet: cell.sheet };
  const compared = splitCompare(token);
  if (!compared?.left || !compared.right) return null;
  const left = parseSide(compared.left);
  const right = parseSide(compared.right);
  if (!left || left.kind !== "cell" || !right) return null;
  if (right.kind === "cell" && right.sheet !== left.sheet) return null;
  return { kind: "compare", left: left.address, op: compared.op, right: storedSide(right), sheet: left.sheet ?? null };
}

/** `=AND(A1>10, B1<5)`, `=OR(A1>10, B1<5)`, or `=NOT(A1>10)`. A plain cell is still a test. */
export function parseLogic(formula: string): LogicCall | null {
  const match = /^=\s*(AND|OR|NOT)\s*\((.*)\)\s*$/i.exec(formula.trim());
  if (!match) return null;
  const op = match[1].toLowerCase() as "and" | "or" | "not";
  const parts = splitArgs(match[2] ?? "");
  if (!parts) return null;
  if ((op === "not" && parts.length !== 1) || (op !== "not" && parts.length !== 2)) return null;
  const tests = parts.map((part) => parseLogicTest(part));
  if (tests.some((item) => item == null)) return null;
  const named = tests.filter((item): item is LogicTest => item != null);
  const sheet = named[0]?.sheet ?? null;
  if (named.some((item) => item.sheet !== sheet)) return null;
  return { op, tests: named, sheet };
}

export function logicCells(parsed: LogicCall): string[] {
  const cells: string[] = [];
  for (const test of parsed.tests) {
    if (test.kind === "cell") cells.push(test.address);
    else {
      cells.push(test.left);
      if (test.right.kind === "cell") cells.push(test.right.address);
    }
  }
  return cells;
}

function logicTestHolds(test: LogicTest, read: (address: string) => unknown): boolean | null {
  if (test.kind === "cell") return cellHolds(read(test.address));
  return compareHolds(test.left, { op: test.op, right: test.right }, read);
}

/** 1 or 0 when every test is decided. A test that is not a number stays undecided. */
export function logicValue(parsed: LogicCall, read: (address: string) => unknown): 0 | 1 | null {
  const held = parsed.tests.map((test) => logicTestHolds(test, read));
  if (held.some((item) => item === null)) return null;
  if (parsed.op === "not") return held[0] ? 0 : 1;
  if (parsed.op === "or") return held.some((item) => item) ? 1 : 0;
  return held.every((item) => item) ? 1 : 0;
}

/** The note names the outcome. It does not copy text or the formula word. */
export function logicNote(parsed: LogicCall, read: (address: string) => unknown): string {
  const value = logicValue(parsed, read);
  if (value === null) return "The comparison was not decided.";
  if (parsed.op === "not") return value === 0 ? "The opposite is 0." : "The opposite is 1.";
  if (parsed.op === "or") return value === 1 ? "Either is true." : "Neither is true.";
  return value === 1 ? "Both are true." : "Both are not true.";
}

/** Settle same-sheet AND, OR, and NOT formulas that use a comparison. */
export function settleLogic(
  addresses: readonly string[],
  formulaOf: (address: string) => string,
  readValue: (address: string) => unknown,
  writeValue: (address: string, value: unknown) => boolean,
): { calculated: string[]; left: string[] } {
  const waiting = new Set(addresses);
  const calculated: string[] = [];
  for (let pass = 0; pass < addresses.length && waiting.size > 0; pass += 1) {
    let wrote = false;
    for (const address of [...waiting]) {
      const parsed = parseLogic(formulaOf(address));
      if (!parsed || parsed.sheet) continue;
      if (logicCells(parsed).some((part) => part !== address && waiting.has(part))) continue;
      const next = logicValue(parsed, readValue);
      if (next === null) continue;
      if (writeValue(address, next)) wrote = true;
      waiting.delete(address);
      calculated.push(address);
    }
    if (!wrote) break;
  }
  return { calculated, left: [...waiting] };
}
