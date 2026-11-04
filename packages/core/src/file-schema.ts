import { savedQuerySchema } from "./sheet-query";
import { chartSchema, pivotSchema, worksheetSchema } from "./sheet-schema";
import { presentationSchema } from "./slide-schema";
import { z } from "zod";

export type Kind = "doc" | "sheet" | "slide" | "form" | "drawing";
/** The text a drawing is kept as: an SVG picture, a Mermaid diagram, or a Graphviz graph. */
export const DRAWING_FORMATS = ["svg", "mermaid", "graphviz"] as const;
export type DrawingFormat = (typeof DRAWING_FORMATS)[number];
export const DRAWING_SOURCE_CHARS = 5_000_000;
export const drawingContentSchema = z.object({
  format: z.enum(DRAWING_FORMATS),
  source: z.string().max(DRAWING_SOURCE_CHARS),
});
export type DrawingContent = z.infer<typeof drawingContentSchema>;
/** What a new drawing of each kind starts with. */
export const DRAWING_STARTERS: Record<DrawingFormat, string> = {
  svg: `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">
  <rect x="80" y="80" width="200" height="120" rx="12" fill="#e8f0fe" stroke="#1a73e8" stroke-width="2"/>
  <ellipse cx="460" cy="260" rx="100" ry="60" fill="#fef7e0" stroke="#f9ab00" stroke-width="2"/>
  <text x="180" y="146" font-family="sans-serif" font-size="20" text-anchor="middle" fill="#202124">Hello</text>
</svg>
`,
  mermaid: `flowchart TD
    A[Start] --> B{Is it working?}
    B -->|Yes| C[Ship it]
    B -->|No| D[Fix it]
    D --> B
`,
  graphviz: `digraph G {
    rankdir=LR;
    node [shape=box, style=rounded];
    start [label="Start"];
    build [label="Build"];
    ship [label="Ship"];
    start -> build;
    build -> ship;
}
`,
};
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
const meta = {
  importInfo: z
    .object({
      sourceFormat: z.enum([
        "docx",
        "docm",
        "dotx",
        "dotm",
        "doc",
        "dot",
        "xlsx",
        "xlsm",
        "xlsb",
        "xltx",
        "xls",
        "pptx",
        "ppt",
        "ppsx",
        "pptm",
        "potx",
        "ppsm",
        "odt",
        "ott",
        "fodt",
        "ods",
        "fods",
        "odp",
        "fodp",
        "rtf",
      ]),
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
const formQuestionSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().max(200),
  kind: z.enum(["text", "choice", "rating", "grid", "file", "number"]),
  required: z.boolean(),
  choices: z.array(z.string().max(80)).max(20).optional(),
  branches: z
    .array(z.object({ when: z.string().max(80), next: z.string().min(1).max(80) }))
    .max(20)
    .optional(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  points: z.number().int().min(1).max(1000).optional(),
  answer: z.string().max(80).optional(),
  rows: z.array(z.string().max(80)).max(20).optional(),
  columns: z.array(z.string().max(80)).max(20).optional(),
});
/**
 * Text, choice, and rating answers. A grid is JSON around those labels, so
 * it is not held to this.
 */
const ANSWER_CHARS = 2_000;
/**
 * A form label is at most 80 characters. Twenty labels, each answered with
 * an 80-character column, are 3,200 characters of cells.
 */
const GRID_CELL_CHARS = 20 * 80 * 2;
/**
 * JSON quotes and escaping around that grid. Anything larger is rejected
 * before it is parsed.
 */
const GRID_ENVELOPE_CHARS = 32_768;
function charCount(value: string): number {
  return [...value].length;
}
/** Row and column characters, or null when the answer is not one object of strings. */
function gridCellChars(value: string): number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return null;
  let cells = 0;
  for (const [row, column] of Object.entries(parsed)) {
    if (typeof column !== "string") return null;
    cells += charCount(row) + charCount(column);
  }
  return cells;
}
function formAnswerFits(kind: string | undefined, value: string): boolean {
  const length = charCount(value);
  if (length > GRID_ENVELOPE_CHARS) return false;
  if (kind !== "grid") return length <= ANSWER_CHARS;
  if (length <= ANSWER_CHARS) return true;
  const cells = gridCellChars(value);
  return cells !== null && cells <= GRID_CELL_CHARS;
}
const formResponseSchema = z.object({
  id: z.string().min(1),
  at: z.string().datetime(),
  answers: z.record(z.string(), z.string().max(GRID_ENVELOPE_CHARS)),
  score: z.number().int().nonnegative().max(100_000).optional(),
  possible: z.number().int().nonnegative().max(100_000).optional(),
});
/** A tab after the first. The first tab's body stays in `content`. */
const docTabSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(80),
  content: node,
});
export type DocTab = z.infer<typeof docTabSchema>;
const collaboratorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
});
/** Edit metadata only. The op is not interpreted while the file opens. */
const editSchema = z.object({
  id: z.string().min(1),
  at: z.string().datetime(),
  by: collaboratorSchema,
  op: z.unknown(),
});
/**
 * A checkpoint. `content` is the snapshot to copy back; it is not validated
 * until that version is previewed or restored.
 */
const versionSchema = z.object({
  id: z.string().min(1),
  at: z.string().datetime(),
  by: collaboratorSchema,
  summary: z.string().min(1).max(200),
  label: z.string().min(1).max(80).optional(),
  title: z.string().min(1).max(200),
  throughEdit: z.string().min(1),
  content: z.unknown(),
});
const historyFields = {
  edits: z.array(editSchema).optional(),
  versions: z.array(versionSchema).optional(),
};
export const fileSchema = z.discriminatedUnion("kind", [
  z.object({
    ...meta,
    ...historyFields,
    kind: z.literal("doc"),
    content: node,
    properties: z
      .object({
        author: z.string().max(200),
        subject: z.string().max(200),
        keywords: z.array(z.string().max(80)).max(20),
        description: z.string().max(2000).optional(),
        category: z.string().max(200).optional(),
      })
      .optional(),
    /** Name of the first tab. Missing means Document. */
    tabTitle: z.string().min(1).max(80).optional(),
    /** Tabs after the first, in order. Missing or empty means there are no extra tabs. */
    tabs: z.array(docTabSchema).max(40).optional(),
  }),
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
      proofingLanguage: z.enum(["en", "es", "fr", "de", "ar", "he"]).optional(),
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
      queries: z.array(savedQuerySchema).max(20).optional(),
      tables: z
        .array(
          z.object({
            name: z.string().min(1).max(80),
            sheetId: z.string(),
            headerRow: z.number().int().nonnegative(),
            startColumn: z.number().int().nonnegative(),
            endColumn: z.number().int().nonnegative(),
            endRow: z.number().int().nonnegative(),
          }),
        )
        .max(40)
        .optional(),
      /** Paper layout. Independent of a frozen row on screen. */
      print: z
        .object({
          sheets: z.record(
            z.string(),
            z.object({
              /** 0-based rows that start a new printed page. The break sits above each row. */
              breaksAbove: z
                .array(z.number().int().min(1).max(1048575))
                .max(200),
              repeatFirstRow: z.boolean(),
            }),
          ),
        })
        .optional(),
    }),
    ...historyFields,
  }),
  z.object({
    ...meta,
    ...historyFields,
    kind: z.literal("slide"),
    content: presentationSchema,
  }),
  z.object({
    ...meta,
    kind: z.literal("form"),
    ...historyFields,
    content: z
      .object({
        questions: z.array(formQuestionSchema).max(100),
        responses: z.array(formResponseSchema).max(5000),
        /** Missing means the form is still taking responses. */
        accepting: z.boolean().optional(),
        deadline: z.string().max(40).optional(),
      })
      // Text stays at 2,000 characters. A grid may total 3,200 characters of cells.
      .superRefine((content, ctx) => {
        const kinds = new Map(
          content.questions.map((question) => [question.id, question.kind]),
        );
        content.responses.forEach((response, index) => {
          for (const [id, answer] of Object.entries(response.answers)) {
            if (formAnswerFits(kinds.get(id), answer)) continue;
            ctx.addIssue({
              code: "custom",
              message: "Answer is too long",
              path: ["responses", index, "answers", id],
            });
          }
        });
      }),
  }),
  z.object({
    ...meta,
    ...historyFields,
    kind: z.literal("drawing"),
    content: drawingContentSchema,
  }),
]);
export type SuiteFile = z.infer<typeof fileSchema>;
export type DocFile = Extract<SuiteFile, { kind: "doc" }>;
export type SheetFile = Extract<SuiteFile, { kind: "sheet" }>;
export type SlideFile = Extract<SuiteFile, { kind: "slide" }>;
export type FormFile = Extract<SuiteFile, { kind: "form" }>;
export type DrawingFile = Extract<SuiteFile, { kind: "drawing" }>;
