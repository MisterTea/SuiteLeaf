/**
 * Local CSV and JSON tables for a saved query.
 * The file text is not stored on the query document.
 */
import { refreshQuery, type QueryDocument, type QueryRow, type QueryRun } from "./sheet-query";

const NOT_A_TABLE = "That file is not a table of text.";

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  const pushRow = () => {
    row.push(field);
    field = "";
    if (row.some((cell) => cell.length > 0)) rows.push(row);
    row = [];
  };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      pushRow();
      continue;
    }
    field += char;
  }
  if (field.length > 0 || row.length > 0) pushRow();
  return rows;
}

function table(headers: string[], records: string[][]): { ok: true; rows: QueryRow[] } | { ok: false; error: string } {
  if (headers.length === 0 || headers.some((name) => name.trim() === "")) {
    return { ok: false, error: "That file has an empty column name." };
  }
  const names = headers.map((name) => name.trim());
  const rows: QueryRow[] = [];
  for (const record of records) {
    if (record.length !== names.length) return { ok: false, error: "That file has a row that does not match the header." };
    const row: QueryRow = {};
    names.forEach((name, index) => {
      row[name] = record[index] ?? "";
    });
    rows.push(row);
  }
  return { ok: true, rows };
}

/** The first row is the header. A quoted comma stays in the field. */
export function rowsFromCsv(text: string): { ok: true; rows: QueryRow[] } | { ok: false; error: string } {
  const parsed = parseCsv(text);
  if (parsed.length === 0) return { ok: false, error: "That file has no rows." };
  const [headers, ...records] = parsed;
  return table(headers ?? [], records);
}

/** A JSON array of objects whose values are text. */
export function rowsFromJson(text: string): { ok: true; rows: QueryRow[] } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    return { ok: false, error: NOT_A_TABLE };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return { ok: false, error: NOT_A_TABLE };
  const names: string[] = [];
  const records: string[][] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { ok: false, error: NOT_A_TABLE };
    const entries = Object.entries(item);
    if (entries.some(([, value]) => typeof value !== "string")) return { ok: false, error: NOT_A_TABLE };
    if (names.length === 0) {
      for (const [name] of entries) names.push(name);
    }
    if (entries.length !== names.length || entries.some(([name], index) => name !== names[index])) {
      return { ok: false, error: "That file has a row that does not match the header." };
    }
    records.push(entries.map(([, value]) => value as string));
  }
  return table(names, records);
}

function cellFilled(value: unknown): boolean {
  if (value == null || value === "") return false;
  if (typeof value === "object" && value && "v" in value) {
    const inner = (value as { v?: unknown }).v;
    return inner != null && inner !== "";
  }
  return true;
}

/**
 * True when the destination already has a value.
 * The stored value is not returned.
 */
export function localTableBlocked(existing: readonly (readonly unknown[])[]): boolean {
  return existing.some((row) => row.some((cell) => cellFilled(cell)));
}

/** Header row, then one row per record. Cell values stay in the table. */
export function localTableValues(rows: readonly QueryRow[]): string[][] {
  const headers: string[] = [];
  for (const row of rows) {
    for (const name of Object.keys(row)) {
      if (!headers.includes(name)) headers.push(name);
    }
  }
  if (headers.length === 0) return [];
  return [headers, ...rows.map((row) => headers.map((name) => row[name] ?? ""))];
}

function kept(error: string, previous: { rows: QueryRow[]; refreshedAt: string } | null): QueryRun {
  return {
    ok: false,
    error,
    rows: previous?.rows ?? [],
    refreshedAt: previous?.refreshedAt ?? null,
    stale: true,
  };
}

/**
 * Run a saved query on a local CSV or JSON table.
 * The file text is not written onto the query document.
 */
export function refreshLocalQuery(input: {
  document: QueryDocument;
  text: string;
  format: "csv" | "json";
  previous: { rows: QueryRow[]; refreshedAt: string } | null;
  refreshedAt: string;
}): QueryRun {
  const loaded = input.format === "csv" ? rowsFromCsv(input.text) : rowsFromJson(input.text);
  if (!loaded.ok) return kept(loaded.error, input.previous);
  return refreshQuery(input.document, loaded.rows, input.previous, input.refreshedAt);
}
