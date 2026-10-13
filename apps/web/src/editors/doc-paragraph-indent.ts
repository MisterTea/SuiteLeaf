import { Extension } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import {
  PARAGRAPH_INDENT_MAX_IN,
  firstLineIndentAttribute,
  hangingIndentAttribute,
  indentChoice,
  indentInches,
  type SpecialIndent,
} from "@suiteleaf/core/paragraph-indent";

export type { SpecialIndent };

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    paragraphIndent: {
      /**
       * Set the special indent on the selected paragraphs.
       * First line and hanging clear each other. None, or 0 inches, removes it.
       */
      setSpecialIndent: (kind: SpecialIndent, inches: number) => ReturnType;
    };
  }
}

function readInches(element: HTMLElement, name: string): number | null {
  const raw = element.getAttribute(name);
  if (raw == null || raw === "") return null;
  const inches = indentInches(raw);
  return inches > 0 ? inches : null;
}

function stored(value: unknown): number | null {
  const inches = indentInches(value);
  return inches > 0 ? inches : null;
}

/** The special indent shared by the selected paragraphs, or "mixed" when they differ. */
export function selectionSpecialIndent(state: EditorState): {
  kind: SpecialIndent | "mixed";
  inches: number | "mixed";
} {
  const found: { kind: SpecialIndent; inches: number }[] = [];
  for (const range of state.selection.ranges) {
    state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node) => {
      if (node.type.name !== "paragraph") return;
      found.push(indentChoice(node.attrs));
      return false;
    });
  }
  if (found.length === 0) return { kind: "none", inches: 0 };
  const kinds = new Set(found.map((item) => item.kind));
  const amounts = new Set(found.map((item) => item.inches));
  return {
    kind: kinds.size === 1 ? found[0].kind : "mixed",
    inches: amounts.size === 1 ? found[0].inches : "mixed",
  };
}

/**
 * Writes one special indent onto paragraphs in the selection.
 * Choosing first line clears hanging on those paragraphs, and the reverse.
 * Line spacing, space before, and space after stay as they were.
 * Paragraphs outside the selection are not visited.
 */
export function applySpecialIndent(
  state: EditorState,
  kind: SpecialIndent,
  inches: number,
): { transaction: Transaction; paragraphs: number } {
  const amount = kind === "none" ? 0 : indentInches(inches);
  const nextFirst = kind === "firstLine" && amount > 0 ? amount : null;
  const nextHanging = kind === "hanging" && amount > 0 ? amount : null;
  const tr = state.tr;
  let paragraphs = 0;
  for (const range of state.selection.ranges) {
    state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, pos) => {
      if (node.type.name !== "paragraph") return;
      paragraphs += 1;
      if (
        stored(node.attrs.firstLineIndent) === nextFirst &&
        stored(node.attrs.hangingIndent) === nextHanging
      )
        return false;
      tr.setNodeMarkup(tr.mapping.map(pos), undefined, {
        ...node.attrs,
        firstLineIndent: nextFirst,
        hangingIndent: nextHanging,
      });
      return false;
    });
  }
  return { transaction: tr, paragraphs };
}

export const paragraphIndent = Extension.create({
  name: "paragraphIndent",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          firstLineIndent: {
            default: null,
            keepOnSplit: true,
            parseHTML: (element) =>
              readInches(element, "data-first-line-indent"),
            renderHTML: (attributes) =>
              firstLineIndentAttribute(attributes.firstLineIndent),
          },
          hangingIndent: {
            default: null,
            keepOnSplit: true,
            parseHTML: (element) => readInches(element, "data-hanging-indent"),
            renderHTML: (attributes) =>
              hangingIndentAttribute(attributes.hangingIndent),
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setSpecialIndent:
        (kind, inches) =>
        ({ state, dispatch }) => {
          if (kind !== "none" && kind !== "firstLine" && kind !== "hanging")
            return false;
          if (
            kind !== "none" &&
            (!Number.isFinite(inches) ||
              inches < 0 ||
              inches > PARAGRAPH_INDENT_MAX_IN)
          )
            return false;
          const { transaction, paragraphs } = applySpecialIndent(
            state,
            kind,
            inches,
          );
          if (!paragraphs) return false;
          if (dispatch && transaction.docChanged) dispatch(transaction);
          return true;
        },
    };
  },
});
