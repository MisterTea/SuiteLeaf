import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";

const KEYS = ["fontFamily", "fontSize", "color"] as const;
type NormalTextKey = (typeof KEYS)[number];

/** Font family, size, and color stored as this document's Normal text style. */
export type NormalTextStyle = Partial<Record<NormalTextKey, string>>;

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    normalText: {
      /** Save the selection's font as this document's Normal text style. */
      updateNormalTextToMatch: () => ReturnType;
    };
  }
}

function cleanStyleValue(key: NormalTextKey, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 80) return null;
  if (/[;{}<>\n\r]/.test(trimmed)) return null;
  if (key === "fontSize" && !/^\d+(?:\.\d+)?(?:pt|px)$/.test(trimmed)) return null;
  return trimmed;
}

/** The font attributes worth saving. Blank, missing, and unsafe values are dropped. */
export function normalTextStyle(
  attrs: Record<string, unknown> | null | undefined,
): NormalTextStyle | null {
  if (!attrs) return null;
  const style: NormalTextStyle = {};
  for (const key of KEYS) {
    const value = attrs[key];
    if (typeof value !== "string") continue;
    const cleaned = cleanStyleValue(key, value);
    if (cleaned) style[key] = cleaned;
  }
  return style.fontFamily || style.fontSize || style.color ? style : null;
}

export function readNormalText(attrs: { normalText?: unknown } | null | undefined): NormalTextStyle | null {
  const raw = attrs?.normalText;
  if (!raw || typeof raw !== "object") return null;
  return normalTextStyle(raw as Record<string, unknown>);
}

/**
 * Font attributes to add so new paragraph text matches Normal.
 * An attribute the text already carries, including a later font choice, stays.
 */
export function normalTextToApply(
  style: NormalTextStyle | null,
  existing: Record<string, unknown> | null | undefined,
): NormalTextStyle | null {
  if (!style) return null;
  const add: NormalTextStyle = {};
  for (const key of KEYS) {
    const want = style[key];
    if (!want) continue;
    const have = existing?.[key];
    if (typeof have === "string" && have.trim()) continue;
    add[key] = want;
  }
  return add.fontFamily || add.fontSize || add.color ? add : null;
}

/** Headings keep their own size and family. Only body paragraphs adopt Normal. */
export function blockAcceptsNormalText(blockType: string): boolean {
  return blockType === "paragraph";
}

function sameStyle(a: NormalTextStyle, b: NormalTextStyle): boolean {
  return KEYS.every((key) => (a[key] ?? "") === (b[key] ?? ""));
}

/** The font shared by the selection, from stored marks or the selected text. */
export function selectionTextStyle(state: EditorState): NormalTextStyle | null {
  const markType = state.schema.marks.textStyle;
  if (!markType) return null;
  const { selection } = state;
  if (selection.empty) {
    const marks = state.storedMarks ?? selection.$from.marks();
    return normalTextStyle(markType.isInSet(marks)?.attrs);
  }
  let found: NormalTextStyle | null | undefined;
  state.doc.nodesBetween(selection.from, selection.to, (node) => {
    if (!node.isText || found === null) return;
    const style = normalTextStyle(markType.isInSet(node.marks)?.attrs) ?? {};
    if (found === undefined) found = style;
    else if (!sameStyle(found, style)) found = null;
  });
  if (!found || !Object.keys(found).length) return null;
  return found;
}

function insertedRanges(tr: Transaction): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  tr.steps.forEach((step, index) => {
    if (!(step instanceof ReplaceStep) || step.slice.size === 0) return;
    const rest = tr.mapping.slice(index + 1);
    const from = rest.map(step.from, 1);
    const to = rest.map(step.from + step.slice.size, -1);
    if (to > from) ranges.push({ from, to });
  });
  return ranges;
}

function localEdit(tr: Transaction): boolean {
  if (tr.getMeta("history$")) return false;
  if (tr.getMeta("addToHistory") === false) return false;
  const sync = tr.getMeta("y-sync$") as { isChangeOrigin?: boolean } | undefined;
  if (sync?.isChangeOrigin) return false;
  return tr.docChanged || tr.selectionSet;
}

function rangesIn(transactions: readonly Transaction[]): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  for (const tr of transactions) {
    for (const range of ranges) {
      range.from = tr.mapping.map(range.from, 1);
      range.to = tr.mapping.map(range.to, -1);
    }
    if (localEdit(tr) && tr.docChanged) ranges.push(...insertedRanges(tr));
  }
  return ranges.filter((range) => range.to > range.from);
}

function paintNormalText(
  transactions: readonly Transaction[],
  _previous: EditorState,
  state: EditorState,
): Transaction | null {
  const style = readNormalText(state.doc.attrs);
  if (!style || !transactions.some(localEdit)) return null;
  const markType = state.schema.marks.textStyle;
  if (!markType) return null;
  const tr = state.tr;
  let changed = false;
  const max = state.doc.content.size;
  for (const range of rangesIn(transactions)) {
    const from = Math.max(0, Math.min(range.from, max));
    const to = Math.max(0, Math.min(range.to, max));
    if (to <= from) continue;
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isText) return;
      if (!blockAcceptsNormalText(state.doc.resolve(pos).parent.type.name)) return;
      const start = Math.max(from, pos);
      const end = Math.min(to, pos + node.nodeSize);
      if (end <= start) return;
      const existing = markType.isInSet(node.marks);
      const add = normalTextToApply(style, existing?.attrs);
      if (!add) return;
      tr.addMark(start, end, markType.create({ ...existing?.attrs, ...add }));
      changed = true;
    });
  }
  return changed ? tr : null;
}

export const normalText = Extension.create({
  name: "normalText",
  addGlobalAttributes() {
    return [
      {
        types: ["doc"],
        attributes: {
          normalText: { default: null, rendered: false },
        },
      },
    ];
  },
  addCommands() {
    return {
      updateNormalTextToMatch:
        () =>
        ({ editor, state, tr, dispatch }) => {
          if (!editor.isEditable) return false;
          const style = selectionTextStyle(state);
          if (!style) return false;
          if (dispatch) {
            tr.setDocAttribute("normalText", style);
            dispatch(tr);
          }
          return true;
        },
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("normalText"),
        appendTransaction: paintNormalText,
      }),
    ];
  },
});
