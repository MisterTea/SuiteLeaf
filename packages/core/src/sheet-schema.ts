import { z } from "zod";

export const rangeSchema = z.object({
  sheetId: z.string(),
  startRow: z.number().int().nonnegative(),
  endRow: z.number().int().nonnegative(),
  startColumn: z.number().int().nonnegative(),
  endColumn: z.number().int().nonnegative(),
});
export type SourceRange = z.infer<typeof rangeSchema>;
export const chartSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.enum(["bar", "line", "pie", "scatter", "waterfall", "histogram", "area", "combo", "stacked"]),
  source: rangeSchema,
  sheetId: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  invalid: z.boolean().optional(),
  excel: z
    .object({
      anchorResolved: z.boolean().optional(),
      series: z.array(
        z.object({
          name: z.string(),
          values: rangeSchema,
          color: z.string(),
          axis: z.number().optional(),
          marker: z.number().optional(),
          numberFormat: z.string().optional(),
        }),
      ),
      legend: z.string(),
      markers: z.boolean(),
      biff: z
        .object({
          axes: z.array(
            z.object({
              min: z.number().optional(),
              max: z.number().optional(),
              step: z.number().optional(),
            }),
          ),
          categories: z.array(z.string()),
          axisTitles: z.array(z.string()),
          annotations: z.array(z.string()),
          dataTable: z.boolean(),
        })
        .optional(),
      anchor: z.object({
        fromColumn: z.number(),
        fromRow: z.number(),
        fromColumnOffset: z.number(),
        fromRowOffset: z.number(),
        toColumn: z.number(),
        toRow: z.number(),
        toColumnOffset: z.number(),
        toRowOffset: z.number(),
      }),
    })
    .optional(),
});
export type ChartDefinition = z.infer<typeof chartSchema>;
export const pivotSchema = z.object({
  id: z.string(),
  title: z.string(),
  source: rangeSchema,
  targetSheetId: z.string(),
  rows: z.array(z.number().int().nonnegative()),
  columns: z.array(z.number().int().nonnegative()),
  value: z.number().int().nonnegative(),
  aggregate: z.enum(["SUM", "COUNT", "AVERAGE", "MIN", "MAX", "PERCENT"]),
  /** A field computed from each source number before the totals. The source cells stay as they were. */
  calculated: z
    .object({
      name: z.string().min(1).max(40),
      op: z.enum(["multiply", "add", "divide"]),
      amount: z.number().finite(),
    })
    .optional(),
  /** Each source row becomes left minus right before the totals. The source cells stay as they were. */
  difference: z
    .object({
      name: z.string().min(1).max(40),
      left: z.number().int().nonnegative(),
      right: z.number().int().nonnegative(),
    })
    .optional(),
  /** Extra summaries of the same rows. The first summary stays in `value` and `aggregate`. */
  measures: z
    .array(
      z.object({
        value: z.number().int().nonnegative(),
        aggregate: z.enum(["SUM", "COUNT", "AVERAGE", "MIN", "MAX", "PERCENT"]),
      }),
    )
    .max(4)
    .optional(),
  filterColumn: z.number().int().optional(),
  filterValue: z.string().optional(),
  /** Group an ISO date column by year or month before the totals are built. */
  dateColumn: z.number().int().nonnegative().optional(),
  dateGroup: z.enum(["year", "month", "quarter"]).optional(),
  /** Keep rows whose slicer cell is one of these values. An empty list keeps every row. */
  slicerColumn: z.number().int().nonnegative().optional(),
  slicerValues: z.array(z.string().max(80)).max(40).optional(),
  /** Order of the row labels. Absent means labels ascending. Value order needs one row field. */
  sort: z
    .object({
      by: z.enum(["label", "value"]),
      direction: z.enum(["asc", "desc"]),
    })
    .optional(),
  invalid: z.boolean().optional(),
});
export type PivotDefinition = z.infer<typeof pivotSchema>;
type NativeCell = {
  v?: string | number | boolean | null;
  f?: string | null;
  t?: number | null;
  s?: string | Record<string, unknown> | null;
  [key: string]: unknown;
} | null;
type NativeCells = Record<string, Record<string, NativeCell>>;
function validateCells(value: unknown): value is NativeCells {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  for (const r in value) {
    if (!/^\d+$/.test(r)) return false;
    const row = (value as Record<string, unknown>)[r];
    if (!row || typeof row !== "object" || Array.isArray(row)) return false;
    for (const c in row) {
      if (!/^\d+$/.test(c)) return false;
      const cell = (row as Record<string, unknown>)[c];
      if (cell === null) continue;
      if (!cell || typeof cell !== "object" || Array.isArray(cell))
        return false;
      const n = cell as Record<string, unknown>;
      if (
        n.v !== undefined &&
        n.v !== null &&
        typeof n.v !== "string" &&
        typeof n.v !== "boolean" &&
        (typeof n.v !== "number" || !Number.isFinite(n.v))
      )
        return false;
      if (n.f !== undefined && n.f !== null && typeof n.f !== "string")
        return false;
      if (
        n.t !== undefined &&
        n.t !== null &&
        (typeof n.t !== "number" || !Number.isInteger(n.t))
      )
        return false;
      if (
        n.s !== undefined &&
        n.s !== null &&
        typeof n.s !== "string" &&
        (typeof n.s !== "object" || Array.isArray(n.s))
      )
        return false;
    }
  }
  return true;
}
// Validate in place: deep-cloning millions of cells made large native imports
// and ordinary autosaves stall. The enclosing metadata still uses Zod schemas.
const cellMatrixSchema = z.custom<NativeCells>(validateCells, {
  error:
    "Worksheet cells contain invalid coordinates, values, formulas, types or styles.",
});
export const worksheetSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    rowCount: z.number().int().positive().max(1048576),
    columnCount: z.number().int().positive().max(16384),
    cellData: cellMatrixSchema.optional(),
  })
  .passthrough();
