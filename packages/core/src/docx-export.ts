import {
  AlignmentType,
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  Document,
  Packer,
  Paragraph,
  SectionType,
} from "docx";
import type { DocFile, JsonNode } from "./index";
import { documentProperties } from "./doc-properties";
import {
  paragraphStyles,
  styledDocument,
  wordParagraphStyles,
} from "./doc-styles";
import { refreshReport } from "./doc-contents";
import { refreshIndex } from "./doc-index";
import { captionPagesForExport, headingPagesForExport } from "./caption-pages";
import {
  documentPageSettings,
  restartedSectionTotal,
  sectionContentPages,
} from "./document-layout";
import { docxWatermarkParagraph } from "./doc-watermark";
import { officeFont } from "./office-fonts";
import {
  planDocxComments,
  stampDocxComments,
  type DocxCommentPlan,
} from "./doc-comments";
import { embedSuggestionMarkers, revisionizeDocx } from "./suggestions";
import { citationLibrary, stampDocxCitations } from "./citations";
import { blocks, columnSegments } from "./docx-blocks";
import type { NoteSlot } from "./docx-runs";
import {
  combineExportSections,
  docxSection,
  sectionPieces,
  splitAtArabicRestart,
  type DocxExportSection,
  type ExportNumberFormat,
} from "./docx-section";
import { stampDocxTextBoxes } from "./docx-text-boxes";

export { docxImageAlt } from "./docx-runs";
export type { DocxExportSection } from "./docx-section";

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








export async function exportDocx(
  file: Pick<DocFile, "title" | "content"> & {
    sections?: DocxExportSection[];
    properties?: { author?: string; subject?: string; keywords?: string[] };
  },
): Promise<Uint8Array> {
  const source = file.sections?.length
    ? combineExportSections(file.sections)
    : structuredClone(file.content);
  const storedPages = (source as { attrs?: { pageSettings?: unknown } }).attrs?.pageSettings;
  const sourceDoc = source as JsonNode;
  const indexed =
    storedPages && typeof storedPages === "object" && !Array.isArray(storedPages)
      ? refreshIndex(sourceDoc, documentPageSettings(sourceDoc as never))
      : refreshIndex(sourceDoc);
  const content = styledDocument(
    embedSuggestionMarkers(
      refreshReport(indexed, captionPagesForExport(indexed), headingPagesForExport(indexed)),
    ),
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
  const properties = documentProperties(file);
  const doc = new Document({
    title: file.title,
    creator: properties?.author || "SuiteLeaf",
    ...(properties ? { subject: properties.subject, keywords: properties.keywords.join(", ") } : {}),
    ...(properties?.description ? { description: properties.description } : {}),
    ...(properties?.category
      ? { customProperties: [{ name: "Category", value: properties.category }] }
      : {}),
    ...(settings.differentOddEven
      ? { evenAndOddHeaderAndFooters: true }
      : {}),
    ...(Object.keys(footnotes).length ? { footnotes } : {}),
    ...(Object.keys(endnotes).length ? { endnotes } : {}),
    styles: {
      default: {
        document: {
          run: {
            font: settings.font ? officeFont(settings.font) : "Arial",
            size: 22,
            ...(settings.kern ? { kern: Math.round(settings.kern * 2) } : {}),
          },
        },
      },
      paragraphStyles: wordParagraphStyles(paragraphStyles(content)),
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




