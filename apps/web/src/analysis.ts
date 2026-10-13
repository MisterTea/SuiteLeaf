import * as aq from "arquero";
import type { PivotDefinition, SourceRange } from "@suiteleaf/core";
export type CellValue = string | number | boolean | null;
export function pivotResult(
  values: CellValue[][],
  config: Pick<
    PivotDefinition,
    "rows" | "columns" | "value" | "aggregate" | "filterColumn" | "filterValue"
  >,
): CellValue[][] {
  if (values.length < 2)
    throw new Error("Select a header row and at least one data row.");
  const headers = values[0].map((v, i) => String(v ?? `Column ${i + 1}`));
  const dims = [...config.rows, ...config.columns];
  if (
    !config.rows.length ||
    new Set(dims).size !== dims.length ||
    [...dims, config.value].some((i) => i >= headers.length)
  )
    throw new Error(
      "Choose distinct row/column fields and a valid value field.",
    );
  let records = values
    .slice(1)
    .filter((r) => r.some((v) => v !== null && v !== ""))
    .map((row) => Object.fromEntries(row.map((v, i) => [`c${i}`, v ?? ""])));
  if (
    config.filterColumn !== undefined &&
    config.filterColumn >= 0 &&
    config.filterValue
  )
    records = records.filter(
      (r) => String(r[`c${config.filterColumn}`]) === config.filterValue,
    );
  const keys = dims.map((i) => `c${i}`),
    value = `c${config.value}`;
  if (config.aggregate === "COUNT")
    records = records.filter((r) => r[value] !== "" && r[value] !== null);
  if (config.aggregate !== "COUNT")
    records = records.filter(
      (r) => typeof r[value] === "number" && Number.isFinite(r[value]),
    );
  if (!records.length)
    return [[...config.rows.map((i) => headers[i]), "No matching data"]];
  const op =
    config.aggregate === "COUNT"
      ? aq.op.count()
      : config.aggregate === "SUM"
        ? aq.op.sum(value)
        : config.aggregate === "AVERAGE"
          ? aq.op.mean(value)
          : config.aggregate === "MIN"
            ? aq.op.min(value)
            : aq.op.max(value);
  const table = aq.from(records);
  const rollup = (by: string[]) =>
    (by.length ? table.groupby(...by) : table)
      .rollup({ result: op })
      .objects() as Record<string, CellValue>[];
  const rowKey = (r: Record<string, CellValue>) =>
    JSON.stringify(config.rows.map((i) => r[`c${i}`]));
  const colKey = (r: Record<string, CellValue>) =>
    JSON.stringify(config.columns.map((i) => r[`c${i}`]));
  // Totals aggregate the underlying records, so an AVERAGE total is not an average of averages.
  const grouped = rollup(keys),
    rowTotals = new Map(
      rollup(config.rows.map((i) => `c${i}`)).map((r) => [rowKey(r), r.result]),
    ),
    colTotals = new Map(
      rollup(config.columns.map((i) => `c${i}`)).map((r) => [
        colKey(r),
        r.result,
      ]),
    ),
    total = rollup([])[0]?.result ?? null;
  const byKey = (a: string, b: string) => {
    const x = JSON.parse(a) as CellValue[],
      y = JSON.parse(b) as CellValue[];
    for (let i = 0; i < x.length; i++) {
      const order =
        typeof x[i] === "number" && typeof y[i] === "number"
          ? (x[i] as number) - (y[i] as number)
          : String(x[i]).localeCompare(String(y[i]), undefined, {
              numeric: true,
            });
      if (order) return order;
    }
    return 0;
  };
  const cols = [...new Set(grouped.map(colKey))].sort(byKey),
    rows = [...new Set(grouped.map(rowKey))].sort(byKey);
  const lookup = new Map(
    grouped.map((r) => [`${rowKey(r)}|${colKey(r)}`, r.result]),
  );
  const split = config.columns.length > 0;
  const labels = cols.map((c) =>
    split
      ? (JSON.parse(c) as CellValue[]).join(" / ")
      : `${config.aggregate} ${headers[config.value]}`,
  );
  return [
    [
      ...config.rows.map((i) => headers[i]),
      ...labels,
      ...(split ? [GRAND_TOTAL] : []),
    ],
    ...rows.map((r) => [
      ...(JSON.parse(r) as CellValue[]),
      ...cols.map((c) => lookup.get(`${r}|${c}`) ?? null),
      ...(split ? [rowTotals.get(r) ?? null] : []),
    ]),
    [
      GRAND_TOTAL,
      ...config.rows.slice(1).map(() => null),
      ...cols.map((c) => colTotals.get(c) ?? null),
      ...(split ? [total] : []),
    ],
  ];
}
export const GRAND_TOTAL = "Grand Total";
/** Univer cell data keyed by row then column; `null` clears a cell. */
export type PivotCells = Record<
  number,
  Record<
    number,
    {
      v: string | number | boolean;
      t: number;
      s: { bl?: 1; n?: { pattern: string } } | null;
    } | null
  >
>;
/**
 * Cell data for a pivot worksheet: bold header and grand totals, the source's number
 * format on aggregated values, and cleared cells wherever an earlier, larger result was.
 */
export function pivotCells(
  result: CellValue[][],
  options: {
    rowFields: number;
    numberFormat?: string;
    previous?: { rows: number; columns: number };
  },
): PivotCells {
  const rows = Math.max(result.length, options.previous?.rows ?? 0),
    columns = Math.max(
      result[0]?.length ?? 0,
      options.previous?.columns ?? 0,
    );
  const totalRow =
    result.length > 1 && result[result.length - 1][0] === GRAND_TOTAL
      ? result.length - 1
      : -1;
  const totalColumn = result[0]?.lastIndexOf(GRAND_TOTAL) ?? -1;
  const out: PivotCells = {};
  for (let r = 0; r < rows; r++) {
    out[r] = {};
    for (let c = 0; c < columns; c++) {
      const v = result[r]?.[c];
      if (v === null || v === undefined || v === "") {
        out[r][c] = null;
        continue;
      }
      const bold =
        r === 0 ||
        r === totalRow ||
        (c === totalColumn && c >= options.rowFields);
      const pattern =
        r > 0 && c >= options.rowFields && typeof v === "number"
          ? options.numberFormat
          : undefined;
      out[r][c] = {
        v,
        t: typeof v === "number" ? 2 : typeof v === "boolean" ? 3 : 1,
        s:
          bold || pattern
            ? {
                ...(bold ? { bl: 1 as const } : {}),
                ...(pattern ? { n: { pattern } } : {}),
              }
            : null,
      };
    }
  }
  return out;
}
/** The number format of the first numeric data cell in a source column, if any. */
export function valueFormat(
  values: CellValue[][],
  formats: (string | null | undefined)[][],
  column: number,
): string | undefined {
  const row = values.findIndex(
    (cells, i) => i > 0 && typeof cells[column] === "number",
  );
  return row > 0 ? formats[row]?.[column] || undefined : undefined;
}
/** The first numeric field that is not already grouping rows, for a sensible Value default. */
export function defaultValueField(
  values: CellValue[][],
  exclude: number[] = [],
): number {
  const width = values[0]?.length ?? 0;
  const candidates = Array.from({ length: width }, (_, i) => i).filter(
    (i) => !exclude.includes(i),
  );
  return (
    candidates.find((i) =>
      values.slice(1).some((r) => typeof r[i] === "number"),
    ) ??
    candidates[0] ??
    0
  );
}
/** `base`, or `base 2`, `base 3`… when a worksheet already has that name. */
export function uniqueSheetName(base: string, existing: string[]): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`.toLowerCase())) n++;
  return `${base} ${n}`;
}
/** "October by category (copy)", then "(copy 2)"… for editable copies of a pivot. */
export function copySheetName(title: string, existing: string[]): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  const base = `${title.slice(0, 24)} (copy`;
  if (!taken.has(`${base})`.toLowerCase())) return `${base})`;
  let n = 2;
  while (taken.has(`${base} ${n})`.toLowerCase())) n++;
  return `${base} ${n})`;
}
/** Rebase inclusive ranges after structural changes. A fully deleted range is invalid. */
export function shiftRange(
  r: SourceRange,
  axis: "row" | "column",
  start: number,
  count: number,
  remove: boolean,
): SourceRange | null {
  const lo = axis === "row" ? "startRow" : "startColumn",
    hi = axis === "row" ? "endRow" : "endColumn";
  const out = { ...r };
  if (!remove) {
    if (start <= r[lo]) {
      out[lo] += count;
      out[hi] += count;
    } else if (start <= r[hi]) out[hi] += count;
    return out;
  }
  const end = start + count - 1;
  if (start <= r[lo] && end >= r[hi]) return null;
  const before = Math.max(0, Math.min(count, r[lo] - start));
  const overlap = Math.max(
    0,
    Math.min(end, r[hi]) - Math.max(start, r[lo]) + 1,
  );
  out[lo] -= before;
  out[hi] -= before + overlap;
  return out;
}
/** Value-axis ticks on 1, 2, 2.5 or 5 × 10ⁿ steps, as Sheets and Excel choose them. */
export function valueTicks(values: unknown[]): number[] | undefined {
  const numbers = values.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  const low = Math.min(0, ...numbers),
    high = Math.max(0, ...numbers);
  if (low === high) return undefined;
  const magnitude = 10 ** Math.floor(Math.log10((high - low) / 6));
  const step = [1, 2, 2.5, 5, 10, 20]
    .map((m) => m * magnitude)
    .find((s) => Math.ceil(high / s) - Math.floor(low / s) <= 6)!;
  const first = Math.floor(low / step),
    last = Math.ceil(high / step);
  return Array.from({ length: last - first + 1 }, (_, i) =>
    Number(((first + i) * step).toPrecision(12)),
  );
}
