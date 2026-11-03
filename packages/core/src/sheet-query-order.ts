/** Order two query cells. Two plain numbers use numeric order. Other text stays text order. */

function plainNumber(value: string): number | null {
  if (!/^-?\d+(\.\d+)?$/.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function compareQueryValues(left: string, right: string): number {
  const leftNumber = plainNumber(left);
  const rightNumber = plainNumber(right);
  if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
  return left.localeCompare(right);
}

type GroupAggregate = "sum" | "count" | "average" | "min" | "max";

/** Group rows. Two plain numbers share a group. The label is the first writing. */
export function groupQueryRows(
  rows: Record<string, string>[],
  by: string,
  value: string,
  aggregate: GroupAggregate,
): Record<string, string>[] {
  const order: string[] = [];
  const labels = new Map<string, string>();
  const buckets = new Map<string, { sum: number; count: number; numeric: number; min: number; max: number }>();
  for (const row of rows) {
    const written = row[by] ?? "";
    const key = joinKey(written);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { sum: 0, count: 0, numeric: 0, min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY };
      buckets.set(key, bucket);
      labels.set(key, written);
      order.push(key);
    }
    bucket.count += 1;
    const parsed = Number(row[value]);
    if (row[value]?.trim() !== "" && Number.isFinite(parsed)) {
      bucket.sum += parsed;
      bucket.numeric += 1;
      bucket.min = Math.min(bucket.min, parsed);
      bucket.max = Math.max(bucket.max, parsed);
    }
  }
  const grouped = (key: string): string => {
    const bucket = buckets.get(key);
    if (!bucket) return "";
    if (aggregate === "count") return String(bucket.count);
    if (bucket.numeric === 0) return aggregate === "sum" ? "0" : "";
    if (aggregate === "average") return String(Math.round((bucket.sum / bucket.numeric) * 1_000_000) / 1_000_000);
    if (aggregate === "min") return String(bucket.min);
    if (aggregate === "max") return String(bucket.max);
    return String(bucket.sum);
  };
  return order.map((key) => ({
    [by]: labels.get(key) ?? key,
    [value]: grouped(key),
  }));
}

/** A join key. Two plain numbers use the same key. Other text stays as written. A blank stays blank. */
export function joinKey(value: string): string {
  if (value === "") return "";
  const number = plainNumber(value);
  return number === null ? value : `n:${number}`;
}
