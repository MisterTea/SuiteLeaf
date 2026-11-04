/**
 * `=TODAY()` and `=NOW()`. The date is UTC. A caller supplies the clock.
 */

import { cellAddress } from "./sheet-audit";

/** The UTC day, or the UTC time to the second. Null when it is not a clock formula. */
export function clockText(formula: string, now: Date): string | null {
  const match = /^=\s*(TODAY|NOW)\s*\(\s*\)$/i.exec(formula.trim());
  if (!match || Number.isNaN(now.getTime())) return null;
  const iso = now.toISOString();
  return match[1].toUpperCase() === "TODAY" ? iso.slice(0, 10) : `${iso.slice(0, 19)}Z`;
}

/** Writes every clock formula on the sheet. */
export function applyClock(
  rows: Record<string, Record<string, { f?: string | null; v?: unknown } | null> | undefined>,
  now: Date,
): string[] {
  const calculated: string[] = [];
  for (const [rowKey, row] of Object.entries(rows)) {
    for (const [columnKey, cell] of Object.entries(row ?? {})) {
      if (!cell || typeof cell.f !== "string") continue;
      const next = clockText(cell.f, now);
      if (next === null) continue;
      if (cell.v !== next) cell.v = next;
      const address = cellAddress(Number(rowKey), Number(columnKey));
      if (address) calculated.push(address);
    }
  }
  return calculated;
}
