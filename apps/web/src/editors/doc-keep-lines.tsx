import { Extension } from "@tiptap/core";

export function keepsLines(node: { attrs: Record<string, unknown> }): boolean {
  return node.attrs.keepLines === true;
}

/**
 * A paragraph that fits on one page and asked to keep its lines together is
 * one block. Taller than a page is out of scope, so it may still split.
 * This is not widow control: two lines on each page is still a split.
 */
export function keepParagraphTogether(
  keepLines: boolean,
  height: number,
  pageBody: number,
): boolean {
  return keepLines && height <= pageBody;
}

export const KeepLines = Extension.create({
  name: "keepLines",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          keepLines: {
            default: null,
            keepOnSplit: true,
            parseHTML: (element) =>
              element.getAttribute("data-keep-lines") === "true" ? true : null,
            renderHTML: (attributes) =>
              attributes.keepLines === true ? { "data-keep-lines": "true" } : {},
          },
        },
      },
    ];
  },
});
