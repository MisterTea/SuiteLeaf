import { Extension } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import {
  PARAGRAPH_SPACE_MAX_PT,
  paragraphSpaceAttribute,
  paragraphSpacePoints,
} from "@suiteleaf/core/paragraph-spacing";

export type ParagraphSpaceSide = "before" | "after";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    paragraphSpacing: {
      /** Set space before the selected paragraphs, in points. 0 removes it. */
      setParagraphSpaceBefore: (points: number) => ReturnType;
      /** Set space after the selected paragraphs, in points. 0 removes it. */
      setParagraphSpaceAfter: (points: number) => ReturnType;
    };
  }
}

const BLOCKS = new Set(["paragraph", "heading"]);

function attrKey(side: ParagraphSpaceSide) {
  return side === "before" ? "spaceBefore" : "spaceAfter";
}

/** 0 is stored, so a heading can drop its stylesheet gap. Export still omits it. */
function storedPoints(points: number): number {
  return paragraphSpacePoints(points);
}

/** The gap shared by the selected blocks, or "mixed" when they differ. */
export function selectionParagraphSpace(
  state: EditorState,
  side: ParagraphSpaceSide,
): number | "mixed" {
  const key = attrKey(side);
  const found = new Set<number>();
  for (const range of state.selection.ranges) {
    state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node) => {
      if (!BLOCKS.has(node.type.name)) return;
      found.add(paragraphSpacePoints(node.attrs[key]));
      return false;
    });
  }
  if (found.size <= 1) return [...found][0] ?? 0;
  return "mixed";
}

/**
 * Writes one side of the gap onto paragraphs and headings in the selection.
 * Line spacing and the other side stay as they were. Blocks outside the
 * selection are not visited.
 */
export function applyParagraphSpace(
  state: EditorState,
  side: ParagraphSpaceSide,
  points: number,
): { transaction: Transaction; blocks: number } {
  const key = attrKey(side);
  const next = storedPoints(points);
  const tr = state.tr;
  let blocks = 0;
  for (const range of state.selection.ranges) {
    state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, pos) => {
      if (!BLOCKS.has(node.type.name)) return;
      blocks += 1;
      const raw = node.attrs[key];
      const stored = raw == null || raw === "" ? null : paragraphSpacePoints(raw);
      if (stored !== next)
        tr.setNodeMarkup(tr.mapping.map(pos), undefined, {
          ...node.attrs,
          [key]: next,
        });
      return false;
    });
  }
  return { transaction: tr, blocks };
}

function readSpace(element: HTMLElement, side: ParagraphSpaceSide) {
  const raw = element.getAttribute(`data-space-${side}`);
  if (raw == null) return null;
  return paragraphSpacePoints(raw);
}

export const paragraphSpacing = Extension.create({
  name: "paragraphSpacing",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          spaceBefore: {
            default: null,
            keepOnSplit: true,
            parseHTML: (element) => readSpace(element, "before"),
            renderHTML: (attributes) =>
              paragraphSpaceAttribute("before", attributes.spaceBefore),
          },
          spaceAfter: {
            default: null,
            keepOnSplit: true,
            parseHTML: (element) => readSpace(element, "after"),
            renderHTML: (attributes) =>
              paragraphSpaceAttribute("after", attributes.spaceAfter),
          },
        },
      },
    ];
  },
  addCommands() {
    const command =
      (side: ParagraphSpaceSide) =>
      (points: number) =>
      ({ state, dispatch }: { state: EditorState; dispatch?: (tr: Transaction) => void }) => {
        if (!Number.isFinite(points) || points < 0 || points > PARAGRAPH_SPACE_MAX_PT)
          return false;
        const { transaction, blocks } = applyParagraphSpace(state, side, points);
        if (!blocks) return false;
        if (dispatch && transaction.docChanged) dispatch(transaction);
        return true;
      };
    return {
      setParagraphSpaceBefore: command("before"),
      setParagraphSpaceAfter: command("after"),
    };
  },
});
