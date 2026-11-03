import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { histogramBins, histogramColumn, histogramSkipText } from "@suiteleaf/core";

/** One bar per bin. The height is the count, not the original number. */
export function HistogramPreview({ cells, bins = 4 }: { cells: readonly unknown[]; bins?: number }) {
  const column = histogramColumn(cells);
  const result = histogramBins(column.values, bins);
  const note = histogramSkipText(column.skipped);
  return (
    <>
      {note ? <p>{note}</p> : null}
      <BarChart data={result.bins}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="label" height={44} />
      <YAxis allowDecimals={false} />
      <Tooltip />
      <Bar dataKey="count" fill="#4F81BD" name="Count" isAnimationActive={false} />
    </BarChart>
    </>
  );
}
