import { Bar, CartesianGrid, ComposedChart, Legend, Line, Tooltip, XAxis, YAxis } from "recharts";

/** Columns for every series except the last, which is a line on the right axis. */
export function ComboPreview({
  rows,
  keys,
  headers,
  colors,
}: {
  rows: readonly Record<string, string | number | null>[];
  keys: readonly string[];
  headers: readonly unknown[];
  colors: readonly string[];
}) {
  return (
    <ComposedChart data={[...rows]}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="label" height={44} />
      <YAxis yAxisId="left" orientation="left" width={36} />
      {keys.length > 1 ? <YAxis yAxisId="right" orientation="right" width={36} /> : null}
      <Tooltip />
      <Legend verticalAlign="top" />
      {keys.map((key, index) => {
        const line = keys.length > 1 && index === keys.length - 1;
        const color = colors[index % colors.length];
        const name = String(headers[index + 1] ?? key);
        return line ? (
          <Line
            key={key}
            yAxisId="right"
            type="monotone"
            dataKey={key}
            name={name}
            stroke={color}
            dot={false}
            isAnimationActive={false}
          />
        ) : (
          <Bar
            key={key}
            yAxisId="left"
            dataKey={key}
            name={name}
            fill={color}
            isAnimationActive={false}
          />
        );
      })}
    </ComposedChart>
  );
}
