import { nativeDrawingSchema } from "./pptx-native-objects";
import { z } from "zod";

export { diffDocuments, type DocDiff } from "./doc-diff";
export { cloneJson, sameJson } from "./json-data";
export {
  applyParagraphRestore,
  compareParagraphs,
  paragraphRestorePrompt,
  type ParagraphCompare,
  type ParagraphOffer,
} from "./doc-paragraph-restore";
export {
  diffSheets,
  type CellLook,
  type SheetCellChange,
  type SheetDiff,
  type SheetDiffSheet,
  type SheetPlainCell,
} from "./sheet-diff";
export {
  diffSlides,
  type SlideDiff,
  type SlideDiffElement,
  type SlideDiffFrame,
  type SlideTextRun,
} from "./slide-diff";
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
  aggregate: z.enum(["SUM", "COUNT", "AVERAGE", "MIN", "MAX"]),
  filterColumn: z.number().int().optional(),
  filterValue: z.string().optional(),
  invalid: z.boolean().optional(),
});
export type PivotDefinition = z.infer<typeof pivotSchema>;
/** One slice of a text box. Unset bold, italic, underline, and colour follow the box. */
export const textRunSchema = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  color: z.string().max(40).optional(),
  fontSize: z.number().positive().optional(),
  paragraphBreak: z.boolean().optional(),
});
export type TextRun = z.infer<typeof textRunSchema>;
export const slideElementSchema = z.object({
  id: z.string(),
  type: z.enum(["text", "shape", "image", "table", "audio", "video"]),
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  rotation: z.number().optional(),
  content: z.string().optional(),
  /** Per-word styles. The plain `content` string stays in sync with these runs. */
  runs: z.array(textRunSchema).optional(),
  placeholder: z.string().optional(),
  fontSize: z.number().optional(),
  /**
   * Shrink the rendered type so the words fit in the box. Absent means off,
   * so existing boxes and older files keep their normal size.
   */
  autofit: z.boolean().optional(),
  fontFamily: z.string().optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  color: z.string().optional(),
  align: z.enum(["left", "center", "right", "justify"]).optional(),
  /** Unitless line height. A fitted MARP box uses the theme's line height. */
  lineHeight: z.number().positive().max(4).optional(),
  /** Left inset, in slide units, so a heading can sit inside its bar. */
  padLeft: z.number().nonnegative().max(400).optional(),
  /**
   * Width of a list item's marker, in slide units. Each line starts with its
   * marker, and the lines a long item wraps onto start this far in, under its words.
   */
  hang: z.number().nonnegative().max(200).optional(),
  /** Corner radius for a rounded rectangle, in slide units. */
  radius: z.number().nonnegative().max(200).optional(),
  /** Keep the line breaks of a code block. */
  preformatted: z.boolean().optional(),
  /** Language of a code block, used to color it until the box is edited. */
  codeLanguage: z.string().max(40).optional(),
  /** The text is LaTeX. The box shows typeset math until it is edited. */
  math: z.boolean().optional(),
  bullet: z.boolean().optional(),
  shapeType: z
    .enum(["rect", "roundRect", "ellipse", "line", "arrow"])
    .optional(),
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().optional(),
  /**
   * Display lettering. The letter fill is `color` and the outline is `stroke`,
   * so both survive save. Absent on ordinary text boxes and older files.
   */
  wordArt: z.enum(["blue", "gold"]).optional(),
  /** Set when someone chose this element's font or colour by hand. */
  themeOverride: z.boolean().optional(),
  /** In a MARP deck, the markdown lines this box shows: first line, and the line after the last. */
  marpLines: z
    .tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
    .optional(),
  /** In a MARP deck, a block written as HTML. It can be moved or deleted whole, and is edited in the markdown. */
  marpHtml: z.boolean().optional(),
  /** Hidden in the slideshow until its click, then brought in. */
  animation: z
    .enum([
      "fade-on-click",
      "appear-on-click",
      "fly-on-click",
      "wipe-on-click",
      "zoom-on-click",
    ])
    .optional(),
  /** Click sequence. Objects that share an order appear on the same click. */
  animationOrder: z.number().int().nonnegative().optional(),
  nativeDrawing: nativeDrawingSchema.optional(),
  src: z.string().optional(),
  /** Authored vector artwork retained alongside the raster fallback in src. */
  svgSrc: z
    .string()
    .regex(/^data:image\/svg\+xml;base64,/i)
    .optional(),
  /** Original JPEG XR layer and numeric background removal editing data. */
  imageLayer: z
    .object({
      src: z.string().regex(/^data:image\/wdp;base64,/i),
      backgroundRemoval: z
        .object({
          t: z.number(),
          b: z.number(),
          l: z.number(),
          r: z.number(),
          foregroundMarks: z.array(
            z.object({
              x1: z.number(),
              y1: z.number(),
              x2: z.number(),
              y2: z.number(),
            }),
          ),
          backgroundMarks: z.array(
            z.object({
              x1: z.number(),
              y1: z.number(),
              x2: z.number(),
              y2: z.number(),
            }),
          ),
        })
        .optional(),
    })
    .optional(),
  /** Embedded still frame shown before a clip plays. */
  poster: z.string().optional(),
  alt: z.string().optional(),
  rows: z.array(z.array(z.string())).optional(),
  /** Bold and italic for each slide-table cell, aligned with `rows`. */
  cellMarks: z
    .array(
      z.array(
        z.object({
          bold: z.boolean().optional(),
          italic: z.boolean().optional(),
        }),
      ),
    )
    .optional(),
});
export type SlideElement = z.infer<typeof slideElementSchema>;
export const slideCommentMessageSchema = z.object({
  id: z.string().min(1),
  authorName: z.string().min(1).max(80),
  text: z.string().min(1).max(4000),
  createdAt: z.string().datetime(),
});
export type SlideCommentMessage = z.infer<typeof slideCommentMessageSchema>;
/** A review thread on one object. Speaker notes stay on the slide, not here. */
export const slideCommentThreadSchema = z.object({
  id: z.string().min(1),
  elementId: z.string().min(1),
  resolved: z.boolean().optional(),
  resolvedBy: z.string().max(80).optional(),
  messages: z.array(slideCommentMessageSchema).min(1).max(50),
});
export type SlideCommentThread = z.infer<typeof slideCommentThreadSchema>;
export const slideTransitionSchema = z.object({
  type: z.enum(["none", "fade", "slide", "push"]),
  duration: z.number().min(0).max(10),
  /** The original Office transition element, when it is one of the kinds above. */
  office: z.string().max(400).optional(),
});
export type SlideTransition = z.infer<typeof slideTransitionSchema>;
export const slideSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  background: z
    .object({
      color: z.string().optional(),
      image: z.string().optional(),
      /** Set from markdown. A theme change leaves this color alone. */
      pinned: z.boolean().optional(),
    })
    .optional(),
  layout: z
    .enum(["title", "title-body", "section", "two-column", "blank"])
    .optional(),
  elements: z.array(slideElementSchema),
  notes: z.string().optional(),
  comments: z.array(slideCommentThreadSchema).max(40).optional(),
  transition: slideTransitionSchema.optional(),
  /** Office animation timeline, written back when the deck is saved as PowerPoint. */
  timing: z.string().max(100_000).optional(),
});
export type Slide = z.infer<typeof slideSchema>;
export const slideThemeSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  background: z.string().min(1).max(40),
  headingColor: z.string().min(1).max(40),
  bodyColor: z.string().min(1).max(40),
  accent: z.string().min(1).max(40),
  headingFont: z.string().min(1).max(80),
  bodyFont: z.string().min(1).max(80),
});
export type SlideTheme = z.infer<typeof slideThemeSchema>;
export const presentationSchema = z.object({
  id: z.string(),
  width: z.number().positive(),
  height: z.number().positive(),
  slideOrder: z.array(z.string()),
  slides: z.record(z.string(), slideSchema),
  theme: slideThemeSchema.optional(),
  /** Objects and a background drawn behind every slide. */
  master: z
    .object({
      background: z.object({ color: z.string().max(40).optional() }).optional(),
      elements: z.array(slideElementSchema).max(30),
    })
    .optional(),
  /** A MARP deck is markdown with a single column or two columns, not free placement. */
  marp: z.boolean().optional(),
  /** When set, each slide shows its place in the deck, starting at 1. Absent means off. */
  slideNumbers: z.boolean().optional(),
  /** A MARP deck's markdown. It is the source of truth: the slides are drawn from it, and canvas edits are written back into it. */
  marpSource: z.string().max(500_000).optional(),
  /** Direct canvas edits supersede the retained source when printing. */
  marpSourceDirty: z.boolean().optional(),
  /** Relative path from the markdown file to a data URI. Image boxes keep the path. */
  marpAssets: z
    .record(z.string().max(400), z.string().max(40_000_000))
    .optional(),
  /** Text boxes have been placed to match the MARP theme. A number is the layout revision. */
  marpFit: z.union([z.boolean(), z.number()]).optional(),
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
  kind: z.enum(["text", "choice", "rating", "grid"]),
  required: z.boolean(),
  choices: z.array(z.string().max(80)).max(20).optional(),
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
export {
  VERSION_PAUSE_MS,
  VERSION_PAUSE_KEY,
  VERSION_SNAPSHOT_CAP,
  OP_BYTE_CAP,
  applyParagraphTexts,
  blockTexts,
  changeExcerpt,
  changedRegions,
  compactSession,
  nameVersion,
  recordEdit,
  restoreToVersion,
  sealIfIdle,
  slideOp,
  summarizeChange,
  summaryPrompt,
  trimVersions,
  versionPauseMs,
  type Collaborator,
  type RegionTouch,
  type StoredEdit,
  type StoredVersion,
  type TrackedFile,
} from "./history";
export {
  DocumentRoom,
  canJoinRoom,
  connectDocs,
  editParagraph,
  paragraphTexts,
  seedParagraphs,
  syncParagraphTexts,
  type CollabJoin,
  type CollabRole,
} from "./collab";
export function safeLink(url: string): boolean {
  return /^(https?:|mailto:|tel:|#)/i.test(url);
}
/**
 * Turns what someone typed into a link into a safe href, or null.
 * A bare web address gets https:// and a bare email address gets mailto:;
 * anything else must already pass `safeLink`. Docs and Sheets share this.
 */
export function linkTarget(input: string): string | null {
  const url = input.trim();
  if (!url || /\s/.test(url)) return null;
  if (safeLink(url)) return url;
  if (/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(url)) return `mailto:${url}`;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?([/?#]\S*)?$/.test(url))
    return `https://${url}`;
  return null;
}
export {
  cellHyperlink,
  cellLabel,
  linkDocument,
  linkedCell,
  removedLinkWarning,
  takeExcelHyperlink,
} from "./sheet-links";
/** A slide picture is either embedded, or a relative path filled from the deck's imported files. */
function allowedSlideImage(src: string) {
  if (
    /^data:image\/(png|jpeg|gif|webp|bmp|svg\+xml|tiff|emf|wmf|wdp);base64,/i.test(
      src,
    )
  )
    return true;
  if (
    src.length > 400 ||
    src.includes("..") ||
    src.includes("\\") ||
    src.includes(":")
  )
    return false;
  return /^[A-Za-z0-9._~/+-]+$/.test(src);
}
function validateTree(n: JsonNode, depth = 0) {
  if (depth > 100) throw new Error("Document is nested too deeply.");
  if (
    (n.type === "image" || n.type === "inlineImage") &&
    !/^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,/i.test(String(n.attrs?.src))
  )
    throw new Error(
      "Native images must be embedded PNG, JPEG, GIF, WebP, or SVG data.",
    );
  for (const m of n.marks ?? [])
    if (m.type === "link" && !safeLink(String(m.attrs?.href)))
      throw new Error("Unsafe document link.");
  for (const c of n.content ?? []) validateTree(c, depth + 1);
}
export const LEGACY_EXTENSION = "suiteleaf";
const nativeExtensions = {
  doc: "sldoc",
  sheet: "slsheet",
  slide: "slslides",
  form: "slform",
  drawing: "sldraw",
} as const satisfies Record<Kind, string>;
const nativeMimes = {
  doc: "application/vnd.suiteleaf.doc+json",
  sheet: "application/vnd.suiteleaf.sheet+json",
  slide: "application/vnd.suiteleaf.slides+json",
  form: "application/vnd.suiteleaf.form+json",
  drawing: "application/vnd.suiteleaf.drawing+json",
} as const satisfies Record<Kind, string>;
export const NATIVE_EXTENSIONS = [
  ...Object.values(nativeExtensions),
  LEGACY_EXTENSION,
];
export function extensionFor(kind: Kind): string {
  return nativeExtensions[kind];
}
export function mimeFor(kind: Kind): string {
  return nativeMimes[kind];
}
/** `null` means a legacy `.suiteleaf` name, which may hold any kind; `undefined` is not native. */
export function kindFromName(name: string): Kind | null | undefined {
  const base = name.split(/[/\\]/).pop() ?? "";
  if (!base.includes(".")) return undefined;
  const ext = base.split(".").pop()?.toLowerCase();
  if (ext === LEGACY_EXTENSION) return null;
  return (Object.keys(nativeExtensions) as Kind[]).find(
    (k) => nativeExtensions[k] === ext,
  );
}
export function isNativeName(name: string): boolean {
  return kindFromName(name) !== undefined;
}
/**
 * Whether `text` takes more than `limit` bytes as UTF-8. A UTF-16 unit is one to
 * three bytes, so only text near the limit is encoded to find out.
 */
export function utf8LongerThan(text: string, limit: number): boolean {
  if (text.length * 3 <= limit) return false;
  if (text.length > limit) return true;
  return new TextEncoder().encode(text).length > limit;
}
export function parseFile(text: string, expectedKind?: Kind | null): SuiteFile {
  if (utf8LongerThan(text, 200 * 1024 * 1024))
    throw new Error("Native files must be smaller than 200 MB.");
  const raw = JSON.parse(text);
  if (raw.version !== 1)
    throw new Error("This SuiteLeaf file version is not supported.");
  const file = fileSchema.parse(raw);
  if (expectedKind && file.kind !== expectedKind)
    throw new Error(
      `This .${nativeExtensions[expectedKind]} file contains a ${file.kind}, not a ${expectedKind}.`,
    );
  if (file.kind === "doc") {
    if (file.content.type !== "doc") throw new Error("Invalid document root.");
    validateTree(file.content);
    const ids = new Set<string>();
    for (const tab of file.tabs ?? []) {
      if (ids.has(tab.id))
        throw new Error("Document tabs must have distinct ids.");
      ids.add(tab.id);
      if (tab.content.type !== "doc") throw new Error("Invalid document tab.");
      validateTree(tab.content);
    }
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
        if (el.poster && !allowedSlideImage(el.poster))
          throw new Error(
            "Native media posters must be embedded image data or an imported image path.",
          );
        if (el.type === "image" && el.src && !allowedSlideImage(el.src))
          throw new Error(
            "Native images must be embedded PNG, JPEG, GIF, WebP, BMP, SVG, TIFF, EMF, WMF, or JPEG XR data.",
          );
        if (
          el.type === "audio" &&
          el.src &&
          !/^data:audio\/(wav|mpeg|ogg);base64,/i.test(el.src)
        )
          throw new Error(
            "Native audio must be embedded WAV, MP3, or Ogg data.",
          );
        if (
          el.type === "video" &&
          el.src &&
          !/^data:video\/(mp4|webm);base64,/i.test(el.src)
        )
          throw new Error("Native video must be embedded MP4 or WebM data.");
      }
    }
  } else if (file.kind === "form") {
    const ids = file.content.questions.map((q) => q.id);
    if (new Set(ids).size !== ids.length)
      throw new Error("Form questions must have distinct ids.");
    const responseIds = file.content.responses.map((r) => r.id);
    if (new Set(responseIds).size !== responseIds.length)
      throw new Error("Form responses must have distinct ids.");
  }
  return file;
}
export function serializeFile(file: SuiteFile): string {
  const parsed = parseFile(JSON.stringify(file));
  const copy = { ...parsed };
  if (!copy.edits?.length) delete copy.edits;
  if (!copy.versions?.length) delete copy.versions;
  return JSON.stringify(copy);
}
export function createFile(
  kind: Kind,
  title = kind === "doc"
    ? "Untitled document"
    : kind === "sheet"
      ? "Untitled spreadsheet"
      : kind === "form"
        ? "Untitled form"
        : kind === "drawing"
          ? "Untitled drawing"
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
            layout: "title",
            elements: [
              {
                id: crypto.randomUUID(),
                type: "text",
                x: 100,
                y: 160,
                width: 760,
                height: 100,
                content: "",
                placeholder: "Click to add title",
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
                content: "",
                placeholder: "Click to add subtitle",
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
  if (kind === "form")
    return { ...base, kind, content: { questions: [], responses: [] } };
  if (kind === "drawing")
    return {
      ...base,
      kind,
      content: { format: "svg", source: DRAWING_STARTERS.svg },
    };
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
export function duplicateFile(
  file: SuiteFile,
  title = `${file.title.slice(0, 190)} copy`,
): SuiteFile {
  const copy = structuredClone(file);
  copy.id = crypto.randomUUID();
  copy.title = title;
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
export function nativeFilename(file: Pick<SuiteFile, "title" | "kind">) {
  return filename(file.title, extensionFor(file.kind));
}
/** Parse a native file using the kind implied by its name. */
export function parseNamedFile(name: string, text: string): SuiteFile {
  const kind = kindFromName(name);
  if (kind === undefined)
    throw new Error(
      `SuiteLeaf files use ${NATIVE_EXTENSIONS.map((e) => `.${e}`).join(", ")}.`,
    );
  return parseFile(text, kind);
}
/** Where a file lives in SuiteDrive. `versionId` is the head version this
 * copy was loaded from or last saved as, and `syncedAt` is the file's
 * `updatedAt` at that moment. */
export interface DriveLink {
  nodeUrl: string;
  itemId: string;
  versionId?: string;
  syncedAt?: string;
  name: string;
}
export const driveLinkSchema = z.object({
  nodeUrl: z.string().url(),
  itemId: z.string().min(1),
  versionId: z.string().optional(),
  syncedAt: z.string().optional(),
  name: z.string().min(1).max(255),
});
export interface FileRecord {
  file: SuiteFile;
  path?: string;
  fingerprint?: string;
  recovery?: boolean;
  drive?: DriveLink;
  /** Saved on the library entry so starring and Trash never rewrite the native file. */
  starred?: boolean;
  /** When the file was moved to Trash. Absent means it is not in Trash. */
  trashedAt?: string;
}
export {
  applyLibraryMarks,
  readLibraryMarks,
  type LibraryMarks,
} from "./library-marks";
/** Whether a SuiteDrive file has local edits that were never uploaded. */
export function hasUnsyncedEdits(record: FileRecord) {
  return !!record.drive && record.drive.syncedAt !== record.file.updatedAt;
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
  getDocumentsDirectory?(): Promise<string>;
  chooseDocumentsDirectory?(): Promise<string | null>;
  onFilesChanged?(callback: () => void): () => void;
  /**
   * Folders inside the documents folder. A folder is a "/"-separated path
   * relative to it, and "" is the documents folder itself. Each call changes
   * the folders on disk, and resolves with the folder's new path.
   */
  listFolders?(): Promise<string[]>;
  createFolder?(parent: string, name: string): Promise<string>;
  renameFolder?(folder: string, name: string): Promise<string>;
  moveFolder?(folder: string, parent: string): Promise<string>;
  /** Move a file into a folder on disk. A file not saved to disk yet is written there. */
  moveFile?(id: string, folder: string): Promise<FileRecord>;
  /** The on-device model host (Gemma via llama.cpp in the main process). */
  ai?: import("./ai").AiBridge;
  list(): Promise<FileRecord[]>;
  get(id: string): Promise<FileRecord | undefined>;
  save(record: FileRecord): Promise<FileRecord>;
  remove(id: string): Promise<void>;
  open(): Promise<FileRecord | null>;
  saveAs(record: FileRecord): Promise<FileRecord | null>;
  reload(id: string): Promise<FileRecord | undefined>;
  /** Where the person saved the export, or null if they cancelled the dialog. */
  exportFile(
    name: string,
    content: string | Uint8Array,
  ): Promise<string | null>;
  print(title?: string): Promise<void>;
  onMenu(callback: (action: string) => void): () => void;
  setDirty(dirty: boolean): void;
  getMode?(): Promise<AppMode>;
  /** Persist the mode and reload the app in it. */
  setMode?(mode: AppMode): Promise<void>;
  /** Run a social sign-in hand-off in a separate window and resolve with
   * the one-time token it returns. */
  authWindow?(startUrl: string): Promise<string | null>;
}
/**
 * `single`: files live on this device; no accounts, no shared storage.
 * `cluster`: the app is a client of a SuiteLeaf server; people sign in and
 * files live in SuiteDrive, replicated across the cluster's servers.
 */
export type AppMode =
  { kind: "single" } | { kind: "cluster"; serverUrl: string };
export const appModeSchema: z.ZodType<AppMode> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("single") }),
  z.object({
    kind: z.literal("cluster"),
    serverUrl: z.string().regex(/^https?:\/\/[^\s/]+(\/[^\s]*)?$/),
  }),
]);
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
