import type { Node as ProseNode } from "@tiptap/pm/model";
import type { JsonNode } from "@suiteleaf/core";

export interface LocalParagraphEdit {
  index: number;
  before: JsonNode;
}

function paragraphBlocks(content: unknown): JsonNode[] {
  const found: JsonNode[] = [];
  const walk = (node: JsonNode) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "paragraph" || node.type === "heading") {
      found.push(structuredClone(node));
      return;
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(content as JsonNode);
  return found;
}

/** One local paragraph or heading change, when the block count stayed the same. */
export function recordLocalParagraph(beforeDoc: unknown, afterDoc: unknown): LocalParagraphEdit | null {
  const previous = paragraphBlocks(beforeDoc);
  const next = paragraphBlocks(afterDoc);
  if (previous.length !== next.length) return null;
  const index = next.findIndex((node, i) => JSON.stringify(node) !== JSON.stringify(previous[i]));
  const before = previous[index];
  if (index < 0 || !before) return null;
  return { index, before };
}

export function invertLocalParagraph(
  doc: JsonNode,
  edit: LocalParagraphEdit,
): { doc: JsonNode; inverse: LocalParagraphEdit } | null {
  let seen = 0;
  let current: JsonNode | null = null;
  const visit = (node: JsonNode): JsonNode => {
    if (node.type === "paragraph" || node.type === "heading") {
      const at = seen;
      seen += 1;
      if (at !== edit.index) return node;
      current = structuredClone(node);
      return structuredClone(edit.before);
    }
    if (!node.content) return node;
    return { ...node, content: node.content.map(visit) };
  };
  const next = visit(doc);
  if (!current) return null;
  return { doc: next, inverse: { index: edit.index, before: current } };
}

/**
 * Where the paragraph or heading an edit names sits in the open document,
 * counted the way `recordLocalParagraph` counts. Undo replaces only that
 * block, so other people's paragraphs in the shared document are not rewritten.
 */
export function localParagraphRange(doc: ProseNode, index: number): { from: number; to: number } | null {
  let seen = 0;
  let found: { from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name !== "paragraph" && node.type.name !== "heading") return true;
    if (seen === index) found = { from: pos, to: pos + node.nodeSize };
    seen += 1;
    return false;
  });
  return found;
}

export function restoreLocalParagraph(doc: JsonNode, edit: LocalParagraphEdit): JsonNode {
  return invertLocalParagraph(doc, edit)?.doc ?? doc;
}
