import type { JsonNode } from "@suiteleaf/core";

export type MailMergeResult =
  { ok: true; content: JsonNode } | { ok: false; missing: string[] };

const placeholder = () => /\{\{\s*([^{}]+?)\s*\}\}/g;

/** Column names written as `{{Header}}` in text nodes, in reading order. */
export function placeholderNames(node: JsonNode): string[] {
  const names: string[] = [];
  const visit = (current: JsonNode) => {
    if (current.type === "text" && current.text) {
      for (const match of current.text.matchAll(placeholder())) {
        const name = match[1].trim();
        if (name && !names.includes(name)) names.push(name);
      }
    }
    current.content?.forEach(visit);
  };
  visit(node);
  return names;
}

function fill(template: JsonNode, values: Map<string, string>): JsonNode {
  const copy = structuredClone(template);
  const visit = (node: JsonNode) => {
    if (node.type === "text" && typeof node.text === "string") {
      node.text = node.text.replace(placeholder(), (_, raw: string) => {
        const name = raw.trim();
        return values.get(name) ?? "";
      });
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

function emptyRow(row: string[]): boolean {
  return row.every((cell) => cell.trim() === "");
}

/**
 * One copy of the template per data row. A name that is not a header is an
 * error, and then no document is produced. The template is not changed.
 */
export function mergeLetters(
  template: JsonNode,
  headers: string[],
  rows: string[][],
): MailMergeResult {
  const known = new Set(headers.filter((header) => header !== ""));
  const missing = placeholderNames(template).filter((name) => !known.has(name));
  if (missing.length) return { ok: false, missing };

  const sections: JsonNode[] = [];
  for (const row of rows) {
    if (emptyRow(row)) continue;
    const values = new Map<string, string>();
    headers.forEach((header, index) => {
      if (header && !values.has(header)) values.set(header, row[index] ?? "");
    });
    if (sections.length) sections.push({ type: "pageBreak" });
    sections.push(...(fill(template, values).content ?? []));
  }
  const content = structuredClone(template);
  content.content = sections.length ? sections : [{ type: "paragraph" }];
  return { ok: true, content };
}

export function missingColumnMessage(missing: string[]): string {
  if (missing.length === 0) return "A placeholder is not a column.";
  if (missing.length === 1) return `${missing[0]} is not a column.`;
  const last = missing[missing.length - 1];
  return `${missing.slice(0, -1).join(", ")} and ${last} are not columns.`;
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
