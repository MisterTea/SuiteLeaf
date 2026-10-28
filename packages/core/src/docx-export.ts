import {
  AlignmentType,
  BorderStyle,
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  Document,
  EndnoteReferenceRun,
  ExternalHyperlink,
  Footer,
  FootnoteReferenceRun,
  Header,
  HeadingLevel,
  HorizontalPositionAlign,
  HorizontalPositionRelativeFrom,
  ImageRun,
  Math as OfficeMath,
  MathFraction,
  MathRun,
  MathSubScript,
  MathSuperScript,
  NumberFormat,
  Packer,
  PageNumber,
  Paragraph,
  SectionType,
  SimpleField,
  Tab,
  TabStopType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  TextWrappingSide,
  TextWrappingType,
  UnderlineType,
  VerticalAlign,
  VerticalPositionAlign,
  VerticalPositionRelativeFrom,
  WidthType,
  type IRunOptions,
  type MathComponent,
  type ParagraphChild,
} from "docx";
import JSZip from "jszip";
import type { DocFile, JsonNode } from "./index";
import { docxParagraphIndent } from "./paragraph-indent";
import { asEquation, type EqNode } from "./equations";
import {
  documentPageSettings,
  restartedSectionTotal,
  sectionContentPages,
  wordPageNumberStart,
  type PageNumberFormat,
  type PageSettings,
} from "./document-layout";
import { docxWatermarkParagraph } from "./doc-watermark";
import { officeFont } from "./office-fonts";
import { pagePxToTwips } from "./word-page-margins";
import {
  planDocxComments,
  stampDocxComments,
  type DocxCommentPlan,
} from "./doc-comments";
import { embedSuggestionMarkers, revisionizeDocx } from "./suggestions";
import { docxLineSpacing } from "./line-spacing";
import { docxParagraphGap } from "./paragraph-spacing";
import {
  citationLibrary,
  inText,
  stampDocxCitations,
  type CitationLibrary,
} from "./citations";
import { croppedFrame, docxImageCrop, imageCrop } from "./image-crop";
import { imageWrap } from "./image-wrap";
import {
  chartCaption,
  linkedChartAttrs,
  missingSpreadsheetText,
} from "./linked-chart";

const color = (v: unknown) =>
  typeof v === "string" && /^#[\da-f]{6}$/i.test(v) ? v.slice(1) : undefined;
const alignment = (v: unknown) =>
  ({
    left: AlignmentType.LEFT,
    right: AlignmentType.RIGHT,
    center: AlignmentType.CENTER,
    justify: AlignmentType.JUSTIFIED,
  })[String(v) as "left"];
/**
 * Word announces `descr` and can fall back to the required drawing `name`.
 * Both are the description someone wrote, never the file name or "Image".
 */
export function docxImageAlt(alt: unknown): {
  title: string;
  description: string;
  name: string;
} {
  const description = typeof alt === "string" ? alt : "";
  return { title: description, description, name: description || "photo" };
}

function imageSize(data: Uint8Array, type: string): [number, number] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (type === "png" && data.length >= 24)
    return [view.getUint32(16), view.getUint32(20)];
  if (type === "gif" && data.length >= 10)
    return [view.getUint16(6, true), view.getUint16(8, true)];
  if (type === "jpeg")
    for (let offset = 2; offset + 9 < data.length;) {
      if (data[offset] !== 255) break;
      const marker = data[offset + 1],
        length = view.getUint16(offset + 2);
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker)
      )
        return [view.getUint16(offset + 7), view.getUint16(offset + 5)];
      if (length < 2) break;
      offset += length + 2;
    }
  return [480, 320];
}

/** A header or footer picture, sized to sit on the letterhead. */
function furnitureImageParagraph(src: string): Paragraph | null {
  const match = /^data:image\/(png|jpeg|gif);base64,(.*)$/i.exec(src);
  if (!match) return null;
  let data: Uint8Array;
  try {
    data = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  if (!data.length) return null;
  const kind = match[1].toLowerCase();
  const [naturalWidth, naturalHeight] = imageSize(
    data,
    kind === "jpg" ? "jpeg" : kind,
  );
  const scale = Math.min(1, 144 / naturalWidth, 48 / naturalHeight);
  return new Paragraph({
    children: [
      new ImageRun({
        type: kind === "jpeg" || kind === "jpg" ? "jpg" : (kind as "png" | "gif"),
        data,
        transformation: {
          width: Math.max(1, Math.round(naturalWidth * scale)),
          height: Math.max(1, Math.round(naturalHeight * scale)),
        },
        altText: docxImageAlt(""),
      }),
    ],
  });
}
function marked(
  plan: DocxCommentPlan,
  index: number,
  edge: "starts" | "ends",
): ParagraphChild[] {
  return (plan[edge].get(index) ?? []).flatMap((id) =>
    edge === "starts"
      ? [new CommentRangeStart(id)]
      : [new CommentRangeEnd(id), new CommentReference(id)],
  );
}
type NoteSlot = { kind: "footnote" | "endnote"; num: number };

function noteIndex(content: JsonNode): Map<string, NoteSlot> {
  const index = new Map<string, NoteSlot>();
  let footnotes = 0;
  let endnotes = 0;
  const walk = (node: JsonNode) => {
    if (node.type === "noteReference") {
      const id = String(node.attrs?.id ?? "");
      if (id && !index.has(id)) {
        const kind = node.attrs?.kind === "endnote" ? "endnote" : "footnote";
        index.set(id, {
          kind,
          num: kind === "endnote" ? ++endnotes : ++footnotes,
        });
      }
    }
    if (node.type !== "note") node.content?.forEach(walk);
  };
  walk(content);
  return index;
}

function findNote(content: JsonNode, id: string): JsonNode | undefined {
  let found: JsonNode | undefined;
  const walk = (node: JsonNode) => {
    if (found) return;
    if (node.type === "note" && String(node.attrs?.id ?? "") === id) found = node;
    else node.content?.forEach(walk);
  };
  walk(content);
  return found;
}

function blankCommentPlan(): DocxCommentPlan {
  return {
    comments: [],
    starts: new Map(),
    ends: new Map(),
    index: 0,
    trailing: [],
    resolvedWordIds: [],
  };
}

function exprToMath(node: EqNode): MathComponent[] {
  switch (node.kind) {
    case "text":
      return node.text ? [new MathRun(node.text)] : [];
    case "sup":
      return [
        new MathSuperScript({
          children: exprToMath(node.base),
          superScript: exprToMath(node.exp),
        }),
      ];
    case "sub":
      return [
        new MathSubScript({
          children: exprToMath(node.base),
          subScript: exprToMath(node.sub),
        }),
      ];
    case "frac":
      return [
        new MathFraction({
          numerator: exprToMath(node.num),
          denominator: exprToMath(node.den),
          type: "stacked",
        }),
      ];
    case "row":
      return node.items.flatMap(exprToMath);
  }
}

function equationChildren(node: JsonNode): ParagraphChild[] {
  const children = exprToMath(asEquation(node.attrs?.expr));
  if (!children.length) return [new TextRun(String(node.attrs?.plain ?? ""))];
  return [new OfficeMath({ children })];
}

function runs(
  node: JsonNode,
  plan: DocxCommentPlan,
  notes: Map<string, NoteSlot>,
  library: CitationLibrary,
): ParagraphChild[] {
  return (node.content ?? []).flatMap((n): ParagraphChild[] => {
    if (n.type === "citation") {
      const source = library.sources.find(
        (item) => item.id === String(n.attrs?.sourceId ?? ""),
      );
      if (!source) return [];
      return [
        new SimpleField(
          ` CITATION ${source.tag} \\l 1033 `,
          inText(source, library.style),
        ),
      ];
    }
    if (n.type === "noteReference") {
      const slot = notes.get(String(n.attrs?.id ?? ""));
      if (!slot) return [];
      return [
        slot.kind === "endnote"
          ? new EndnoteReferenceRun(slot.num)
          : new FootnoteReferenceRun(slot.num),
      ];
    }
    if (n.type === "hardBreak") return [new TextRun({ break: 1 })];
    if (n.type === "tab") return [new TextRun({ children: [new Tab()] })];
    if (n.type === "image" || n.type === "inlineImage") {
      const match = /^data:image\/(png|jpeg|gif);base64,(.*)$/i.exec(
        String(n.attrs?.src),
      );
      if (!match) return [new TextRun(String(n.attrs?.alt ?? "[Image]"))];
      const data = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
      const [naturalWidth, naturalHeight] = imageSize(data, match[1]);
      const explicitWidth = Number(n.attrs?.width);
      const explicitHeight = Number(n.attrs?.height);
      const sized = explicitWidth > 0 && explicitHeight > 0;
      const requestedWidth = sized ? explicitWidth : naturalWidth;
      const requestedHeight = sized
        ? explicitHeight
        : (naturalHeight * requestedWidth) / naturalWidth;
      const scale = sized
        ? 1
        : Math.min(1, 600 / requestedWidth, 800 / requestedHeight);
      const crop = imageCrop(n.attrs);
      // The frame is the cropped region at the same scale as the full picture.
      // `data` stays the whole image so Word's crop reset can reveal it.
      const frame = croppedFrame(
        { width: requestedWidth * scale, height: requestedHeight * scale },
        crop,
      );
      const docxCrop = docxImageCrop(crop);
      const wrap = n.type === "image" ? imageWrap(n.attrs) : null;
      const beside = wrap === "left" || wrap === "right";
      return [
        new ImageRun({
          type: match[1] === "jpeg" ? "jpg" : (match[1] as "png" | "gif"),
          data,
          transformation: {
            width: Math.max(1, frame.width),
            height: Math.max(1, frame.height),
          },
          ...(docxCrop ? { crop: docxCrop } : {}),
          ...(beside
            ? {
                floating: {
                  horizontalPosition: {
                    relative: HorizontalPositionRelativeFrom.COLUMN,
                    align:
                      wrap === "right"
                        ? HorizontalPositionAlign.RIGHT
                        : HorizontalPositionAlign.LEFT,
                  },
                  verticalPosition: {
                    relative: VerticalPositionRelativeFrom.PARAGRAPH,
                    align: VerticalPositionAlign.TOP,
                  },
                  wrap: {
                    type: TextWrappingType.SQUARE,
                    side: TextWrappingSide.BOTH_SIDES,
                  },
                },
              }
            : {}),
          altText: docxImageAlt(n.attrs?.alt),
        }),
      ];
    }
    if (n.type === "note") return [];
    if (n.type === "equation") return equationChildren(n);
    if (n.type !== "text") return runs(n, plan, notes, library);
    const index = plan.index;
    plan.index += 1;
    const opts: { -readonly [K in keyof IRunOptions]: IRunOptions[K] } = {
      text: n.text ?? "",
    };
    for (const m of n.marks ?? []) {
      if (m.type === "bold") opts.bold = true;
      if (m.type === "italic") opts.italics = true;
      if (m.type === "strike") opts.strike = true;
      if (m.type === "underline")
        opts.underline = { type: UnderlineType.SINGLE };
      if (m.type === "superscript") opts.superScript = true;
      if (m.type === "subscript") opts.subScript = true;
      if (m.type === "code") opts.font = "Courier New";
      if (m.type === "textStyle") {
        opts.font =
          typeof m.attrs?.fontFamily === "string"
            ? officeFont(m.attrs.fontFamily)
            : undefined;
        opts.color = color(m.attrs?.color);
        const size = parseFloat(String(m.attrs?.fontSize));
        if (size > 0)
          opts.size =
            size * (String(m.attrs?.fontSize).endsWith("px") ? 1.5 : 2);
      }
      if (m.type === "highlight")
        opts.shading = { fill: color(m.attrs?.color) ?? "FFFF00" };
    }
    const run = new TextRun(opts);
    const link = n.marks?.find((m) => m.type === "link");
    const body: ParagraphChild =
      link && /^(https?:|mailto:|tel:)/i.test(String(link.attrs?.href))
        ? new ExternalHyperlink({
            link: String(link.attrs?.href),
            children: [run],
          })
        : run;
    return [...marked(plan, index, "starts"), body, ...marked(plan, index, "ends")];
  });
}
function columnSegments(
  nodes: JsonNode[],
): { columns: 1 | 2; nodes: JsonNode[] }[] {
  const out: { columns: 1 | 2; nodes: JsonNode[] }[] = [];
  const push = (columns: 1 | 2, node: JsonNode) => {
    const last = out[out.length - 1];
    if (last && last.columns === columns) last.nodes.push(node);
    else out.push({ columns, nodes: [node] });
  };
  const walk = (items: JsonNode[], columns: 1 | 2) => {
    for (const node of items) {
      if (node.type === "columnLayout")
        walk(node.content ?? [], node.attrs?.columns === 1 ? 1 : 2);
      else push(columns, node);
    }
  };
  walk(nodes, 1);
  return out;
}
/** Source name, then one row per bar. A missing sheet keeps the last numbers. */
function linkedChartBlocks(node: JsonNode): (Paragraph | Table)[] {
  const chart = linkedChartAttrs(node.attrs);
  const written: (Paragraph | Table)[] = [
    new Paragraph({
      children: [new TextRun(chartCaption(chart.sourceTitle))],
    }),
  ];
  if (chart.labels.length)
    written.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: chart.labels.map(
          (label, index) =>
            new TableRow({
              children: [label, String(chart.values[index])].map(
                (text) =>
                  new TableCell({
                    children: [
                      new Paragraph({ children: [new TextRun(text)] }),
                    ],
                  }),
              ),
            }),
        ),
      }),
    );
  if (chart.missing)
    written.push(
      new Paragraph({ children: [new TextRun(missingSpreadsheetText)] }),
    );
  return written;
}
function blocks(
  nodes: JsonNode[],
  plan: DocxCommentPlan,
  notes: Map<string, NoteSlot>,
  library: CitationLibrary,
  list?: { ordered: boolean; level: number },
): (Paragraph | Table | TableOfContents)[] {
  return nodes.flatMap((n): (Paragraph | Table | TableOfContents)[] => {
    if (n.type === "note" || n.type === "sectionBreak" || n.type === "docShape") return [];
    if (n.type === "linkedChart") return linkedChartBlocks(n);
    if (n.type === "columnLayout")
      return blocks(n.content ?? [], plan, notes, library, list);
    if (n.type === "bibliography")
      return [new Paragraph({ children: [new TextRun("SLBIBFIELD")] })];
    if (n.type === "tableOfContents") {
      const max = Number(n.attrs?.maxLevel) === 1 ? "1-1" : "1-3";
      const pageNumbers = n.attrs?.pageNumbers !== false;
      return [
        new TableOfContents("Contents", {
          hyperlink: true,
          headingStyleRange: max,
          ...(pageNumbers ? {} : { pageNumbersEntryLevelsRange: max }),
        }),
      ];
    }
    if (n.type === "bulletList" || n.type === "orderedList")
      return blocks(n.content ?? [], plan, notes, library, {
        ordered: n.type === "orderedList",
        level: list ? Math.min(8, list.level + 1) : 0,
      });
    if (n.type === "listItem" || n.type === "blockquote")
      return blocks(n.content ?? [], plan, notes, library, list);
    if (n.type === "table")
      return [
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: (n.content ?? []).map(
            (row) =>
              new TableRow({
                tableHeader:
                  (!!row.content?.length &&
                    row.content.every((cell) => cell.type === "tableHeader")) ||
                  undefined,
                children: (row.content ?? []).map(
                  (cell) =>
                    new TableCell({
                      columnSpan: Number(cell.attrs?.colspan) || 1,
                      rowSpan: Number(cell.attrs?.rowspan) || 1,
                      verticalAlign: VerticalAlign.TOP,
                      children: blocks(cell.content ?? [], plan, notes, library).filter(
                        (block): block is Paragraph | Table =>
                          block instanceof Paragraph || block instanceof Table,
                      ),
                    }),
                ),
              }),
          ),
        }),
      ];
    if (n.type === "textBox") {
      const text = textBoxPlain(n);
      const hex = [...new TextEncoder().encode(text)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      return [new Paragraph({ children: [new TextRun(`SLTBXEXPORT${hex}END`)] })];
    }
    if (n.type === "pageBreak")
      return [new Paragraph({ pageBreakBefore: true })];
    if (n.type === "horizontalRule")
      return [
        new Paragraph({
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 6, color: "808080" },
          },
        }),
      ];
    const children =
      n.type === "image"
        ? runs({ type: "paragraph", content: [n] }, plan, notes, library)
        : runs(n, plan, notes, library);
    const spacing =
      n.type === "paragraph" || n.type === "heading"
        ? { ...docxLineSpacing(n.attrs?.lineSpacing), ...docxParagraphGap(n.attrs) }
        : undefined;
    const indent =
      n.type === "paragraph" || n.type === "heading"
        ? docxParagraphIndent(n.attrs)
        : undefined;
    const stop = Number(n.attrs?.tabStop);
    const tabStops =
      Number.isFinite(stop) && stop > 0 && stop <= 22
        ? [{ type: TabStopType.LEFT, position: Math.round(stop * 1440) }]
        : undefined;
    return [
      new Paragraph({
        children,
        tabStops,
        alignment: alignment(n.attrs?.textAlign),
        ...(spacing ? { spacing } : {}),
        ...(indent ? { indent } : {}),
        heading:
          n.type === "heading"
            ? ([
                HeadingLevel.HEADING_1,
                HeadingLevel.HEADING_2,
                HeadingLevel.HEADING_3,
                HeadingLevel.HEADING_4,
                HeadingLevel.HEADING_5,
                HeadingLevel.HEADING_6,
              ][Number(n.attrs?.level) - 1] ?? HeadingLevel.HEADING_1)
            : undefined,
        ...(n.attrs?.keepNext === true ? { keepNext: true } : {}),
        ...(n.attrs?.keepLines === true ? { keepLines: true } : {}),
        ...(n.attrs?.widowControl === true ? { widowControl: true } : {}),
        ...(list
          ? list.ordered
            ? { numbering: { reference: "suiteleaf-list", level: list.level } }
            : { bullet: { level: list.level } }
          : {}),
      }),
    ];
  });
}
type ExportNumberFormat = PageNumberFormat | "arabic";
/** The first heading marked startArabic begins a new page numbered 1. */
function splitAtArabicRestart(nodes: JsonNode[]): {
  front: JsonNode[];
  body: JsonNode[] | null;
} {
  const at = nodes.findIndex(
    (node) => node.type === "heading" && node.attrs?.startArabic === true,
  );
  if (at < 0) return { front: nodes, body: null };
  const cut = at > 0 && nodes[at - 1]?.type === "pageBreak" ? at - 1 : at;
  return { front: nodes.slice(0, cut), body: nodes.slice(at) };
}
function docxSection(
  pageSettings: PageSettings,
  watermark: Paragraph | null,
  format: ExportNumberFormat,
  lead: boolean,
  nextPage: boolean,
  sectionOverride: { header: string; footer: string } | null = null,
  sectionRestart: number | null = null,
  sectionContinues = false,
  fractionTotal: number | null = null,
) {
  const settings: PageSettings = sectionOverride
    ? {
        ...pageSettings,
        header: sectionOverride.header || pageSettings.header,
        footer: sectionOverride.footer || pageSettings.footer,
        oddHeader: sectionOverride.header || pageSettings.oddHeader,
        oddFooter: sectionOverride.footer || pageSettings.oddFooter,
        evenHeader: sectionOverride.header || pageSettings.evenHeader,
        evenFooter: sectionOverride.footer || pageSettings.evenFooter,
        firstHeader: sectionOverride.header || pageSettings.firstHeader,
        firstFooter: sectionOverride.footer || pageSettings.firstFooter,
      }
    : pageSettings;
  const fractionField =
    fractionTotal != null ? String(fractionTotal) : PageNumber.TOTAL_PAGES;
  const numberRun = () =>
    new TextRun({
      children:
        format === "page"
          ? ["Page ", PageNumber.CURRENT]
          : format === "fraction"
            ? [PageNumber.CURRENT, " / ", fractionField]
            : [PageNumber.CURRENT],
    });
  const topRight =
    settings.pageNumbers &&
    settings.pageNumberPositionSet &&
    settings.pageNumberPosition === "top-right";
  const pictures = (src: string): Paragraph[] => {
    const picture = furnitureImageParagraph(src);
    return picture ? [picture] : [];
  };
  const headerPart = (
    text: string,
    image: string,
    withNumber = false,
    alignment: (typeof AlignmentType)["LEFT"] | (typeof AlignmentType)["RIGHT"] = AlignmentType.RIGHT,
  ) =>
    new Header({
      children: [
        ...(watermark ? [watermark] : []),
        ...pictures(image),
        new Paragraph(text),
        ...(withNumber
          ? [
              new Paragraph({
                alignment,
                children: [numberRun()],
              }),
            ]
          : []),
      ],
    });
  const footerPart = (
    text: string,
    image: string,
    side: "left" | "right" | "center" | "none",
    numbers: boolean,
  ) => {
    const number = numberRun();
    if (numbers && side === "center")
      return new Footer({
        children: [
          ...pictures(image),
          new Paragraph(text),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [number],
          }),
        ],
      });
    const children = !numbers
      ? [new TextRun(text)]
      : side === "left"
        ? text
          ? [number, new TextRun(`  ${text}`)]
          : [number]
        : text
          ? [new TextRun(`${text}  `), number]
          : [number];
    return new Footer({
      children: [
        ...pictures(image),
        new Paragraph({
          alignment:
            side === "right" ? AlignmentType.RIGHT : AlignmentType.LEFT,
          children,
        }),
      ],
    });
  };
  const placedFooterSide = (
    even = false,
  ): "left" | "right" | "center" | "none" => {
    if (!settings.pageNumbers) return "none";
    if (!settings.pageNumberPositionSet) return even ? "left" : "right";
    if (settings.pageNumberPosition === "top-right") return "none";
    if (settings.differentOddEven) return even ? "left" : "right";
    if (settings.pageNumberPosition === "bottom-center") return "center";
    return "right";
  };
  const firstPage = lead && settings.differentFirstPage;
  const coverPage =
    lead &&
    settings.pageNumbers &&
    settings.coverHasNoNumber &&
    !settings.differentFirstPage;
  const coverHeader = settings.differentOddEven
    ? settings.oddHeader
    : settings.header;
  const coverFooter = settings.differentOddEven
    ? settings.oddFooter
    : settings.footer;
  const splitFurniture = firstPage || settings.differentOddEven || coverPage;
  const start = lead ? wordPageNumberStart(settings) : null;
  const pageNumbers = !settings.pageNumbers
    ? undefined
    : sectionRestart != null
      ? {
          start: sectionRestart,
          formatType:
            format === "roman" ? NumberFormat.LOWER_ROMAN : NumberFormat.DECIMAL,
        }
      : sectionContinues
        ? format === "roman"
          ? { formatType: NumberFormat.LOWER_ROMAN }
          : undefined
        : !lead || format === "arabic"
          ? { start: 1, formatType: NumberFormat.DECIMAL }
          : format === "roman"
            ? {
                ...(start == null ? {} : { start }),
                formatType: NumberFormat.LOWER_ROMAN,
              }
            : start == null
              ? undefined
              : { start };
  const [width, height] =
    settings.size === "a4" ? [11906, 16838] : [12240, 15840];
  return {
    properties: {
      ...(nextPage ? { type: SectionType.NEXT_PAGE } : {}),
      ...(firstPage || coverPage ? { titlePage: true } : {}),
      page: {
        size: {
          width: settings.landscape ? height : width,
          height: settings.landscape ? width : height,
        },
        margin: {
              top: pagePxToTwips(settings.marginTop),
              bottom: pagePxToTwips(settings.marginBottom),
              left: pagePxToTwips(settings.marginLeft),
              right: pagePxToTwips(settings.marginRight),
          header: pagePxToTwips(settings.headerFromEdge),
          footer: pagePxToTwips(settings.footerFromEdge),
        },
        ...(pageNumbers ? { pageNumbers } : {}),
      },
    },
    headers: splitFurniture
      ? {
          default: headerPart(
            settings.differentOddEven ? settings.oddHeader : settings.header,
            settings.headerImage,
            topRight,
          ),
          ...(settings.differentOddEven
            ? {
                even: headerPart(
                  settings.evenHeader,
                  settings.headerImage,
                  topRight,
                  AlignmentType.LEFT,
                ),
              }
            : {}),
          ...(firstPage
            ? { first: headerPart(settings.firstHeader, settings.firstHeaderImage) }
            : coverPage
              ? { first: headerPart(coverHeader, settings.headerImage) }
              : {}),
        }
      : {
          default: headerPart(settings.header, settings.headerImage, topRight),
        },
    footers: splitFurniture
      ? {
          default: footerPart(
            settings.differentOddEven ? settings.oddFooter : settings.footer,
            settings.footerImage,
            placedFooterSide(false),
            settings.pageNumbers && !topRight,
          ),
          ...(settings.differentOddEven
            ? {
                even: footerPart(
                  settings.evenFooter,
                  settings.footerImage,
                  placedFooterSide(true),
                  settings.pageNumbers && !topRight,
                ),
              }
            : {}),
          ...(firstPage
            ? {
                first: footerPart(
                  settings.firstFooter,
                  settings.firstFooterImage,
                  "none",
                  false,
                ),
              }
            : coverPage
              ? { first: footerPart(coverFooter, settings.footerImage, "none", false) }
              : {}),
        }
      : topRight
        ? { default: footerPart(settings.footer, settings.footerImage, "none", false) }
        : settings.pageNumberPositionSet &&
            settings.pageNumberPosition === "bottom-center"
          ? {
              default: footerPart(
                settings.footer,
                settings.footerImage,
                "center",
                settings.pageNumbers,
              ),
            }
          : format === "fraction"
            ? {
                default: new Footer({
                  children: [
                    ...pictures(settings.footerImage),
                    new Paragraph({
                      children: [
                        new TextRun(settings.footer),
                        ...(settings.pageNumbers
                          ? [
                              new TextRun({
                                children: [
                                  "  ",
                                  PageNumber.CURRENT,
                                  " / ",
                                  fractionField,
                                ],
                              }),
                            ]
                          : []),
                      ],
                    }),
                  ],
                }),
              }
            : {
                default: footerPart(
                  settings.footer,
                  settings.footerImage,
                  "right",
                  settings.pageNumbers,
                ),
              },
  };
}
/** One tab's body in a Word export. `title` is the heading written before it. */
export type DocxExportSection = {
  title?: string;
  content: JsonNode;
};

/** One Word document: a heading for each titled section, then that section's body. */
function combineExportSections(sections: DocxExportSection[]): JsonNode {
  const base = structuredClone(sections[0].content);
  const content: JsonNode[] = [];
  for (const section of sections) {
    const title = section.title?.trim();
    if (title) {
      content.push({
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: title }],
      });
    }
    for (const node of section.content.content ?? [])
      content.push(structuredClone(node));
  }
  return { ...base, type: "doc", content };
}

type SectionBreakAttrs = {
  header: string;
  footer: string;
  restartAt: number | null;
};

function sectionBreakAttrs(
  attrs: Record<string, unknown> | undefined,
): SectionBreakAttrs {
  const clean = (value: unknown) =>
    typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  const restart = attrs?.restartAt;
  const restartAt =
    typeof restart === "number" &&
    Number.isInteger(restart) &&
    restart >= 1 &&
    restart <= 9999
      ? restart
      : null;
  return { header: clean(attrs?.header), footer: clean(attrs?.footer), restartAt };
}

/** Split at section breaks. Each break's letterhead applies to the pages after it. */
function sectionPieces(
  nodes: JsonNode[],
): { nodes: JsonNode[]; break: SectionBreakAttrs | null }[] {
  const pieces: { nodes: JsonNode[]; break: SectionBreakAttrs | null }[] = [
    { nodes: [], break: null },
  ];
  const add = (node: JsonNode) => {
    pieces[pieces.length - 1]!.nodes.push(node);
  };
  const visit = (items: JsonNode[]) => {
    for (const node of items) {
      if (node.type === "sectionBreak") {
        pieces.push({ nodes: [], break: sectionBreakAttrs(node.attrs) });
        continue;
      }
      if (node.type !== "columnLayout") {
        add(node);
        continue;
      }
      // A stored break inside the columns still starts the next section.
      let bucket: JsonNode[] = [];
      const flush = () => {
        if (!bucket.length) return;
        add({ ...node, content: bucket });
        bucket = [];
      };
      for (const child of node.content ?? []) {
        if (child.type === "sectionBreak") {
          flush();
          pieces.push({ nodes: [], break: sectionBreakAttrs(child.attrs) });
          continue;
        }
        if (child.type === "columnLayout") {
          flush();
          visit([child]);
          continue;
        }
        bucket.push(child);
      }
      flush();
    }
  };
  visit(nodes);
  const filled = pieces.filter((piece) => piece.nodes.length > 0);
  return filled.length ? filled : [{ nodes: [], break: null }];
}

export async function exportDocx(
  file: Pick<DocFile, "title" | "content"> & {
    sections?: DocxExportSection[];
  },
): Promise<Uint8Array> {
  const content = embedSuggestionMarkers(
    file.sections?.length
      ? combineExportSections(file.sections)
      : structuredClone(file.content),
  );
  // Word takes neither WebP nor SVG without a fallback, so both go in as PNG.
  const pngForWord = async (src: string): Promise<string> => {
    if (!/^data:image\/(webp|svg\+xml)/i.test(src)) return src;
    if (typeof document === "undefined")
      throw new Error(
        "WebP and SVG images need the browser image converter for DOCX export.",
      );
    const img = document.createElement("img");
    img.src = src;
    await img.decode();
    const canvas = document.createElement("canvas");
    // An SVG without a width and height has no size of its own.
    canvas.width = img.naturalWidth || 300;
    canvas.height = img.naturalHeight || 150;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not convert the image for DOCX export.");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  };
  const prepareImages = async (node: JsonNode): Promise<void> => {
    if (
      (node.type === "image" || node.type === "inlineImage") &&
      /^data:image\/(webp|svg\+xml)/i.test(String(node.attrs?.src))
    )
      node.attrs = { ...node.attrs, src: await pngForWord(String(node.attrs?.src)) };
    await Promise.all((node.content ?? []).map(prepareImages));
  };
  await prepareImages(content);
  const pageSettings = content.attrs?.pageSettings;
  if (pageSettings && typeof pageSettings === "object") {
    const images = pageSettings as Record<string, unknown>;
    for (const key of ["headerImage", "footerImage", "firstHeaderImage", "firstFooterImage"]) {
      if (typeof images[key] === "string") images[key] = await pngForWord(images[key]);
    }
  }
  const notes = noteIndex(content);
  const library = citationLibrary(content);
  const noteBody = (id: string): Paragraph[] => {
    const note = findNote(content, id);
    const paragraphs = blocks(note?.content ?? [], blankCommentPlan(), notes, library).filter(
      (block): block is Paragraph => block instanceof Paragraph,
    );
    return paragraphs.length ? paragraphs : [new Paragraph("")];
  };
  const footnotes: Record<string, { children: Paragraph[] }> = {};
  const endnotes: Record<string, { children: Paragraph[] }> = {};
  for (const [id, slot] of notes) {
    const target = slot.kind === "endnote" ? endnotes : footnotes;
    target[String(slot.num)] = { children: noteBody(id) };
  }
  const settings = documentPageSettings(content);
  const watermark = docxWatermarkParagraph(settings.watermark);
  const comments = planDocxComments(content);
  const pieces = sectionPieces(content.content ?? []);
  const built = pieces.flatMap((piece, pieceIndex) => {
    const fractionTotal =
      piece.break?.restartAt != null
        ? restartedSectionTotal(
            piece.break.restartAt,
            0,
            sectionContentPages(piece.nodes, settings),
          )
        : null;
    const split = splitAtArabicRestart(piece.nodes);
    const parts: {
      nodes: JsonNode[];
      format: ExportNumberFormat;
      lead: boolean;
      nextPage: boolean;
    }[] =
      split.body && split.front.length
        ? [
            {
              nodes: split.front,
              format: settings.pageNumberFormat,
              lead: pieceIndex === 0,
              nextPage: false,
            },
            { nodes: split.body, format: "arabic", lead: false, nextPage: true },
          ]
        : [
            {
              nodes: split.body ?? split.front,
              format: split.body ? "arabic" : settings.pageNumberFormat,
              lead: pieceIndex === 0 && split.body == null,
              nextPage: false,
            },
          ];
    return parts.flatMap((part, partIndex) => {
      const segments = columnSegments(part.nodes);
      if (!segments.length) segments.push({ columns: 1, nodes: [] });
      return segments.map((segment, index) => ({
        format: part.format,
        lead: part.lead && index === 0,
        nextPage:
          index === 0 && (part.nextPage || (piece.break != null && partIndex === 0)),
        continuous: index > 0,
        columns: segment.columns,
        sectionBreak: piece.break,
        sectionRestart:
          piece.break && partIndex === 0 && index === 0 ? piece.break.restartAt : null,
        sectionContinues:
          piece.break != null &&
          partIndex === 0 &&
          index === 0 &&
          piece.break.restartAt == null &&
          part.format !== "arabic",
        fractionTotal,
        children: blocks(segment.nodes, comments, notes, library),
      }));
    });
  });
  const lastBuilt = built[built.length - 1];
  if (comments.trailing.length)
    lastBuilt.children.push(
      new Paragraph({
        children: comments.trailing.flatMap((id) => [
          new CommentRangeStart(id),
          new CommentRangeEnd(id),
          new CommentReference(id),
        ]),
      }),
    );
  const sections = built.map((part) => {
    const section = docxSection(
      settings,
      watermark,
      part.format,
      part.lead,
      part.nextPage,
      part.sectionBreak
        ? { header: part.sectionBreak.header, footer: part.sectionBreak.footer }
        : null,
      part.sectionRestart,
      part.sectionContinues,
      part.fractionTotal,
    );
    return {
      ...section,
      properties: {
        ...section.properties,
        ...(part.continuous ? { type: SectionType.CONTINUOUS } : {}),
        ...(part.columns === 2
          ? { column: { count: 2, space: 720, equalWidth: true } }
          : {}),
      },
      children: part.children,
    };
  });
  const doc = new Document({
    title: file.title,
    creator: "SuiteLeaf",
    ...(settings.differentOddEven
      ? { evenAndOddHeaderAndFooters: true }
      : {}),
    ...(Object.keys(footnotes).length ? { footnotes } : {}),
    ...(Object.keys(endnotes).length ? { endnotes } : {}),
    styles: {
      default: {
        document: { run: { font: settings.font ? officeFont(settings.font) : "Arial", size: 22 } },
      },
    },
    numbering: {
      config: [
        {
          reference: "suiteleaf-list",
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: "decimal" as const,
            text: `%${level + 1}.`,
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } },
            },
          })),
        },
      ],
    },
    comments: comments.comments.length
      ? {
          children: comments.comments.map((comment) => ({
            id: comment.wordId,
            author: comment.author,
            initials: comment.initials,
            date: comment.date,
            parentId: comment.parentWordId,
            resolved: comment.resolved,
            children: [new Paragraph(comment.text)],
          })),
        }
      : undefined,
    sections,
  });
  const packed = await revisionizeDocx(
    new Uint8Array(await Packer.toArrayBuffer(doc)),
  );
  const withComments = comments.comments.length
    ? await stampDocxComments(packed, comments.resolvedWordIds)
    : packed;
  return stampDocxTextBoxes(await stampDocxCitations(withComments, library, content));
}

function hexToText(hex: string): string {
  if (hex.length % 2) return "";
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return new TextDecoder().decode(bytes);
}

function textBoxPlain(node: JsonNode): string {
  const parts: string[] = [];
  const walk = (current: JsonNode) => {
    if (current.type === "text" && current.text) parts.push(current.text);
    if (current.type === "hardBreak") parts.push("\n");
    for (const child of current.content ?? []) walk(child);
  };
  walk(node);
  return parts.join("") || String(node.attrs?.text ?? "");
}

function textBoxParagraph(text: string): string {
  const runs = text
    .split("\n")
    .map((line, index) => {
      const escaped = line
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      const breakBefore = index > 0 ? "<w:r><w:br/></w:r>" : "";
      return `${breakBefore}<w:r><w:t xml:space="preserve">${escaped}</w:t></w:r>`;
    })
    .join("");
  return `<w:p><w:r><w:pict><v:shape style="width:180pt;height:48pt" filled="f" stroked="t"><v:textbox><w:txbxContent><w:p>${runs}</w:p></w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>`;
}

/** Turns text-box tokens into Word text boxes. */
async function stampDocxTextBoxes(bytes: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  const file = zip.file("word/document.xml");
  if (!file) return bytes;
  let xml = await file.async("string");
  if (!xml.includes("SLTBXEXPORT")) return bytes;
  xml = xml.replace(
    /<w:p\b[^>]*>(?:(?!<\/w:p>)[\s\S])*SLTBXEXPORT([0-9a-f]*)END(?:(?!<\/w:p>)[\s\S])*<\/w:p>/g,
    (_paragraph, hex: string) => textBoxParagraph(hexToText(hex)),
  );
  if (!xml.includes('xmlns:v="urn:schemas-microsoft-com:vml"'))
    xml = xml.replace(/<w:document\b/, '<w:document xmlns:v="urn:schemas-microsoft-com:vml"');
  zip.file("word/document.xml", xml);
  return zip.generateAsync({ type: "uint8array" });
}
