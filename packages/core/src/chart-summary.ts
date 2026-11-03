/** Enough of a chart to describe it without the painted picture or the cell values. */
export type ChartSummaryInput = {
  title: string;
  type: string;
  invalid?: boolean;
  series?: { name: string; axis?: number }[];
  categories?: string[];
  legend?: string;
};

const TYPE_NAMES: Record<string, string> = {
  bar: "Bar chart",
  line: "Line chart",
  pie: "Pie chart",
  scatter: "Scatter chart",
  waterfall: "Waterfall chart",
  histogram: "Histogram",
  area: "Area chart",
  combo: "Combo chart",
  stacked: "Stacked chart",
};

function join(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/** A sentence a reader can use when the chart picture is not available. */
export function chartSummary(chart: ChartSummaryInput): string {
  const kind = TYPE_NAMES[chart.type] ?? "Chart";
  const title = chart.title.trim() || "Untitled chart";
  const series = (chart.series ?? []).map((item) => item.name.trim()).filter(Boolean);
  const categories = (chart.categories ?? []).map((item) => item.trim()).filter(Boolean);
  const right = (chart.series ?? [])
    .filter((item) => item.axis === 2 && item.name.trim())
    .map((item) => item.name.trim());
  const parts = [`${kind} ${title}.`];
  if (chart.invalid) parts.push("This chart is marked invalid.");
  parts.push(series.length ? `Series ${join(series)}.` : "No series names.");
  if (categories.length) parts.push(`Categories ${join(categories)}.`);
  if (right.length) parts.push(`Right axis ${join(right)}.`);
  const legend = chart.legend?.trim();
  if (legend) parts.push(`Legend ${legend}.`);
  return parts.join(" ");
}

/**
 * Put the last combo series on the right axis when no series already uses it.
 * The input list is not changed, and cell values are not read.
 */
export function assignComboAxes<T extends { name: string; axis?: number }>(
  series: readonly T[],
): T[] {
  const copy = series.map((item) => ({ ...item }));
  if (copy.length < 2 || copy.some((item) => item.axis === 2)) return copy;
  return copy.map((item, index) => ({
    ...item,
    axis: index === copy.length - 1 ? 2 : 1,
  }));
}

/** Value headers for a combo chart. The first header is the category, not a series. */
export function seriesFromHeaders(headers: readonly string[]): { name: string; axis: number }[] {
  const names = headers.slice(1).map((header, index) => header.trim() || `Series ${index + 1}`);
  return assignComboAxes(names.map((name) => ({ name }))).map((item) => ({
    name: item.name,
    axis: item.axis ?? 1,
  }));
}
