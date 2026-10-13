import type { Node as ProseNode } from "@tiptap/pm/model";
import { Decoration } from "@tiptap/pm/view";
import type { PageSettings } from "@suiteleaf/core/document-layout";

/**
 * Mark each top-level block with the binding side of its page. A block that
 * crosses a page break is left alone: one box cannot sit on both edges.
 * Odd pages (including page 1) get `doc-bind-odd`, which shifts the column
 * right by the gutter. Even pages get `doc-bind-even`; the extra right
 * padding on the page already holds their gutter.
 */
export function gutterDecorations(
  doc: ProseNode,
  boundaries: { pos: number }[],
  breaks: number[],
  settings: PageSettings,
): Decoration[] {
  if (!(settings.gutter > 0)) return [];
  const breakAt = new Set(breaks);
  const ordered = [...boundaries].sort((a, b) => a.pos - b.pos);
  let page = 0;
  const seen = new Set<number>();
  const pageByPos = new Map<number, number>();
  for (const boundary of ordered) {
    if (breakAt.has(boundary.pos) && !seen.has(boundary.pos)) {
      seen.add(boundary.pos);
      page += 1;
    }
    pageByPos.set(boundary.pos, page);
  }
  const decorations: Decoration[] = [];
  doc.forEach((node, offset) => {
    const pages = new Set<number>();
    for (const [pos, assigned] of pageByPos) {
      if (pos >= offset && pos < offset + node.nodeSize) pages.add(assigned);
    }
    if (pages.size !== 1) return;
    const pageNumber = [...pages][0] + 1;
    const odd = pageNumber % 2 === 1;
    decorations.push(
      Decoration.node(offset, offset + node.nodeSize, {
        class: odd ? "doc-bind-odd" : "doc-bind-even",
        "data-bind": odd ? "odd" : "even",
      }),
    );
  });
  return decorations;
}
