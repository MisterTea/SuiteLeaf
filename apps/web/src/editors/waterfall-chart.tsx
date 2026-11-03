import { Bar, BarChart, CartesianGrid, LabelList, Legend, Tooltip, XAxis, YAxis } from "recharts";
import { waterfallBarLabel, waterfallRows, waterfallSkipText, waterfallSteps } from "@suiteleaf/core";

/** Floating bars for a waterfall. The base is invisible so a fall hangs from the previous total. */
export function WaterfallPreview({
  rows,
}: {
  rows: readonly { label: string; change: unknown }[];
}) {
  const prepared = waterfallRows(rows);
  const result = waterfallSteps(prepared.rows);
  const note = waterfallSkipText(prepared.skipped);
  const data = result.steps.map((step) => ({
    label: step.label,
    base: Math.min(step.start, step.end),
    rise: step.kind === "rise" ? Math.abs(step.change) : 0,
    fall: step.kind === "fall" ? Math.abs(step.change) : 0,
    total: step.kind === "total" ? Math.abs(step.change) : 0,
    riseLabel: step.kind === "rise" ? waterfallBarLabel(step) : "",
    fallLabel: step.kind === "fall" ? waterfallBarLabel(step) : "",
    totalLabel: step.kind === "total" ? waterfallBarLabel(step) : "",
  }));
  return (
    <>
      {note ? <p>{note}</p> : null}
      <BarChart data={data}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="label" height={44} />
      <YAxis />
      <Tooltip />
      <Legend verticalAlign="top" />
      <Bar dataKey="base" stackId="waterfall" fill="transparent" legendType="none" name="" isAnimationActive={false} />
      <Bar dataKey="rise" stackId="waterfall" fill="#267C60" name="Rise" isAnimationActive={false}>
        <LabelList dataKey="riseLabel" position="top" />
      </Bar>
      <Bar dataKey="fall" stackId="waterfall" fill="#C0504D" name="Fall" isAnimationActive={false}>
        <LabelList dataKey="fallLabel" position="top" />
      </Bar>
      <Bar dataKey="total" stackId="waterfall" fill="#4F81BD" name="Total" isAnimationActive={false}>
        <LabelList dataKey="totalLabel" position="top" />
      </Bar>
    </BarChart>
    </>
  );
}
