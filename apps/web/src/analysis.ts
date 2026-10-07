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
  const grouped = aq
    .from(records)
    .groupby(...keys)
    .rollup({ result: op })
    .objects() as Record<string, CellValue>[];
  const rowKey = (r: Record<string, CellValue>) =>
    JSON.stringify(config.rows.map((i) => r[`c${i}`]));
  const colKey = (r: Record<string, CellValue>) =>
    JSON.stringify(config.columns.map((i) => r[`c${i}`]));
  const cols = [...new Set(grouped.map(colKey))].sort(),
    rows = [...new Set(grouped.map(rowKey))].sort();
  const lookup = new Map(
    grouped.map((r) => [`${rowKey(r)}|${colKey(r)}`, r.result]),
  );
  const labels = cols.map((c) =>
    config.columns.length
      ? (JSON.parse(c) as CellValue[]).join(" / ")
      : `${config.aggregate} ${headers[config.value]}`,
  );
  return [
    [...config.rows.map((i) => headers[i]), ...labels],
    ...rows.map((r) => [
      ...(JSON.parse(r) as CellValue[]),
      ...cols.map((c) => lookup.get(`${r}|${c}`) ?? null),
    ]),
  ];
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
