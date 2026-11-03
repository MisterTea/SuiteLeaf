import { histogramColumn, histogramSkipText } from "@suiteleaf/core";
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from "recharts";

/** How many series cells were text. Empty cells are not counted. The text is not copied. */
export function stackedNote(cells: readonly unknown[]): string {
  return histogramSkipText(histogramColumn(cells).skipped);
}

/** Columns that sit on top of each other. Each series uses the same stack. */
export function StackedPreview({
  rows,
  keys,
  headers,
  colors,
  cells = [],
}: {
  rows: readonly Record<string, string | number | null>[];
  keys: readonly string[];
  headers: readonly unknown[];
  colors: readonly string[];
  cells?: readonly unknown[];
}) {
  const note = stackedNote(cells);
  return (
    <>
      {note ? <p>{note}</p> : null}
      <BarChart data={[...rows]}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="label" height={44} />
      <YAxis width={36} />
      <Tooltip />
      <Legend verticalAlign="top" />
      {keys.map((key, index) => (
        <Bar
          key={key}
          dataKey={key}
          name={String(headers[index + 1] ?? key)}
          stackId="stacked"
          fill={colors[index % colors.length]}
          isAnimationActive={false}
        />
      ))}
    </BarChart>
    </>
  );
}
