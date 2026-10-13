import { Node } from "@tiptap/core";
import type { Node as ProseNode } from "@tiptap/pm/model";
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";

/** Word's default column gap: half an inch, so the split is visible without a dialog. */
export const COLUMN_GAP_TWIPS = 720;
export const COLUMN_LAYOUT = "columnLayout";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    columnLayout: {
      /** Flow the selected blocks into one or two columns. */
      setColumns: (columns: 1 | 2) => ReturnType;
    };
  }
}

type SectionHit = { node: ProseNode; pos: number };

function inTable(state: EditorState) {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--)
    if ($from.node(depth).type.spec.tableRole) return true;
  return false;
}

function sectionsTouching(state: EditorState): SectionHit[] {
  const { from, to } = state.selection;
  const found: SectionHit[] = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name !== COLUMN_LAYOUT) return;
    const end = pos + node.nodeSize;
    if (from < end && to > pos) found.push({ node, pos });
    return false;
  });
  return found;
}

/** A position relative to a section that is about to be replaced by its contents. */
function mapThroughUnwrap(pos: number, sectionPos: number, sectionSize: number) {
  if (pos <= sectionPos) return pos;
  if (pos >= sectionPos + sectionSize) return pos - 2;
  return pos - 1;
}

function placeCaret(tr: Transaction, from: number, to: number) {
  const doc = tr.doc;
  const clamp = (pos: number) => Math.max(0, Math.min(pos, doc.content.size));
  tr.setSelection(
    TextSelection.between(
      doc.resolve(clamp(from)),
      doc.resolve(clamp(Math.max(from, to))),
    ),
  );
}

/** Move the caret just outside a range so replacing that range does not map it onto the wrapper. */
function parkBefore(tr: Transaction, pos: number) {
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.max(0, pos)), pos > 0 ? -1 : 1));
}

/**
 * Put the selected blocks in two columns, or back into the single stream.
 * Blocks outside the selection stay full width. Nothing changes inside a table.
 */
export function applyColumnLayout(
  state: EditorState,
  columns: 1 | 2,
  dispatch?: (tr: Transaction) => void,
): boolean {
  if (inTable(state)) return false;
  if (columns === 1) return clearColumns(state, dispatch);
  return wrapColumns(state, dispatch);
}

function clearColumns(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
): boolean {
  const sections = sectionsTouching(state);
  if (!sections.length) return false;
  if (!dispatch) return true;
  let from = state.selection.from;
  let to = state.selection.to;
  const tr = state.tr;
  const earliest = Math.min(...sections.map((section) => section.pos));
  if (from > earliest) parkBefore(tr, earliest);
  for (const { node, pos } of [...sections].sort((a, b) => b.pos - a.pos)) {
    from = mapThroughUnwrap(from, pos, node.nodeSize);
    to = mapThroughUnwrap(to, pos, node.nodeSize);
    tr.replaceWith(pos, pos + node.nodeSize, node.content);
  }
  placeCaret(tr, from, to);
  dispatch(tr.scrollIntoView());
  return true;
}

function wrapColumns(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
): boolean {
  if (sectionsTouching(state).length) return true;
  const { $from, $to } = state.selection;
  const range = $from.blockRange($to, (node) => node.type.name === "doc");
  if (!range) return false;
  for (let index = range.startIndex; index < range.endIndex; index++)
    if (range.parent.child(index).type.name === COLUMN_LAYOUT) return true;
  const type = state.schema.nodes[COLUMN_LAYOUT];
  if (!type) return false;
  const content = state.doc.slice(range.start, range.end).content;
  if (!content.size) return false;
  if (!dispatch) return true;
  const tr = state.tr;
  if (state.selection.from >= range.start) parkBefore(tr, range.start);
  tr.replaceWith(range.start, range.end, type.create({ columns: 2 }, content));
  placeCaret(tr, state.selection.from + 1, state.selection.to + 1);
  dispatch(tr.scrollIntoView());
  return true;
}

export const columnLayout = Node.create({
  name: COLUMN_LAYOUT,
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      columns: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute("data-columns") === "2" ? 2 : null,
        renderHTML: (attributes) =>
          attributes.columns === 2 ? { "data-columns": "2" } : {},
      },
    };
  },
  parseHTML: () => [{ tag: "div.doc-columns" }, { tag: "div[data-columns='2']" }],
  renderHTML: () => ["div", { class: "doc-columns", "data-columns": "2" }, 0],
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("div");
      dom.className = "doc-columns";
      dom.dataset.columns = "2";
      dom.setAttribute("role", "group");
      dom.setAttribute("aria-label", "Two columns");
      const fit = (count: number) => {
        const rows = Math.max(1, Math.ceil(count / 2));
        dom.style.gridTemplateRows = `repeat(${rows}, auto)`;
      };
      fit(node.childCount);
      return {
        dom,
        contentDOM: dom,
        update(updated) {
          if (updated.type.name !== COLUMN_LAYOUT) return false;
          fit(updated.childCount);
          return true;
        },
        ignoreMutation(mutation) {
          return mutation.type === "attributes" && mutation.target === dom;
        },
      };
    };
  },
  addCommands() {
    return {
      setColumns:
        (columns) =>
        ({ state, dispatch }) =>
          applyColumnLayout(state, columns, dispatch),
    };
  },
});
