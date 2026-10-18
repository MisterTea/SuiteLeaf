import { Node } from "@tiptap/core";
import type { Node as ProseNode } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import {
  applyOffset,
  bindObjectDrag,
  canPlaceObject,
  ensureParagraphAfter,
  offsetOf,
  placeObject,
} from "./doc-object-move";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    textBox: {
      /** Insert an empty text box and leave the caret inside it. */
      insertTextBox: () => ReturnType;
      /** Leave a text box and continue in the paragraph after it. */
      exitTextBox: () => ReturnType;
    };
  }
}

function numberAttr(value: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

type TextBoxJson = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: TextBoxJson[];
};

/** Turn an imported `text` attribute into real inline content. */
function materializeTextBoxJson(node: unknown): unknown {
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(materializeTextBoxJson);
  const current = node as TextBoxJson;
  const content = current.content?.map((child) => materializeTextBoxJson(child) as TextBoxJson);
  if (current.type !== "textBox") return content ? { ...current, content } : current;
  const imported = typeof current.attrs?.text === "string" ? current.attrs.text : "";
  if (!imported || (content && content.length > 0)) {
    return content ? { ...current, content } : current;
  }
  return {
    ...current,
    attrs: { ...current.attrs, text: "" },
    content: [{ type: "text", text: imported }],
  };
}

/** Insert imported words into empty text boxes and clear the attribute. */
function textBoxImportTransaction(state: EditorState): Transaction | null {
  const spots: { pos: number; text: string }[] = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name !== "textBox") return;
    const imported = String(node.attrs.text ?? "");
    if (!imported || node.content.size > 0) return;
    spots.push({ pos, text: imported });
  });
  if (!spots.length) return null;
  let tr = state.tr;
  for (const spot of spots.reverse()) {
    const node = tr.doc.nodeAt(spot.pos);
    if (!node || node.type.name !== "textBox" || node.content.size > 0) continue;
    tr = tr.insert(spot.pos + 1, state.schema.text(spot.text));
    const current = tr.doc.nodeAt(spot.pos);
    if (current) tr = tr.setNodeMarkup(spot.pos, undefined, { ...current.attrs, text: "" });
  }
  if (!tr.docChanged) return null;
  tr.setMeta("addToHistory", false);
  tr.setMeta("textBoxImport", true);
  return tr;
}

function caretInside(view: EditorView, pos: number) {
  const { selection } = view.state;
  if (!(selection instanceof TextSelection)) return false;
  const $from = selection.$from;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === "textBox" && $from.before(depth) === pos) return true;
  }
  return false;
}

/**
 * A document text box. Typed words live in the node. An imported box may
 * only have a `text` attribute; that string becomes real content before
 * editing, so the first character does not replace it.
 */
export const TextBox = Node.create({
  name: "textBox",
  group: "block",
  content: "inline*",
  atom: false,
  defining: true,
  isolating: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      text: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-text") ?? "",
        renderHTML: (attributes) =>
          attributes.text ? { "data-text": String(attributes.text) } : {},
      },
      x: {
        default: 0,
        parseHTML: (element) => numberAttr(element.getAttribute("data-x")),
        renderHTML: (attributes) => ({ "data-x": String(offsetOf(attributes).x) }),
      },
      y: {
        default: 0,
        parseHTML: (element) => numberAttr(element.getAttribute("data-y")),
        renderHTML: (attributes) => ({ "data-y": String(offsetOf(attributes).y) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-text-box]" }];
  },

  onBeforeCreate() {
    const content = this.editor.options.content;
    if (!content || typeof content === "string") return;
    this.editor.options.content = materializeTextBoxJson(content) as typeof content;
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("textBoxImport"),
        appendTransaction(transactions, _old, state) {
          if (transactions.some((tr) => tr.getMeta("textBoxImport"))) return null;
          return textBoxImportTransaction(state);
        },
        view(editorView) {
          const tr = textBoxImportTransaction(editorView.state);
          if (tr) editorView.dispatch(tr);
          return {};
        },
      }),
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const { x, y } = offsetOf(node.attrs);
    const attrs = {
      ...HTMLAttributes,
      "data-text-box": "",
      class: "doc-text-box",
      style: `transform: translate(${x}px, ${y}px)`,
    };
    if (node.content.size === 0 && node.attrs.text)
      return ["div", attrs, String(node.attrs.text)];
    return ["div", attrs, 0];
  },

  addCommands() {
    return {
      insertTextBox:
        () =>
        ({ state, tr, dispatch }) => {
          const type = state.schema.nodes.textBox;
          if (!type || !canPlaceObject(state, type)) return false;
          if (!dispatch) return true;
          const pos = placeObject(tr, type.create({ text: "", x: 0, y: 0 }));
          const inserted = tr.doc.nodeAt(pos);
          if (!inserted || inserted.type !== type) return false;
          ensureParagraphAfter(tr, pos);
          tr.setSelection(TextSelection.create(tr.doc, pos + 1)).scrollIntoView();
          dispatch(tr);
          return true;
        },
      exitTextBox:
        () =>
        ({ state, tr, dispatch }) => {
          const { selection } = state;
          let after = -1;
          if (selection instanceof NodeSelection && selection.node.type.name === "textBox")
            after = selection.to;
          else {
            const $from = selection.$from;
            for (let depth = $from.depth; depth > 0; depth--) {
              if ($from.node(depth).type.name === "textBox") {
                after = $from.after(depth);
                break;
              }
            }
          }
          if (after < 0) return false;
          if (!dispatch) return true;
          if (!tr.doc.resolve(after).nodeAfter?.isTextblock)
            tr.insert(after, state.schema.nodes.paragraph.create());
          tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView();
          dispatch(tr);
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      Escape: () => this.editor.commands.exitTextBox(),
      Enter: () => {
        if (this.editor.state.selection.$from.parent.type.name !== "textBox") return false;
        return this.editor.commands.setHardBreak();
      },
    };
  },

  addNodeView() {
    return ({ node, view, getPos }) => {
      let current: ProseNode = node;
      const dom = document.createElement("div");
      dom.className = "doc-text-box";
      dom.setAttribute("data-text-box", "");
      const frame = document.createElement("div");
      frame.className = "doc-object-move";
      frame.setAttribute("data-doc-move", "");
      frame.setAttribute("contenteditable", "false");
      frame.setAttribute("aria-hidden", "true");
      const fallback = document.createElement("div");
      fallback.className = "doc-text-box-fallback";
      fallback.setAttribute("contenteditable", "false");
      const contentDOM = document.createElement("div");
      contentDOM.className = "doc-text-box-content";
      dom.append(frame, fallback, contentDOM);

      const paint = (painted: ProseNode) => {
        applyOffset(dom, painted.attrs);
        const imported = painted.content.size === 0 ? String(painted.attrs.text ?? "") : "";
        fallback.textContent = imported;
        fallback.hidden = imported.length === 0;
      };
      paint(current);

      const unbind = bindObjectDrag(dom, {
        view,
        getPos,
        canDrag(event) {
          const target = event.target;
          if (!(target instanceof globalThis.Node)) return false;
          if (!contentDOM.contains(target)) return true;
          const pos = getPos();
          return pos == null || !caretInside(view, pos);
        },
        placeCaretOnClick(event) {
          const target = event.target;
          return target instanceof globalThis.Node && contentDOM.contains(target);
        },
      });

      return {
        dom,
        contentDOM,
        update(next) {
          if (next.type.name !== "textBox") return false;
          current = next;
          paint(next);
          return true;
        },
        stopEvent(event) {
          const target = event.target;
          if (!(target instanceof globalThis.Node)) return false;
          return !contentDOM.contains(target);
        },
        ignoreMutation(mutation) {
          if (mutation.type === "selection") return true;
          return !contentDOM.contains(mutation.target);
        },
        destroy() {
          unbind();
        },
      };
    };
  },
});
