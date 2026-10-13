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
  ImageRun,
  Math as OfficeMath,
  MathFraction,
  MathRun,
  MathSubScript,
  MathSuperScript,
  Packer,
  PageNumber,
  Paragraph,
  SimpleField,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  UnderlineType,
  HorizontalPositionAlign,
  HorizontalPositionRelativeFrom,
  TextWrappingSide,
  TextWrappingType,
  VerticalAlign,
  VerticalPositionAlign,
  VerticalPositionRelativeFrom,
  WidthType,
  type IRunOptions,
  type MathComponent,
  type ParagraphChild,
} from "docx";
import type { DocFile, JsonNode } from "./index";
import { asEquation, type EqNode } from "./equations";
import { documentPageSettings } from "./document-layout";
import { docxWatermarkParagraph } from "./doc-watermark";
import {
  planDocxComments,
  stampDocxComments,
  type DocxCommentPlan,
} from "./doc-comments";
import { embedSuggestionMarkers, revisionizeDocx } from "./suggestions";
import { docxLineSpacing } from "./line-spacing";
import {
  citationLibrary,
  inText,
  stampDocxCitations,
  type CitationLibrary,
} from "./citations";
import { croppedFrame, docxImageCrop, imageCrop } from "./image-crop";
import { imageWrap } from "./image-wrap";

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
    if (n.type === "image") {
      const match = /^data:image\/(png|jpeg|gif);base64,(.*)$/i.exec(
        String(n.attrs?.src),
      );
      if (!match) return [new TextRun(String(n.attrs?.alt ?? "[Image]"))];
      const data = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
      const [naturalWidth, naturalHeight] = imageSize(data, match[1]);
      const storedWidth = Number(n.attrs?.width);
      const storedHeight = Number(n.attrs?.height);
      const requestedWidth = storedWidth > 0 ? storedWidth : naturalWidth;
      const requestedHeight =
        storedHeight > 0
          ? storedHeight
          : (naturalHeight * requestedWidth) / naturalWidth;
      // A stored size is the size on the page and has to survive a round trip.
      // Pictures with no stored size still use the file's pixels, capped so a
      // multi-megapixel photo does not become a huge drawing.
      const scale =
        storedWidth > 0
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
      const wrap = imageWrap(n.attrs);
      const floating = wrap
        ? {
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
            wrap:
              wrap === "break"
                ? { type: TextWrappingType.TOP_AND_BOTTOM }
                : {
                    type: TextWrappingType.SQUARE,
                    side: TextWrappingSide.BOTH_SIDES,
                  },
            allowOverlap: false,
          }
        : undefined;
      return [
        new ImageRun({
          type: match[1] === "jpeg" ? "jpg" : (match[1] as "png" | "gif"),
          data,
          transformation: {
            width: Math.max(1, frame.width),
            height: Math.max(1, frame.height),
          },
          ...(docxCrop ? { crop: docxCrop } : {}),
          ...(floating ? { floating } : {}),
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
            ? m.attrs.fontFamily
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
function blocks(
  nodes: JsonNode[],
  plan: DocxCommentPlan,
  notes: Map<string, NoteSlot>,
  library: CitationLibrary,
  list?: { ordered: boolean; level: number },
): (Paragraph | Table | TableOfContents)[] {
  return nodes.flatMap((n): (Paragraph | Table | TableOfContents)[] => {
    if (n.type === "note") return [];
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
        ? docxLineSpacing(n.attrs?.lineSpacing)
        : undefined;
    return [
      new Paragraph({
        children,
        alignment: alignment(n.attrs?.textAlign),
        ...(spacing ? { spacing } : {}),
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
        ...(list
          ? list.ordered
            ? { numbering: { reference: "suiteleaf-list", level: list.level } }
            : { bullet: { level: list.level } }
          : {}),
      }),
    ];
  });
}
export async function exportDocx(
  file: Pick<DocFile, "title" | "content">,
): Promise<Uint8Array> {
  const content = embedSuggestionMarkers(structuredClone(file.content));
  const prepareImages = async (node: JsonNode): Promise<void> => {
    if (
      node.type === "image" &&
      String(node.attrs?.src).startsWith("data:image/webp")
    ) {
      if (typeof document === "undefined")
        throw new Error(
          "WebP images need the browser image converter for DOCX export.",
        );
      const img = document.createElement("img");
      img.src = String(node.attrs?.src);
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not convert the image for DOCX export.");
      ctx.drawImage(img, 0, 0);
      node.attrs = { ...node.attrs, src: canvas.toDataURL("image/png") };
    }
    await Promise.all((node.content ?? []).map(prepareImages));
  };
  await prepareImages(content);
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
  const numberRun = () =>
    new TextRun({
      children:
        settings.pageNumberFormat === "page"
          ? ["Page ", PageNumber.CURRENT]
          : [PageNumber.CURRENT, " / ", PageNumber.TOTAL_PAGES],
    });
  const topRight =
    settings.pageNumbers &&
    settings.pageNumberPositionSet &&
    settings.pageNumberPosition === "top-right";
  const headerPart = (text: string, withNumber = false) =>
    new Header({
      children: [
        ...(watermark ? [watermark] : []),
        new Paragraph(text),
        ...(withNumber
          ? [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [numberRun()],
              }),
            ]
          : []),
      ],
    });
  const footerPart = (
    text: string,
    side: "left" | "right" | "center" | "none",
    numbers: boolean,
  ) => {
    const number = numberRun();
    if (numbers && side === "center")
      return new Footer({
        children: [
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
        new Paragraph({
          alignment:
            side === "right" ? AlignmentType.RIGHT : AlignmentType.LEFT,
          children,
        }),
      ],
    });
  };
  const placedFooterSide = (): "right" | "center" | "none" => {
    if (!settings.pageNumberPositionSet || !settings.pageNumbers) return "right";
    if (settings.pageNumberPosition === "top-right") return "none";
    if (settings.pageNumberPosition === "bottom-center") return "center";
    return "right";
  };
  const splitFurniture =
    settings.differentFirstPage || settings.differentOddEven;
  const comments = planDocxComments(content);
  const children = blocks(content.content ?? [], comments, notes, library);
  if (comments.trailing.length)
    children.push(
      new Paragraph({
        children: comments.trailing.flatMap((id) => [
          new CommentRangeStart(id),
          new CommentRangeEnd(id),
          new CommentReference(id),
        ]),
      }),
    );
  const [width, height] =
    settings.size === "a4" ? [11906, 16838] : [12240, 15840];
  const doc = new Document({
    title: file.title,
    creator: "SuiteLeaf",
    ...(settings.differentOddEven
      ? { evenAndOddHeaderAndFooters: true }
      : {}),
    ...(Object.keys(footnotes).length ? { footnotes } : {}),
    ...(Object.keys(endnotes).length ? { endnotes } : {}),
    styles: { default: { document: { run: { font: "Arial", size: 22 } } } },
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
    sections: [
      {
        properties: {
          page: {
            size: {
              width: settings.landscape ? height : width,
              height: settings.landscape ? width : height,
            },
            margin: {
              top: settings.margin * 15,
              bottom: settings.margin * 15,
              left: settings.margin * 15,
              right: settings.margin * 15,
              header: 360,
              footer: 360,
            },
          },
          ...(settings.differentFirstPage ? { titlePage: true } : {}),
        },
        headers: splitFurniture
          ? {
              default: headerPart(
                settings.differentOddEven ? settings.oddHeader : settings.header,
                topRight,
              ),
              ...(settings.differentOddEven
                ? { even: headerPart(settings.evenHeader, topRight) }
                : {}),
              ...(settings.differentFirstPage
                ? { first: headerPart(settings.firstHeader) }
                : {}),
            }
          : {
              default: headerPart(settings.header, topRight),
            },
        footers: splitFurniture
          ? {
              default: footerPart(
                settings.differentOddEven ? settings.oddFooter : settings.footer,
                settings.pageNumberPositionSet ? placedFooterSide() : "right",
                settings.pageNumbers && !topRight,
              ),
              ...(settings.differentOddEven
                ? {
                    even: footerPart(
                      settings.evenFooter,
                      settings.pageNumberPositionSet ? placedFooterSide() : "left",
                      settings.pageNumbers && !topRight,
                    ),
                  }
                : {}),
              ...(settings.differentFirstPage
                ? { first: footerPart(settings.firstFooter, "none", false) }
                : {}),
            }
          : topRight
            ? { default: footerPart(settings.footer, "none", false) }
            : settings.pageNumberPositionSet &&
                settings.pageNumberPosition === "bottom-center"
              ? {
                  default: footerPart(
                    settings.footer,
                    "center",
                    settings.pageNumbers,
                  ),
                }
              : settings.pageNumberFormat === "page"
                ? {
                    default: footerPart(
                      settings.footer,
                      "right",
                      settings.pageNumbers,
                    ),
                  }
                : {
                    default: new Footer({
                      children: [
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
                                      PageNumber.TOTAL_PAGES,
                                    ],
                                  }),
                                ]
                              : []),
                          ],
                        }),
                      ],
                    }),
                  },
        children,
      },
    ],
  });
  const packed = await revisionizeDocx(
    new Uint8Array(await Packer.toArrayBuffer(doc)),
  );
  const withComments = comments.comments.length
    ? await stampDocxComments(packed, comments.resolvedWordIds)
    : packed;
  return stampDocxCitations(withComments, library, content);
}
