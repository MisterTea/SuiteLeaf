/**
 * `=LEFT(A1, 4)`, `=RIGHT(A1, 4)`, `=MID(A1, 2, 3)`, `=CONCATENATE(A1, B1)`, and `=TEXT(A1, "0.00")`.
 * A formula error is left for the caller. A bad count is `#VALUE!`.
 */

const FORMULA_ERRORS = new Set(["#DIV/0!", "#REF!", "#VALUE!", "#NAME?", "#N/A", "#NUM!", "#NULL!"]);

export type TextOp = "left" | "right" | "mid" | "concatenate" | "text";
export type TextFormula = { op: TextOp; cells: string[]; counts: Array<number | string>; sheet: string | null };

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

function formatToken(token: string): { sheet: string | null; count: string } | null {
  const quoted = /^"([^"]*)"$/.exec(token.trim());
  if (quoted) return { sheet: null, count: quoted[1] };
  const cell = oneCell(token);
  return cell ? { sheet: cell.sheet, count: cell.address } : null;
}

function countToken(token: string): { sheet: string | null; count: number | string } | null {
  if (/^-?\d+$/.test(token.trim())) return { sheet: null, count: Number(token.trim()) };
  const cell = oneCell(token);
  return cell ? { sheet: cell.sheet, count: cell.address } : null;
}

function splitArgs(body: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of body) {
    if (char === '"') quoted = !quoted;
    if (char === "," && !quoted) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Two to four cells for concatenate. Left and right take one count. Mid takes two. */
export function parseText(formula: string): TextFormula | null {
  const match = /^=\s*(LEFT|RIGHT|MID|CONCATENATE|TEXT)\s*\((.+)\)\s*$/i.exec(formula.trim());
  if (!match) return null;
  const op = match[1].toLowerCase() as TextOp;
  const parts = splitArgs(match[2]);
  if (op === "concatenate") {
    if (parts.length < 2 || parts.length > 4) return null;
    const cells = parts.map(oneCell);
    if (cells.some((cell) => !cell)) return null;
    const parsed = cells as { sheet: string | null; address: string }[];
    const sheet = parsed.find((cell) => cell.sheet)?.sheet ?? null;
    if (sheet && parsed.some((cell) => cell.sheet !== sheet)) return null;
    return { op, cells: parsed.map((cell) => cell.address), counts: [], sheet };
  }
  if (op === "text") {
    if (parts.length !== 2) return null;
    const value = oneCell(parts[0]);
    const format = formatToken(parts[1]);
    if (!value || !format) return null;
    if (format.sheet && value.sheet && format.sheet !== value.sheet) return null;
    const sheet = value.sheet ?? format.sheet;
    if (sheet && value.sheet !== sheet) return null;
    return { op, cells: [value.address], counts: [format.count], sheet };
  }
  const expected = op === "mid" ? 3 : 2;
  if (parts.length !== expected) return null;
  const text = oneCell(parts[0]);
  const counts = parts.slice(1).map(countToken);
  if (!text || counts.some((count) => !count)) return null;
  const parsedCounts = counts as { sheet: string | null; count: number | string }[];
  const sheet = text.sheet ?? parsedCounts.find((count) => count.sheet)?.sheet ?? null;
  if (sheet && (text.sheet !== sheet || parsedCounts.some((count) => count.sheet && count.sheet !== sheet))) return null;
  return { op, cells: [text.address], counts: parsedCounts.map((count) => count.count), sheet };
}

function asText(value: unknown): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string" || FORMULA_ERRORS.has(value)) return null;
  return value;
}

function wholeCount(value: number | string, read: (address: string) => unknown): number | null {
  const number = typeof value === "number" ? value : read(value);
  if (typeof number !== "number" || !Number.isInteger(number)) return null;
  return number;
}

function roundPlaces(value: number, places: number): number {
  const factor = 10 ** places;
  const scaled = value * factor;
  return (Math.sign(scaled) * Math.round(Math.abs(scaled))) / factor;
}

/** `0`, `0.00`, `#,##0`, `#,##0.00`, and the same patterns with a trailing `%`. */
function formatNumber(value: number, format: string): string | null {
  const percent = format.endsWith("%");
  const body = percent ? format.slice(0, -1) : format;
  const grouped = body.startsWith("#,##");
  const digits = grouped ? body.slice(4) : body;
  if (!/^0(?:\.0+)?$/.test(digits)) return null;
  const places = digits.includes(".") ? digits.length - 2 : 0;
  const rounded = roundPlaces(percent ? value * 100 : value, places);
  const text = rounded.toFixed(places);
  const negative = text.startsWith("-");
  const [whole, fraction] = text.replace("-", "").split(".");
  const groupedWhole = grouped ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : whole;
  return `${negative ? "-" : ""}${groupedWhole}${fraction ? `.${fraction}` : ""}${percent ? "%" : ""}`;
}

function formatOf(count: number | string, read: (address: string) => unknown): string | null {
  if (typeof count !== "string") return null;
  if (/^[A-Z]+\d+$/.test(count)) {
    const stored = read(count);
    return typeof stored === "string" && !FORMULA_ERRORS.has(stored) ? stored : null;
  }
  return count;
}

/** The text piece, `#VALUE!` for a bad count, or null when the text is an error. */
export function textValue(parsed: TextFormula, read: (address: string) => unknown): string | null {
  if (parsed.op === "text") {
    const raw = read(parsed.cells[0]);
    if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
    const format = formatOf(parsed.counts[0], read);
    return format === null ? null : formatNumber(raw, format);
  }
  if (parsed.op === "concatenate") {
    const pieces: string[] = [];
    for (const address of parsed.cells) {
      const text = asText(read(address));
      if (text === null) return null;
      pieces.push(text);
    }
    return pieces.join("");
  }
  const text = asText(read(parsed.cells[0]));
  if (text === null) return null;
  const counts = parsed.counts.map((count) => wholeCount(count, read));
  if (counts.some((count) => count === null || count < 0)) return "#VALUE!";
  const [startOrCount, length] = counts as number[];
  if (parsed.op === "left") return text.slice(0, startOrCount);
  if (parsed.op === "right") return startOrCount === 0 ? "" : text.slice(-startOrCount);
  if (startOrCount < 1) return "#VALUE!";
  return text.slice(startOrCount - 1, startOrCount - 1 + length);
}

/** Writes same-sheet text formulas. */
export function applyText(input: {
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
      const parsed = parseText(input.formula(address));
      if (!parsed || parsed.sheet) continue;
      const watched = [...parsed.cells, ...parsed.counts.filter((count): count is string => typeof count === "string")];
      if (watched.some((part) => part !== address && waiting.has(part))) continue;
      const next = textValue(parsed, input.value);
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
