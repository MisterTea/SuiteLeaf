/**
 * `=RAND()` and `=RANDBETWEEN(A1, B1)`.
 * The caller supplies the draw. A draw outside 0 inclusive to 1 exclusive is ignored.
 */

import { cellAddress } from "./sheet-audit";

type Cell = { f?: string | null; v?: unknown } | null;

function bound(token: string, read: (address: string) => unknown): number | null {
  if (/^-?\d+$/.test(token.trim())) return Number(token.trim());
  const qualified = /^(?:'((?:[^']|'')*)'|([A-Za-z_][A-Za-z0-9_-]*))!(\$?[A-Z]+)\$?(\d+)$/i.exec(token.trim());
  if (qualified) {
    const sheet = (qualified[1] ?? qualified[2] ?? "").replaceAll("''", "'").trim();
    const value = read(`${sheet}!${qualified[3].toUpperCase()}${qualified[4]}`);
    return typeof value === "number" && Number.isInteger(value) ? value : null;
  }
  const match = /^\$?([A-Z]+)\$?(\d+)$/i.exec(token.trim());
  if (!match) return null;
  const value = read(`${match[1].toUpperCase()}${match[2]}`);
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function draw(random: () => number): number | null {
  const sample = random();
  return typeof sample === "number" && Number.isFinite(sample) && sample >= 0 && sample < 1 ? sample : null;
}

/** The random result, an error, or null when the draw or a bound cannot be used. */
export function randomResult(formula: string, random: () => number, read: (address: string) => unknown): number | string | null {
  const match = /^=\s*(RAND|RANDBETWEEN)\s*\((.*)\)\s*$/i.exec(formula.trim());
  if (!match) return null;
  const sample = draw(random);
  if (sample === null) return null;
  if (match[1].toUpperCase() === "RAND") return match[2].trim() ? null : sample;
  const parts = match[2].split(",").map((item) => item.trim());
  if (parts.length !== 2) return null;
  const low = bound(parts[0], read);
  const high = bound(parts[1], read);
  if (low === null || high === null) return null;
  if (low > high) return "#NUM!";
  return low + Math.floor(sample * (high - low + 1));
}

/** Writes every random formula on the sheet. */
export function applyRandom(
  rows: Record<string, Record<string, Cell> | undefined>,
  random: () => number,
  readValue?: (address: string) => unknown,
): string[] {
  const read = readValue ?? ((address: string): unknown => {
    const match = /^([A-Z]+)(\d+)$/.exec(address);
    if (!match) return undefined;
    let column = 0;
    for (const char of match[1]) column = column * 26 + (char.charCodeAt(0) - 64);
    return rows[String(Number(match[2]) - 1)]?.[String(column - 1)]?.v;
  });
  const calculated: string[] = [];
  for (const [rowKey, row] of Object.entries(rows)) {
    for (const [columnKey, cell] of Object.entries(row ?? {})) {
      if (!cell || typeof cell.f !== "string") continue;
      const next = randomResult(cell.f, random, read);
      if (next === null) continue;
      if (cell.v !== next) cell.v = next;
      const address = cellAddress(Number(rowKey), Number(columnKey));
      if (address) calculated.push(address);
    }
  }
  return calculated;
}
