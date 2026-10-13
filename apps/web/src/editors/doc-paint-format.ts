import type { Mark } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";

/** Bold, font size, and text color copied from a selection. Other marks are left out. */
export type CopiedTextFormat = {
  bold: boolean;
  /** Stored size, such as "18pt". Null when the source has no size mark. */
  fontSize: string | null;
  /** Stored color, such as "#1a73e8". Null when the source has no color mark. */
  color: string | null;
};

function styleAttr(mark: Mark | undefined, key: "fontSize" | "color"): string | null {
  const value = mark?.attrs?.[key];
  return typeof value === "string" && value ? value : null;
}

function formatFrom(marks: readonly Mark[], state: EditorState): CopiedTextFormat {
  const boldType = state.schema.marks.bold;
  const styleType = state.schema.marks.textStyle;
  const style = styleType ? marks.find((mark) => mark.type === styleType) : undefined;
  return {
    bold: !!boldType && marks.some((mark) => mark.type === boldType),
    fontSize: styleAttr(style, "fontSize"),
    color: styleAttr(style, "color"),
  };
}

/**
 * Reads bold, font size, and text color from the selection.
 * A plain selection returns an empty format. Paragraph style, spacing, and
 * indent are not part of the result.
 */
export function copyTextFormat(state: EditorState): CopiedTextFormat {
  const { from, to, empty, $from } = state.selection;
  if (empty) return formatFrom(state.storedMarks ?? $from.marks(), state);

  let shared: CopiedTextFormat | null = null;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return;
    if (Math.max(from, pos) >= Math.min(to, pos + node.nodeSize)) return;
    const next = formatFrom(node.marks, state);
    if (!shared) {
      shared = next;
      return;
    }
    shared = {
      bold: shared.bold && next.bold,
      fontSize: shared.fontSize === next.fontSize ? shared.fontSize : null,
      color:
        (shared.color ?? "").toLowerCase() === (next.color ?? "").toLowerCase()
          ? shared.color
          : null,
    };
  });
  return shared ?? { bold: false, fontSize: null, color: null };
}

/**
 * Paints a copied format onto the selected text. The characters stay put,
 * and text outside the selection keeps its marks. An empty format adds nothing.
 * Block type, spacing, and indent are not changed.
 */
export function applyCopiedTextFormat(
  state: EditorState,
  format: CopiedTextFormat,
): Transaction {
  const tr = state.tr;
  if (!format.bold && !format.fontSize && !format.color) return tr;
  const boldType = state.schema.marks.bold;
  const styleType = state.schema.marks.textStyle;
  const ranges: { from: number; to: number; marks: readonly Mark[] }[] = [];
  for (const range of state.selection.ranges) {
    const from = range.$from.pos;
    const to = range.$to.pos;
    if (from === to) continue;
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isText) return;
      const start = Math.max(from, pos);
      const end = Math.min(to, pos + node.nodeSize);
      if (start < end) ranges.push({ from: start, to: end, marks: node.marks });
    });
  }
  for (const range of ranges) {
    if (format.bold && boldType) tr.addMark(range.from, range.to, boldType.create());
    if ((format.fontSize || format.color) && styleType) {
      const existing = range.marks.find((mark) => mark.type === styleType);
      const attrs = { ...(existing?.attrs ?? {}) };
      if (format.fontSize) attrs.fontSize = format.fontSize;
      if (format.color) attrs.color = format.color;
      tr.addMark(range.from, range.to, styleType.create(attrs));
    }
  }
  return tr;
}
