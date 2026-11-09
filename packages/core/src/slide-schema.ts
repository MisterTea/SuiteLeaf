import { nativeDrawingSchema } from "./pptx-native-objects";
import { z } from "zod";

/** One glyph group inside a stacked Office math fraction. */
const mathPieceSchema = z.object({
  text: z.string().max(2000),
  script: z.enum(["sub", "sup"]).optional(),
});
/** One slice of a text box. Unset bold, italic, underline, and colour follow the box. */
export const textRunSchema = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  /** DrawingML strike="sngStrike" or dblStrike. */
  strike: z.boolean().optional(),
  color: z.string().max(40).optional(),
  /** DrawingML highlight, painted behind the glyphs. */
  highlight: z.string().max(40).optional(),
  /** DrawingML run outline. The glyph fill stays `color`. */
  stroke: z.string().max(40).optional(),
  /** Run outline width, in points. */
  strokeWidth: z.number().positive().max(200).optional(),
  /**
   * DrawingML outerShdw. Offsets and blur are points.
   * Positive x is to the right; positive y is down.
   */
  shadow: z
    .object({
      x: z.number().min(-500).max(500),
      y: z.number().min(-500).max(500),
      blur: z.number().min(0).max(500),
      color: z.string().max(40),
    })
    .optional(),
  /** CSS gradient painted through the glyphs when the run fill is a gradFill. */
  gradient: z.string().max(2000).optional(),
  /**
   * DrawingML reflection under the paragraph. Alphas are 0–1 and endPos is the
   * fraction of the text block the mirror occupies.
   */
  reflection: z
    .object({
      startAlpha: z.number().min(0).max(1),
      endAlpha: z.number().min(0).max(1),
      endPos: z.number().min(0).max(1),
    })
    .optional(),
  fontSize: z.number().positive().optional(),
  /** DrawingML cap. `all` is capitals; `small` is small capitals. */
  caps: z.enum(["small", "all"]).optional(),
  /**
   * DrawingML baseline shift, in percent of the font size. Positive raises a
   * superscript; negative lowers a subscript.
   */
  baseline: z.number().min(-1000).max(1000).optional(),
  /**
   * The run omitted `sz`. PowerPoint still paints that baseline shift at 65%
   * of the inherited size; the percent stays relative to the inherited size.
   */
  scriptScale: z.boolean().optional(),
  /** Line size of a paragraph whose words are all raised or lowered. */
  scriptStrut: z.number().optional(),
  /** Symbol-font text and bullets, such as Wingdings, keep that typeface (as its SuiteLeaf face). */
  font: z.string().max(80).optional(),
  /** DrawingML picture bullet (`buBlip`). The marker text stays for editing; the image is what paints. */
  bulletSrc: z.string().max(700_000).optional(),
  paragraphBreak: z.boolean().optional(),
  /**
   * Left edge of this paragraph's first line, in slide units.
   * Set when list levels in one box do not share a margin.
   */
  paraMargin: z.number().nonnegative().max(20000).optional(),
  /** Hanging marker width for this paragraph, in slide units. */
  paraHang: z.number().nonnegative().max(20000).optional(),
  /** Positive first-line indent, in slide units. The other lines stay at `paraMargin`. */
  paraFirst: z.number().nonnegative().max(20000).optional(),
  /** Default tab interval, in points. PowerPoint's is one inch. */
  paraTab: z.number().positive().max(2000).optional(),
  /** Explicit tab stops, in points from the paragraph's left edge. */
  paraTabs: z
    .array(
      z.object({
        pos: z.number().nonnegative().max(20000),
        align: z.enum(["l", "ctr", "r", "dec"]),
      }),
    )
    .max(40)
    .optional(),
  /** Space before this paragraph, in slide units. */
  spaceBefore: z.number().nonnegative().max(2000).optional(),
  /** This paragraph's alignment when one box mixes left, center, right, or justify. */
  paraAlign: z.enum(["left", "center", "right", "justify"]).optional(),
  /** DrawingML distributed alignment expands gaps between characters on every line. */
  paraDistributed: z.boolean().optional(),
  /**
   * CSS line-height for this paragraph when one box mixes spacing.
   * The box line-height stays the first paragraph's.
   */
  paraLine: z.number().positive().max(4).optional(),
  /** Authored exact paragraph pitch in points, independent of run size. */
  paraLinePt: z.number().positive().max(4000).optional(),
  /** An imported automatic list marker, distinct from authored leading text. */
  autoNumber: z.object({ kind: z.string(), prefix: z.string(), startAt: z.number().int().positive().optional(), level: z.number().int().min(0).max(8).optional() }).optional(),
  listMarker: z.boolean().optional(),
  /** DrawingML kern, in points. PowerPoint import moves it to the box. */
  kern: z.number().min(0).max(4000).optional(),
  /** DrawingML spc, in points. Negative tracking pulls glyphs together. */
  tracking: z.number().min(-4000).max(4000).optional(),
  /** DrawingML latinLnBrk="0": keep a hyphenated word on one line. */
  unbroken: z.boolean().optional(),
  /** A web or mail address from the PowerPoint run. */
  href: z.string().max(2000).optional(),
  /**
   * Office math fraction. `text` stays the linear reading; the painter stacks
   * `num` over `den`.
   */
  math: z.boolean().optional(),
  latex: z.string().max(4096).optional(),
  officeMath: z.object({
    xml: z.string().max(262144),
    count: z.number().int().positive(),
    signature: z.string().max(262144),
  }).optional(),
  fraction: z
    .object({
      num: z.array(mathPieceSchema).max(80),
      den: z.array(mathPieceSchema).max(80),
      /** False for a limit under or over an operator. A fraction keeps the bar. */
      bar: z.boolean().optional(),
    })
    .optional(),
});
export type TextRun = z.infer<typeof textRunSchema>;
export const slideElementSchema = z.object({
  id: z.string(),
  /** Original DrawingML shape id, used to remap retained timing on export. */
  sourceShapeId: z.string().regex(/^\d+$/).optional(),
  type: z.enum(["text", "shape", "image", "table", "audio", "video"]),
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  /** A locked object stays where it is. Text can still change. */
  locked: z.boolean().optional(),
  /** Boxes that share this id move together. */
  groupId: z.string().min(1).max(80).optional(),
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
  /** Kern text at or above this point size, as PowerPoint does. Absent never kerns. */
  kern: z.number().min(0).max(4000).optional(),
  fontFamily: z.string().optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  color: z.string().optional(),
  align: z.enum(["left", "center", "right", "justify"]).optional(),
  /** Unitless line height. A fitted MARP box uses the theme's line height. */
  lineHeight: z.number().positive().max(4).optional(),
  /** Authored exact text-box pitch in points. */
  lineHeightPt: z.number().positive().max(4000).optional(),
  /** Left inset, in slide units, so a heading can sit inside its bar. */
  padLeft: z.number().nonnegative().max(20000).optional(),
  /** Right text inset, in slide units. Absent uses the left inset. */
  padRight: z.number().nonnegative().max(20000).optional(),
  /** Bottom text inset, in slide units. Absent uses the top inset. */
  padBottom: z.number().nonnegative().max(20000).optional(),
  /**
   * Width of a list item's marker, in slide units. Each line starts with its
   * marker, and the lines a long item wraps onto start this far in, under its words.
   * A hanging indent can be most of a poster column, so the cap matches other insets.
   */
  hang: z.number().nonnegative().max(20000).optional(),
  /** Corner radius for a rounded rectangle, in slide units. A pill is half the short side. */
  radius: z.number().nonnegative().max(20000).optional(),
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
  /** Retain editable Office gradient transforms while the visible fill is unchanged. */
  officeFill: z
    .object({
      css: z.string().max(64000),
      xml: z
        .string()
        .max(64000)
        .refine(
          (xml) =>
            /^<a:gradFill\b[\s\S]*<\/a:gradFill>$/.test(xml) &&
            !/<!DOCTYPE|<!ENTITY|\br:/.test(xml),
        ),
    })
    .optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().optional(),
  /**
   * DrawingML prstDash. `dashed` and `dotted` are the CSS names for `dash` and
   * `dot`. The other names keep the preset, such as `sysDot` or `lgDash`.
   */
  strokeStyle: z
    .enum([
      "dashed",
      "dotted",
      "sysDash",
      "sysDot",
      "sysDashDot",
      "sysDashDotDot",
      "lgDash",
      "dashDot",
      "lgDashDot",
      "lgDashDotDot",
    ])
    .optional(),
  /** DrawingML outer shadow on the whole object. Offsets and blur are points. */
  shadow: z
    .object({
      x: z.number().min(-500).max(500),
      y: z.number().min(-500).max(500),
      blur: z.number().min(0).max(500),
      color: z.string().max(80),
    })
    .optional(),
  /** Vertical alignment inside a text box. Absent means top, as older boxes do. */
  valign: z.enum(["top", "middle", "bottom"]).optional(),
  /**
   * DrawingML bodyPr vert. `up` is vert270 (bottom to top); `down` is vert.
   * The box stays put; only the text runs along it.
   * `upright` is wordArtVert: letters stay upright and stack top to bottom.
   */
  textFlow: z.enum(["up", "down", "upright"]).optional(),
  /** Top text inset, in slide units. Absent keeps the editor's padding. */
  inset: z.number().nonnegative().max(20000).optional(),
  /** Mirror a line or arrow across its box. */
  flipH: z.boolean().optional(),
  flipV: z.boolean().optional(),
  /**
   * DrawingML headEnd, at the line's start. An oval is a dot. A triangle,
   * arrow, or stealth is an arrowhead. Older arrows omit this.
   */
  lineHead: z
    .enum(["triangle", "arrow", "stealth", "diamond", "oval"])
    .optional(),
  /** DrawingML tailEnd, at the line's end. */
  lineTail: z
    .enum(["triangle", "arrow", "stealth", "diamond", "oval"])
    .optional(),
  /** Non-default head size. Medium is omitted. */
  lineHeadSize: z.enum(["sm", "lg"]).optional(),
  /** Non-default tail size. Medium is omitted. */
  lineTailSize: z.enum(["sm", "lg"]).optional(),
  /** DrawingML tblPr rtl: the first column is the rightmost one. */
  rtl: z.boolean().optional(),
  /** DrawingML wrap="none": keep each paragraph on one line. */
  nowrap: z.boolean().optional(),
  /** Apply paragraph before/after spacing at the text body's outer edges. */
  paragraphEdgeSpacing: z.boolean().optional(),
  /**
   * WordArt textPlain. The letters stretch to this box; the stored font size
   * is the size before that stretch.
   */
  stretchText: z.boolean().optional(),
  /**
   * DrawingML srcRect, in percent of the source picture.
   * Positive hides that edge. Negative insets the picture inside the box.
   */
  cropLeft: z.number().min(-5000).max(100).optional(),
  cropTop: z.number().min(-5000).max(100).optional(),
  cropRight: z.number().min(-5000).max(100).optional(),
  cropBottom: z.number().min(-5000).max(100).optional(),
  /** SVG path, in the element's own box, that clips a picture to its preset. */
  clipPath: z.string().max(20000).optional(),
  /** Picture opacity from DrawingML alphaModFix. 1 is omitted. */
  opacity: z.number().min(0).max(1).optional(),
  /**
   * DrawingML tile fill. Width and height are one repeat, in slide units.
   * x and y place the origin inside this element.
   */
  tile: z
    .object({
      width: z.number().positive().max(100000),
      height: z.number().positive().max(100000),
      x: z.number().min(-100000).max(100000),
      y: z.number().min(-100000).max(100000),
      flip: z.enum(["x", "y", "xy"]).optional(),
    })
    .optional(),
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
  /** `with` shares the previous click. `after` starts when that entrance finishes. */
  animationTrigger: z.enum(["click", "with", "after"]).optional(),
  /**
   * Paragraphs of this text box that wait for a click. Indexes match the
   * paragraphs PowerPoint numbered, starting at 0. The box itself stays put.
   */
  paragraphBuilds: z
    .array(
      z.object({
        start: z.number().int().nonnegative().max(500),
        end: z.number().int().nonnegative().max(500),
        order: z.number().int().nonnegative(),
        trigger: z.enum(["click", "with", "after"]).optional(),
      }),
    )
    .max(200)
    .optional(),
  /** A later click hides this object. It is visible until that click. */
  animationExit: z
    .object({
      order: z.number().int().nonnegative(),
      trigger: z.enum(["click", "with", "after"]).optional(),
    })
    .optional(),
  /** Entrance length in milliseconds. Playback clamps this to 0–5000. */
  animationDuration: z.number().optional(),
  nativeDrawing: nativeDrawingSchema.optional(),
  src: z.string().optional(),
  /** DrawingML softEdge radius, in slide units, feathered on every side. */
  softEdge: z.number().positive().max(2000).optional(),
  /** Authored vector artwork retained alongside the raster fallback in src. */
  svgSrc: z
    .string()
    .regex(/^data:image\/svg\+xml;base64,/i)
    .optional(),
  /** Original Office metafile retained alongside its browser preview. */
  emfSrc: z.string().regex(/^data:image\/emf;base64,/i).optional(),
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
  /** A web or mail address for a picture, from the PowerPoint shape. */
  href: z.string().max(2000).optional(),
  /** When true, the object is not read and does not need alternative text. */
  decorative: z.boolean().optional(),
  /** Spoken words for a sound or a video. This is not the media file. */
  caption: z.string().max(500).optional(),
  rows: z.array(z.array(z.string())).optional(),
  /** Column widths as fractions of the table, aligned with the grid. */
  colWidths: z.array(z.number().positive()).max(64).optional(),
  /** Row heights as fractions of the table. */
  rowHeights: z.array(z.number().nonnegative()).max(80).optional(),
  /** Authored row minima and the derived layout they belong to; changing row sizes releases them. */
  officeRowHeights: z
    .object({
      minimums: z.array(z.number().nonnegative()).max(80),
      layout: z.array(z.number().nonnegative()).max(80),
    })
    .optional(),
  /** Formatting for each slide-table cell, aligned with `rows`. */
  cellMarks: z
    .array(
      z.array(
        z.object({
          bold: z.boolean().optional(),
          italic: z.boolean().optional(),
          fill: z.string().optional(),
          color: z.string().optional(),
          font: z.string().max(80).optional(),
          fontSize: z.number().positive().optional(),
          align: z.enum(["left", "center", "right", "justify"]).optional(),
          colSpan: z.number().int().positive().optional(),
          rowSpan: z.number().int().positive().optional(),
          border: z.string().optional(),
          borderTop: z
            .object({
              color: z.string(),
              width: z.number().positive().max(20).optional(),
            })
            .optional(),
          borderRight: z
            .object({
              color: z.string(),
              width: z.number().positive().max(20).optional(),
            })
            .optional(),
          borderBottom: z
            .object({
              color: z.string(),
              width: z.number().positive().max(20).optional(),
            })
            .optional(),
          borderLeft: z
            .object({
              color: z.string(),
              width: z.number().positive().max(20).optional(),
            })
            .optional(),
          padTop: z.number().nonnegative().max(200).optional(),
          padRight: z.number().nonnegative().max(200).optional(),
          padBottom: z.number().nonnegative().max(200).optional(),
          padLeft: z.number().nonnegative().max(200).optional(),
          valign: z.enum(["top", "middle", "bottom"]).optional(),
          textFlow: z.enum(["up", "down", "upright"]).optional(),
          lines: z
            .array(
              z.object({
                margin: z.number().nonnegative().max(20000).optional(),
                hang: z.number().nonnegative().max(20000).optional(),
                first: z.number().nonnegative().max(20000).optional(),
                tabs: z
                  .array(
                    z.object({
                      pos: z.number().nonnegative().max(20000),
                      align: z.enum(["l", "ctr", "r", "dec"]),
                    }),
                  )
                  .max(40)
                  .optional(),
              }),
            )
            .max(400)
            .optional(),
          /** Default tab interval for this cell, in points. */
          tabSize: z.number().positive().max(2000).optional(),
          /** Symbol font, subscript, or a second colour inside one cell. */
          runs: z
            .array(
              z.object({
                text: z.string(),
                color: z.string().max(40).optional(),
                font: z.string().max(80).optional(),
                fontSize: z.number().positive().optional(),
                bulletSrc: z.string().max(700_000).optional(),
                baseline: z.number().min(-1000).max(1000).optional(),
                scriptScale: z.boolean().optional(),
                /** Line size of a paragraph whose words are all raised or lowered. */
                scriptStrut: z.number().optional(),
                bold: z.boolean().optional(),
                paragraphBreak: z.boolean().optional(),
                paraMargin: z.number().nonnegative().max(20000).optional(),
                paraHang: z.number().nonnegative().max(20000).optional(),
                paraFirst: z.number().nonnegative().max(20000).optional(),
                paraTab: z.number().positive().max(2000).optional(),
                paraLine: z.number().positive().max(4).optional(),
                paraLinePt: z.number().positive().max(4000).optional(),
                spaceBefore: z.number().nonnegative().max(20000).optional(),
                paraTabs: z
                  .array(
                    z.object({
                      pos: z.number().nonnegative().max(20000),
                      align: z.enum(["l", "ctr", "r", "dec"]),
                    }),
                  )
                  .max(40)
                  .optional(),
                fraction: z
                  .object({
                    num: z.array(mathPieceSchema).max(80),
                    den: z.array(mathPieceSchema).max(80),
                  })
                  .optional(),
              }),
            )
            .max(400)
            .optional(),
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
      /** Native gradient stops while the editable CSS paint remains unchanged. */
      officeFill: z.object({ css: z.string(), xml: z.string().max(100000) }).optional(),
      /** Set from markdown. A theme change leaves this color alone. */
      pinned: z.boolean().optional(),
    })
    .optional(),
  layout: z
    .enum(["title", "title-body", "section", "two-column", "blank"])
    .optional(),
  elements: z.array(slideElementSchema),
  /**
   * Object ids in reading order. Absent means the element list is the order.
   * An id that is not on the slide is kept here and reported as missing.
   */
  readingOrder: z.array(z.string().min(1).max(200)).max(400).optional(),
  notes: z.string().optional(),
  comments: z.array(slideCommentThreadSchema).max(40).optional(),
  transition: slideTransitionSchema.optional(),
  /** Whole seconds before the slideshow moves on. Absent means the slide waits. */
  advanceSeconds: z.number().int().min(0).max(3600).optional(),
  /** Office animation timeline, written back when the deck is saved as PowerPoint. */
  timing: z.string().max(100_000).optional(),
  /** Hidden in a PowerPoint slideshow. PDF export skips the slide. */
  hidden: z.boolean().optional(),
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
/** A face extracted from a PPTX `ppt/fonts` part, as a data URL the renderer can load. */
export const embeddedFontSchema = z.object({
  family: z.string().min(1).max(80),
  style: z.enum(["normal", "italic"]),
  weight: z.union([z.literal(400), z.literal(700)]),
  data: z.string().min(30).max(12_000_000),
});
export type EmbeddedFont = z.infer<typeof embeddedFontSchema>;
export const presentationSchema = z.object({
  id: z.string(),
  width: z.number().positive(),
  height: z.number().positive(),
  /**
   * Slide size in PDF points. Drawing coordinates stay on `width` and `height`.
   * Absent on older decks, which were authored in that same coordinate space.
   */
  pointWidth: z.number().positive().optional(),
  pointHeight: z.number().positive().optional(),
  slideOrder: z.array(z.string()),
  slides: z.record(z.string(), slideSchema),
  theme: slideThemeSchema.optional(),
  proofingLanguage: z.enum(["en", "es", "fr", "de", "ar", "he"]).optional(),
  /** Fonts that were embedded in the PowerPoint file. The renderer loads these by family name. */
  fonts: z.array(embeddedFontSchema).max(16).optional(),
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
