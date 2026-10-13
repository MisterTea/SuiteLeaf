import { Extension, findParentNode } from "@tiptap/core";
import { useEditorState, type Editor } from "@tiptap/react";

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

/** Marks the heading at the caret. Hidden copy is for narrow screens, where the outline is gone. */
export function ArabicStartControl({
  editor,
  readOnly = false,
  phone = false,
}: {
  editor: Editor | null;
  readOnly?: boolean;
  phone?: boolean;
}) {
  const mark = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current?.isActive("heading")) return null;
      const text = current.state.selection.$from.parent.textContent.trim();
      return {
        on: current.getAttributes("heading").startArabic === true,
        text,
      };
    },
  });
  const name = mark?.text || "this heading";
  return (
    <div className={phone ? "arabic-start arabic-start-phone" : "arabic-start"}>
      <button
        type="button"
        className="arabic-start-btn"
        aria-pressed={mark?.on ?? false}
        disabled={!mark || readOnly || !editor}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => editor?.chain().focus().toggleArabicNumberStart().run()}
      >
        {mark?.on ? "Arabic numbers start here" : "Start Arabic numbers here"}
      </button>
      <p className="arabic-start-hint">
        {mark?.on
          ? `“${name}” is page 1. Pages before it stay i, ii.`
          : mark
            ? `“${name}” becomes page 1. Pages before it stay as they are.`
            : "Click a heading, then start Arabic numbers on its page."}
      </p>
    </div>
  );
}
