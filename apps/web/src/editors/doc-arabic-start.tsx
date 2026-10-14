import { Extension, findParentNode } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    arabicNumberStart: {
      /** The heading at the caret becomes page 1. Earlier pages keep their numbers. */
      toggleArabicNumberStart: () => ReturnType;
    };
  }
}

/** One heading can restart page numbers at arabic 1. Not a section-break dialog. */
export const ArabicNumberStart = Extension.create({
  name: "arabicNumberStart",
  addGlobalAttributes() {
    return [
      {
        types: ["heading"],
        attributes: {
          startArabic: {
            default: false,
            keepOnSplit: false,
            parseHTML: (element) =>
              element.getAttribute("data-start-arabic") === "true",
            renderHTML: (attributes) =>
              attributes.startArabic ? { "data-start-arabic": "true" } : {},
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      toggleArabicNumberStart:
        () =>
        ({ state, tr, dispatch }) => {
          const found = findParentNode((node) => node.type.name === "heading")(
            state.selection,
          );
          if (!found) return false;
          const next = found.node.attrs.startArabic !== true;
          if (!dispatch) return true;
          const updates: { pos: number; attrs: Record<string, unknown> }[] =
            [];
          state.doc.descendants((node, pos) => {
            if (node.type.name !== "heading") return;
            if (pos === found.pos)
              updates.push({
                pos,
                attrs: { ...node.attrs, startArabic: next },
              });
            else if (next && node.attrs.startArabic === true)
              updates.push({
                pos,
                attrs: { ...node.attrs, startArabic: false },
              });
          });
          for (const update of updates)
            tr.setNodeMarkup(update.pos, undefined, update.attrs);
          return true;
        },
    };
  },
});
