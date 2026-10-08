import { z } from "zod";

export type Kind = "doc" | "sheet" | "slide";
export type JsonNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: JsonNode[];
};
const node: z.ZodType<JsonNode> = z.lazy(() =>
  z.object({
    type: z.string(),
    text: z.string().optional(),
    attrs: z.record(z.string(), z.unknown()).optional(),
    marks: z
      .array(
        z.object({
          type: z.string(),
          attrs: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .optional(),
    content: z.array(node).optional(),
  }),
);
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
  type: z.enum(["bar", "line", "pie", "scatter"]),
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
        z.object({ name: z.string(), values: rangeSchema, color: z.string() }),
      ),
      legend: z.string(),
      markers: z.boolean(),
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
  aggregate: z.enum(["SUM", "COUNT", "AVERAGE", "MIN", "MAX"]),
  filterColumn: z.number().int().optional(),
  filterValue: z.string().optional(),
  invalid: z.boolean().optional(),
});
export type PivotDefinition = z.infer<typeof pivotSchema>;
export const slideElementSchema = z.object({
  id: z.string(),
  type: z.enum(["text", "shape", "image", "table"]),
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  rotation: z.number().optional(),
  content: z.string().optional(),
  fontSize: z.number().optional(),
  fontFamily: z.string().optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  color: z.string().optional(),
  align: z.enum(["left", "center", "right", "justify"]).optional(),
  bullet: z.boolean().optional(),
  shapeType: z
    .enum(["rect", "roundRect", "ellipse", "line", "arrow"])
    .optional(),
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().optional(),
  src: z.string().optional(),
  alt: z.string().optional(),
  rows: z.array(z.array(z.string())).optional(),
});
export type SlideElement = z.infer<typeof slideElementSchema>;
export const slideSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  background: z
    .object({
      color: z.string().optional(),
      image: z.string().optional(),
    })
    .optional(),
  layout: z
    .enum(["title", "title-body", "section", "two-column", "blank"])
    .optional(),
  elements: z.array(slideElementSchema),
  notes: z.string().optional(),
});
export type Slide = z.infer<typeof slideSchema>;
export const presentationSchema = z.object({
  id: z.string(),
  width: z.number().positive(),
  height: z.number().positive(),
  slideOrder: z.array(z.string()),
  slides: z.record(z.string(), slideSchema),
});
export type Presentation = z.infer<typeof presentationSchema>;
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
const worksheetSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    rowCount: z.number().int().positive().max(1048576),
    columnCount: z.number().int().positive().max(16384),
    cellData: cellMatrixSchema.optional(),
  })
  .passthrough();
const meta = {
  importInfo: z
    .object({
      sourceFormat: z.enum(["docx", "xlsx", "xls", "xlsm", "xlsb", "xltx"]),
      sourceName: z.string(),
      warnings: z.array(z.string()),
      features: z.array(z.string()),
    })
    .optional(),
  format: z.literal("suiteleaf"),
  version: z.literal(1),
  id: z.string().min(1),
  title: z.string().min(1).max(200),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
};
export const fileSchema = z.discriminatedUnion("kind", [
  z.object({ ...meta, kind: z.literal("doc"), content: node }),
  z.object({
    ...meta,
    kind: z.literal("sheet"),
    content: z.object({
      workbook: z
        .object({
          id: z.string(),
          sheetOrder: z.array(z.string()),
          sheets: z.record(z.string(), worksheetSchema),
        })
        .passthrough(),
      images: z
        .array(
          z.object({
            id: z.string(),
            sheetId: z.string(),
            src: z
              .string()
              .regex(/^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,/i),
            row: z.number().int().nonnegative(),
            column: z.number().int().nonnegative(),
            to: z
              .object({
                row: z.number().int().nonnegative(),
                column: z.number().int().nonnegative(),
                offsetX: z.number().finite(),
                offsetY: z.number().finite(),
              })
              .optional(),
            offsetX: z.number().finite(),
            offsetY: z.number().finite(),
            width: z.number().positive().finite(),
            height: z.number().positive().finite(),
            anchorType: z.enum(["0", "1", "2"]),
          }),
        )
        .optional(),
      charts: z.array(chartSchema),
      pivots: z.array(pivotSchema),
    }),
  }),
  z.object({
    ...meta,
    kind: z.literal("slide"),
    content: presentationSchema,
  }),
]);
export type SuiteFile = z.infer<typeof fileSchema>;
export type DocFile = Extract<SuiteFile, { kind: "doc" }>;
export type SheetFile = Extract<SuiteFile, { kind: "sheet" }>;
export type SlideFile = Extract<SuiteFile, { kind: "slide" }>;
export function safeLink(url: string): boolean {
  return /^(https?:|mailto:|tel:|#)/i.test(url);
}
function validateTree(n: JsonNode, depth = 0) {
  if (depth > 100) throw new Error("Document is nested too deeply.");
  if (
    n.type === "image" &&
    !/^data:image\/(png|jpeg|gif|webp);base64,/i.test(String(n.attrs?.src))
  )
    throw new Error(
      "Native images must be embedded PNG, JPEG, GIF, or WebP data.",
    );
  for (const m of n.marks ?? [])
    if (m.type === "link" && !safeLink(String(m.attrs?.href)))
      throw new Error("Unsafe document link.");
  for (const c of n.content ?? []) validateTree(c, depth + 1);
}
export function parseFile(text: string): SuiteFile {
  if (new TextEncoder().encode(text).length > 200 * 1024 * 1024)
    throw new Error("Native files must be smaller than 200 MB.");
  const raw = JSON.parse(text);
  if (raw.version !== 1)
    throw new Error("This SuiteLeaf file version is not supported.");
  const file = fileSchema.parse(raw);
  if (file.kind === "doc") {
    if (file.content.type !== "doc") throw new Error("Invalid document root.");
    validateTree(file.content);
  } else if (file.kind === "sheet") {
    if (
      new Set(file.content.workbook.sheetOrder).size !==
        file.content.workbook.sheetOrder.length ||
      !file.content.workbook.sheetOrder.length
    )
      throw new Error("Workbook must have distinct worksheets.");
    for (const id of file.content.workbook.sheetOrder)
      if (!file.content.workbook.sheets[id])
        throw new Error("Workbook contains a missing worksheet.");
    for (const item of [...file.content.charts, ...file.content.pivots])
      if (
        item.source.endRow < item.source.startRow ||
        item.source.endColumn < item.source.startColumn
      )
        throw new Error("Invalid source range.");
  } else if (file.kind === "slide") {
    if (
      new Set(file.content.slideOrder).size !==
        file.content.slideOrder.length ||
      !file.content.slideOrder.length
    )
      throw new Error("Presentation must have distinct slides.");
    for (const id of file.content.slideOrder)
      if (!file.content.slides[id])
        throw new Error("Presentation contains a missing slide.");
    for (const s of Object.values(file.content.slides)) {
      for (const el of s.elements) {
        if (
          el.type === "image" &&
          el.src &&
          !/^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,/i.test(el.src)
        )
          throw new Error(
            "Native images must be embedded PNG, JPEG, GIF, WebP, or SVG data.",
          );
      }
    }
  }
  return file;
}
export function serializeFile(file: SuiteFile): string {
  return JSON.stringify(parseFile(JSON.stringify(file)));
}
export function createFile(
  kind: Kind,
  title = kind === "doc"
    ? "Untitled document"
    : kind === "sheet"
      ? "Untitled spreadsheet"
      : "Untitled presentation",
): SuiteFile {
  const id = crypto.randomUUID(),
    now = new Date().toISOString();
  const base = {
    format: "suiteleaf" as const,
    version: 1 as const,
    id,
    title,
    createdAt: now,
    updatedAt: now,
  };
  if (kind === "doc")
    return {
      ...base,
      kind,
      content: { type: "doc", content: [{ type: "paragraph" }] },
    };
  if (kind === "slide") {
    const slideId = crypto.randomUUID();
    return {
      ...base,
      kind,
      content: {
        id,
        width: 960,
        height: 540,
        slideOrder: [slideId],
        slides: {
          [slideId]: {
            id: slideId,
            title: "Untitled slide",
            layout: "title",
            elements: [
              {
                id: crypto.randomUUID(),
                type: "text",
                x: 100,
                y: 160,
                width: 760,
                height: 100,
                content: title,
                fontSize: 44,
                bold: true,
                align: "center",
                color: "#1e293b",
              },
              {
                id: crypto.randomUUID(),
                type: "text",
                x: 100,
                y: 280,
                width: 760,
                height: 60,
                content: "Click to add subtitle",
                fontSize: 22,
                align: "center",
                color: "#64748b",
              },
            ],
            notes: "",
          },
        },
      },
    };
  }
  const sheetId = crypto.randomUUID();
  return {
    ...base,
    kind,
    content: {
      workbook: {
        id,
        name: title,
        appVersion: "1.0.3",
        locale: "enUS",
        styles: {},
        sheetOrder: [sheetId],
        sheets: {
          [sheetId]: {
            id: sheetId,
            name: "Sheet1",
            rowCount: 1000,
            columnCount: 26,
            cellData: {},
            defaultColumnWidth: 100,
            defaultRowHeight: 24,
          },
        },
      },
      charts: [],
      pivots: [],
    },
  };
}
export function duplicateFile(file: SuiteFile): SuiteFile {
  const copy = structuredClone(file);
  copy.id = crypto.randomUUID();
  copy.title = `${file.title.slice(0, 190)} copy`;
  copy.createdAt = copy.updatedAt = new Date().toISOString();
  if (copy.kind === "sheet") copy.content.workbook.id = copy.id;
  if (copy.kind === "slide") copy.content.id = copy.id;
  return copy;
}
export { parsePowerPoint } from "./pptx";
export function filename(title: string, extension = "suiteleaf") {
  return `${
    title
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .trim()
      .slice(0, 150) || "Untitled"
  }.${extension}`;
}
export interface FileRecord {
  file: SuiteFile;
  path?: string;
  fingerprint?: string;
  recovery?: boolean;
}
export interface StorageAdapter {
  list(): Promise<FileRecord[]>;
  get(id: string): Promise<FileRecord | undefined>;
  save(record: FileRecord): Promise<FileRecord>;
  remove(id: string): Promise<void>;
  open(): Promise<FileRecord | null>;
  saveAs(record: FileRecord): Promise<FileRecord | null>;
  reload(id: string): Promise<FileRecord | undefined>;
}
export interface DesktopBridge {
  list(): Promise<FileRecord[]>;
  get(id: string): Promise<FileRecord | undefined>;
  save(record: FileRecord): Promise<FileRecord>;
  remove(id: string): Promise<void>;
  open(): Promise<FileRecord | null>;
  saveAs(record: FileRecord): Promise<FileRecord | null>;
  reload(id: string): Promise<FileRecord | undefined>;
  exportFile(name: string, text: string): Promise<void>;
  print(title?: string): Promise<void>;
  onMenu(callback: (action: string) => void): () => void;
  setDirty(dirty: boolean): void;
}
export function columnName(index: number): string {
  let s = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
export function rangeLabel(r: SourceRange) {
  return `${columnName(r.startColumn)}${r.startRow + 1}:${columnName(r.endColumn)}${r.endRow + 1}`;
}
export function parseRange(a1: string, sheetId: string): SourceRange {
  const m = /^\$?([A-Z]+)\$?([1-9]\d*)(?::\$?([A-Z]+)\$?([1-9]\d*))?$/i.exec(
    a1.trim(),
  );
  if (!m) throw new Error("Use a cell range such as A1:D20.");
  const col = (s: string) =>
    [...s.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  const r = {
    sheetId,
    startRow: +m[2] - 1,
    endRow: +(m[4] ?? m[2]) - 1,
    startColumn: col(m[1]),
    endColumn: col(m[3] ?? m[1]),
  };
  if (
    r.endRow < r.startRow ||
    r.endColumn < r.startColumn ||
    (r.endRow - r.startRow + 1) * (r.endColumn - r.startColumn + 1) > 200000
  )
    throw new Error("Choose an ordered range of at most 200,000 cells.");
  return r;
}
