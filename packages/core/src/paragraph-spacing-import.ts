import type { JsonNode } from "./index";
import { paragraphSpacePoints } from "./paragraph-spacing";

/**
 * Word's paragraph gap, read back from `w:spacing`.
 * `w:before="240"` is 12 pt (twips ÷ 20). A missing attribute or 0 is 0 pt.
 * Anything above 120 pt is rejected, and that side stays 0. The paragraph
 * itself is still imported.
 */
export const IMPORTED_PARAGRAPH_SPACE_MAX_PT = 120;

const BLOCKS = new Set(["paragraph", "heading"]);

export type ImportedParagraphSpace = {
  text: string;
  before: number;
  after: number;
};

function decodeXml(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** Collapse whitespace the way the Word text recovery already does. */
function norm(text: string): string {
  return text.replace(/[\s\u200b\ufeff]+/gu, "");
}

/** Twips on `w:before` / `w:after`. Missing, zero, junk, and anything over 120 pt are 0. */
export function paragraphSpaceFromTwips(raw: string | undefined): number {
  if (raw == null || raw.trim() === "") return 0;
  const twips = Number(raw);
  if (!Number.isFinite(twips) || twips <= 0) return 0;
  const points = twips / 20;
  if (points > IMPORTED_PARAGRAPH_SPACE_MAX_PT) return 0;
  return paragraphSpacePoints(points);
}

function spacingAttribute(raw: string, name: "before" | "after"): string | undefined {
  const match = new RegExp(`(?:^|\\s)(?:[\\w.-]+:)?${name}="([^"]*)"`).exec(raw);
  return match?.[1];
}

function paragraphText(xml: string): string {
  return [...xml.matchAll(/<(?:[\w.-]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?t>/g)]
    .map((part) => decodeXml(part[1]))
    .join("");
}

function paragraphGap(xml: string): { before: number; after: number } {
  const properties =
    /<(?:[\w.-]+:)?pPr\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?pPr>/.exec(xml)?.[1] ?? "";
  const spacing =
    /<(?:[\w.-]+:)?spacing\b([^>]*?)\/?>/.exec(properties)?.[1] ?? "";
  return {
    before: paragraphSpaceFromTwips(spacingAttribute(spacing, "before")),
    after: paragraphSpaceFromTwips(spacingAttribute(spacing, "after")),
  };
}

/**
 * Body paragraphs in document order. Drawings and text boxes are skipped so
 * a picture's own paragraphs are not the gaps on the sentence around it.
 */
export function paragraphSpacesInDocumentXml(xml: string): ImportedParagraphSpace[] {
  const body =
    /<(?:[\w.-]+:)?body\b[^>]*>([\s\S]*)<\/(?:[\w.-]+:)?body>/.exec(xml)?.[1] ?? xml;
  const flat = body
    .replace(/<(?:[\w.-]+:)?txbxContent\b[\s\S]*?<\/(?:[\w.-]+:)?txbxContent>/g, "")
    .replace(/<(?:[\w.-]+:)?drawing\b[\s\S]*?<\/(?:[\w.-]+:)?drawing>/g, "")
    .replace(/<(?:[\w.-]+:)?pict\b[\s\S]*?<\/(?:[\w.-]+:)?pict>/g, "");
  const spaces: ImportedParagraphSpace[] = [];
  for (const match of flat.matchAll(/<(?:[\w.-]+:)?p\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?p>/g)) {
    const paragraph = match[0];
    spaces.push({ text: paragraphText(paragraph), ...paragraphGap(paragraph) });
  }
  return spaces;
}

function plainText(node: JsonNode): string {
  let text = node.text ?? "";
  for (const child of node.content ?? []) text += plainText(child);
  return text;
}

function collectBlocks(node: JsonNode, out: JsonNode[] = []): JsonNode[] {
  if (BLOCKS.has(node.type)) out.push(node);
  node.content?.forEach((child) => collectBlocks(child, out));
  return out;
}

/**
 * Put each Word paragraph's gap on the imported block with the same text.
 * Both sides are stored, including 0, so a heading's stylesheet margin cannot
 * add a gap the line-spacing control does not show. Line spacing is left alone.
 */
export function applyImportedParagraphSpacing(doc: JsonNode, documentXml: string): JsonNode {
  const spaces = paragraphSpacesInDocumentXml(documentXml);
  if (!spaces.length) return doc;
  const blocks = collectBlocks(doc);
  const texts = blocks.map((block) => plainText(block));
  const assigned = new Map<JsonNode, ImportedParagraphSpace>();
  let index = 0;
  for (let block = 0; block < blocks.length; block += 1) {
    const want = norm(texts[block]);
    const rest = texts.slice(block + 1);
    while (index < spaces.length) {
      const got = norm(spaces[index].text);
      if (got === want) {
        assigned.set(blocks[block], spaces[index]);
        index += 1;
        break;
      }
      if (!rest.some((text) => norm(text) === got)) {
        index += 1;
        continue;
      }
      break;
    }
  }
  if (!assigned.size) return doc;
  const visit = (node: JsonNode): JsonNode => {
    const content = node.content?.map(visit);
    const gap = assigned.get(node);
    const sameContent =
      !content || content.every((child, at) => child === node.content?.[at]);
    if (!gap && sameContent) return node;
    return {
      ...node,
      ...(gap
        ? {
            attrs: {
              ...(node.attrs ?? {}),
              spaceBefore: gap.before,
              spaceAfter: gap.after,
            },
          }
        : {}),
      ...(content ? { content } : {}),
    };
  };
  return visit(doc);
}
