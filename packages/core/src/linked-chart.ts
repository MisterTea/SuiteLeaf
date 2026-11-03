/** Shown under the bars. The source name stays even after the file is gone. */
export const missingSpreadsheetText = "The spreadsheet is missing.";

/** Shown instead of the bars when this viewer cannot open the source. */
export const withheldChartText =
  "You cannot view this spreadsheet. The bars are not included.";

export interface LinkedChartAttrs {
  sourceId: string;
  sourceTitle: string;
  labels: string[];
  values: number[];
  missing: boolean;
  withheld?: boolean;
  /** When the copied values were taken. Empty when that time was not stored. */
  snapshotAt: string;
}

/** "From Plot fees" — the file name, not a hidden link. */
export function chartCaption(title: string): string {
  return `From ${title.trim() || "spreadsheet"}`;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^-?(?:\d+|\d+\.\d+)$/.test(trimmed)) return null;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
}

export function linkedChartAttrs(
  raw: Record<string, unknown> | null | undefined,
): LinkedChartAttrs {
  const labels: string[] = [];
  const values: number[] = [];
  const rawLabels = Array.isArray(raw?.labels) ? raw.labels : [];
  const rawValues = Array.isArray(raw?.values) ? raw.values : [];
  const count = Math.min(rawLabels.length, rawValues.length);
  for (let index = 0; index < count; index++) {
    const label = String(rawLabels[index] ?? "").trim();
    const value = finiteNumber(rawValues[index]);
    if (!label || value === null) continue;
    labels.push(label);
    values.push(value);
  }
  return {
    sourceId: typeof raw?.sourceId === "string" ? raw.sourceId : "",
    sourceTitle: typeof raw?.sourceTitle === "string" ? raw.sourceTitle : "",
    labels,
    values,
    missing: raw?.missing === true,
    withheld: false,
    snapshotAt: snapshotTime(raw?.snapshotAt),
  };
}

const SNAPSHOT_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function snapshotTime(value: unknown): string {
  return typeof value === "string" && SNAPSHOT_TIME.test(value) ? value : "";
}

/** Names the copied spreadsheet. The source id is not included. */
export function chartProvenance(title: string, snapshotAt: string): string {
  const name = title.trim() || "spreadsheet";
  const when = snapshotTime(snapshotAt)
    ? ` Taken ${snapshotTime(snapshotAt)}.`
    : " The time of this copy was not recorded.";
  return `Snapshot of ${name}.${when} These values are a copy, not a live link.`;
}

/**
 * A viewer who cannot open the source gets the file name and no bars.
 * The source id, labels, and values are left out. The input is not changed.
 */
export function chartForViewer(
  raw: Record<string, unknown> | null | undefined,
  allowed: boolean,
): LinkedChartAttrs {
  const chart = linkedChartAttrs(raw);
  if (allowed) return chart;
  return {
    sourceId: "",
    sourceTitle: chart.sourceTitle,
    labels: [],
    values: [],
    missing: false,
    withheld: true,
    snapshotAt: chart.snapshotAt,
  };
}

/** Lines for a plain-text copy of the chart: the source, then each bar. */
export function chartPlainLines(
  raw: Record<string, unknown> | null | undefined,
  allowed = true,
): string[] {
  const chart = chartForViewer(raw, allowed);
  const lines = [
    chartCaption(chart.sourceTitle),
    chartProvenance(chart.sourceTitle, chart.snapshotAt),
    ...chart.labels.map(
      (label, index) => `${label}\t${chart.values[index]}`,
    ),
  ];
  if (chart.withheld) lines.push(withheldChartText);
  if (chart.missing) lines.push(missingSpreadsheetText);
  return lines;
}

/** A DOM spec for the chart: source paragraph, then a two-column table. */
export type ChartDomSpec =
  | string
  | [string, Record<string, string>, ...ChartDomSpec[]];

export function linkedChartDom(
  raw: Record<string, unknown> | null | undefined,
  allowed = true,
): [string, Record<string, string>, ...ChartDomSpec[]] {
  const chart = chartForViewer(raw, allowed);
  const children: ChartDomSpec[] = [
    ["p", { class: "linked-chart-source" }, chartCaption(chart.sourceTitle)],
    [
      "p",
      { class: "linked-chart-provenance" },
      chartProvenance(chart.sourceTitle, chart.snapshotAt),
    ],
  ];
  if (chart.labels.length)
    children.push([
      "table",
      { class: "linked-chart-table" },
      ...chart.labels.map(
        (label, index): ChartDomSpec => [
          "tr",
          {},
          ["td", {}, label],
          ["td", {}, String(chart.values[index])],
        ],
      ),
    ]);
  if (chart.withheld)
    children.push(["p", { class: "linked-chart-withheld" }, withheldChartText]);
  if (chart.missing)
    children.push([
      "p",
      { class: "linked-chart-missing" },
      missingSpreadsheetText,
    ]);
  return [
    "div",
    {
      class: "linked-chart",
      "data-linked-chart": "true",
      "data-source-id": chart.sourceId,
      "data-source-title": chart.sourceTitle,
      "data-labels": JSON.stringify(chart.labels),
      "data-values": JSON.stringify(chart.values),
      "data-missing": chart.missing ? "true" : "false",
      "data-withheld": chart.withheld ? "true" : "false",
      "data-snapshot-at": chart.snapshotAt,
    },
    ...children,
  ];
}

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );

function specToHtml(spec: ChartDomSpec): string {
  if (typeof spec === "string") return escapeHtml(spec);
  const [tag, attrs, ...children] = spec;
  const attributes = Object.entries(attrs)
    .map(([key, value]) => ` ${key}="${escapeHtml(value)}"`)
    .join("");
  return `<${tag}${attributes}>${children.map(specToHtml).join("")}</${tag}>`;
}

/** The same tree HTML export writes for a linked chart. */
export function linkedChartHtml(
  raw: Record<string, unknown> | null | undefined,
  allowed = true,
): string {
  return specToHtml(linkedChartDom(raw, allowed));
}
