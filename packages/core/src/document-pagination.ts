import type { JsonNode } from "./index";
import { keepWithNextLayout } from "./keep-with-next";
import { paginateSection, type SectionPiece } from "./table-pages";
import { bodyEdgeInsets } from "./header-edge";
import {
  defaultPageSettings,
  pageDimensions,
  type PageSettings,
} from "./document-page-settings";

/**
 * Last printed number of a restarted section.
 * `sectionPage` is where the section starts and `endPage` is the next
 * section or the document page count, the same span applySection uses.
 * Two pages restarted at 1 total 2.
 */
export function restartedSectionTotal(
  restartAt: number,
  sectionPage: number,
  endPage: number,
): number {
  return restartAt + Math.max(0, endPage - sectionPage) - 1;
}
const BODY_FONT_PX = (11 * 96) / 72;
/** Editor body line-height. Single spacing in the document, not the HTML 1.5 shorthand. */
const BODY_LINE_PX = BODY_FONT_PX * 1.333333;
/** About half an em of 11pt Arial, wide enough that a page of text is not counted as one. */
const BODY_CHAR_PX = BODY_FONT_PX * 0.5;
const FLOW_TEXT_BLOCKS = new Set(["paragraph", "heading", "codeBlock"]);
export function pageTextCapacity(settings: PageSettings): { charsPerLine: number; linesPerPage: number } {
  const { width, height } = pageDimensions(settings);
  const insets = bodyEdgeInsets(settings, width);
  const bodyHeight = Math.max(1, height - insets.top - insets.bottom);
  const contentWidth = Math.max(
    1,
    width - settings.marginLeft - settings.marginRight - Math.max(0, settings.gutter || 0),
  );
  return {
    charsPerLine: Math.max(1, Math.floor(contentWidth / BODY_CHAR_PX)),
    linesPerPage: Math.max(1, Math.floor((bodyHeight + 0.5) / BODY_LINE_PX)),
  };
}
function blockLines(text: string, charsPerLine: number): number {
  if (!text) return 0;
  return text.split("\n").reduce((lines, block) => {
    if (!block) return lines + 1;
    return lines + Math.max(1, Math.ceil(block.length / charsPerLine));
  }, 0);
}
/**
 * Pages occupied by text between manual page breaks.
 * The screen measures the DOM. Export has no DOM, so this uses the same
 * paper, margins, and body line box. A break always starts a page, and text
 * that passes the bottom of the page starts another.
 */
export function pagesForTextSegments(
  segments: readonly string[],
  settings: PageSettings = defaultPageSettings,
): number {
  const { charsPerLine, linesPerPage } = pageTextCapacity(settings);
  const list = segments.length ? segments : [""];
  let pages = 0;
  for (const segment of list) {
    const lines = blockLines(segment, charsPerLine);
    pages += Math.max(1, Math.ceil(lines / linesPerPage));
  }
  return pages;
}
function nodeText(node: JsonNode): string {
  if (node.text) return node.text;
  return (node.content ?? []).map(nodeText).join("");
}
/** Pages a section's blocks fill, including text that flows and stored page breaks. */
export function sectionContentPages(
  nodes: JsonNode[],
  settings: PageSettings = defaultPageSettings,
): number {
  const segments = [""];
  const { charsPerLine, linesPerPage } = pageTextCapacity(settings);
  const blocks: { lines: number; keepNext?: boolean; widowControl?: boolean }[] = [];
  const pieces: SectionPiece[] = [];
  let sawTable = false;
  let keep = false;
  const addBlock = (text: string) => {
    const current = segments[segments.length - 1] ?? "";
    segments[segments.length - 1] = current ? `${current}\n${text}` : text;
  };
  const visit = (items: JsonNode[]) => {
    for (const node of items) {
      if (node.type === "pageBreak") {
        segments.push("");
        pieces.push({ kind: "break" });
        continue;
      }
      if (node.type === "table" && node.content?.length) {
        sawTable = true;
        const heights = node.content.map((row) =>
          Math.max(1, blockLines(nodeText(row), charsPerLine)),
        );
        pieces.push({
          kind: "table",
          heights,
          repeatHeader: node.attrs?.repeatHeader === true,
        });
        continue;
      }
      if (FLOW_TEXT_BLOCKS.has(node.type)) {
        addBlock(nodeText(node));
        pieces.push({
          kind: "text",
          lines: blockLines(nodeText(node), charsPerLine),
          keepNext: node.attrs?.keepNext === true,
          widowControl: node.attrs?.widowControl === true,
        });
        if (node.attrs?.keepNext === true || node.attrs?.widowControl === true) keep = true;
        blocks.push({
          lines: blockLines(nodeText(node), charsPerLine),
          keepNext: node.attrs?.keepNext === true,
          widowControl: node.attrs?.widowControl === true,
        });
        continue;
      }
      if (node.content?.length) visit(node.content);
    }
  };
  visit(nodes);
  if (sawTable) return paginateSection(pieces, linesPerPage);
  if (keep) return keepWithNextLayout(blocks, linesPerPage).count;
  return pagesForTextSegments(segments, settings);
}
