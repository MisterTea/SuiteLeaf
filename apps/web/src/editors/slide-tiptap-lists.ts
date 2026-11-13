import { Extension, type Editor } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import type { TextRun } from "@suiteleaf/core";
import { effectiveListColors, effectiveListFontSizes, listRunFontSize } from "./slide-list";
import { slideDocumentToRuns, slideParagraphs } from "./slide-tiptap-model";

/** Office permits an independent indent even when there is no preceding parent item. */
function officeIndent(editor: Editor, direction: -1 | 1): boolean {
  const { state } = editor;
  const selected = slideParagraphs(state.doc).filter(p => p.list && state.selection.from <= p.pos + p.node.nodeSize - 1 && state.selection.to >= p.pos + 1);
  if (!selected.length) {
    if (direction !== 1) return false;
    editor.view.dispatch(editor.state.tr.insertText("\t"));
    return true;
  }
  if (direction === 1 && selected.some(p => p.depth >= 8)) return true;
  const items = new Map<number, { offset: number; base: number }>();
  for (const p of selected) {
    const resolved = state.doc.resolve(p.pos);
    for (let depth = resolved.depth; depth > 0; depth--) {
      if (resolved.node(depth).type.name === "listItem") {
        items.set(resolved.before(depth), { offset: resolved.node(depth).attrs.officeDepthOffset ?? 0, base: depth === 2 ? resolved.node(1).attrs.officeBaseDepth ?? 0 : 0 });
        break;
      }
    }
  }
  if (direction === 1 && editor.commands.sinkListItem("listItem")) return true;
  if (direction === -1 && ![...items.values()].some(item => item.offset > 0 || item.base > 0)) {
    return selected.every(p => p.depth === 0) || editor.commands.liftListItem("listItem");
  }
  const tr = state.tr;
  for (const [pos, { offset, base }] of items) {
    const node = state.doc.nodeAt(pos)!;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, officeDepthOffset: Math.max(-base, offset + direction) });
  }
  editor.view.dispatch(tr);
  return true;
}

export const SlideLists = Extension.create({
  name: "slideLists",
  addGlobalAttributes: () => [
    { types: ["bulletList", "orderedList"], attributes: { officeBaseDepth: { default: 0, rendered: false } } },
    { types: ["listItem"], attributes: { officeDepthOffset: { default: 0, rendered: false } } },
  ],
  addKeyboardShortcuts() {
    return { Tab: () => officeIndent(this.editor, 1), "Shift-Tab": () => officeIndent(this.editor, -1) };
  },
  addProseMirrorPlugins: () => [new Plugin({
    appendTransaction(transactions, old, state) {
      if (!transactions.some(tr => tr.docChanged)) return null;
      const tr = state.tr;
      const levels = effectiveListColors(slideDocumentToRuns(old.doc));
      const sizes = effectiveListFontSizes(slideDocumentToRuns(old.doc));
      for (const p of slideParagraphs(state.doc)) {
        const attrs = { ...p.node.attrs };
        if (!p.list && attrs.marker) attrs.marker = null;
        else if (p.list) {
          attrs.marker = p.marker;
          const office = { ...attrs.office };
          const original = office.listDepth ?? 0;
          if (p.depth !== original) {
            const colors = (office.listColors ?? Array<string | null>(9).fill(null)).map((color: string | null, depth: number) => {
              const authored = levels.get(depth);
              return authored?.size === 1 ? [...authored][0] : color;
            });
            const previous = colors[original]?.toLowerCase();
            const color = colors[p.depth] ?? colors[original];
            office.listColors = colors;
            if (sizes.some(Boolean)) office.listFontSizes = sizes;
            const previousSize = sizes[original];
            const nextSize = sizes[p.depth];
            if (attrs.breakRun && nextSize) attrs.breakRun = { ...attrs.breakRun, fontSize: nextSize };
            if (color || nextSize) {
              attrs.marker = p.marker.map(run => ({ ...run, ...(color ? { color } : {}), ...(listRunFontSize(run, previousSize, nextSize, true) ? { fontSize: listRunFontSize(run, previousSize, nextSize, true) } : {}) }));
              p.node.forEach((child, offset) => {
                const run: Partial<TextRun> = child.type.name === "officeInline" ? child.attrs.run : child.marks.find(mark => mark.type.name === "officeRun")?.attrs.office ?? {};
                const fontSize = listRunFontSize(run, previousSize, nextSize);
                const paint = { ...run,
                  ...(!run.href && previous && run.color?.toLowerCase() === previous && color ? { color } : {}),
                  ...(fontSize ? { fontSize } : {}),
                };
                if (JSON.stringify(paint) === JSON.stringify(run)) return;
                const start = p.pos + 1 + offset;
                if (child.type.name === "officeInline") tr.setNodeMarkup(start, undefined, { ...child.attrs, run: paint });
                else tr.addMark(start, start + child.nodeSize, state.schema.marks.officeRun.create({ office: paint }));
              });
            }
          }
          office.paraMargin = Math.max(0, (office.paraMargin ?? 0) + (p.depth - original) * 36) || undefined;
          office.listDepth = p.depth;
          attrs.office = office;
        }
        if (JSON.stringify(attrs) !== JSON.stringify(p.node.attrs)) tr.setNodeMarkup(p.pos, undefined, attrs);
      }
      return tr.docChanged ? tr : null;
    },
  })],
});
