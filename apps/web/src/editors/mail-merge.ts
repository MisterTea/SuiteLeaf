import type { JsonNode } from "@suiteleaf/core";
import { documentPdf } from "@suiteleaf/core/doc-pdf";
import { plainMergeNumber, sameWritten } from "./mail-merge-match";

export type MailMergeResult =
  { ok: true; content: JsonNode } | { ok: false; missing: string[] };

const placeholder = () => /\{\{\s*([^{}|]+?)\s*(?:\|\s*([^{}|]+?)\s*)?\}\}/g;

/** The document proofing language, as a locale for dates and numbers. */
export function mergeLocale(language: string | undefined): string {
  if (language === "de") return "de-DE";
  if (language === "en" || !language) return "en-US";
  return language;
}

/** Format a merge value for a locale. An unknown format or a value that is not that kind stays as written. */
export function formatMergeField(value: string, format: string | undefined, locale: string): string {
  if (format === "date") {
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/.exec(
      value.trim(),
    );
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      const hour = match[4] === undefined ? 0 : Number(match[4]);
      const minute = match[5] === undefined ? 0 : Number(match[5]);
      const second = match[6] === undefined ? 0 : Number(match[6]);
      const zone = match[7];
      const zoneHour = zone && zone !== "Z" ? Number(zone.slice(1, 3)) : 0;
      const zoneMinute = zone && zone !== "Z" ? Number(zone.slice(4, 6)) : 0;
      const clock =
        hour <= 23 && minute <= 59 && second <= 59 && zoneHour <= 23 && zoneMinute <= 59;
      const date = new Date(Date.UTC(year, month - 1, day));
      if (
        clock &&
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
      ) {
        return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(date);
      }
    }
  }
  if (format === "number") {
    const parsed = plainMergeNumber(value);
    if (parsed !== null) return new Intl.NumberFormat(locale).format(parsed);
  }
  if (format?.startsWith("currency:")) {
    const code = format.slice("currency:".length).trim().toUpperCase();
    const parsed = plainMergeNumber(value);
    if (!/^[A-Z]{3}$/.test(code) || parsed === null) return value;
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency: code }).format(parsed);
    } catch {
      return value;
    }
  }
  return value;
}

/** Column names written as `{{Header}}` in text nodes, in reading order. */
export function placeholderNames(node: JsonNode): string[] {
  const names: string[] = [];
  const add = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === "." || trimmed === "else" || trimmed.startsWith("#") || trimmed.startsWith("/")) return;
    if (!names.includes(trimmed)) names.push(trimmed);
  };
  const visit = (current: JsonNode) => {
    if (current.type === "text" && current.text) {
      for (const match of current.text.matchAll(/\{\{#each\s+([^{}]+?)\s*\}\}/g)) add(match[1]);
      for (const match of current.text.matchAll(/\{\{#(?!each\b)\s*([^{}]+?)\s*\}\}/g)) {
        add(conditionColumn(match[1]));
      }
      for (const match of current.text.matchAll(placeholder())) add(match[1]);
    }
    current.content?.forEach(visit);
  };
  visit(node);
  return names;
}

function withoutMergeBlocks(text: string): string {
  const repeated = text.replace(/\{\{#each\s+[^{}]+?\s*\}\}[\s\S]*?\{\{\/each\}\}/g, "");
  return repeated.replace(/\{\{#\s*[^{}]+?\s*\}\}[\s\S]*?\{\{\/\s*[^{}]+?\s*\}\}/g, "");
}

/** Placeholders outside a conditional or repeated block. A blank in those is an error. */
export function requiredPlaceholderNames(node: JsonNode): string[] {
  const names: string[] = [];
  const visit = (current: JsonNode) => {
    if (current.type === "text" && current.text) {
      for (const match of withoutMergeBlocks(current.text).matchAll(placeholder())) {
        const trimmed = match[1].trim();
        if (trimmed && trimmed !== "." && trimmed !== "else" && !names.includes(trimmed)) names.push(trimmed);
      }
    }
    current.content?.forEach(visit);
  };
  visit(node);
  return names;
}

function fill(template: JsonNode, values: Map<string, string>, locale: string): JsonNode {
  const copy = structuredClone(template);
  const visit = (node: JsonNode) => {
    if (node.type === "text" && typeof node.text === "string") {
      node.text = applyMergeBlocks(node.text, values);
      node.text = node.text.replace(placeholder(), (_, name: string, format?: string) =>
        formatMergeField(values.get(headerName(name)) ?? "", format?.trim(), locale),
      );
    }
    if (!node.content) return;
    const next: JsonNode[] = [];
    for (const child of node.content) {
      visit(child);
      if (child.type === "text" && !child.text) continue;
      next.push(child);
    }
    if (next.length) node.content = next;
    else delete node.content;
  };
  visit(copy);
  return copy;
}

function applyMergeBlocks(text: string, values: Map<string, string>): string {
  const repeated = text.replace(
    /\{\{#each\s+([^{}]+?)\s*\}\}([\s\S]*?)\{\{\/each\}\}/g,
    (_, name: string, body: string) =>
      (values.get(headerName(name)) ?? "")
        .split(";")
        .map((part) => part.trim())
        .filter((part) => part !== "")
        .map((part) => body.replaceAll("{{.}}", part))
        .join(""),
  );
  return repeated.replace(
    /\{\{#\s*([^{}]+?)\s*\}\}([\s\S]*?)\{\{\/\s*([^{}]+?)\s*\}\}/g,
    (whole: string, raw: string, body: string, end: string) => {
      const column = conditionColumn(raw);
      if (!column || headerName(end) !== headerName(column)) return whole;
      const unequal = raw.indexOf("!=");
      const equal = raw.indexOf("==");
      const negate = unequal >= 0 && (equal < 0 || unequal < equal);
      const expected = negate
        ? raw.slice(unequal + 2).trim()
        : equal >= 0
          ? raw.slice(equal + 2).trim()
          : null;
      const actual = (values.get(headerName(column)) ?? "").trim();
      const matched = expected == null ? actual !== "" : sameWritten(actual, expected);
      const yes = negate ? !matched : matched;
      const splitAt = body.indexOf("{{else}}");
      const whenSet = splitAt < 0 ? body : body.slice(0, splitAt);
      const whenEmpty = splitAt < 0 ? "" : body.slice(splitAt + "{{else}}".length);
      return yes ? whenSet : whenEmpty;
    },
  );
}

function emptyRow(row: string[]): boolean {
  return row.every((cell) => cell.trim() === "");
}

/**
 * One copy of the template per data row. A name that is not a header is an
 * error, and then no document is produced. The template is not changed.
 */
function conditionColumn(raw: string): string {
  const unequal = raw.indexOf("!=");
  const equal = raw.indexOf("==");
  if (unequal >= 0 && (equal < 0 || unequal < equal)) return raw.slice(0, unequal).trim();
  if (equal >= 0) return raw.slice(0, equal).trim();
  return raw.trim();
}

function headerName(header: string): string {
  return header.trim().toLocaleLowerCase("en");
}

function rowValues(headers: string[], row: string[]): Map<string, string> {
  const values = new Map<string, string>();
  headers.forEach((header, index) => {
    const name = headerName(header);
    if (name && !values.has(name)) values.set(name, row[index] ?? "");
  });
  return values;
}

export function mergeLetters(
  template: JsonNode,
  headers: string[],
  rows: string[][],
  locale = "en",
): MailMergeResult {
  const known = new Set(headers.map(headerName).filter((header) => header !== ""));
  const missing = placeholderNames(template).filter((name) => !known.has(headerName(name)));
  if (missing.length) return { ok: false, missing };

  const sections: JsonNode[] = [];
  for (const row of rows) {
    if (emptyRow(row)) continue;
    const values = rowValues(headers, row);
    if (sections.length) sections.push({ type: "pageBreak" });
    sections.push(...(fill(template, values, locale).content ?? []));
  }
  const content = structuredClone(template);
  content.content = sections.length ? sections : [{ type: "paragraph" }];
  return { ok: true, content };
}

/** Prefer a column named Name. Otherwise the first header that has text. */
export function nameColumn(headers: string[]): string | undefined {
  const named = headers.find((header) => header.trim().toLowerCase() === "name");
  if (named) return named;
  return headers.find((header) => header.trim() !== "");
}

/** The first problems, so the dialog can show them before writing files. */
const SECRET_FIELD = /password|secret|token|authorization|api[-_]?key|credential/i;

export function mergeIssueText(issues: MergeIssue[]): string {
  const lines = issues.slice(0, 5).map((issue) => {
    const hidden = SECRET_FIELD.test(issue.field);
    if (issue.reason === "missing-column") {
      return hidden ? "That name is not a column." : `${issue.field} is not a column.`;
    }
    const where = mergeCell(issue) ? ` Cell ${mergeCell(issue)}.` : "";
    return hidden ? `Row ${issue.row} has an empty cell.${where}` : `Row ${issue.row} has no ${issue.field}.${where}`;
  });
  if (issues.length > 5) lines.push(`${issues.length - 5} more.`);
  return lines.join(" ");
}

/** A letter name with path pieces removed. The remaining words stay. */
export function mergeFileName(raw: string): string {
  const cleaned = raw
    .replace(/[\\/]+/g, " ")
    .replace(/\.\./g, " ")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || "Letter";
}

export function letterTitle(sourceTitle: string, name: string): string {
  const base = mergeFileName(sourceTitle) === "Letter" && !sourceTitle.trim()
    ? "Untitled document"
    : sourceTitle.trim() || "Untitled document";
  const title = `${base} — ${mergeFileName(name)}`;
  return title.length <= 200 ? title : title.slice(0, 200);
}

export function missingColumnMessage(missing: string[]): string {
  if (missing.length === 0) return "A placeholder is not a column.";
  if (missing.length === 1) return `${missing[0]} is not a column.`;
  const last = missing[missing.length - 1];
  return `${missing.slice(0, -1).join(", ")} and ${last} are not columns.`;
}

export type MergeIssue = {
  /** 1-based data row. `0` means the template, not one row. */
  row: number;
  field: string;
  reason: "missing-column" | "blank";
  /** 0-based header column. Set when the blank cell is in the sheet. */
  column?: number;
};

function columnLetters(index: number): string {
  let n = index;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letters;
}

/** The sheet cell for a blank data row. The header is the row above that data. */
export function mergeCell(issue: MergeIssue): string | null {
  if (issue.reason !== "blank" || issue.column == null || issue.column < 0) return null;
  return `${columnLetters(issue.column)}${issue.row + 1}`;
}

export type MergeLetter = { name: string; content: JsonNode };

/** Problems to show before any letter is written. An empty cell is blank. */
export function previewMerge(
  template: JsonNode,
  headers: string[],
  rows: string[][],
): MergeIssue[] {
  const known = new Set(headers.map(headerName).filter((header) => header !== ""));
  const names = placeholderNames(template);
  const required = new Set(requiredPlaceholderNames(template));
  const issues: MergeIssue[] = names
    .filter((name) => !known.has(headerName(name)))
    .map((field) => ({ row: 0, field, reason: "missing-column" as const }));
  const needed = names.filter((name) => known.has(headerName(name)) && required.has(name));
  rows.forEach((row, index) => {
    if (emptyRow(row)) return;
    const values = rowValues(headers, row);
    for (const field of needed) {
      if (!(values.get(headerName(field)) ?? "").trim()) {
        issues.push({
          row: index + 1,
          field,
          reason: "blank",
          column: headers.findIndex((header) => headerName(header) === headerName(field)),
        });
      }
    }
  });
  return issues;
}

function letterName(raw: string, seen: Map<string, number>): string {
  const base = mergeFileName(raw);
  const key = base.toLocaleLowerCase("en");
  const count = (seen.get(key) ?? 0) + 1;
  seen.set(key, count);
  return count === 1 ? base : `${base} ${count}`;
}

/**
 * One document per data row, named from `nameField` when that column has text.
 * Any preview issue returns no documents. The template is not changed.
 */
export function mergeBatch(
  template: JsonNode,
  headers: string[],
  rows: string[][],
  nameField?: string,
  locale = "en",
): { ok: false; issues: MergeIssue[] } | { ok: true; letters: MergeLetter[] } {
  const issues = previewMerge(template, headers, rows);
  if (issues.length) return { ok: false, issues };
  const seen = new Map<string, number>();
  const letters: MergeLetter[] = [];
  for (const row of rows) {
    if (emptyRow(row)) continue;
    const values = rowValues(headers, row);
    const raw = nameField ? (values.get(headerName(nameField)) ?? "") : "";
    letters.push({
      name: letterName(raw, seen),
      content: fill(template, values, locale),
    });
  }
  return { ok: true, letters };
}

/**
 * The same letters as `mergeBatch`, each as a text PDF.
 * A preview problem returns no files. The template is not changed.
 * This is not a print of the page and it is not a PDF/UA file.
 */
export function mergePdfBatch(
  template: JsonNode,
  headers: string[],
  rows: string[][],
  nameField?: string,
  locale = "en",
): { ok: false; issues: MergeIssue[] } | { ok: true; files: { name: string; pdf: Uint8Array }[] } {
  const batch = mergeBatch(template, headers, rows, nameField, locale);
  if (!batch.ok) return batch;
  return {
    ok: true,
    files: batch.letters.map((letter) => ({
      name: letter.name,
      pdf: documentPdf(letter.content),
    })),
  };
}

export function mergedDocumentTitle(sourceTitle: string): string {
  const base = sourceTitle.trim() || "Untitled document";
  const title = `${base} merged`;
  return title.length <= 200 ? title : title.slice(0, 200);
}

function primitive(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return null;
}

/** The text a cell shows: a stored display, otherwise `v`, otherwise rich text. */
export function cellDisplay(cell: unknown): string {
  if (!cell || typeof cell !== "object") return "";
  const record = cell as Record<string, unknown>;
  for (const key of ["display", "m", "v"]) {
    const text = primitive(record[key]);
    if (text !== null && text !== "") return text;
  }
  const stream = (record.p as { body?: { dataStream?: unknown } } | undefined)
    ?.body?.dataStream;
  return typeof stream === "string" ? stream.replace(/\r?\n/g, "") : "";
}

function rowCells(row: Record<string, unknown> | null | undefined): string[] {
  if (!row) return [];
  const cols = Object.keys(row)
    .filter((key) => /^\d+$/.test(key))
    .map(Number);
  if (!cols.length) return [];
  const width = Math.max(...cols) + 1;
  return Array.from({ length: width }, (_, col) =>
    cellDisplay(row[String(col)]).trim(),
  );
}

/**
 * Headers are the first non-empty row of the first sheet. Later rows are
 * data, including blank ones so the merge can skip them.
 */
export function sheetTable(workbook: {
  sheetOrder: readonly string[];
  sheets: Readonly<
    Record<
      string,
      | { cellData?: Record<string, Record<string, unknown> | null> | null }
      | null
      | undefined
    >
  >;
}): { headers: string[]; rows: string[][] } {
  const sheet = workbook.sheets[workbook.sheetOrder[0] ?? ""];
  const data = sheet?.cellData ?? {};
  const indexes = Object.keys(data)
    .filter((key) => /^\d+$/.test(key))
    .map(Number)
    .sort((a, b) => a - b);
  const read = (row: number) => rowCells(data[String(row)] ?? undefined);
  let headerAt = -1;
  let headers: string[] = [];
  for (const row of indexes) {
    const values = read(row);
    if (values.some((value) => value !== "")) {
      headerAt = row;
      headers = values;
      break;
    }
  }
  if (headerAt < 0) return { headers: [], rows: [] };
  const last = indexes[indexes.length - 1] ?? headerAt;
  const rows: string[][] = [];
  for (let row = headerAt + 1; row <= last; row++) {
    const values = read(row);
    rows.push(headers.map((_, index) => values[index] ?? ""));
  }
  return { headers, rows };
}

/** Spreadsheets in this computer's library, by title. Not SuiteDrive copies. */
export function spreadsheetChoices(
  records: readonly {
    drive?: unknown;
    trashedAt?: string;
    file: { id: string; kind: string; title: string };
  }[],
): { id: string; title: string }[] {
  return records
    .filter(
      (record) =>
        record.file.kind === "sheet" && !record.drive && !record.trashedAt,
    )
    .map((record) => ({ id: record.file.id, title: record.file.title }))
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

/** One spreadsheet the merge dialog can offer. */
export interface MergeSheet {
  key: string;
  source: "library" | "drive";
  id: string;
  title: string;
  /** The folder name, or "On this computer" for a library spreadsheet. */
  place: string;
}

/** "Garden members.slsheet" is shown as Garden members. */
export function spreadsheetTitle(name: string): string {
  const trimmed = name.trim();
  if (trimmed.toLowerCase().endsWith(".slsheet")) {
    const title = trimmed.slice(0, -".slsheet".length).trim();
    if (title) return title;
  }
  return trimmed || "Untitled spreadsheet";
}

/**
 * Library spreadsheets plus SuiteDrive spreadsheets. A server file is
 * included even when this computer has no copy of it. The folder name is
 * what tells two files with the same title apart.
 */
export function mergeSheetChoices(
  local: readonly { id: string; title: string }[],
  driveSheets: readonly { id: string; name: string; parentName: string }[],
): MergeSheet[] {
  const rows: MergeSheet[] = [
    ...local.map((row) => ({
      key: `library:${row.id}`,
      source: "library" as const,
      id: row.id,
      title: row.title,
      place: "On this computer",
    })),
    ...driveSheets.map((row) => ({
      key: `drive:${row.id}`,
      source: "drive" as const,
      id: row.id,
      title: spreadsheetTitle(row.name),
      place: row.parentName,
    })),
  ];
  rows.sort(
    (a, b) =>
      a.title.localeCompare(b.title) ||
      a.place.localeCompare(b.place) ||
      a.key.localeCompare(b.key),
  );
  return rows;
}
