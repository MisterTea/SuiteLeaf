import { Node } from "@tiptap/core";
import type { Node as ProseNode } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import {
  applyOffset,
  bindObjectDrag,
  canPlaceObject,
  ensureParagraphAfter,
  offsetOf,
  placeObject,
} from "./doc-object-move";

export type DocShapeKind = "rect" | "ellipse";

function shapeKind(value: unknown): DocShapeKind {
  return value === "ellipse" ? "ellipse" : "rect";
}

function numberAttr(value: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    docShape: {
      /** Insert a rectangle or an ellipse at the caret. */
      insertShape: (kind: DocShapeKind) => ReturnType;
    };
  }
}

/** A bordered rectangle or ellipse in the document body. */
export const DocShape = Node.create({
  name: "docShape",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      kind: {
        default: "rect",
        parseHTML: (element) => shapeKind(element.getAttribute("data-doc-shape")),
        renderHTML: (attributes) => ({ "data-doc-shape": shapeKind(attributes.kind) }),
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
    return [{ tag: "div[data-doc-shape]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const kind = shapeKind(node.attrs.kind);
    const { x, y } = offsetOf(node.attrs);
    return [
      "div",
      {
        ...HTMLAttributes,
        "data-doc-shape": kind,
        class: `doc-shape doc-shape-${kind}`,
        style: `transform: translate(${x}px, ${y}px)`,
      },
    ];
  },

  addCommands() {
    return {
      insertShape:
        (kind) =>
        ({ state, tr, dispatch }) => {
          const type = state.schema.nodes.docShape;
          const stored = shapeKind(kind);
          if (!type || !canPlaceObject(state, type)) return false;
          if (!dispatch) return true;
          const pos = placeObject(tr, type.create({ kind: stored, x: 0, y: 0 }));
          const inserted = tr.doc.nodeAt(pos);
          if (!inserted || inserted.type !== type) return false;
          ensureParagraphAfter(tr, pos);
          tr.setSelection(NodeSelection.create(tr.doc, pos)).scrollIntoView();
          dispatch(tr);
          return true;
        },
    };
  },

  addNodeView() {
    return ({ node, view, getPos }) => {
      let current: ProseNode = node;
      const dom = document.createElement("div");

      const paint = (painted: ProseNode) => {
        const kind = shapeKind(painted.attrs.kind);
        dom.className = `doc-shape doc-shape-${kind}`;
        dom.setAttribute("data-doc-shape", kind);
        dom.setAttribute("aria-label", kind === "ellipse" ? "Ellipse" : "Rectangle");
        applyOffset(dom, painted.attrs);
      };
      paint(current);

      const unbind = bindObjectDrag(dom, {
        view,
        getPos,
        canDrag: () => true,
        placeCaretOnClick: () => false,
      });

      return {
        dom,
        update(next) {
          if (next.type.name !== "docShape") return false;
          current = next;
          paint(next);
          return true;
        },
        stopEvent: () => true,
        ignoreMutation: () => true,
        destroy() {
          unbind();
        },
      };
    };
  },
});
