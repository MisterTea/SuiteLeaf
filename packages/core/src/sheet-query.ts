import { z } from "zod";
import { filterKeeps } from "./sheet-query-filter";
import { compareQueryValues, groupQueryRows, joinKey } from "./sheet-query-order";
import { sourceUrlProblem } from "./sheet-query-url";
export { sourceUrlProblem } from "./sheet-query-url";

/**
 * Saved steps that turn source rows into a sheet range.
 * Credentials are not part of this document.
 */
export type QueryStep =
  | { op: "select"; columns: string[] }
  | { op: "rename"; from: string; to: string }
  | { op: "filter"; column: string; equals: string; match?: "eq" | "ne" | "contains" }
  | { op: "sort"; column: string; direction: "asc" | "desc" }
  | { op: "dedupe"; column: string }
  | { op: "group"; by: string; value: string; aggregate: "sum" | "count" | "average" | "min" | "max" }
  | { op: "split"; column: string; separator: string; into: string[] }
  | { op: "join"; on: string; take: string[]; range?: string }
  | { op: "append"; range?: string }
  | { op: "merge"; columns: string[]; separator: string; into: string }
  | { op: "convert"; column: string; to: "number" | "text" | "date" };

export type QueryDocument = {
  version: 1;
  steps: QueryStep[];
};

const queryStepSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("select"),
    columns: z.array(z.string().min(1).max(80)).max(40),
  }),
  z.object({
    op: z.literal("rename"),
    from: z.string().min(1).max(80),
    to: z.string().min(1).max(80),
  }),
  z.object({
    op: z.literal("filter"),
    column: z.string().min(1).max(80),
    equals: z.string().max(200),
    match: z.enum(["eq", "ne", "contains"]).optional(),
  }),
  z.object({
    op: z.literal("sort"),
    column: z.string().min(1).max(80),
    direction: z.enum(["asc", "desc"]),
  }),
  z.object({
    op: z.literal("dedupe"),
    column: z.string().min(1).max(80),
  }),
  z.object({
    op: z.literal("group"),
    by: z.string().min(1).max(80),
    value: z.string().min(1).max(80),
    aggregate: z.enum(["sum", "count", "average", "min", "max"]),
  }),
  z.object({
    op: z.literal("split"),
    column: z.string().min(1).max(80),
    separator: z.string().min(1).max(8),
    into: z.array(z.string().min(1).max(80)).min(2).max(8),
  }),
  z.object({
    op: z.literal("join"),
    on: z.string().min(1).max(80),
    take: z.array(z.string().min(1).max(80)).min(1).max(20),
    range: z.string().min(1).max(80).optional(),
  }),
  z.object({ op: z.literal("append"), range: z.string().min(1).max(80).optional() }),
  z.object({
    op: z.literal("merge"),
    columns: z.array(z.string().min(1).max(80)).min(2).max(8),
    separator: z.string().max(8),
    into: z.string().min(1).max(80),
  }),
  z.object({
    op: z.literal("convert"),
    column: z.string().min(1).max(80),
    to: z.enum(["number", "text", "date"]),
  }),
]);

/** A query stored on a spreadsheet. The source rows are not stored with it. */
export const savedQuerySchema = z
  .object({
    id: z.string().min(1).max(80),
    document: z
      .object({
        version: z.literal(1),
        steps: z.array(queryStepSchema).max(40),
      })
      .strict(),
    everyMinutes: z.number().int().min(1).max(1440).optional(),
    source: z.string().min(1).max(2000).optional(),
  })
  .strict()
  .superRefine((query, ctx) => {
    const problem = query.source ? sourceUrlProblem(query.source) : null;
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });

export type QueryRow = Record<string, string>;

export type QueryRun =
  | { ok: true; rows: QueryRow[]; refreshedAt: string; stale: false }
  | {
      ok: false;
      error: string;
      rows: QueryRow[];
      refreshedAt: string | null;
      stale: boolean;
    };

const SECRET = /password|secret|token|authorization|api[-_]?key|credential/i;

/** Drop fields that would store a credential in a portable query. */
export function queryDocument(
  steps: QueryStep[],
  extra?: Record<string, unknown>,
): QueryDocument {
  if (extra) {
    for (const key of Object.keys(extra)) {
      if (SECRET.test(key)) {
        throw new Error("A query cannot store a credential.");
      }
    }
  }
  return { version: 1, steps };
}

export type SchemaNote = { step: number; column: string };

/** A sentence for one missing column. It does not include a cell value. */
export function schemaNoteText(note: SchemaNote): string {
  return `Step ${note.step} uses ${note.column}, and that column is not in the source.`;
}

/**
 * Name the steps whose columns are not in the source, following renames,
 * splits, merges, and groups. This does not read cell values and does not
 * write a sheet.
 */
export function reviewQuerySchema(document: QueryDocument, columns: string[]): SchemaNote[] {
  const available = new Set(columns);
  const notes: SchemaNote[] = [];
  const missing = (step: number, column: string) => {
    if (!available.has(column)) notes.push({ step, column });
  };
  document.steps.forEach((step, index) => {
    const number = index + 1;
    if (step.op === "select") {
      for (const column of step.columns) missing(number, column);
      available.clear();
      for (const column of step.columns) available.add(column);
      return;
    }
    if (step.op === "rename") {
      missing(number, step.from);
      available.delete(step.from);
      available.add(step.to);
      return;
    }
    if (step.op === "filter" || step.op === "dedupe" || step.op === "convert" || step.op === "sort") {
      missing(number, step.column);
      return;
    }
    if (step.op === "group") {
      missing(number, step.by);
      missing(number, step.value);
      available.clear();
      available.add(step.by);
      available.add(step.value);
      return;
    }
    if (step.op === "split") {
      missing(number, step.column);
      available.delete(step.column);
      for (const name of step.into) available.add(name);
      return;
    }
    if (step.op === "join") {
      missing(number, step.on);
      for (const column of step.take) available.add(column);
      return;
    }
    if (step.op === "append") return;
    for (const column of step.columns) missing(number, column);
    for (const column of step.columns) {
      if (column !== step.into) available.delete(column);
    }
    available.add(step.into);
  });
  return notes;
}

/**
 * Rewrite source column names the caller mapped. A name with no mapping stays.
 * The input document is not changed. An empty name or a credential-like name is refused.
 */
export function remapQuery(
  document: QueryDocument,
  mapping: Record<string, string>,
): QueryDocument {
  const rename = (name: string) => {
    if (!Object.prototype.hasOwnProperty.call(mapping, name)) return name;
    const next = mapping[name];
    if (typeof next !== "string" || !next.trim() || SECRET.test(next)) {
      throw new Error("That column cannot be remapped.");
    }
    return next;
  };
  return {
    version: 1,
    steps: document.steps.map((step) => {
      if (step.op === "select") return { ...step, columns: step.columns.map(rename) };
      if (step.op === "rename") return { ...step, from: rename(step.from) };
      if (step.op === "group") return { ...step, by: rename(step.by), value: rename(step.value) };
      if (step.op === "split") {
        return { ...step, column: rename(step.column), into: step.into.map(rename) };
      }
      if (step.op === "join") return { ...step, on: rename(step.on), take: step.take.map(rename) };
      if (step.op === "append") return step;
      if (step.op === "merge") {
        return { ...step, columns: step.columns.map(rename), into: rename(step.into) };
      }
      return { ...step, column: rename(step.column) };
    }),
  };
}

function isoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** A calendar day, or the day written at the start of a real timestamp. */
function queryDate(value: string): string | null {
  const trimmed = value.trim();
  if (isoDate(trimmed)) return trimmed;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/.exec(trimmed);
  if (!match || !isoDate(match[1])) return null;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (match[5] !== "Z") {
    const offsetHour = Number(match[6]);
    const offsetMinute = Number(match[7]);
    if (offsetHour > 23 || offsetMinute > 59) return null;
  }
  return match[1];
}

function columnsOf(rows: QueryRow[]): Set<string> {
  const names = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) names.add(key);
  }
  return names;
}

const SECRET_COLUMN = /password|secret|token|authorization|api[-_]?key|credential|[\r\n]/i;

function columnNotice(column: string, detail: string): string {
  const label = SECRET_COLUMN.test(column) ? "That column" : `Column ${column}`;
  return `${label} ${detail}`;
}

function parameterValue(equals: string, parameters?: Record<string, string>): string {
  const match = /^\{\{([A-Za-z][A-Za-z0-9]{0,40})\}\}$/.exec(equals);
  if (!match) return equals;
  const value = parameters?.[match[1]];
  if (value === undefined) throw new Error(`Name the value for ${match[1]}.`);
  return value;
}

function apply(
  rows: QueryRow[],
  step: QueryStep,
  lookup?: QueryRow[],
  parameters?: Record<string, string>,
): QueryRow[] {
  const names = columnsOf(rows);
  if (step.op === "select") {
    const missing = step.columns.find(
      (column) => rows.length > 0 && !names.has(column),
    );
    if (missing) throw new Error(columnNotice(missing, "is not in the source."));
    return rows.map((row) => {
      const next: QueryRow = {};
      for (const column of step.columns) next[column] = row[column] ?? "";
      return next;
    });
  }
  if (step.op === "rename") {
    if (rows.length > 0 && !names.has(step.from)) {
      throw new Error(columnNotice(step.from, "is not in the source."));
    }
    return rows.map((row) => {
      const next: QueryRow = {};
      for (const [key, value] of Object.entries(row)) {
        next[key === step.from ? step.to : key] = value;
      }
      return next;
    });
  }
  if (step.op === "filter") {
    if (rows.length > 0 && !names.has(step.column)) {
      throw new Error(columnNotice(step.column, "is not in the source."));
    }
    const equals = parameterValue(step.equals, parameters);
    return rows.filter((row) => filterKeeps(row[step.column] ?? "", equals, step.match));
  }
  if (step.op === "dedupe") {
    if (rows.length > 0 && !names.has(step.column)) {
      throw new Error(columnNotice(step.column, "is not in the source."));
    }
    const seen = new Set<string>();
    return rows.filter((row) => {
      const value = joinKey(row[step.column] ?? "");
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
  }
  if (step.op === "group") {
    if (rows.length > 0 && !names.has(step.by)) {
      throw new Error(columnNotice(step.by, "is not in the source."));
    }
    if (rows.length > 0 && !names.has(step.value)) {
      throw new Error(columnNotice(step.value, "is not in the source."));
    }
    return groupQueryRows(rows, step.by, step.value, step.aggregate);
  }
  if (step.op === "split") {
    if (rows.length > 0 && !names.has(step.column)) {
      throw new Error(columnNotice(step.column, "is not in the source."));
    }
    return rows.map((row) => {
      const parts = (row[step.column] ?? "").split(step.separator);
      if (parts.length !== step.into.length) {
        throw new Error(columnNotice(step.column, `does not split into ${step.into.length} parts.`));
      }
      const next: QueryRow = {};
      for (const [key, value] of Object.entries(row)) {
        if (key !== step.column) next[key] = value;
      }
      step.into.forEach((name, index) => {
        next[name] = parts[index].trim();
      });
      return next;
    });
  }
  if (step.op === "join") {
    if (!lookup) throw new Error("A join needs a lookup table.");
    const right = columnsOf(lookup);
    if (rows.length > 0 && !names.has(step.on)) {
      throw new Error(columnNotice(step.on, "is not in the source."));
    }
    if (lookup.length > 0 && !right.has(step.on)) {
      throw new Error(columnNotice(step.on, "is not in the lookup."));
    }
    for (const column of step.take) {
      if (lookup.length > 0 && !right.has(column)) {
        throw new Error(columnNotice(column, "is not in the lookup."));
      }
    }
    const first = new Map<string, QueryRow>();
    for (const row of lookup) {
      const key = joinKey(row[step.on] ?? "");
      if (key !== "" && !first.has(key)) first.set(key, row);
    }
    return rows.map((row) => {
      const key = joinKey(row[step.on] ?? "");
      const match = key === "" ? undefined : first.get(key);
      const next: QueryRow = { ...row };
      for (const column of step.take) next[column] = match?.[column] ?? "";
      return next;
    });
  }
  if (step.op === "append") {
    if (!lookup) throw new Error("An append needs another table.");
    return [...rows.map((row) => ({ ...row })), ...lookup.map((row) => ({ ...row }))];
  }
  if (step.op === "merge") {
    if (rows.length > 0) {
      const missing = step.columns.find((column) => !names.has(column));
      if (missing) throw new Error(columnNotice(missing, "is not in the source."));
    }
    const drop = new Set(step.columns.filter((column) => column !== step.into));
    return rows.map((row) => {
      const next: QueryRow = {};
      for (const [key, value] of Object.entries(row)) {
        if (!drop.has(key)) next[key] = value;
      }
      next[step.into] = step.columns.map((column) => row[column] ?? "").join(step.separator);
      return next;
    });
  }
  if (step.op === "convert") {
    if (rows.length > 0 && !names.has(step.column)) {
      throw new Error(columnNotice(step.column, "is not in the source."));
    }
    return rows.map((row) => {
      const value = row[step.column] ?? "";
      let converted = value;
      if (step.to === "number") {
        const parsed = Number(value);
        if (value.trim() === "" || !Number.isFinite(parsed)) {
          throw new Error(columnNotice(step.column, "is not a number."));
        }
        converted = String(parsed);
      } else if (step.to === "date") {
        const day = queryDate(value);
        if (!day) throw new Error(columnNotice(step.column, "is not an ISO date."));
        converted = day;
      }
      return { ...row, [step.column]: converted };
    });
  }
  if (rows.length > 0 && !names.has(step.column)) {
    throw new Error(columnNotice(step.column, "is not in the source."));
  }
  const direction = step.direction === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => compareQueryValues(a[step.column] ?? "", b[step.column] ?? "") * direction);
}

/**
 * Run `document` on `source`. A step that names a missing column keeps `previous`
 * and marks it stale. The source rows are not changed.
 */
export function refreshQuery(
  document: QueryDocument,
  source: QueryRow[],
  previous: { rows: QueryRow[]; refreshedAt: string } | null,
  refreshedAt: string,
  shouldStop?: () => boolean,
  lookup?: QueryRow[],
  parameters?: Record<string, string>,
): QueryRun {
  const cancelled = (): QueryRun => {
    if (!previous) {
      return {
        ok: false,
        error: "The refresh was cancelled.",
        rows: [],
        refreshedAt: null,
        stale: false,
      };
    }
    return {
      ok: false,
      error: "The refresh was cancelled.",
      rows: previous.rows.map((row) => ({ ...row })),
      refreshedAt: previous.refreshedAt,
      stale: true,
    };
  };
  try {
    if (shouldStop?.()) return cancelled();
    let rows = source.map((row) => ({ ...row }));
    for (const step of document.steps) {
      if (shouldStop?.()) return cancelled();
      rows = apply(rows, step, lookup, parameters);
    }
    return { ok: true, rows, refreshedAt, stale: false };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The query could not run.";
    if (!previous)
      return {
        ok: false,
        error: message,
        rows: [],
        refreshedAt: null,
        stale: false,
      };
    return {
      ok: false,
      error: message,
      rows: previous.rows.map((row) => ({ ...row })),
      refreshedAt: previous.refreshedAt,
      stale: true,
    };
  }
}

export type RemoteTable = { ok: boolean; status: number; rows?: QueryRow[] };

export type SourceAccess = "owner" | "editor" | "commenter" | "viewer" | "none";

/** A protected source can be refreshed by an owner or an editor. A viewer cannot. */
function refreshDenied(input: {
  allowed: boolean;
  protectedSource?: boolean;
  sourceAccess?: SourceAccess;
}): string | null {
  if (!input.allowed) return "This view cannot refresh the source.";
  if (input.sourceAccess === "none") return "You do not have access to this source.";
  if (input.protectedSource && input.sourceAccess !== "owner" && input.sourceAccess !== "editor") {
    return "You can view this source, but you cannot refresh it.";
  }
  return null;
}

function kept(error: string, previous: { rows: QueryRow[]; refreshedAt: string } | null): QueryRun {
  if (!previous) return { ok: false, error, rows: [], refreshedAt: null, stale: false };
  return {
    ok: false,
    error,
    rows: previous.rows.map((row) => ({ ...row })),
    refreshedAt: previous.refreshedAt,
    stale: true,
  };
}

function stringRows(rows: QueryRow[]): QueryRow[] {
  return rows.filter(
    (row) =>
      !!row &&
      typeof row === "object" &&
      Object.values(row).every((value) => typeof value === "string"),
  );
}

/**
 * Refresh from an https table the caller fetches. A view that is not allowed
 * does not fetch. A failed fetch keeps the last rows and marks them stale.
 * The error text does not include the response body. The address is not stored
 * on the query document.
 */
export async function refreshRemoteQuery(input: {
  document: QueryDocument;
  url: string;
  allowed: boolean;
  protectedSource?: boolean;
  sourceAccess?: SourceAccess;
  fetchRows: (url: string) => Promise<RemoteTable>;
  previous: { rows: QueryRow[]; refreshedAt: string } | null;
  refreshedAt: string;
}): Promise<QueryRun> {
  const denied = refreshDenied(input);
  if (denied) return kept(denied, input.previous);
  const urlProblem = sourceUrlProblem(input.url);
  if (urlProblem) return kept(urlProblem, input.previous);
  let table: RemoteTable;
  try {
    table = await input.fetchRows(input.url);
  } catch {
    return kept("The source did not answer.", input.previous);
  }
  if (!table.ok || !Array.isArray(table.rows)) return kept("The source did not answer.", input.previous);
  return refreshQuery(input.document, stringRows(table.rows), input.previous, input.refreshedAt);
}

const MIN_REFRESH_MS = 60_000;

export type QuerySchedule = {
  url: string;
  everyMs: number;
  lastRunAt: string | null;
};

/** True when the interval has passed. An interval under one minute is never due. */
export function refreshIsDue(schedule: QuerySchedule, nowMs: number): boolean {
  if (sourceUrlProblem(schedule.url)) return false;
  if (!Number.isFinite(schedule.everyMs) || schedule.everyMs < MIN_REFRESH_MS) return false;
  if (!Number.isFinite(nowMs)) return false;
  if (schedule.lastRunAt == null) return true;
  const last = Date.parse(schedule.lastRunAt);
  if (!Number.isFinite(last)) return false;
  return nowMs - last >= schedule.everyMs;
}

/**
 * Fetch only when the schedule is due and the view is allowed.
 * A fetch moves `lastRunAt` forward, including when the source does not answer.
 * This does not start a timer.
 */
export async function runScheduledRefresh(input: {
  document: QueryDocument;
  schedule: QuerySchedule;
  now: string;
  allowed: boolean;
  protectedSource?: boolean;
  sourceAccess?: SourceAccess;
  fetchRows: (url: string) => Promise<RemoteTable>;
  previous: { rows: QueryRow[]; refreshedAt: string } | null;
}): Promise<{ run: QueryRun | null; schedule: QuerySchedule; fetched: boolean }> {
  const nowMs = Date.parse(input.now);
  if (!refreshIsDue(input.schedule, nowMs)) {
    return { run: null, schedule: input.schedule, fetched: false };
  }
  const denied = refreshDenied(input);
  if (denied) {
    return {
      run: kept(denied, input.previous),
      schedule: input.schedule,
      fetched: false,
    };
  }
  const run = await refreshRemoteQuery({
    document: input.document,
    url: input.schedule.url,
    allowed: true,
    protectedSource: input.protectedSource,
    sourceAccess: input.sourceAccess,
    fetchRows: input.fetchRows,
    previous: input.previous,
    refreshedAt: input.now,
  });
  return { run, schedule: { ...input.schedule, lastRunAt: input.now }, fetched: true };
}

const WRITE_SQL = /\b(insert|update|delete|drop|alter|attach|pragma|replace|create)\b/i;

function readOnlySelect(sql: string): boolean {
  const text = sql.trim();
  if (!/^select\b/i.test(text)) return false;
  if (text.includes(";")) return false;
  if (WRITE_SQL.test(text)) return false;
  return true;
}

/**
 * Run one read-only SELECT through a caller-supplied database query.
 * A view that is not allowed does not query. A statement that changes data
 * does not query. A failed query keeps the last rows and marks them stale.
 * The driver message is not returned. The statement is not stored on the query document.
 */
export async function refreshDatabaseQuery(input: {
  document: QueryDocument;
  sql: string;
  allowed: boolean;
  protectedSource?: boolean;
  sourceAccess?: SourceAccess;
  query: (sql: string) => Promise<{ ok: boolean; rows?: QueryRow[] }>;
  previous: { rows: QueryRow[]; refreshedAt: string } | null;
  refreshedAt: string;
}): Promise<QueryRun> {
  const denied = refreshDenied(input);
  if (denied) return kept(denied, input.previous);
  if (!readOnlySelect(input.sql)) return kept("The database query must be one read.", input.previous);
  let table: { ok: boolean; rows?: QueryRow[] };
  try {
    table = await input.query(input.sql);
  } catch {
    return kept("The database query did not answer.", input.previous);
  }
  if (!table.ok || !Array.isArray(table.rows)) return kept("The database query did not answer.", input.previous);
  return refreshQuery(input.document, stringRows(table.rows), input.previous, input.refreshedAt);
}

export type QueryCell = { v?: string | number | boolean | null } | null;
export type QueryGrid = Record<string, Record<string, QueryCell>>;

/** The rectangle last written for this query, including the header row. */
export type QueryPlacement = {
  startRow: number;
  startColumn: number;
  writtenRows: number;
  writtenColumns: number;
};

export type QueryWrite = {
  grid: QueryGrid;
  placement: QueryPlacement | null;
  wrote: boolean;
  error?: string;
};

function columnOrder(rows: QueryRow[]): string[] {
  const names: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!names.includes(key)) names.push(key);
    }
  }
  return names;
}

function covers(place: QueryPlacement, row: number, column: number): boolean {
  return (
    row >= place.startRow &&
    row < place.startRow + place.writtenRows &&
    column >= place.startColumn &&
    column < place.startColumn + place.writtenColumns
  );
}

function occupied(grid: QueryGrid, row: number, column: number): boolean {
  const cell = grid[String(row)]?.[String(column)];
  if (!cell) return false;
  const value = cell.v;
  return value !== undefined && value !== null && value !== "";
}

function cloneGrid(grid: QueryGrid): QueryGrid {
  const next: QueryGrid = {};
  for (const [row, columns] of Object.entries(grid)) {
    next[row] = {};
    for (const [column, cell] of Object.entries(columns)) {
      next[row][column] = cell ? { ...cell } : cell;
    }
  }
  return next;
}

function setCell(grid: QueryGrid, row: number, column: number, value: string) {
  const rowKey = String(row);
  const columnKey = String(column);
  grid[rowKey] = grid[rowKey] ?? {};
  grid[rowKey][columnKey] = { v: value };
}

function clearCell(grid: QueryGrid, row: number, column: number) {
  const rowKey = String(row);
  const columns = grid[rowKey];
  if (!columns) return;
  delete columns[String(column)];
  if (Object.keys(columns).length === 0) delete grid[rowKey];
}

/**
 * Write a successful query into `grid` at the origin. Cells inside the previous
 * output may be replaced. A cell outside that rectangle that already has a
 * value stops the write, and the grid is left unchanged. A failed refresh does
 * not write.
 */
export function writeQueryOutput(
  grid: QueryGrid,
  run: QueryRun,
  origin: {
    startRow: number;
    startColumn: number;
    previous?: QueryPlacement | null;
  },
): QueryWrite {
  const previous = origin.previous ?? null;
  if (!run.ok) {
    return { grid, placement: previous, wrote: false, error: run.error };
  }
  if (origin.startRow < 0 || origin.startColumn < 0) {
    return {
      grid,
      placement: previous,
      wrote: false,
      error: "The output starts before the sheet.",
    };
  }
  const columns = columnOrder(run.rows);
  const height = columns.length === 0 ? 0 : run.rows.length + 1;
  const width = columns.length;
  const next: QueryPlacement = {
    startRow: origin.startRow,
    startColumn: origin.startColumn,
    writtenRows: height,
    writtenColumns: width,
  };
  for (let rowOffset = 0; rowOffset < height; rowOffset += 1) {
    for (let columnOffset = 0; columnOffset < width; columnOffset += 1) {
      const row = origin.startRow + rowOffset;
      const column = origin.startColumn + columnOffset;
      if (previous && covers(previous, row, column)) continue;
      if (!occupied(grid, row, column)) continue;
      return {
        grid,
        placement: previous,
        wrote: false,
        error: `Row ${row}, column ${column} already has a value.`,
      };
    }
  }
  const written = cloneGrid(grid);
  if (previous) {
    for (let rowOffset = 0; rowOffset < previous.writtenRows; rowOffset += 1) {
      for (
        let columnOffset = 0;
        columnOffset < previous.writtenColumns;
        columnOffset += 1
      ) {
        const row = previous.startRow + rowOffset;
        const column = previous.startColumn + columnOffset;
        if (covers(next, row, column)) continue;
        clearCell(written, row, column);
      }
    }
  }
  if (height > 0) {
    columns.forEach((column, columnOffset) => {
      setCell(written, origin.startRow, origin.startColumn + columnOffset, column);
    });
    run.rows.forEach((row, rowOffset) => {
      columns.forEach((column, columnOffset) => {
        setCell(
          written,
          origin.startRow + 1 + rowOffset,
          origin.startColumn + columnOffset,
          row[column] ?? "",
        );
      });
    });
  }
  return { grid: written, placement: next, wrote: true };
}

function cellText(cell: QueryCell): string {
  if (!cell || cell.v === undefined || cell.v === null) return "";
  return String(cell.v);
}

/** Header row plus data rows. A blank header is skipped. An empty data row is skipped. */
export function tableFromGrid(
  grid: QueryGrid,
  source: { startRow: number; startColumn: number; rows: number; columns: number },
): QueryRow[] {
  if (source.rows < 2 || source.columns < 1 || source.startRow < 0 || source.startColumn < 0) {
    return [];
  }
  const headers: string[] = [];
  for (let column = 0; column < source.columns; column += 1) {
    headers.push(
      cellText(grid[String(source.startRow)]?.[String(source.startColumn + column)] ?? null),
    );
  }
  const rows: QueryRow[] = [];
  for (let row = 1; row < source.rows; row += 1) {
    const next: QueryRow = {};
    let any = false;
    headers.forEach((header, column) => {
      if (!header) return;
      const value = cellText(
        grid[String(source.startRow + row)]?.[String(source.startColumn + column)] ?? null,
      );
      next[header] = value;
      if (value) any = true;
    });
    if (any) rows.push(next);
  }
  return rows;
}

/**
 * Read a source rectangle, run the query, and write the result at `origin`.
 * The source cells are not the output. A failed refresh does not replace them.
 */
export function refreshGridQuery(
  grid: QueryGrid,
  document: QueryDocument,
  source: { startRow: number; startColumn: number; rows: number; columns: number },
  origin: { startRow: number; startColumn: number; previous?: QueryPlacement | null },
  previous: { rows: QueryRow[]; refreshedAt: string } | null,
  refreshedAt: string,
  lookup?: QueryRow[],
  parameters?: Record<string, string>,
): { run: QueryRun; write: QueryWrite } {
  const run = refreshQuery(
    document,
    tableFromGrid(grid, source),
    previous,
    refreshedAt,
    undefined,
    lookup,
    parameters,
  );
  return { run, write: writeQueryOutput(grid, run, origin) };
}

export type ScheduledJob = {
  id: string;
  document: QueryDocument;
  schedule: QuerySchedule;
  previous: { rows: QueryRow[]; refreshedAt: string } | null;
};

/**
 * Run due refreshes a few at a time. A failed source is tried again.
 * Stopping skips the jobs that have not started. This does not start a timer.
 */
export async function runScheduledBatch(input: {
  jobs: ScheduledJob[];
  now: string;
  allowed: boolean;
  limit: number;
  retries: number;
  /** Milliseconds to wait for one attempt. Absent means no limit. */
  timeoutMs?: number;
  shouldStop?: () => boolean;
  fetchRows: (url: string) => Promise<RemoteTable>;
}): Promise<{
  results: { id: string; run: QueryRun | null; schedule: QuerySchedule; fetched: boolean; attempts: number }[];
  notices: string[];
}> {
  const width = Math.min(4, Math.max(1, Math.floor(input.limit)));
  const tries = Math.min(2, Math.max(0, Math.floor(input.retries))) + 1;
  const results: { id: string; run: QueryRun | null; schedule: QuerySchedule; fetched: boolean; attempts: number }[] =
    [];
  const notices: string[] = [];
  let next = 0;
  const runOne = async () => {
    for (;;) {
      if (input.shouldStop?.()) return;
      const index = next;
      next += 1;
      const job = input.jobs[index];
      if (!job) return;
      if (!refreshIsDue(job.schedule, Date.parse(input.now))) {
        results[index] = { id: job.id, run: null, schedule: job.schedule, fetched: false, attempts: 0 };
        continue;
      }
      let attempts = 0;
      let run: QueryRun | null = null;
      for (let attempt = 0; attempt < tries; attempt += 1) {
        if (input.shouldStop?.()) break;
        attempts = attempt + 1;
        let fetchRows = input.fetchRows;
        if (input.timeoutMs != null) {
          const limited = await refreshWithin({
            timeoutMs: input.timeoutMs,
            fetchRows: () => input.fetchRows(job.schedule.url),
          });
          if ("reason" in limited) {
            run = kept(limited.reason, job.previous);
            if (limited.reason === "The refresh limit is not a time.") break;
            continue;
          }
          fetchRows = async () => limited;
        }
        run = await refreshRemoteQuery({
          document: job.document,
          url: job.schedule.url,
          allowed: input.allowed,
          fetchRows,
          previous: job.previous,
          refreshedAt: input.now,
        });
        if (run.ok) break;
      }
      const fetched = attempts > 0;
      results[index] = {
        id: job.id,
        run,
        schedule: fetched ? { ...job.schedule, lastRunAt: input.now } : job.schedule,
        fetched,
        attempts,
      };
      if (fetched) notices.push(run?.ok ? `${job.id} was refreshed.` : `${job.id} did not answer.`);
    }
  };
  const workers = Math.min(width, input.jobs.length);
  await Promise.all(Array.from({ length: workers }, () => runOne()));
  for (let index = next; index < input.jobs.length; index += 1) {
    const job = input.jobs[index];
    results[index] = { id: job.id, run: null, schedule: job.schedule, fetched: false, attempts: 0 };
    notices.push(`${job.id} was cancelled.`);
  }
  return { results, notices };
}

const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 60_000;

/**
 * Wait for one fetch. A slow source becomes a static refusal. The address is
 * not part of this function, so it cannot appear in the refusal.
 */
export async function refreshWithin(input: {
  timeoutMs: number;
  fetchRows: () => Promise<RemoteTable>;
}): Promise<RemoteTable | { ok: false; reason: string }> {
  if (!Number.isFinite(input.timeoutMs) || input.timeoutMs < MIN_TIMEOUT_MS || input.timeoutMs > MAX_TIMEOUT_MS) {
    return { ok: false, reason: "The refresh limit is not a time." };
  }
  const timeout = Math.floor(input.timeoutMs);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timed = new Promise<{ ok: false; reason: string }>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: "The source took too long." }), timeout);
  });
  try {
    return await Promise.race([
      input.fetchRows().catch(() => ({ ok: false as const, reason: "The source did not answer." })),
      timed,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
