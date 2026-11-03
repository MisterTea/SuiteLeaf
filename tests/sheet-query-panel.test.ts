import { expect, it } from "vitest";
import { createFile, parseFile, type SheetFile } from "../packages/core/src";
import { savedQuerySchema } from "../packages/core/src/sheet-query";
import {
  applySheetFilter,
  applySheetQuery,
  forgetSheetSchedule,
  rememberSheetQuery,
  rememberSheetSchedule,
  rememberSheetStep,
  savedSheetFilter,
  savedSheetSchedule,
  savedSheetStep,
  type QuerySheet,
  type SheetQueryPlacement,
} from "../apps/web/src/editors/sheet-query-panel";

function sheetFrom(values: unknown[][], occupied: unknown[][] = []): {
  host: QuerySheet;
  written: string[][] | null;
  cleared: SheetQueryPlacement | null;
} {
  let written: string[][] | null = null;
  let cleared: SheetQueryPlacement | null = null;
  const host: QuerySheet = {
    getSelection: () => ({
      getActiveRange: () => ({
        getRange: () => ({
          startRow: 0,
          startColumn: 0,
          endRow: values.length - 1,
          endColumn: (values[0]?.length ?? 1) - 1,
        }),
        getRawValues: () => values,
      }),
    }),
    getRange: (row, column, rows, columns) => ({
      getRawValues: () => occupied,
      setValues: (next) => {
        written = next;
      },
      clearContent: () => {
        cleared = { startRow: row, startColumn: column, rows, columns };
      },
    }),
  };
  return { host, get written() { return written; }, get cleared() { return cleared; } };
}

it("writes matching rows beside the selection and leaves the source unread for writing", () => {
  const fake = sheetFrom([
    ["Crop", "Count"],
    ["Tomato", "secret tomato count"],
    ["Basil", "1"],
  ]);
  const result = applySheetFilter(
    fake.host,
    { column: "Crop", equals: "Tomato" },
    null,
    "2026-10-31T00:00:00.000Z",
  );
  expect(result.changed).toBe(true);
  expect(result.placement).toEqual({ startRow: 0, startColumn: 3, rows: 2, columns: 2 });
  expect(result.message).not.toContain("secret tomato");
  expect(fake.written).toEqual([
    ["Crop", "Count"],
    ["Tomato", "secret tomato count"],
  ]);
  expect(fake.cleared).toBeNull();
});

it("refuses a destination cell that already has a value", () => {
  const fake = sheetFrom(
    [
      ["Crop", "Count"],
      ["Tomato", "4"],
    ],
    [["kept"]],
  );
  const result = applySheetFilter(
    fake.host,
    { column: "Crop", equals: "Tomato" },
    null,
    "2026-10-31T00:00:00.000Z",
  );
  expect(result.changed).toBe(false);
  expect(result.message).toBe("Row 1, column 4 already has a value.");
  expect(fake.written).toBeNull();
});

it("stores the filter on the spreadsheet and reads it back", () => {
  const file = createFile("sheet", "Beds") as SheetFile;
  file.content.queries = rememberSheetQuery(undefined, "crop", "Tomato");
  const reopened = parseFile(JSON.stringify(file));
  if (reopened.kind !== "sheet") throw new Error("expected a spreadsheet");
  expect(savedSheetFilter(reopened.content.queries)).toEqual({
    column: "crop",
    equals: "Tomato",
  });
  expect(JSON.stringify(reopened)).not.toContain("secret-value");
});

it("writes a converted number beside the selection and stores that step", () => {
  const fake = sheetFrom([
    ["amount"],
    ["010"],
  ]);
  const result = applySheetQuery(
    fake.host,
    { op: "convert", column: "amount", to: "number" },
    null,
    "2026-10-31T00:00:00.000Z",
  );
  expect(result.changed).toBe(true);
  expect(result.message).toContain("converted column");
  expect(result.message).not.toContain("010");
  expect(fake.written).toEqual([["amount"], ["10"]]);
  const bad = sheetFrom([["amount"], ["secret-value"]]);
  const failed = applySheetQuery(
    bad.host,
    { op: "convert", column: "amount", to: "number" },
    null,
    "2026-10-31T00:00:00.000Z",
  );
  expect(failed.changed).toBe(false);
  expect(failed.message).toContain("not a number");
  expect(failed.message).not.toContain("secret-value");
  expect(bad.written).toBeNull();
  const file = createFile("sheet", "Beds") as SheetFile;
  file.content.queries = rememberSheetStep(undefined, { op: "convert", column: "amount", to: "number" });
  const reopened = parseFile(JSON.stringify(file));
  if (reopened.kind !== "sheet") throw new Error("expected a spreadsheet");
  expect(savedSheetStep(reopened.content.queries)).toEqual({
    op: "convert",
    column: "amount",
    to: "number",
  });
  expect(savedSheetFilter(reopened.content.queries)).toBeNull();
});

it("writes rows sorted Z to A beside the selection and stores that step", () => {
  const values = [
    ["crop", "note"],
    ["Tomato", "kept"],
    ["Bean", "secret-value"],
  ];
  const fake = sheetFrom(values);
  const result = applySheetQuery(
    fake.host,
    { op: "sort", column: "crop", direction: "desc" },
    null,
    "2026-10-31T00:00:00.000Z",
  );
  expect(result.changed).toBe(true);
  expect(result.message).toBe(
    "The rows were sorted beside the selection. The source cells stayed.",
  );
  expect(result.message).not.toContain("secret-value");
  expect(fake.written).toEqual([
    ["crop", "note"],
    ["Tomato", "kept"],
    ["Bean", "secret-value"],
  ]);
  expect(values[2]).toEqual(["Bean", "secret-value"]);
  const missing = sheetFrom(values);
  const failed = applySheetQuery(
    missing.host,
    { op: "sort", column: "plot", direction: "asc" },
    null,
    "2026-10-31T00:00:00.000Z",
  );
  expect(failed.changed).toBe(false);
  expect(failed.message).toContain("plot");
  expect(failed.message).not.toContain("secret-value");
  expect(missing.written).toBeNull();
  const unnamed = applySheetQuery(
    fake.host,
    { op: "sort", column: "  ", direction: "asc" },
    null,
    "2026-10-31T00:00:00.000Z",
  );
  expect(unnamed.message).toBe("Name the column to sort.");
  const file = createFile("sheet", "Beds") as SheetFile;
  file.content.queries = rememberSheetStep(undefined, {
    op: "sort",
    column: "crop",
    direction: "desc",
  });
  const reopened = parseFile(JSON.stringify(file));
  if (reopened.kind !== "sheet") throw new Error("expected a spreadsheet");
  expect(savedSheetStep(reopened.content.queries)).toEqual({
    op: "sort",
    column: "crop",
    direction: "desc",
  });
});

it("keeps the first row of each value and stores that step", () => {
  const values = [
    ["crop", "note"],
    ["Tomato", "kept"],
    ["Tomato", "secret-value"],
    ["Bean", "south"],
  ];
  const fake = sheetFrom(values);
  const result = applySheetQuery(
    fake.host,
    { op: "dedupe", column: "crop" },
    null,
    "2026-10-31T00:00:00.000Z",
  );
  expect(result.changed).toBe(true);
  expect(result.message).toBe(
    "The first row of each value was written beside the selection. The source cells stayed.",
  );
  expect(result.message).not.toContain("secret-value");
  expect(fake.written).toEqual([
    ["crop", "note"],
    ["Tomato", "kept"],
    ["Bean", "south"],
  ]);
  expect(values[2]).toEqual(["Tomato", "secret-value"]);
  const missing = applySheetQuery(
    sheetFrom(values).host,
    { op: "dedupe", column: "plot" },
    null,
    "2026-10-31T00:00:00.000Z",
  );
  expect(missing.changed).toBe(false);
  expect(missing.message).toContain("plot");
  expect(missing.message).not.toContain("secret-value");
  const unnamed = applySheetQuery(
    fake.host,
    { op: "dedupe", column: " " },
    null,
    "2026-10-31T00:00:00.000Z",
  );
  expect(unnamed.message).toBe("Name the column to check for duplicates.");
  const file = createFile("sheet", "Beds") as SheetFile;
  file.content.queries = rememberSheetStep(undefined, { op: "dedupe", column: "crop" });
  const reopened = parseFile(JSON.stringify(file));
  if (reopened.kind !== "sheet") throw new Error("expected a spreadsheet");
  expect(savedSheetStep(reopened.content.queries)).toEqual({ op: "dedupe", column: "crop" });
});

it("sums a column by group and skips a value that is not a number", () => {
  const values = [
    ["bed", "amount"],
    ["North", "10"],
    ["North", "5"],
    ["North", "secret-value"],
    ["South", "3"],
  ];
  const fake = sheetFrom(values);
  const result = applySheetQuery(
    fake.host,
    { op: "group", by: "bed", value: "amount", aggregate: "sum" },
    null,
    "2026-10-31T00:00:00.000Z",
  );
  expect(result.changed).toBe(true);
  expect(result.message).toBe(
    "The grouped rows were written beside the selection. The source cells stayed.",
  );
  expect(result.message).not.toContain("secret-value");
  expect(fake.written).toEqual([
    ["bed", "amount"],
    ["North", "15"],
    ["South", "3"],
  ]);
  expect(values[3]).toEqual(["North", "secret-value"]);
  const missing = applySheetQuery(
    sheetFrom(values).host,
    { op: "group", by: "plot", value: "amount", aggregate: "sum" },
    null,
    "2026-10-31T00:00:00.000Z",
  );
  expect(missing.changed).toBe(false);
  expect(missing.message).toContain("plot");
  expect(missing.message).not.toContain("secret-value");
  const unnamed = applySheetQuery(
    fake.host,
    { op: "group", by: " ", value: "amount", aggregate: "sum" },
    null,
    "2026-10-31T00:00:00.000Z",
  );
  expect(unnamed.message).toBe("Name the column to group by.");
  const file = createFile("sheet", "Beds") as SheetFile;
  file.content.queries = rememberSheetStep(undefined, {
    op: "group",
    by: "bed",
    value: "amount",
    aggregate: "count",
  });
  const reopened = parseFile(JSON.stringify(file));
  if (reopened.kind !== "sheet") throw new Error("expected a spreadsheet");
  expect(savedSheetStep(reopened.content.queries)).toEqual({
    op: "group",
    by: "bed",
    value: "amount",
    aggregate: "count",
  });
});

it("splits one column into the named columns and leaves the source", () => {
  const values = [
    ["crop", "plot"],
    ["Tomato", "North, kept"],
    ["Bean", "South, secret-value"],
  ];
  const fake = sheetFrom(values);
  const result = applySheetQuery(
    fake.host,
    { op: "split", column: "plot", separator: ", ", into: ["bed", "note"] },
    null,
    "2026-10-31T00:00:00.000Z",
  );
  expect(result.changed).toBe(true);
  expect(result.message).toBe(
    "The split columns were written beside the selection. The source cells stayed.",
  );
  expect(result.message).not.toContain("secret-value");
  expect(fake.written).toEqual([
    ["crop", "bed", "note"],
    ["Tomato", "North", "kept"],
    ["Bean", "South", "secret-value"],
  ]);
  expect(values[2]).toEqual(["Bean", "South, secret-value"]);
  const uneven = applySheetQuery(
    sheetFrom(values).host,
    { op: "split", column: "plot", separator: ", ", into: ["bed", "note", "extra"] },
    null,
    "2026-10-31T00:00:00.000Z",
  );
  expect(uneven.changed).toBe(false);
  expect(uneven.message).toContain("plot");
  expect(uneven.message).not.toContain("secret-value");
  const unnamed = applySheetQuery(
    fake.host,
    { op: "split", column: " ", separator: ", ", into: ["bed", "note"] },
    null,
    "2026-10-31T00:00:00.000Z",
  );
  expect(unnamed.message).toBe("Name the column to split.");
  const file = createFile("sheet", "Beds") as SheetFile;
  file.content.queries = rememberSheetStep(undefined, {
    op: "split",
    column: "plot",
    separator: ", ",
    into: ["bed", "note"],
  });
  const reopened = parseFile(JSON.stringify(file));
  if (reopened.kind !== "sheet") throw new Error("expected a spreadsheet");
  expect(savedSheetStep(reopened.content.queries)).toEqual({
    op: "split",
    column: "plot",
    separator: ", ",
    into: ["bed", "note"],
  });
});

it("merges columns into one and leaves the source", () => {
  const values = [
    ["crop", "bed", "note"],
    ["Tomato", "North", "kept"],
    ["Bean", "South", "secret-value"],
  ];
  const fake = sheetFrom(values);
  const result = applySheetQuery(
    fake.host,
    { op: "merge", columns: ["bed", "note"], separator: ", ", into: "plot" },
    null,
    "2026-10-31T00:00:00.000Z",
  );
  expect(result.changed).toBe(true);
  expect(result.message).toBe(
    "The merged column was written beside the selection. The source cells stayed.",
  );
  expect(result.message).not.toContain("secret-value");
  expect(fake.written).toEqual([
    ["crop", "plot"],
    ["Tomato", "North, kept"],
    ["Bean", "South, secret-value"],
  ]);
  expect(values[2]).toEqual(["Bean", "South", "secret-value"]);
  const missing = applySheetQuery(
    sheetFrom(values).host,
    { op: "merge", columns: ["bed", "plot"], separator: ", ", into: "place" },
    null,
    "2026-10-31T00:00:00.000Z",
  );
  expect(missing.changed).toBe(false);
  expect(missing.message).toContain("plot");
  expect(missing.message).not.toContain("secret-value");
  const unnamed = applySheetQuery(
    fake.host,
    { op: "merge", columns: ["bed"], separator: ", ", into: "plot" },
    null,
    "2026-10-31T00:00:00.000Z",
  );
  expect(unnamed.message).toBe("Name at least two columns to merge.");
  const file = createFile("sheet", "Beds") as SheetFile;
  file.content.queries = rememberSheetStep(undefined, {
    op: "merge",
    columns: ["bed", "note"],
    separator: ", ",
    into: "plot",
  });
  const reopened = parseFile(JSON.stringify(file));
  if (reopened.kind !== "sheet") throw new Error("expected a spreadsheet");
  expect(savedSheetStep(reopened.content.queries)).toEqual({
    op: "merge",
    columns: ["bed", "note"],
    separator: ", ",
    into: "plot",
  });
});

function sheetWithLookup(
  values: unknown[][],
  lookupRow: number,
  lookupColumn: number,
  lookup: unknown[][],
) {
  const fake = sheetFrom(values);
  const host: QuerySheet = {
    ...fake.host,
    getRange: (row, column, rows, columns) => {
      if (
        row === lookupRow &&
        column === lookupColumn &&
        rows === lookup.length &&
        columns === (lookup[0]?.length ?? 0)
      ) {
        return {
          getRawValues: () => lookup,
          setValues: () => {},
          clearContent: () => {},
        };
      }
      return fake.host.getRange(row, column, rows, columns);
    },
  };
  return {
    host,
    get written() {
      return fake.written;
    },
    get cleared() {
      return fake.cleared;
    },
  };
}

it("joins a lookup range and leaves a second match behind", () => {
  const values = [
    ["bed", "crop"],
    ["North", "Tomato"],
    ["South", "Bean"],
  ];
  const lookup = [
    ["bed", "note"],
    ["North", "kept"],
    ["North", "secret-value"],
    ["West", "secret-value"],
  ];
  const fake = sheetWithLookup(values, 0, 4, lookup);
  const result = applySheetQuery(
    fake.host,
    { op: "join", on: "bed", take: ["note"], range: "E1:F4" },
    null,
    "2026-10-31T00:00:00.000Z",
  );
  expect(result.changed).toBe(true);
  expect(result.message).not.toContain("secret-value");
  expect(fake.written).toEqual([
    ["bed", "crop", "note"],
    ["North", "Tomato", "kept"],
    ["South", "Bean", ""],
  ]);
  expect(values[1]).toEqual(["North", "Tomato"]);
  const missing = applySheetQuery(
    fake.host,
    { op: "join", on: "bed", take: ["plot"], range: "E1:F4" },
    null,
    "2026-10-31T00:00:00.000Z",
  );
  expect(missing.changed).toBe(false);
  expect(missing.message).toContain("plot");
  expect(missing.message).not.toContain("secret-value");
  const unnamed = applySheetQuery(
    fake.host,
    { op: "join", on: "", take: ["note"], range: "E1:F4" },
    null,
    "2026-10-31T00:00:00.000Z",
  );
  expect(unnamed.message).toBe("Name the column to join on.");
  const secret = applySheetQuery(
    fake.host,
    { op: "join", on: "bed", take: ["note"], range: "secret-value" },
    null,
    "2026-10-31T00:00:00.000Z",
  );
  expect(secret.changed).toBe(false);
  expect(secret.message).not.toContain("secret-value");
  const file = createFile("sheet", "Beds") as SheetFile;
  file.content.queries = rememberSheetStep(undefined, {
    op: "join",
    on: "bed",
    take: ["note"],
    range: "E1:F4",
  });
  const reopened = parseFile(JSON.stringify(file));
  if (reopened.kind !== "sheet") throw new Error("expected a spreadsheet");
  expect(savedSheetStep(reopened.content.queries)).toEqual({
    op: "join",
    on: "bed",
    take: ["note"],
    range: "E1:F4",
  });
});

it("appends a lookup range under the selection", () => {
  const values = [
    ["bed", "crop"],
    ["North", "Tomato"],
  ];
  const lookup = [
    ["bed", "crop", "note"],
    ["West", "Pea", "secret-value"],
  ];
  const fake = sheetWithLookup(values, 0, 4, lookup);
  const result = applySheetQuery(
    fake.host,
    { op: "append", range: "E1:G2" },
    null,
    "2026-10-31T00:00:00.000Z",
  );
  expect(result.changed).toBe(true);
  expect(result.message).not.toContain("secret-value");
  expect(fake.written).toEqual([
    ["bed", "crop", "note"],
    ["North", "Tomato", ""],
    ["West", "Pea", "secret-value"],
  ]);
  expect(values[1]).toEqual(["North", "Tomato"]);
  const unnamed = applySheetQuery(
    fake.host,
    { op: "append", range: "" },
    null,
    "2026-10-31T00:00:00.000Z",
  );
  expect(unnamed.message).toBe("Name the lookup range.");
  const file = createFile("sheet", "Beds") as SheetFile;
  file.content.queries = rememberSheetStep(undefined, { op: "append", range: "E1:F2" });
  const reopened = parseFile(JSON.stringify(file));
  if (reopened.kind !== "sheet") throw new Error("expected a spreadsheet");
  expect(savedSheetStep(reopened.content.queries)).toEqual({ op: "append", range: "E1:F2" });
});

it("stores a parameter name and uses the value only for this refresh", () => {
  const saved = rememberSheetStep(undefined, {
    op: "filter",
    column: "bed",
    equals: "North",
    parameter: "plot",
    parameterValue: "North",
  });
  expect(JSON.stringify(saved)).toContain("{{plot}}");
  expect(JSON.stringify(saved)).not.toContain("North");
  expect(JSON.stringify(saved)).not.toContain("secret-value");
  const fake = sheetFrom([
    ["bed", "crop"],
    ["North", "Tomato"],
    ["secret-value", "Bean"],
  ]);
  const result = applySheetQuery(
    fake.host,
    {
      op: "filter",
      column: "bed",
      equals: "North",
      parameter: "plot",
      parameterValue: "North",
    },
    null,
    "2026-11-01T00:00:00.000Z",
  );
  expect(result.changed).toBe(true);
  expect(fake.written).toEqual([
    ["bed", "crop"],
    ["North", "Tomato"],
  ]);
  expect(JSON.stringify(fake.written)).not.toContain("secret-value");
  const refused = applySheetQuery(
    fake.host,
    {
      op: "filter",
      column: "bed",
      equals: "North",
      parameter: "secret-value",
      parameterValue: "North",
    },
    null,
    "2026-11-01T00:00:00.000Z",
  );
  expect(refused.changed).toBe(false);
  expect(refused.message).toBe("Name the parameter with letters and digits.");
  expect(refused.message).not.toContain("secret-value");
});

it("keeps a refresh wait on the file and refuses a credential address", () => {
  const before = [{ id: "selection", document: { version: 1 as const, steps: [] } }];
  const copy = structuredClone(before);
  expect(() =>
    rememberSheetSchedule(before, 15, "https://example.test?token=secret-value"),
  ).toThrow("The source address cannot include a credential.");
  expect(before).toEqual(copy);
  const saved = rememberSheetSchedule(before, 15, "https://example.test/rows.json");
  expect(savedSheetSchedule(saved)).toEqual({
    everyMinutes: 15,
    source: "https://example.test/rows.json",
  });
  expect(savedQuerySchema.safeParse(saved.find((item) => item.id === "refresh")).success).toBe(true);
  const bad = savedQuerySchema.safeParse({
    id: "refresh",
    document: { version: 1, steps: [] },
    everyMinutes: 15,
    source: "https://example.test?token=secret-value",
  });
  expect(bad.success).toBe(false);
  if (!bad.success) {
    expect(bad.error.issues[0]?.message).toBe("The source address cannot include a credential.");
    expect(bad.error.issues.map((issue) => issue.message).join(" ")).not.toContain("secret-value");
  }
  expect(forgetSheetSchedule(saved)).toEqual(before);
  const file = createFile("sheet");
  file.content.queries = saved;
  const parsed = parseFile(JSON.stringify(file)) as SheetFile;
  expect(savedSheetSchedule(parsed.content.queries)).toEqual({
    everyMinutes: 15,
    source: "https://example.test/rows.json",
  });
});
