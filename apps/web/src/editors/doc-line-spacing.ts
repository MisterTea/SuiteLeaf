import { Extension } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import {
  isLineSpacing,
  lineSpacingAttrs,
  lineSpacingOf,
  type LineSpacing,
} from "@suiteleaf/core/line-spacing";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    paragraphLineSpacing: {
      /** Set line spacing on every paragraph in the selection. */
      setLineSpacing: (spacing: LineSpacing) => ReturnType;
    };
  }
}

/** The spacing shared by the selected paragraphs, or "mixed" when they differ. */
export function selectionLineSpacing(state: EditorState): LineSpacing | "mixed" {
  const found = new Set<LineSpacing>();
  for (const range of state.selection.ranges) {
    state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node) => {
      if (node.type.name !== "paragraph") return;
      found.add(lineSpacingOf(node.attrs.lineSpacing));
      return false;
    });
  }
  if (found.size <= 1) return [...found][0] ?? "single";
  return "mixed";
}

/**
 * Writes `spacing` onto paragraphs that overlap the selection.
 * A paragraph outside the selection, and any heading, stays as it was.
 */
export function applyLineSpacing(
  state: EditorState,
  spacing: LineSpacing,
): { transaction: Transaction; paragraphs: number } {
  const tr = state.tr;
  let paragraphs = 0;
  for (const range of state.selection.ranges) {
    state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, pos) => {
      if (node.type.name !== "paragraph") return;
      paragraphs += 1;
      if (lineSpacingOf(node.attrs.lineSpacing) !== spacing)
        tr.setNodeMarkup(tr.mapping.map(pos), undefined, {
          ...node.attrs,
          lineSpacing: spacing,
        });
      return false;
    });
  }
  return { transaction: tr, paragraphs };
}

export const paragraphLineSpacing = Extension.create({
  name: "paragraphLineSpacing",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          lineSpacing: {
            default: null,
            keepOnSplit: true,
            parseHTML: (element) =>
              lineSpacingOf(element.getAttribute("data-line-spacing")),
            renderHTML: (attributes) => lineSpacingAttrs(attributes.lineSpacing),
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setLineSpacing:
        (spacing) =>
        ({ state, dispatch }) => {
          if (!isLineSpacing(spacing)) return false;
          const { transaction, paragraphs } = applyLineSpacing(state, spacing);
          if (!paragraphs) return false;
          if (dispatch && transaction.docChanged) dispatch(transaction);
          return true;
        },
    };
  },
});
