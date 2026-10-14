import { Extension } from "@tiptap/core";

export type WidowBoundary = {
  top: number;
  manual?: boolean;
  widowControl?: boolean;
  blockPos?: number;
  line?: number;
  lineCount?: number;
};

/** Number each visual line of a paragraph so a page break can keep two together. */
export function annotateWidowLines<T extends { top: number }>(
  lines: T[],
  blockPos: number,
  widowControl: boolean,
): (T & WidowBoundary)[] {
  const ordered = [...lines].sort((a, b) => a.top - b.top);
  return ordered.map((line, index) => ({
    ...line,
    blockPos,
    line: index,
    lineCount: ordered.length,
    widowControl,
  }));
}

/**
 * Move a page break so a paragraph with widow/orphan control does not leave
 * one of its lines alone at the top or bottom of a page. Lines that belong
 * to another block, including a heading kept with the next paragraph, stay put.
 */
export function avoidSingleLine<T extends WidowBoundary>(
  boundaries: T[],
  index: number,
  pageStart: number,
  added: number,
): number {
  const next = boundaries[index];
  if (
    !next ||
    next.manual ||
    next.widowControl !== true ||
    next.line == null ||
    next.lineCount == null ||
    next.lineCount < 2
  )
    return index;

  const block = next.blockPos;
  const onPage = (boundary: T | undefined): boundary is T =>
    !!boundary &&
    boundary.blockPos === block &&
    boundary.widowControl === true &&
    boundary.top + added > pageStart + 0.5;

  let first = index;
  const remaining = () => {
    const line = boundaries[first]?.line;
    return line == null || next.lineCount == null ? 0 : next.lineCount - line;
  };
  while (remaining() < 2) {
    if (!onPage(boundaries[first - 1])) break;
    first--;
  }

  const aloneOnThisPage = () => {
    let count = 0;
    for (let i = first - 1; i >= 0; i--) {
      if (!onPage(boundaries[i])) break;
      count++;
    }
    return count;
  };
  while (aloneOnThisPage() === 1) {
    if (!onPage(boundaries[first - 1])) break;
    first--;
  }
  return first;
}

export const WidowControl = Extension.create({
  name: "widowControl",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          widowControl: {
            default: null,
            keepOnSplit: true,
            parseHTML: (element) =>
              element.getAttribute("data-widow-control") === "true" ? true : null,
            renderHTML: (attributes) =>
              attributes.widowControl === true
                ? { "data-widow-control": "true" }
                : {},
          },
        },
      },
    ];
  },
});
