/**
 * Counts of numbers in equal-width bins.
 * The list passed in is not modified. This is not an Excel histogram chart.
 */

export type HistogramBin = {
  label: string;
  count: number;
  low: number;
  high: number;
};

export type HistogramResult = {
  bins: HistogramBin[];
  skipped: number;
};

function trim(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded);
}

function numericCell(cell: unknown): number | null {
  if (typeof cell === "number" && Number.isFinite(cell)) return cell;
  if (typeof cell !== "string" || !/^-?\d+(\.\d+)?$/.test(cell.trim())) return null;
  const value = Number(cell.trim());
  return Number.isFinite(value) ? value : null;
}

/** Numbers from one column. Text is counted as skipped and is not copied. */
export function histogramColumn(cells: readonly unknown[]): { values: number[]; skipped: number } {
  const values: number[] = [];
  let skipped = 0;
  for (const cell of cells) {
    const value = numericCell(cell);
    if (value !== null) values.push(value);
    else if (cell != null && String(cell).trim() !== "") skipped += 1;
  }
  return { values, skipped };
}

/** A sentence for skipped cells. The cell text is not included. */
export function histogramSkipText(skipped: number): string {
  if (!Number.isFinite(skipped) || skipped <= 0) return "";
  const count = Math.floor(skipped);
  return count === 1 ? "1 value was not a number." : `${count} values were not a number.`;
}

/** Split finite numbers into `bins` equal widths. The last bin includes the highest value. */
export function histogramBins(values: readonly number[], bins = 4): HistogramResult {
  const numbers = values.filter((value) => Number.isFinite(value));
  const skipped = values.length - numbers.length;
  const count = Math.min(20, Math.max(1, Math.floor(Number.isFinite(bins) ? bins : 4)));
  if (!numbers.length) return { bins: [], skipped };
  const low = Math.min(...numbers);
  const high = Math.max(...numbers);
  if (low === high) {
    return {
      skipped,
      bins: [{ label: trim(low), count: numbers.length, low, high }],
    };
  }
  const width = (high - low) / count;
  const buckets = Array.from({ length: count }, (_, index) => ({
    low: low + index * width,
    high: index === count - 1 ? high : low + (index + 1) * width,
    count: 0,
  }));
  for (const value of numbers) {
    let index = Math.floor((value - low) / width);
    if (index < 0) index = 0;
    if (index >= count) index = count - 1;
    buckets[index].count += 1;
  }
  return {
    skipped,
    bins: buckets.map((bucket) => ({
      label: `${trim(bucket.low)}–${trim(bucket.high)}`,
      count: bucket.count,
      low: bucket.low,
      high: bucket.high,
    })),
  };
}
