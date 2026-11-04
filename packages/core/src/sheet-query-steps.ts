import { filterKeeps } from "./sheet-query-filter";
import { compareQueryValues, groupQueryRows, joinKey } from "./sheet-query-order";
import type { QueryRow, QueryStep } from "./sheet-query";

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
export function apply(
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
  return [...rows].sort((a, b) => {
    const left = (a[step.column] ?? "").trim();
    const right = (b[step.column] ?? "").trim();
    if (left === "" || right === "") {
      if (left === "" && right === "") return 0;
      return left === "" ? 1 : -1;
    }
    return compareQueryValues(left, right) * direction;
  });
}
