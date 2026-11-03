/** Column totals for a stacked chart. A missing number adds nothing. The rows are not changed. */
export function stackTotals(
  rows: readonly Record<string, unknown>[],
  keys: readonly string[],
): number[] {
  return rows.map((row) =>
    keys.reduce((sum, key) => {
      const value = row[key];
      return sum + (typeof value === "number" && Number.isFinite(value) ? value : 0);
    }, 0),
  );
}
