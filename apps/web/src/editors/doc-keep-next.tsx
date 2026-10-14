import { Extension } from "@tiptap/core";
import type { Node as ProseNode } from "@tiptap/pm/model";

const listContainers = new Set(["bulletList", "orderedList"]);

/**
 * Headings already stay with the following paragraph. A list is not that
 * paragraph: Keep with next is what carries the heading onto the list's page.
 */
export function staysWithFollowingBlock(
  block: { type: string; keepNext?: boolean | null },
  nextType: string | null,
): boolean {
  if (block.keepNext === true) return true;
  if (block.type !== "heading" || !nextType) return false;
  return !listContainers.has(nextType);
}

export function nextBlockType(parent: ProseNode | null, node: ProseNode): string | null {
  if (!parent) return null;
  let seen = false;
  let name: string | null = null;
  parent.forEach((child) => {
    if (name) return;
    if (seen) name = child.type.name;
    else if (child === node) seen = true;
  });
  return name;
}

/**
 * A break at the first line of a list belongs in front of the list, so the
 * marker and the words move together instead of leaving a bullet behind.
 */
export function breakPosBeforeList(doc: ProseNode, pos: number): number | null {
  const $ = doc.resolve(pos);
  let listDepth: number | null = null;
  for (let depth = $.depth; depth > 0; depth--) {
    const name = $.node(depth).type.name;
    if (name !== "listItem" && !listContainers.has(name)) break;
    if ($.index(depth) !== 0) return null;
    if (listContainers.has(name)) listDepth = depth;
  }
  return listDepth == null ? null : $.before(listDepth);
}

export function keepsWithNext(node: { attrs: Record<string, unknown> }): boolean {
  return node.attrs.keepNext === true;
}

type BreakBoundary = { top: number; keepNext?: boolean; manual?: boolean };

/**
 * Index of the block that should start the next page. Paragraphs marked
 * keep-with-next travel with the following block instead of staying behind.
 */
export function keepWithNextBreak<T extends BreakBoundary>(
  boundaries: T[],
  index: number,
  pageStart: number,
  added: number,
): number {
  let first = index;
  const next = boundaries[index];
  while (next && !next.manual) {
    const previous = boundaries[first - 1];
    if (!previous?.keepNext || previous.top + added <= pageStart + 0.5) break;
    first--;
  }
  return first;
}

/** Mark the last visual line of a block that should stay with the next one. */
export function markKeepNextLine<T extends { top: number; keepNext?: boolean }>(
  lines: T[],
  keep: boolean,
): T[] {
  if (!keep || lines.length === 0) return lines;
  let last = 0;
  for (let i = 1; i < lines.length; i++) if (lines[i].top >= lines[last].top) last = i;
  lines[last].keepNext = true;
  return lines;
}

export const KeepWithNext = Extension.create({
  name: "keepWithNext",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          keepNext: {
            default: null,
            keepOnSplit: false,
            parseHTML: (element) =>
              element.getAttribute("data-keep-next") === "true" ? true : null,
            renderHTML: (attributes) =>
              attributes.keepNext === true ? { "data-keep-next": "true" } : {},
          },
        },
      },
    ];
  },
});
