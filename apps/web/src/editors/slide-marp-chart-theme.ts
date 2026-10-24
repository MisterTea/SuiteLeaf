// Theme defaults compatible with ContextLab's MIT-licensed chart-defaults.js.
// Copyright (c) 2024 Contextual Dynamics Laboratory. See themes/CONTEXTLAB-LICENSE.txt.
import type { ChartDefinition } from "./slide-marp-charts";
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as ObjectValue)
    : {};
function merge(base: ObjectValue, overrides: ObjectValue): ObjectValue {
  const result = { ...base };
  for (const [key, value] of Object.entries(overrides))
    result[key] = Object.keys(object(value)).length
      ? merge(object(base[key]), object(value))
      : value;
  return result;
}
export function styledChartConfig(
  definition: ChartDefinition,
  host: HTMLElement,
): ObjectValue {
  const config = structuredClone(definition.config);
  if (!definition.themed) return config;
  const style = host.ownerDocument.defaultView!.getComputedStyle(
    host.closest("section") ?? host,
  );
  const variable = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;
  const font = variable("--chart-font-family", style.fontFamily);
  const color = variable("--text-primary", style.color);
  const palette = Array.from({ length: 12 }, (_, index) =>
    variable(`--chart-color-${index + 1}`, color),
  );
  const data = object(config.data);
  const type = String(config.type);
  const datasets = (Array.isArray(data.datasets) ? data.datasets : []).map(
    (item, index) => {
      const dataset = object(item),
        base = palette[index % palette.length];
      const pointColors = Array.from(
        { length: Array.isArray(dataset.data) ? dataset.data.length : 0 },
        (_, i) => palette[i % palette.length],
      );
      const alpha = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(base);
      const translucent = alpha
        ? `rgba(${parseInt(alpha[1], 16)},${parseInt(alpha[2], 16)},${parseInt(alpha[3], 16)},0.1)`
        : base;
      const defaults = ["pie", "doughnut", "polarArea"].includes(type)
        ? {
            backgroundColor: pointColors,
            borderColor: "#d8d8d8",
            borderWidth: 2,
          }
        : type === "line"
          ? {
              borderColor: base,
              backgroundColor: translucent,
              borderWidth: 3,
              pointRadius: 6,
              pointBackgroundColor: base,
              tension: 0.3,
            }
          : type === "scatter" || type === "bubble"
            ? {
                backgroundColor: base,
                borderColor: base,
                pointRadius: 15,
                pointHoverRadius: 18,
              }
            : { backgroundColor: base, borderColor: base, borderWidth: 2 };
      return { ...defaults, ...dataset };
    },
  );
  const scale = {
    grid: {
      color: variable("--chart-grid-light", "rgba(0,105,62,.1)"),
      lineWidth: 1,
    },
    border: {
      color: variable("--chart-grid-dark", "rgba(0,105,62,.2)"),
      width: 1,
    },
    ticks: { font: { family: font, size: 16 }, color },
    title: { font: { family: font, size: 18, weight: 400 }, color },
  };
  const radial = ["pie", "doughnut", "polarArea", "radar"].includes(type);
  const options: ObjectValue = {
    maintainAspectRatio: false,
    color,
    font: { family: font, size: 16 },
    plugins: {
      colors: { enabled: false },
      legend: {
        ...(radial ? { position: "right" } : {}),
        labels: {
          font: { family: font, size: 16, weight: 400 },
          color,
          usePointStyle: true,
          padding: radial ? 15 : 20,
        },
      },
      title: { color, font: { family: font, size: 22, weight: 500 } },
    },
    ...(radial
      ? {}
      : {
          scales: {
            x: merge(scale, type === "bar" ? { grid: { display: false } } : {}),
            y: scale,
          },
        }),
  };
  return {
    ...config,
    data: { ...data, datasets },
    options: merge(options, object(config.options)),
  };
}
