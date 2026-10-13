import type { JsonNode } from "./index";
import { imageWrap } from "./image-wrap";

/** About one line of body text: 11pt with the document line height. */
export const INLINE_TEXT_HEIGHT = 20;

/**
 * Size a picture that was just placed in a sentence.
 * A picture that is already about as tall as the words stays that size.
 * Anything larger shrinks to one line, keeping its shape.
 */
export function inlineFrame(
  attrs: Record<string, unknown> | null | undefined,
  rendered?: { width: number; height: number },
): { width: number; height: number } {
  const width = positive(attrs?.width) || rendered?.width || 0;
  const height = positive(attrs?.height) || rendered?.height || 0;
  if (height >= 12 && height <= 32 && width >= 12 && width <= 96)
    return { width: Math.round(width), height: Math.round(height) };
  const aspect = width > 0 && height > 0 ? width / height : 1;
  return {
    width: Math.max(12, Math.round(INLINE_TEXT_HEIGHT * aspect)),
    height: INLINE_TEXT_HEIGHT,
  };
}

function positive(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function inlineImageFrom(image: JsonNode): JsonNode {
  const attrs = { ...(image.attrs ?? {}) };
  delete attrs.wrap;
  return { type: "inlineImage", attrs };
}

function besideText(children: JsonNode[]): boolean {
  return children.some((child) => {
    if (child.type === "image" || child.type === "inlineImage" || child.type === "hardBreak")
      return false;
    if (child.type === "text") return Boolean(child.text?.trim());
    return true;
  });
}

/**
 * A picture that shares a paragraph with words stays in that sentence.
 * Square wrap and a picture that is the only thing in its paragraph stay
 * blocks, so Left, Right, Break text, and a picture with no wrap still
 * open on their own line.
 */
function settleParagraph(paragraph: JsonNode): JsonNode[] {
  const children = paragraph.content ?? [];
  if (!children.some((child) => child.type === "image")) return [paragraph];
  if (!besideText(children)) return children.filter((child) => child.type === "image");
  const result: JsonNode[] = [];
  let inline: JsonNode[] = [];
  const flush = () => {
    if (!inline.length) return;
    result.push({ ...paragraph, content: inline });
    inline = [];
  };
  for (const child of children) {
    if (child.type !== "image") {
      inline.push(child);
      continue;
    }
    if (imageWrap(child.attrs)) {
      flush();
      result.push(child);
    } else inline.push(inlineImageFrom(child));
  }
  flush();
  return result.length ? result : [paragraph];
}

function settleBlocks(nodes: JsonNode[]): JsonNode[] {
  const out: JsonNode[] = [];
  for (const node of nodes) {
    if (node.type === "paragraph") out.push(...settleParagraph(node));
    else if (node.content) out.push({ ...node, content: settleBlocks(node.content) });
    else out.push(node);
  }
  return out;
}

/** After Word crops and wrap are copied on, put inline pictures back in the sentence. */
export function settleWordPictures(doc: JsonNode): JsonNode {
  if (!doc.content) return doc;
  return { ...doc, content: settleBlocks(doc.content) };
}
