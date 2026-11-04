import { useSyncExternalStore } from "react";
import { numfmt } from "@univerjs/presets";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Cell,
} from "recharts";
import { waterfallSteps, type ChartDefinition } from "@suiteleaf/core";
import { valueTicks, type CellValue } from "../analysis";
import { WaterfallPreview } from "./waterfall-chart";
import { ComboPreview } from "./combo-chart";
import { StackedPreview } from "./stacked-chart";
import { HistogramPreview } from "./histogram-chart";
import { ExcelLineChart } from "./sheet-excel-line-chart";

export type ChartState = {
  definition: ChartDefinition;
  values: CellValue[][];
  numberFormats: string[];
  excelValues?: CellValue[][];
};
export const charts = new Map<string, ChartState>();
const emptyChart: ChartState | undefined = undefined;
export function EmbeddedChart({ data }: { data?: { chartId: string } }) {
  const id = data?.chartId ?? "";
  const state = useSyncExternalStore(
    (callback) => {
      const event = `chart:${id}`;
      window.addEventListener(event, callback);
      return () => window.removeEventListener(event, callback);
    },
    () => charts.get(id) ?? emptyChart,
  );
  if (!state) return <div>Loading chart…</div>;
  const { definition: c, values, numberFormats } = state;
  if (c.type === "line" && c.excel && !c.invalid)
    return <ExcelLineChart chart={c} series={state.excelValues ?? []} />;
  const formatValue = (value: unknown, column: number) =>
    numberFormats[column]
      ? numfmt.format(numberFormats[column], value)
      : String(value ?? "");
  const formatAxis = (value: number) => formatValue(value, 1);
  const formatTooltip = (
    value: unknown,
    _name: unknown,
    item: { dataKey?: unknown },
  ) => {
    const column =
      item.dataKey === "y"
        ? 1
        : Number(String(item.dataKey ?? "v0").slice(1)) + 1;
    return formatValue(value, column);
  };
  if (c.invalid)
    return (
      <div className="suiteleaf-chart" data-chart-id={c.id}>
        <strong>{c.title}</strong>
        <p>Source range unavailable. Edit this chart to select a new range.</p>
      </div>
    );
  const headers = values[0] ?? [],
    keys = headers.slice(1).map((_, i) => `v${i}`);
  const rows = values.slice(1).map((r) => ({
    label: String(r[0] ?? ""),
    ...Object.fromEntries(
      keys.map((k, i) => [k, typeof r[i + 1] === "number" ? r[i + 1] : null]),
    ),
  }));
  const colors = [
    "#4F81BD",
    "#C0504D",
    "#9BBB59",
    "#8064A2",
    "#4BACC6",
    "#F79646",
    "#2C4D75",
    "#267C60",
  ];
  const ticks = valueTicks(values.slice(1).flatMap((r) => r.slice(1)));
  const waterfall =
    c.type === "waterfall"
      ? waterfallSteps(
          values.slice(1).map((row) => ({
            label: String(row[0] ?? ""),
            change: typeof row[1] === "number" ? row[1] : 0,
          })),
        )
      : null;
  const valueAxis = {
    tickFormatter: formatAxis,
    ...(ticks && { ticks, domain: [ticks[0], ticks.at(-1)!] }),
    width: Math.max(
      36,
      12 + 7 * Math.max(0, ...(ticks ?? []).map((t) => formatAxis(t).length)),
    ),
  };
  return (
    <div
      className="suiteleaf-chart"
      aria-label={`Chart: ${c.title}${waterfall?.mismatch ? `. ${waterfall.mismatch}` : ""}`}
      data-chart-id={c.id}
    >
      <strong>{c.title}</strong>
      {waterfall?.mismatch ? <p>{waterfall.mismatch}</p> : null}
      <ResponsiveContainer width="100%" height="100%">
        {c.type === "pie" ? (
          <PieChart>
            <Pie
              data={rows}
              dataKey="v0"
              nameKey="label"
              isAnimationActive={false}
              label={({ value }: { value?: any }) => formatValue(value, 1)}
            >
              {rows.map((_, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={colors[index % colors.length]}
                />
              ))}
            </Pie>
            <Tooltip formatter={formatTooltip} />
          </PieChart>
        ) : c.type === "scatter" ? (
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              type="number"
              dataKey="x"
              name={String(headers[0] ?? "X")}
              tickFormatter={(v) => formatValue(v, 0)}
            />
            <YAxis
              type="number"
              dataKey="y"
              name={String(headers[1] ?? "Y")}
              tickFormatter={formatAxis}
            />
            <Tooltip formatter={formatTooltip} />
            <Scatter
              data={values
                .slice(1)
                .filter(
                  (r) => typeof r[0] === "number" && typeof r[1] === "number",
                )
                .map((r) => ({ x: r[0], y: r[1] }))}
              fill={colors[0]}
            />
          </ScatterChart>
        ) : c.type === "histogram" ? (
          <HistogramPreview cells={values.slice(1).map((row) => row[1])} />
        ) : c.type === "waterfall" ? (
          <WaterfallPreview
            rows={values.slice(1).map((row) => ({
              label: String(row[0] ?? ""),
              change: row[1],
            }))}
          />
        ) : c.type === "area" ? (
          <AreaChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" height={44} />
            <YAxis {...valueAxis} />
            <Tooltip formatter={formatTooltip} />
            <Legend verticalAlign="top" />
            {keys.map((k, i) => (
              <Area
                key={k}
                type="monotone"
                dataKey={k}
                name={String(headers[i + 1] ?? k)}
                stroke={colors[i % colors.length]}
                fill={colors[i % colors.length]}
                fillOpacity={0.25}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        ) : c.type === "combo" ? (
          <ComboPreview rows={rows} keys={keys} headers={headers} colors={colors} />
        ) : c.type === "stacked" ? (
          <StackedPreview
            rows={rows}
            keys={keys}
            headers={headers}
            colors={colors}
            cells={values.slice(1).flatMap((row) => row.slice(1))}
          />
        ) : c.type === "line" ? (
          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              label={{
                value: String(headers[0] ?? ""),
                position: "insideBottom",
                offset: 0,
              }}
              height={44}
            />
            <YAxis {...valueAxis} />
            <Tooltip formatter={formatTooltip} />
            <Legend
              itemSorter={null}
              verticalAlign="top"
              wrapperStyle={{ paddingBottom: 8 }}
            />
            {keys.map((k, i) => (
              <Line
                key={k}
                type="monotone"
                dataKey={k}
                name={String(headers[i + 1] ?? k)}
                stroke={colors[i % colors.length]}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        ) : (
          <BarChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="label"
              label={{
                value: String(headers[0] ?? ""),
                position: "insideBottom",
                offset: 0,
              }}
              height={44}
            />
            <YAxis {...valueAxis} />
            <Tooltip formatter={formatTooltip} />
            <Legend
              itemSorter={null}
              verticalAlign="top"
              wrapperStyle={{ paddingBottom: 8 }}
            />
            {keys.map((k, i) => (
              <Bar
                key={k}
                dataKey={k}
                name={String(headers[i + 1] ?? k)}
                fill={colors[i % colors.length]}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
