import type { SheetFile } from "@suiteleaf/core";
import type { LinkedChartAttrs } from "@suiteleaf/core/linked-chart";

export {
  chartCaption,
  chartPlainLines,
  linkedChartAttrs,
  linkedChartDom,
  linkedChartHtml,
  missingSpreadsheetText,
  type LinkedChartAttrs,
} from "@suiteleaf/core/linked-chart";

/** Shown when the first sheet has a header but no row with a label and a number. */
export const noDataRowsText = "There are no data rows to chart.";

/** Univer cell types. A string that only looks like a number stays text. */
const STRING = 1;
const NUMBER = 2;
const BOOLEAN = 3;
const FORCE_STRING = 4;

export type SheetChart =
  | { ok: true; labels: string[]; values: number[] }
  | { ok: false; error: string };

interface ParsedCell {
  kind: "text" | "number";
  text: string;
  value?: number;
}

/** Accessible name for the button on the chart. */
export function updateChartName(title: string): string {
  return `Update chart from ${title.trim() || "spreadsheet"}`;
}

/**
 * Bar length as a percentage of the largest value. Zero and negative values
 * draw no bar. The largest positive value fills the track.
 */
export function barWidthPercent(
  value: number,
  values: readonly number[],
): number {
  const max = values.reduce((best, item) => (item > best ? item : best), 0);
  if (max <= 0 || value <= 0) return 0;
  return (value / max) * 100;
}

/**
 * A library spreadsheet Update can read. Trash and any other kind count as
 * gone. A SuiteDrive link is still this computer's copy of the file.
 */
export function sheetFromLibrary(
  record:
    | { trashedAt?: string; file: { kind: string } }
    | null
    | undefined,
): SheetFile | null {
  if (!record || record.trashedAt || record.file.kind !== "sheet") return null;
  return record.file as SheetFile;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^-?(?:\d+|\d+\.\d+)$/.test(trimmed)) return null;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
}

function cellText(record: Record<string, unknown>): string {
  if (typeof record.v === "string" && record.v.trim())
    return record.v.replace(/\r?\n/g, "").trim();
  const paragraph = record.p;
  if (!paragraph || typeof paragraph !== "object") return "";
  const stream = (paragraph as { body?: { dataStream?: unknown } }).body
    ?.dataStream;
  return typeof stream === "string" ? stream.replace(/\r?\n/g, "").trim() : "";
}

function parseCell(cell: unknown): ParsedCell | null {
  if (!cell || typeof cell !== "object" || Array.isArray(cell)) return null;
  const record = cell as Record<string, unknown>;
  const type = typeof record.t === "number" ? record.t : null;
  if (type === BOOLEAN || typeof record.v === "boolean") return null;
  const numeric =
    type === NUMBER ||
    (type !== STRING && type !== FORCE_STRING && typeof record.v === "number");
  if (numeric) {
    const value = finiteNumber(record.v);
    if (value === null) return null;
    return { kind: "number", text: String(value), value };
  }
  const text = cellText(record);
  if (!text) return null;
  return { kind: "text", text };
}

function readRow(row: unknown): (ParsedCell | null)[] {
  if (!row || typeof row !== "object" || Array.isArray(row)) return [];
  const record = row as Record<string, unknown>;
  const columns = Object.keys(record)
    .filter((key) => /^\d+$/.test(key))
    .map(Number);
  if (!columns.length) return [];
  const width = Math.max(...columns) + 1;
  return Array.from({ length: width }, (_, column) =>
    parseCell(record[String(column)]),
  );
}

/**
 * The label is the first text cell, or the first column when the row has no
 * text. The value is the first numeric cell. A row needs both.
 */
function rowPoint(
  cells: readonly (ParsedCell | null)[],
): { label: string; value: number } | null {
  let label = "";
  let value: number | null = null;
  for (const cell of cells) {
    if (!cell) continue;
    if (!label && cell.kind === "text") label = cell.text;
    if (value === null && cell.kind === "number" && cell.value !== undefined)
      value = cell.value;
  }
  if (!label && cells[0]?.text) label = cells[0].text;
  if (!label || value === null) return null;
  return { label, value };
}

/**
 * Bars from the first worksheet. The first non-empty row is the header.
 * Later rows contribute one label and one number. No chart object is required.
 */
export function chartFromSheet(file: SheetFile): SheetChart {
  const id = file.content.workbook.sheetOrder[0];
  const sheet = id ? file.content.workbook.sheets[id] : undefined;
  const data = sheet?.cellData;
  if (!data || typeof data !== "object" || Array.isArray(data))
    return { ok: false, error: noDataRowsText };
  const indexes = Object.keys(data)
    .filter((key) => /^\d+$/.test(key))
    .map(Number)
    .sort((a, b) => a - b);
  let headerAt = -1;
  for (const index of indexes) {
    if (readRow(data[String(index)]).some(Boolean)) {
      headerAt = index;
      break;
    }
  }
  if (headerAt < 0) return { ok: false, error: noDataRowsText };
  const last = indexes[indexes.length - 1] ?? headerAt;
  const labels: string[] = [];
  const values: number[] = [];
  for (let row = headerAt + 1; row <= last; row++) {
    const point = rowPoint(readRow(data[String(row)]));
    if (!point) continue;
    labels.push(point.label);
    values.push(point.value);
  }
  if (!labels.length) return { ok: false, error: noDataRowsText };
  return { ok: true, labels, values };
}

/**
 * Re-read a spreadsheet into a chart. A missing file keeps the last bars and
 * marks the chart missing. A file with no data rows keeps the last bars too.
 */
export function applyChartUpdate(
  current: LinkedChartAttrs,
  sheet: SheetFile | null,
): { attrs: LinkedChartAttrs; error?: string } {
  const kept: LinkedChartAttrs = {
    ...current,
    labels: [...current.labels],
    values: [...current.values],
  };
  if (!sheet) return { attrs: { ...kept, missing: true } };
  const read = chartFromSheet(sheet);
  if (!read.ok) return { attrs: { ...kept, missing: false }, error: read.error };
  return {
    attrs: {
      sourceId: current.sourceId,
      sourceTitle: sheet.title,
      labels: read.labels,
      values: read.values,
      missing: false,
    },
  };
}
