import { numfmt } from "@univerjs/presets";
import type { ChartDefinition } from "@suiteleaf/core";
import type { CellValue } from "../analysis";
import { axisLimit, seriesAxis } from "./chart-axis";

export function ExcelLineChart({
  chart,
  series,
}: {
  chart: ChartDefinition;
  series: CellValue[][];
}) {
  if (chart.excel?.biff)
    return <BinaryLineChart chart={chart} series={series} />;
  const w = chart.width,
    h = chart.height;
  const count = Math.max(1, ...series.map((s) => s.length));
  const numeric = (values: CellValue[]) =>
    values.filter((value): value is number => typeof value === "number");
  const secondary = series.some(
    (_, index) => seriesAxis(chart.excel?.series[index]?.axis) === "secondary",
  );
  const primaryValues = secondary
    ? series.flatMap((values, index) =>
        seriesAxis(chart.excel?.series[index]?.axis) === "primary" ? numeric(values) : [],
      )
    : series.flatMap(numeric);
  const secondaryValues = series.flatMap((values, index) =>
    seriesAxis(chart.excel?.series[index]?.axis) === "secondary" ? numeric(values) : [],
  );
  const primaryLimit = axisLimit(primaryValues);
  const secondaryLimit = axisLimit(secondaryValues);
  const maximum = Math.max(0, ...primaryValues, 0);
  const step =
    Math.pow(10, Math.floor(Math.log10(maximum || 1))) * (maximum <= 20 ? 0.2 : 0.5);
  const top = 15,
    bottom = h - 34,
    left = 34,
    right = w - (chart.excel?.legend === "r" ? 128 : 20);
  const limit = primaryLimit;
  const px = (i: number) => left + ((right - left) * (i + 0.5)) / count;
  const py = (v: number, scale = limit) => bottom - ((bottom - top) * v) / scale;
  const ticks = Array.from(
    { length: Math.round(limit / step) + 1 },
    (_, i) => i * step,
  );
  return (
    <svg
      className="excel-line-chart"
      width="100%"
      height="100%"
      viewBox={`0 0 ${w} ${h}`}
      style={{
        background: "white",
        fontFamily: "Calibri",
        fontSize: 12,
      }}
      aria-label="Imported Excel line chart"
      data-secondary-axis={secondary ? "true" : "false"}
    >
      <rect
        x={0.5}
        y={0.5}
        width={w - 1}
        height={h - 1}
        fill="none"
        stroke="#808080"
      />
      {ticks.map((v) => (
        <g key={v}>
          <line x1={left} x2={right} y1={py(v)} y2={py(v)} stroke="#808080" />
          <text x={left - 12} y={py(v) + 4} textAnchor="end">
            {v}
          </text>
        </g>
      ))}
      <line x1={left} x2={left} y1={top} y2={bottom} stroke="#808080" />
      {Array.from({ length: count }, (_, i) => (
        <g key={i}>
          <line
            x1={px(i)}
            x2={px(i)}
            y1={bottom}
            y2={bottom + 5}
            stroke="#808080"
          />
          <text x={px(i)} y={bottom + 22} textAnchor="middle">
            {i + 1}
          </text>
        </g>
      ))}
      {secondary
        ? [0, secondaryLimit / 2, secondaryLimit].map((value) => (
            <text key={value} x={right + 8} y={py(value, secondaryLimit) + 4}>
              {value}
            </text>
          ))
        : null}
      {series.map((s, i) => {
        const color = chart.excel!.series[i].color;
        const scale =
          seriesAxis(chart.excel?.series[i]?.axis) === "secondary" ? secondaryLimit : limit;
        const points = s.flatMap((v, j) =>
          typeof v === "number" ? [{ x: px(j), y: py(v, scale) }] : [],
        );
        return (
          <g key={i}>
            <polyline
              fill="none"
              stroke={color}
              strokeWidth={3.3}
              points={points.map((p) => `${p.x},${p.y}`).join(" ")}
            />
            {chart.excel?.markers &&
              points.map((p, j) =>
                i % 2 ? (
                  <rect
                    key={j}
                    x={p.x - 5}
                    y={p.y - 5}
                    width={10}
                    height={10}
                    fill={color}
                  />
                ) : (
                  <path
                    key={j}
                    d={`M${p.x} ${p.y - 5}l5 5-5 5-5-5Z`}
                    fill={color}
                  />
                ),
              )}
            {chart.excel?.legend === "r" && (
              <g
                transform={`translate(${right + 20},${h / 2 + (i - (series.length - 1) / 2) * 24})`}
              >
                <line x2={27} stroke={color} strokeWidth={3.3} />
                {i % 2 ? (
                  <rect x={10} y={-4} width={8} height={8} fill={color} />
                ) : (
                  <path d="M14 -4l4 4-4 4-4-4Z" fill={color} />
                )}
                <text x={30} y={4}>
                  {chart.excel.series[i].name}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}
function BinaryLineChart({
  chart,
  series,
}: {
  chart: ChartDefinition;
  series: CellValue[][];
}) {
  const meta = chart.excel!.biff!,
    definitions = chart.excel!.series,
    w = chart.width,
    h = chart.height;
  const count = Math.max(
    1,
    meta.categories.length,
    ...series.map((s) => s.length),
  );
  const left = 140,
    right = w - 90,
    top = 70,
    bottom = h - (meta.dataTable ? (definitions.length + 1) * 19 + 18 : 72);
  const scales = meta.axes.map((axis, index) => {
    const values = series.flatMap((s, i) =>
      (definitions[i].axis ?? 0) === index
        ? s.filter((v): v is number => typeof v === "number")
        : [],
    );
    const peak = Math.max(0, ...values),
      unit = 10 ** Math.floor(Math.log10(peak || 1));
    return {
      min: axis.min ?? 0,
      max: axis.max ?? Math.ceil(peak / unit) * unit,
      step: axis.step ?? unit,
    };
  });
  const px = (i: number) => left + ((right - left) * (i + 0.5)) / count;
  const py = (v: number, axis: number) => {
    const s = scales[axis] ?? scales[0];
    return bottom - ((bottom - top) * (v - s.min)) / (s.max - s.min || 1);
  };
  const fmt = (value: CellValue, format: string | undefined) =>
    typeof value === "number"
      ? numfmt.format(format ?? "#,##0", value)
      : String(value ?? "");
  const marker = (
    x: number,
    y: number,
    color: string,
    kind: number,
    key: number,
  ) =>
    kind === 3 ? (
      <path key={key} d={`M${x} ${y - 4}l4 8h-8Z`} fill={color} />
    ) : kind === 8 ? (
      <circle key={key} cx={x} cy={y} r={4} fill={color} />
    ) : kind === 4 ? (
      <rect key={key} x={x - 3} y={y - 3} width={6} height={6} fill={color} />
    ) : kind ? (
      <path key={key} d={`M${x} ${y - 4}l4 4-4 4-4-4Z`} fill={color} />
    ) : null;
  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${w} ${h}`}
      aria-label={chart.title}
      style={{ background: "white", fontSize: 11, fontFamily: "sans-serif" }}
    >
      <rect
        x={0.5}
        y={0.5}
        width={w - 1}
        height={h - 1}
        fill="white"
        stroke="#808080"
      />
      <text
        x={w / 2}
        y={30}
        textAnchor="middle"
        fontSize={19}
        fontWeight="bold"
      >
        {chart.title}
      </text>
      {scales.map((s, axis) => {
        const format = definitions.find(
          (d) => (d.axis ?? 0) === axis,
        )?.numberFormat;
        const ticks = Array.from(
          {
            length: Math.min(
              40,
              Math.floor((s.max - s.min) / s.step + 0.001) + 1,
            ),
          },
          (_, i) => s.min + i * s.step,
        );
        return (
          <g key={axis}>
            <text
              x={axis ? right : left}
              y={52}
              textAnchor={axis ? "end" : "start"}
            >
              {meta.axisTitles[axis]}
            </text>
            <line
              x1={axis ? right : left}
              x2={axis ? right : left}
              y1={top}
              y2={bottom}
              stroke="#777"
            />
            {ticks.map((v, i) => (
              <g key={i}>
                {!axis && (
                  <line
                    x1={left}
                    x2={right}
                    y1={py(v, axis)}
                    y2={py(v, axis)}
                    stroke="#888"
                  />
                )}
                <text
                  x={axis ? right + 12 : left - 12}
                  y={py(v, axis) + 4}
                  textAnchor={axis ? "start" : "end"}
                >
                  {fmt(v, format)}
                </text>
              </g>
            ))}
          </g>
        );
      })}
      {series.map((s, i) => {
        const d = definitions[i],
          points = s.flatMap((v, j) =>
            typeof v === "number" ? [{ x: px(j), y: py(v, d.axis ?? 0) }] : [],
          );
        return (
          <g key={i}>
            <polyline
              fill="none"
              stroke={d.color}
              strokeWidth={2}
              points={points.map((p) => `${p.x},${p.y}`).join(" ")}
            />
            {points.map((p, j) => marker(p.x, p.y, d.color, d.marker ?? 0, j))}
          </g>
        );
      })}
      {Array.from({ length: count }, (_, i) => (
        <text key={i} x={px(i)} y={bottom + 15} textAnchor="middle">
          {meta.categories[i] ?? String(i + 1)}
        </text>
      ))}
      {meta.dataTable &&
        definitions.map((d, i) => (
          <g key={i}>
            <line
              x1={5}
              x2={right}
              y1={bottom + (i + 1) * 19}
              y2={bottom + (i + 1) * 19}
              stroke="#888"
            />
            <line
              x1={12}
              x2={35}
              y1={bottom + (i + 1) * 19 + 10}
              y2={bottom + (i + 1) * 19 + 10}
              stroke={d.color}
              strokeWidth={2}
            />
            <text x={40} y={bottom + (i + 1) * 19 + 14} fontSize={10}>
              {d.name}
            </text>
            {Array.from({ length: count }, (_, j) => (
              <g key={j}>
                <line
                  x1={left + ((right - left) * j) / count}
                  x2={left + ((right - left) * j) / count}
                  y1={bottom}
                  y2={bottom + (definitions.length + 1) * 19}
                  stroke="#888"
                />
                <text
                  x={px(j)}
                  y={bottom + (i + 1) * 19 + 14}
                  textAnchor="middle"
                  fontSize={10}
                >
                  {fmt(series[i]?.[j] ?? null, d.numberFormat)}
                </text>
              </g>
            ))}
          </g>
        ))}
      {!meta.dataTable &&
        definitions.map((d, i) => (
          <g
            key={i}
            transform={`translate(${left + (i % 3) * 290},${h - 40 + Math.floor(i / 3) * 15})`}
          >
            <line x2={20} stroke={d.color} strokeWidth={2} />
            <text x={26} y={4}>
              {d.name}
            </text>
          </g>
        ))}
      {meta.annotations.map((text, i) => {
        const chars = [...text],
          lines = Array.from({ length: Math.ceil(chars.length / 24) }, (_, j) =>
            chars.slice(j * 24, (j + 1) * 24).join(""),
          );
        const x = right - 260,
          y = top + 25 + i * 160;
        return (
          <g key={i}>
            <rect
              x={x - 6}
              y={y - 15}
              width={270}
              height={lines.length * 15 + 15}
              fill="white"
              stroke="#333"
            />
            <text x={x} y={y}>
              {lines.map((line, j) => (
                <tspan key={j} x={x} dy={j ? 15 : 0}>
                  {line}
                </tspan>
              ))}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
