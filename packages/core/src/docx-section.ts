import {
  AlignmentType,
  Footer,
  Header,
  ImageRun,
  NumberFormat,
  PageNumber,
  Paragraph,
  SectionType,
  TextRun,
} from "docx";
import type { JsonNode } from "./index";
import {
  wordPageNumberStart,
  type PageNumberFormat,
  type PageSettings,
} from "./document-layout";
import { pagePxToTwips } from "./word-page-margins";
import { docxImageAlt, imageSize } from "./docx-runs";

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
export type ExportNumberFormat = PageNumberFormat | "arabic";
/** The first heading marked startArabic begins a new page numbered 1. */
export function splitAtArabicRestart(nodes: JsonNode[]): {
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
export function docxSection(
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
export function combineExportSections(sections: DocxExportSection[]): JsonNode {
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
export function sectionPieces(
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
