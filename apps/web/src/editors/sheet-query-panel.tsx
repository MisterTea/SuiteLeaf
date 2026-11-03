import { useRef, useState } from "react";
import { LocalQueryFile } from "./local-query-file";
import { QueryRemap } from "./query-remap-fields";
import { remapStepColumn } from "./query-remap";
import { QuerySchedule } from "./query-schedule";
import {
  parseRange,
  queryDocument,
  refreshGridQuery,
  sourceUrlProblem,
  reviewQuerySchema,
  schemaNoteText,
  tableFromGrid,
  type QueryDocument,
  type QueryGrid,
  type QueryRow,
} from "@suiteleaf/core";

export type SheetQueryPlacement = {
  startRow: number;
  startColumn: number;
  rows: number;
  columns: number;
};

type Box = {
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
};

type SelectedRange = {
  getRange: () => Box;
  getRawValues: () => unknown[][];
};

type WriteRange = {
  getRawValues: () => unknown[][];
  setValues: (values: string[][]) => void;
  clearContent: () => void;
};

/** The active sheet, narrowed to the calls a query needs. */
export type QuerySheet = {
  getSelection: () => { getActiveRange: () => SelectedRange | null } | null;
  getRange: (row: number, column: number, rows: number, columns: number) => WriteRange;
};

export type SheetQueryResult = {
  placement: SheetQueryPlacement | null;
  message: string;
  changed: boolean;
};

function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (typeof value === "object" && "v" in value)
    return cellText((value as { v: unknown }).v);
  return "";
}

function covers(place: SheetQueryPlacement, row: number, column: number): boolean {
  return (
    row >= place.startRow &&
    row < place.startRow + place.rows &&
    column >= place.startColumn &&
    column < place.startColumn + place.columns
  );
}

export type SheetQueryStep =
  | { op: "filter"; column: string; equals: string; match?: "eq" | "ne" | "contains"; parameter?: string; parameterValue?: string }
  | { op: "convert"; column: string; to: "number" | "text" | "date" }
  | { op: "sort"; column: string; direction: "asc" | "desc" }
  | { op: "dedupe"; column: string }
  | { op: "group"; by: string; value: string; aggregate: "sum" | "count" | "average" | "min" | "max" }
  | { op: "split"; column: string; separator: string; into: string[] }
  | { op: "merge"; columns: string[]; separator: string; into: string }
  | { op: "join"; on: string; take: string[]; range: string }
  | { op: "append"; range: string };

function emptyColumnMessage(op: SheetQueryStep["op"]): string {
  if (op === "convert") return "Name the column to convert.";
  if (op === "sort") return "Name the column to sort.";
  if (op === "dedupe") return "Name the column to check for duplicates.";
  return "Name the column to keep.";
}

function writtenMessage(op: SheetQueryStep["op"]): string {
  if (op === "convert")
    return "The converted column was written beside the selection. The source cells stayed.";
  if (op === "sort")
    return "The rows were sorted beside the selection. The source cells stayed.";
  if (op === "dedupe")
    return "The first row of each value was written beside the selection. The source cells stayed.";
  if (op === "group")
    return "The grouped rows were written beside the selection. The source cells stayed.";
  if (op === "split")
    return "The split columns were written beside the selection. The source cells stayed.";
  if (op === "merge")
    return "The merged column was written beside the selection. The source cells stayed.";
  if (op === "join")
    return "The joined rows were written beside the selection. The source cells stayed.";
  if (op === "append")
    return "The appended rows were written beside the selection. The source cells stayed.";
  return "The matching rows were written beside the selection. The source cells stayed.";
}

function documentStep(step: SheetQueryStep) {
  if (step.op === "group") {
    return {
      op: "group" as const,
      by: step.by.trim(),
      value: step.value.trim(),
      aggregate: step.aggregate,
    };
  }
  if (step.op === "merge") {
    return {
      op: "merge" as const,
      columns: step.columns.map((name) => name.trim()).filter((name) => name.length > 0),
      separator: step.separator,
      into: step.into.trim(),
    };
  }
  if (step.op === "join") {
    return {
      op: "join" as const,
      on: step.on.trim(),
      take: step.take.map((name) => name.trim()).filter((name) => name.length > 0),
      range: step.range.trim(),
    };
  }
  if (step.op === "append") return { op: "append" as const, range: step.range.trim() };
  const column = step.column.trim();
  if (step.op === "convert") return { op: "convert" as const, column, to: step.to };
  if (step.op === "sort") return { op: "sort" as const, column, direction: step.direction };
  if (step.op === "dedupe") return { op: "dedupe" as const, column };
  if (step.op === "split") {
    return {
      op: "split" as const,
      column,
      separator: step.separator,
      into: step.into.map((name) => name.trim()).filter((name) => name.length > 0),
    };
  }
  if (step.op === "filter" && step.parameter?.trim()) {
    return {
      op: "filter" as const,
      column,
      equals: `{{${step.parameter.trim()}}}`,
      ...(step.match === "ne" || step.match === "contains" ? { match: step.match } : {}),
    };
  }
  return {
    op: "filter" as const,
    column,
    equals: step.equals,
    ...(step.match === "ne" || step.match === "contains" ? { match: step.match } : {}),
  };
}

function readLookup(
  sheet: QuerySheet,
  step: SheetQueryStep,
): QueryRow[] | { error: string } | undefined {
  if (step.op !== "join" && step.op !== "append") return undefined;
  let parsed;
  try {
    parsed = parseRange(step.range, "query");
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Use a cell range such as A1:D20.",
    };
  }
  const rows = parsed.endRow - parsed.startRow + 1;
  const columns = parsed.endColumn - parsed.startColumn + 1;
  if (rows < 2) return { error: "The lookup needs a header and the rows under it." };
  const values = sheet.getRange(parsed.startRow, parsed.startColumn, rows, columns).getRawValues();
  const grid: QueryGrid = {};
  values.forEach((row, rowIndex) => {
    (row ?? []).forEach((cell, columnIndex) => {
      const text = cellText(cell);
      if (!text) return;
      const rowKey = String(rowIndex);
      grid[rowKey] = grid[rowKey] ?? {};
      grid[rowKey][String(columnIndex)] = { v: text };
    });
  });
  const width = Math.max(columns, ...values.map((row) => row?.length ?? 0));
  return tableFromGrid(grid, {
    startRow: 0,
    startColumn: 0,
    rows: Math.max(values.length, 1),
    columns: width,
  });
}

function stepProblem(step: SheetQueryStep): string | null {
  if (step.op === "group") {
    if (!step.by.trim()) return "Name the column to group by.";
    if (!step.value.trim()) return "Name the column to total.";
  } else if (step.op === "split") {
    if (!step.column.trim()) return "Name the column to split.";
    if (!step.separator) return "Name the separator.";
    if (step.into.filter((name) => name.trim()).length < 2)
      return "Name at least two columns to split into.";
  } else if (step.op === "merge") {
    if (step.columns.filter((name) => name.trim()).length < 2)
      return "Name at least two columns to merge.";
    if (!step.into.trim()) return "Name the column to write.";
  } else if (step.op === "join") {
    if (!step.on.trim()) return "Name the column to join on.";
    if (step.take.filter((name) => name.trim()).length < 1) return "Name a column to copy.";
    if (!step.range.trim()) return "Name the lookup range.";
  } else if (step.op === "append") {
    if (!step.range.trim()) return "Name the lookup range.";
  } else if (!step.column.trim()) return emptyColumnMessage(step.op);
  if (step.op === "filter" && step.parameter?.trim()) {
    const name = step.parameter.trim();
    if (!/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(name)) {
      return "Name the parameter with letters and digits.";
    }
    if (!step.parameterValue?.trim()) return `Name the value for ${name}.`;
  }
  return null;
}

/** Name a column this step uses that the header row does not have. Nothing is written. */
export function checkSheetQuery(sheet: QuerySheet, step: SheetQueryStep): string {
  const problem = stepProblem(step);
  if (problem) return problem;
  const range = sheet.getSelection()?.getActiveRange() ?? null;
  if (!range) return "Select a header row and the rows under it.";
  const box = range.getRange();
  const height = box.endRow - box.startRow + 1;
  const width = box.endColumn - box.startColumn + 1;
  if (height < 2 || width < 1) return "Select a header row and the rows under it.";
  const header = range.getRawValues()[0] ?? [];
  const columns = header.map((cell) => cellText(cell)).filter((name) => name.length > 0);
  const notes = reviewQuerySchema(queryDocument([documentStep(step)]), columns);
  if (!notes.length) return "The columns in this step are in the source.";
  return schemaNoteText(notes[0]);
}

/**
 * Run one saved step on the selection and write it one column to the right.
 * The source range is not written. A cell that already has a value, and was
 * not this query's previous output, stops the write.
 */
export function applySheetQuery(
  sheet: QuerySheet,
  step: SheetQueryStep,
  previous: SheetQueryPlacement | null,
  refreshedAt: string,
): SheetQueryResult {
  const problem = stepProblem(step);
  if (problem) return { placement: previous, message: problem, changed: false };
  const range = sheet.getSelection()?.getActiveRange() ?? null;
  if (!range)
    return {
      placement: previous,
      message: "Select a header row and the rows under it.",
      changed: false,
    };
  const box = range.getRange();
  const height = box.endRow - box.startRow + 1;
  const width = box.endColumn - box.startColumn + 1;
  if (height < 2 || width < 1)
    return {
      placement: previous,
      message: "Select a header row and the rows under it.",
      changed: false,
    };
  const values = range.getRawValues();
  const grid: QueryGrid = {};
  values.forEach((row, rowIndex) => {
    (row ?? []).forEach((cell, columnIndex) => {
      const text = cellText(cell);
      if (!text) return;
      const rowKey = String(rowIndex);
      grid[rowKey] = grid[rowKey] ?? {};
      grid[rowKey][String(columnIndex)] = { v: text };
    });
  });
  const lookup = readLookup(sheet, step);
  if (lookup && "error" in lookup)
    return { placement: previous, message: lookup.error, changed: false };
  const parameterName = step.op === "filter" ? step.parameter?.trim() : "";
  const parameters =
    step.op === "filter" && parameterName
      ? { [parameterName]: step.parameterValue ?? "" }
      : undefined;
  const { run, write } = refreshGridQuery(
    grid,
    queryDocument([documentStep(step)]),
    { startRow: 0, startColumn: 0, rows: height, columns: width },
    { startRow: 0, startColumn: width },
    null,
    refreshedAt,
    lookup,
    parameters,
  );
  if (!run.ok || !write.wrote || !write.placement)
    return {
      placement: previous,
      message: run.ok ? (write.error ?? "The query did not write.") : run.error,
      changed: false,
    };
  const outRows = write.placement.writtenRows;
  const outColumns = write.placement.writtenColumns;
  const startRow = box.startRow;
  const startColumn = box.endColumn + 2;
  if (outRows === 0 || outColumns === 0) {
    if (previous)
      sheet
        .getRange(previous.startRow, previous.startColumn, previous.rows, previous.columns)
        .clearContent();
    return {
      placement: null,
      message: "No rows matched. The source cells stayed.",
      changed: previous != null,
    };
  }
  const existing = sheet.getRange(startRow, startColumn, outRows, outColumns).getRawValues();
  for (let rowOffset = 0; rowOffset < existing.length; rowOffset += 1) {
    const line = existing[rowOffset] ?? [];
    for (let columnOffset = 0; columnOffset < line.length; columnOffset += 1) {
      if (!cellText(line[columnOffset])) continue;
      const row = startRow + rowOffset;
      const columnIndex = startColumn + columnOffset;
      if (previous && covers(previous, row, columnIndex)) continue;
      return {
        placement: previous,
        message: `Row ${row + 1}, column ${columnIndex + 1} already has a value.`,
        changed: false,
      };
    }
  }
  const output: string[][] = [];
  for (let rowOffset = 0; rowOffset < outRows; rowOffset += 1) {
    const line: string[] = [];
    for (let columnOffset = 0; columnOffset < outColumns; columnOffset += 1) {
      line.push(
        cellText(write.grid[String(rowOffset)]?.[String(width + columnOffset)] ?? null),
      );
    }
    output.push(line);
  }
  if (previous)
    sheet
      .getRange(previous.startRow, previous.startColumn, previous.rows, previous.columns)
      .clearContent();
  sheet.getRange(startRow, startColumn, outRows, outColumns).setValues(output);
  return {
    placement: { startRow, startColumn, rows: outRows, columns: outColumns },
    message:
      step.op === "filter" && step.match === "ne"
        ? "The other rows were written beside the selection. The source cells stayed."
        : writtenMessage(step.op),
    changed: true,
  };
}

export type SavedSheetQuery = {
  id: string;
  document: QueryDocument;
  everyMinutes?: number;
  source?: string;
};

export function applySheetFilter(
  sheet: QuerySheet,
  filter: { column: string; equals: string },
  previous: SheetQueryPlacement | null,
  refreshedAt: string,
): SheetQueryResult {
  return applySheetQuery(sheet, { op: "filter", ...filter }, previous, refreshedAt);
}

/** Keep the latest selection step on the file. Source rows are not stored. */
export function rememberSheetQuery(
  queries: SavedSheetQuery[] | undefined,
  column: string,
  equals: string,
): SavedSheetQuery[] {
  const document = queryDocument([{ op: "filter", column: column.trim(), equals }]);
  const rest = (queries ?? []).filter((item) => item.id !== "selection");
  return [...rest, { id: "selection", document }].slice(-20);
}

/** The filter stored on the spreadsheet, if this file has one. */
export function savedSheetFilter(
  queries: SavedSheetQuery[] | undefined,
): { column: string; equals: string } | null {
  const saved = savedSheetStep(queries);
  if (!saved || saved.op !== "filter") return null;
  return { column: saved.column, equals: saved.equals };
}

/** The filter or conversion stored on the spreadsheet. */
export function savedSheetStep(queries: SavedSheetQuery[] | undefined): SheetQueryStep | null {
  const saved = (queries ?? []).find((item) => item.id === "selection");
  const step = saved?.document.steps[0];
  if (!step) return null;
  if (step.op === "filter") {
    return {
      op: "filter",
      column: step.column,
      equals: step.equals,
      ...(step.match === "ne" || step.match === "contains" ? { match: step.match } : {}),
    };
  }
  if (step.op === "convert") return { op: "convert", column: step.column, to: step.to };
  if (step.op === "sort" && (step.direction === "asc" || step.direction === "desc"))
    return { op: "sort", column: step.column, direction: step.direction };
  if (step.op === "dedupe") return { op: "dedupe", column: step.column };
  if (
    step.op === "group" &&
    (step.aggregate === "sum" ||
      step.aggregate === "count" ||
      step.aggregate === "average" ||
      step.aggregate === "min" ||
      step.aggregate === "max")
  )
    return { op: "group", by: step.by, value: step.value, aggregate: step.aggregate };
  if (step.op === "split" && step.separator && step.into.length >= 2)
    return { op: "split", column: step.column, separator: step.separator, into: step.into };
  if (step.op === "merge" && step.columns.length >= 2 && step.into.trim())
    return { op: "merge", columns: step.columns, separator: step.separator, into: step.into };
  if (step.op === "join" && step.on && step.take.length >= 1 && step.range)
    return { op: "join", on: step.on, take: step.take, range: step.range };
  if (step.op === "append" && step.range) return { op: "append", range: step.range };
  return null;
}

export function rememberSheetStep(
  queries: SavedSheetQuery[] | undefined,
  step: SheetQueryStep,
): SavedSheetQuery[] {
  const document = queryDocument([documentStep(step)]);
  const rest = (queries ?? []).filter((item) => item.id !== "selection");
  return [...rest, { id: "selection", document }].slice(-20);
}

/** Keep a refresh wait on the file. A credential address is not stored. */
export function rememberSheetSchedule(
  queries: SavedSheetQuery[] | undefined,
  minutes: number,
  source: string,
): SavedSheetQuery[] {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    throw new Error("Name the wait in whole minutes.");
  }
  const problem = sourceUrlProblem(source);
  if (problem) throw new Error(problem);
  const rest = (queries ?? []).filter((item) => item.id !== "refresh");
  return [
    ...rest,
    { id: "refresh", document: queryDocument([]), everyMinutes: minutes, source },
  ].slice(-20);
}

export function savedSheetSchedule(
  queries: SavedSheetQuery[] | undefined,
): { everyMinutes: number; source: string } | null {
  const saved = (queries ?? []).find((item) => item.id === "refresh");
  if (!saved?.everyMinutes || !saved.source || sourceUrlProblem(saved.source)) return null;
  return { everyMinutes: saved.everyMinutes, source: saved.source };
}

export function forgetSheetSchedule(queries: SavedSheetQuery[] | undefined): SavedSheetQuery[] {
  return (queries ?? []).filter((item) => item.id !== "refresh");
}

/** Filter the current selection. The panel remembers the last output rectangle. */
export function SheetQueryPanel({
  disabled,
  initial,
  onApply,
  onCheck,
  onLocalTable,
  schedule,
  onRememberSchedule,
  onForgetSchedule,
}: {
  disabled: boolean;
  initial?: SheetQueryStep | { column: string; equals: string } | null;
  onApply: (step: SheetQueryStep, previous: SheetQueryPlacement | null) => SheetQueryResult;
  onCheck?: (step: SheetQueryStep) => string;
  onLocalTable?: (rows: QueryRow[]) => string | void;
  schedule?: { everyMinutes: number; source: string } | null;
  onRememberSchedule?: (minutes: number, source: string) => void;
  onForgetSchedule?: () => void;
}) {
  const previous = useRef<SheetQueryPlacement | null>(null);
  const stored = initial && "op" in initial ? initial : initial ? { op: "filter" as const, ...initial } : null;
  const [op, setOp] = useState<
    "filter" | "convert" | "sort" | "dedupe" | "group" | "split" | "merge" | "join" | "append"
  >(stored?.op ?? "filter");
  const [column, setColumn] = useState(
    stored?.op === "group" ? stored.by : stored?.op === "join" ? stored.on : stored && "column" in stored ? stored.column : "",
  );
  const [valueColumn, setValueColumn] = useState(stored?.op === "group" ? stored.value : "");
  const [aggregate, setAggregate] = useState<"sum" | "count" | "average" | "min" | "max">(
    stored?.op === "group" ? stored.aggregate : "sum",
  );
  const openedParameter =
    stored?.op === "filter" ? /^\{\{([A-Za-z][A-Za-z0-9]{0,40})\}\}$/.exec(stored.equals) : null;
  const [parameter, setParameter] = useState(openedParameter?.[1] ?? "");
  const [equals, setEquals] = useState(
    stored?.op === "filter" && !openedParameter ? stored.equals : "",
  );
  const [exclude, setExclude] = useState(stored?.op === "filter" && stored.match === "ne");
  const [contains, setContains] = useState(stored?.op === "filter" && stored.match === "contains");
  const [convertTo, setConvertTo] = useState<"number" | "text" | "date">(
    stored?.op === "convert" ? stored.to : "number",
  );
  const [direction, setDirection] = useState<"asc" | "desc">(
    stored?.op === "sort" ? stored.direction : "asc",
  );
  const [separator, setSeparator] = useState(stored?.op === "split" ? stored.separator : ", ");
  const [intoText, setIntoText] = useState(stored?.op === "split" ? stored.into.join(", ") : "");
  const [mergeText, setMergeText] = useState(stored?.op === "merge" ? stored.columns.join(", ") : "");
  const [mergeInto, setMergeInto] = useState(stored?.op === "merge" ? stored.into : "");
  const [takeText, setTakeText] = useState(stored?.op === "join" ? stored.take.join(", ") : "");
  const [lookupRange, setLookupRange] = useState(
    stored?.op === "join" || stored?.op === "append" ? stored.range : "",
  );
  const [message, setMessage] = useState("");
  const chosenStep = (): SheetQueryStep =>
    op === "convert"
      ? { op: "convert", column, to: convertTo }
      : op === "sort"
        ? { op: "sort", column, direction }
        : op === "dedupe"
          ? { op: "dedupe", column }
          : op === "group"
            ? { op: "group", by: column, value: valueColumn, aggregate }
            : op === "split"
              ? {
                  op: "split",
                  column,
                  separator,
                  into: intoText
                    .split(",")
                    .map((name) => name.trim())
                    .filter((name) => name.length > 0),
                }
              : op === "merge"
                ? {
                    op: "merge",
                    columns: mergeText
                      .split(",")
                      .map((name) => name.trim())
                      .filter((name) => name.length > 0),
                    separator,
                    into: mergeInto,
                  }
                : op === "join"
                  ? {
                      op: "join",
                      on: column,
                      take: takeText
                        .split(",")
                        .map((name) => name.trim())
                        .filter((name) => name.length > 0),
                      range: lookupRange,
                    }
                  : op === "append"
                    ? { op: "append", range: lookupRange }
                    : {
                        op: "filter",
                        column,
                        equals,
                        parameter,
                        parameterValue: equals,
                        ...(exclude ? { match: "ne" as const } : contains ? { match: "contains" as const } : {}),
                      };
  return (
    <section className="access-notes" aria-label="Sheet query">
      <h2>Sheet query</h2>
      <p>
        {op === "convert"
          ? "Converts one column and writes the table beside the selection. The source cells stay. Nothing is fetched."
          : op === "sort"
            ? "Sorts the selection and writes the table beside it. The source cells stay. Nothing is fetched."
            : op === "dedupe"
              ? "Keeps the first row for each value and writes that table beside the selection. The source cells stay. Nothing is fetched."
              : op === "group"
                ? "Groups the selection and writes the totals beside it. The source cells stay. Nothing is fetched."
                : op === "split"
                  ? "Splits one column and writes the table beside the selection. The source cells stay. Nothing is fetched."
                  : op === "merge"
                    ? "Merges columns and writes the table beside the selection. The source cells stay. Nothing is fetched."
                    : op === "join"
                      ? "Copies columns from a lookup range onto matching rows. The source cells stay. Nothing is fetched."
                      : op === "append"
                        ? "Stacks a lookup range under the selection. The source cells stay. Nothing is fetched."
                        : "Keeps rows from the selection whose column matches. Exclude this value keeps the other rows. The source stays, and the result is written beside it. Nothing is fetched."}
      </p>
      <LocalQueryFile onRows={(rows) => onLocalTable?.(rows)} />
      <label>
        Step
        <select
          aria-label="Query step"
          value={op}
          onChange={(event) => {
            const next = event.target.value;
            setOp(
              next === "convert" ||
                next === "sort" ||
                next === "dedupe" ||
                next === "group" ||
                next === "split" ||
                next === "merge" ||
                next === "join" ||
                next === "append"
                ? next
                : "filter",
            );
          }}
        >
          <option value="filter">Keep matching rows</option>
          <option value="convert">Convert a column</option>
          <option value="sort">Sort rows</option>
          <option value="dedupe">Drop duplicate rows</option>
          <option value="group">Group rows</option>
          <option value="split">Split a column</option>
          <option value="merge">Merge columns</option>
          <option value="join">Join a table</option>
          <option value="append">Append a table</option>
        </select>
      </label>
      {op === "merge" ? (
        <>
          <label>
            Columns
            <input
              aria-label="Merge columns"
              value={mergeText}
              onChange={(event) => setMergeText(event.target.value)}
            />
          </label>
          <label>
            Separator
            <input
              aria-label="Merge separator"
              value={separator}
              onChange={(event) => setSeparator(event.target.value)}
            />
          </label>
          <label>
            Into
            <input
              aria-label="Merge into"
              value={mergeInto}
              onChange={(event) => setMergeInto(event.target.value)}
            />
          </label>
        </>
      ) : op === "append" ? (
        <label>
          Lookup
          <input
            aria-label="Lookup range"
            value={lookupRange}
            onChange={(event) => setLookupRange(event.target.value)}
          />
        </label>
      ) : (
      <label>
        Column
        <input
          aria-label="Query column"
          value={column}
          onChange={(event) => setColumn(event.target.value)}
        />
      </label>
      )}
      {op === "convert" ? (
        <label>
          Convert to
          <select
            aria-label="Convert to"
            value={convertTo}
            onChange={(event) => {
              const next = event.target.value;
              setConvertTo(next === "text" || next === "date" ? next : "number");
            }}
          >
            <option value="number">Number</option>
            <option value="text">Text</option>
            <option value="date">Date</option>
          </select>
        </label>
      ) : op === "sort" ? (
        <label>
          Order
          <select
            aria-label="Sort order"
            value={direction}
            onChange={(event) => setDirection(event.target.value === "desc" ? "desc" : "asc")}
          >
            <option value="asc">A to Z</option>
            <option value="desc">Z to A</option>
          </select>
        </label>
      ) : op === "dedupe" ? (
        <p>The first row for each value is kept.</p>
      ) : op === "group" ? (
        <>
          <label>
            Value
            <input
              aria-label="Value column"
              value={valueColumn}
              onChange={(event) => setValueColumn(event.target.value)}
            />
          </label>
          <label>
            Total
            <select
              aria-label="Group total"
              value={aggregate}
              onChange={(event) =>
                setAggregate(
                  event.target.value === "count" ||
                    event.target.value === "average" ||
                    event.target.value === "min" ||
                    event.target.value === "max"
                    ? event.target.value
                    : "sum",
                )
              }
            >
              <option value="sum">Sum</option>
              <option value="count">Count</option>
              <option value="average">Average</option>
              <option value="min">Minimum</option>
              <option value="max">Maximum</option>
            </select>
          </label>
        </>
      ) : op === "split" ? (
        <>
          <label>
            Separator
            <input
              aria-label="Split separator"
              value={separator}
              onChange={(event) => setSeparator(event.target.value)}
            />
          </label>
          <label>
            Into
            <input
              aria-label="Split columns"
              value={intoText}
              onChange={(event) => setIntoText(event.target.value)}
            />
          </label>
        </>
      ) : op === "merge" || op === "append" ? null : op === "join" ? (
        <>
          <label>
            Copy
            <input
              aria-label="Join columns"
              value={takeText}
              onChange={(event) => setTakeText(event.target.value)}
            />
          </label>
          <label>
            Lookup
            <input
              aria-label="Lookup range"
              value={lookupRange}
              onChange={(event) => setLookupRange(event.target.value)}
            />
          </label>
        </>
      ) : (
        <>
          <label>
            Parameter
            <input
              aria-label="Query parameter"
              value={parameter}
              onChange={(event) => setParameter(event.target.value)}
            />
          </label>
          <label>
            Equals
            <input
              aria-label="Query value"
              value={equals}
              onChange={(event) => setEquals(event.target.value)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              aria-label="Exclude this value"
              checked={exclude}
              onChange={(event) => {
                setExclude(event.target.checked);
                if (event.target.checked) setContains(false);
              }}
            />
            Exclude this value
          </label>
          <label>
            <input
              type="checkbox"
              aria-label="Cell contains this text"
              checked={contains}
              onChange={(event) => {
                setContains(event.target.checked);
                if (event.target.checked) setExclude(false);
              }}
            />
            Cell contains this text
          </label>
        </>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          const step = chosenStep();
          const result = onApply(step, previous.current);
          previous.current = result.placement;
          setMessage(result.message);
        }}
      >
        Refresh
      </button>
      {onCheck ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setMessage(onCheck(chosenStep()));
          }}
        >
          Check columns
        </button>
      ) : null}
      <QueryRemap
        disabled={disabled}
        onRemap={(from, to) => {
          const result = remapStepColumn(chosenStep() as Parameters<typeof remapStepColumn>[0], from, to);
          if (!("step" in result)) return result.note;
          const step = result.step;
          if (step.op === "group") {
            setColumn(step.by);
            setValueColumn(step.value);
          } else if (step.op === "merge") {
            setMergeText(step.columns.join(", "));
            setMergeInto(step.into);
          } else if (step.op === "split") {
            setColumn(step.column);
            setIntoText(step.into.join(", "));
          } else if (step.op === "join") {
            setColumn(step.on);
            setTakeText(step.take.join(", "));
          } else if ("column" in step) {
            setColumn(step.column);
          }
          return result.note;
        }}
      />
      <QuerySchedule
        initial={schedule}
        onRemember={onRememberSchedule}
        onForget={onForgetSchedule}
        onRows={onLocalTable}
      />
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
