/**
 * Formula references on one sheet.
 * Cell values are not copied into the result. This does not calculate the formula.
 */

type Cell = { f?: string | null; v?: unknown } | null;
type Cells = Record<string, Record<string, Cell>>;

export type FormulaAudit = {
  address: string;
  precedents: string[];
  dependents: string[];
  trace: string;
  cycle: string | null;
  error: string | null;
};

const ERRORS = new Set([
  "#REF!",
  "#DIV/0!",
  "#VALUE!",
  "#NAME?",
  "#N/A",
  "#NUM!",
  "#NULL!",
  "#CYCLE!",
]);

const MAX_RANGE = 64;

function columnIndex(letters: string): number {
  let index = 0;
  for (const char of letters.toUpperCase()) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

function columnLetters(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function cellAddress(row: number, column: number): string {
  if (row < 0 || column < 0) return "";
  return `${columnLetters(column)}${row + 1}`;
}

function parseAddress(value: string): { row: number; column: number } | null {
  const match = /^\$?([A-Z]+)\$?(\d+)$/i.exec(value.trim());
  if (!match) return null;
  const row = Number(match[2]) - 1;
  const column = columnIndex(match[1]);
  if (row < 0 || row > 1_000_000 || column < 0 || column > 16_384) return null;
  return { row, column };
}

function expandRange(start: string, end: string): { cells: string[]; listed: boolean } {
  const from = parseAddress(start);
  const to = parseAddress(end);
  if (!from || !to) return { cells: [], listed: true };
  const row0 = Math.min(from.row, to.row);
  const row1 = Math.max(from.row, to.row);
  const col0 = Math.min(from.column, to.column);
  const col1 = Math.max(from.column, to.column);
  const count = (row1 - row0 + 1) * (col1 - col0 + 1);
  if (count > MAX_RANGE) return { cells: [], listed: false };
  const cells: string[] = [];
  for (let row = row0; row <= row1; row += 1) {
    for (let column = col0; column <= col1; column += 1) cells.push(cellAddress(row, column));
  }
  return { cells, listed: true };
}

function quotedSheet(name: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) return name;
  return `'${name.replaceAll("'", "''")}'`;
}

function references(formula: string): { cells: string[]; external: string[]; unlisted: string[] } {
  const stripped = formula.replace(/"(?:[^"]|"")*"/g, " ");
  const cells = new Set<string>();
  const external = new Set<string>();
  const unlisted: string[] = [];
  const withoutSheets = stripped.replace(
    /(?:'((?:[^']|'')*)'|([A-Za-z_][A-Za-z0-9_-]*))!(\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?)/gi,
    (whole, quoted: string | undefined, bare: string | undefined, addr: string) => {
      const name = (quoted ?? bare ?? "").replaceAll("''", "'").trim();
      if (!name || /[\r\n]/.test(name)) return " ";
      const add = (cell: string) => external.add(`${quotedSheet(name)}!${cell}`);
      if (addr.includes(":")) {
        const [start, end] = addr.split(":");
        const expanded = expandRange(start, end);
        if (!expanded.listed) unlisted.push(whole.replace(/\$/g, "").replaceAll("''", "'"));
        else for (const cell of expanded.cells) add(cell);
      } else {
        const parsed = parseAddress(addr);
        if (parsed) add(cellAddress(parsed.row, parsed.column));
      }
      return " ";
    },
  );
  const withoutRanges = withoutSheets.replace(
    /\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)/gi,
    (range, c1: string, r1: string, c2: string, r2: string) => {
      const expanded = expandRange(`${c1}${r1}`, `${c2}${r2}`);
      if (!expanded.listed) unlisted.push(range.toUpperCase().replace(/\$/g, ""));
      for (const cell of expanded.cells) cells.add(cell);
      return " ";
    },
  );
  for (const match of withoutRanges.matchAll(/\$?([A-Z]+)\$?(\d+)/gi)) {
    const parsed = parseAddress(`${match[1]}${match[2]}`);
    if (parsed) cells.add(cellAddress(parsed.row, parsed.column));
  }
  return { cells: [...cells], external: [...external], unlisted };
}

export type AuditScope = {
  name: string;
  others?: { name: string; cellData?: Cells }[];
};

function qualify(sheetName: string, cell: string): string {
  return `${quotedSheet(sheetName)}!${cell}`;
}

function showHome(text: string, home: string): string {
  return text.replaceAll(`${quotedSheet(home)}!`, "");
}

function formulasOf(cells: Cells): Map<string, { formula: string; error: string | null }> {
  const found = new Map<string, { formula: string; error: string | null }>();
  for (const [rowKey, row] of Object.entries(cells)) {
    if (!row) continue;
    for (const [columnKey, cell] of Object.entries(row)) {
      const formula = typeof cell?.f === "string" ? cell.f : "";
      if (!formula) continue;
      const address = cellAddress(Number(rowKey), Number(columnKey));
      if (!address) continue;
      const value = cell?.v;
      found.set(address, {
        formula,
        error: typeof value === "string" && ERRORS.has(value) ? value : null,
      });
    }
  }
  return found;
}

function cycleText(start: string, graph: Map<string, string[]>): string | null {
  const stack: string[] = [];
  const seen = new Set<string>();
  const walk = (address: string): string[] | null => {
    if (stack.includes(address)) return stack.slice(stack.indexOf(address));
    if (seen.has(address)) return null;
    seen.add(address);
    stack.push(address);
    for (const next of graph.get(address) ?? []) {
      const found = walk(next);
      if (found) return found;
    }
    stack.pop();
    return null;
  };
  const loop = walk(start);
  if (!loop || loop.length === 0) return null;
  const steps = [...loop, loop[0]];
  if (steps.length === 2) return `${steps[0]} refers to itself.`;
  return `${steps
    .slice(0, -1)
    .map((cell, index) => `${cell} refers to ${steps[index + 1]}`)
    .join(", and ")}.`;
}

function traceText(
  address: string,
  graph: Map<string, string[]>,
  formulas: Set<string>,
  unlisted: string[],
): string {
  if (!formulas.has(address)) return `${address} has no formula.`;
  const lines: string[] = [];
  const seen = new Set<string>();
  const walk = (cell: string, depth: number) => {
    if (depth > 6 || seen.has(cell)) return;
    seen.add(cell);
    const next = graph.get(cell) ?? [];
    if (unlisted.length && cell === address) {
      lines.push(`${cell} has a range that is too large to list: ${unlisted.join(", ")}.`);
    }
    if (!next.length) return;
    lines.push(`${cell} reads ${next.join(", ")}.`);
    for (const item of next) {
      if (formulas.has(item)) walk(item, depth + 1);
    }
  };
  walk(address, 0);
  return lines.join(" ") || `${address} reads no cells.`;
}

function addSheet(
  graph: Map<string, string[]>,
  unlisted: Map<string, string[]>,
  sheet: { name?: string; cellData?: Cells },
  home: string | null,
) {
  for (const [cell, item] of formulasOf(sheet.cellData ?? {})) {
    const refs = references(item.formula);
    const name = sheet.name;
    const key = home && name ? qualify(name, cell) : cell;
    const edges = home && name
      ? [...refs.cells.map((item) => qualify(name, item)), ...refs.external]
      : [...refs.cells, ...refs.external];
    graph.set(key, edges);
    if (refs.unlisted.length) unlisted.set(key, refs.unlisted);
  }
}

/** Precedents, dependents, a reference trace, and a cycle. The sheet is not changed. */
export function auditFormula(
  sheet: { cellData?: Cells },
  address: string,
  scope?: AuditScope,
): FormulaAudit {
  const cells = sheet.cellData ?? {};
  const parsed = parseAddress(address);
  const normalized = parsed ? cellAddress(parsed.row, parsed.column) : "";
  const stored = formulasOf(cells);
  const graph = new Map<string, string[]>();
  const unlisted = new Map<string, string[]>();
  const home = scope && !/[\r\n]/.test(scope.name) ? scope.name : null;
  if (home) {
    addSheet(graph, unlisted, { name: home, cellData: cells }, home);
    for (const other of scope?.others ?? []) {
      if (!other.name || /[\r\n]/.test(other.name)) continue;
      addSheet(graph, unlisted, other, home);
    }
  } else {
    addSheet(graph, unlisted, { cellData: cells }, null);
  }
  if (!normalized) {
    return {
      address,
      precedents: [],
      dependents: [],
      trace: "That cell address is not valid.",
      cycle: null,
      error: null,
    };
  }
  const key = home ? qualify(home, normalized) : normalized;
  const show = (value: string) => (home ? showHome(value, home) : value);
  const precedents = (graph.get(key) ?? []).map(show);
  const dependents = [...graph.keys()]
    .filter((cell) => cell !== key && (graph.get(cell) ?? []).includes(key))
    .map(show)
    .sort();
  const cycle = cycleText(key, graph);
  return {
    address: normalized,
    precedents,
    dependents,
    trace: show(traceText(key, graph, new Set(graph.keys()), unlisted.get(key) ?? [])),
    cycle: cycle ? show(cycle) : null,
    error: stored.get(normalized)?.error ?? null,
  };
}

function errorSheetLabel(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || /[\r\n]/.test(trimmed)) return "another sheet";
  if (/password|secret|token|authorization|api[-_]?key|credential/i.test(trimmed)) return "another sheet";
  return trimmed;
}

type ErrorSpot = {
  address: string;
  error: string;
  row: number;
  column: number;
  sheetOrder: number;
};

function collectErrors(cells: Cells | undefined, sheetOrder: number, prefix: string): ErrorSpot[] {
  const errors: ErrorSpot[] = [];
  for (const [rowKey, row] of Object.entries(cells ?? {})) {
    if (!row) continue;
    for (const [columnKey, cell] of Object.entries(row)) {
      const value = cell?.v;
      if (typeof value !== "string" || !ERRORS.has(value)) continue;
      const rowIndex = Number(rowKey);
      const columnIndex = Number(columnKey);
      const local = cellAddress(rowIndex, columnIndex);
      if (!local) continue;
      errors.push({
        address: prefix ? `${prefix}!${local}` : local,
        error: value,
        row: rowIndex,
        column: columnIndex,
        sheetOrder,
      });
    }
  }
  return errors;
}

/** The next stored formula error after `after`, wrapping once. A value that is not an error code is skipped. */
export function nextFormulaError(
  sheet: { cellData?: Cells },
  after: string,
  others?: readonly { name: string; cellData?: Cells }[],
): { address: string; error: string; note: string } {
  const none = { address: "", error: "", note: "There is no other formula error." };
  const errors = collectErrors(sheet.cellData, 0, "");
  for (const [index, other] of (others ?? []).entries()) {
    errors.push(...collectErrors(other.cellData, index + 1, errorSheetLabel(other.name)));
  }
  errors.sort((a, b) => a.sheetOrder - b.sheetOrder || a.row - b.row || a.column - b.column);
  if (errors.length === 0) return none;
  const bang = after.lastIndexOf("!");
  const sheetName = bang < 0 ? null : after.slice(0, bang);
  const local = bang < 0 ? after : after.slice(bang + 1);
  const current = parseAddress(local);
  const currentAddress = current
    ? sheetName
      ? `${sheetName}!${cellAddress(current.row, current.column)}`
      : cellAddress(current.row, current.column)
    : "";
  const index = errors.findIndex((item) => item.address === currentAddress);
  if (index >= 0 && errors.length === 1) return none;
  if (index >= 0) {
    const pick = errors[(index + 1) % errors.length];
    return { address: pick.address, error: pick.error, note: `Next error is ${pick.address}, ${pick.error}.` };
  }
  const sheetOrder =
    sheetName == null
      ? 0
      : (errors.find((item) => item.address.startsWith(`${sheetName}!`))?.sheetOrder ?? 0);
  const later =
    current == null
      ? errors[0]
      : errors.find(
          (item) =>
            item.sheetOrder > sheetOrder ||
            (item.sheetOrder === sheetOrder &&
              (item.row > current.row || (item.row === current.row && item.column > current.column))),
        );
  const pick = later ?? errors[0];
  return { address: pick.address, error: pick.error, note: `Next error is ${pick.address}, ${pick.error}.` };
}
