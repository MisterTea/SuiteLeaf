import { refreshCaptions, refreshHeadingRefs } from "./doc-styles";

/**
 * A contents list built from the headings in each section.
 * The input document is not changed.
 */

type ContentsNode = {
  type: string;
  attrs?: { level?: number; maxLevel?: number; id?: string };
  content?: ContentsNode[];
  text?: string;
};

function headingText(node: ContentsNode): string {
  const parts: string[] = [];
  const walk = (current: ContentsNode) => {
    if (current.type === "text" && current.text) parts.push(current.text);
    for (const child of current.content ?? []) walk(child);
  };
  walk(node);
  return parts.join("").replace(/^[\s\u200B-\u200D\uFEFF\u2060]+|[\s\u200B-\u200D\uFEFF\u2060]+$/g, "");
}

function collectHeadings(
  nodes: ContentsNode[],
  section: { n: number },
  out: { section: number; level: number; text: string; id?: string }[],
) {
  for (const node of nodes) {
    if (node.type === "sectionBreak") {
      section.n += 1;
      continue;
    }
    if (node.type === "tableOfContents" || node.type === "note") continue;
    if (node.type === "heading") {
      const text = headingText(node);
      const level = Number(node.attrs?.level) || 1;
      if (text) out.push({ section: section.n, level, text, id: node.attrs?.id });
      continue;
    }
    if (node.content) collectHeadings(node.content, section, out);
  }
}

/** Rewrite each contents field from the headings that are still in the document. */
export function refreshContents<T extends { content?: ContentsNode[] }>(
  doc: T,
  pages?: Readonly<Record<string, number>>,
): T {
  const copy = structuredClone(doc);
  const headings: { section: number; level: number; text: string; id?: string }[] = [];
  collectHeadings(copy.content ?? [], { n: 1 }, headings);
  const walk = (nodes: ContentsNode[]) => {
    for (const node of nodes) {
      if (node.type === "tableOfContents") {
        const max = Number(node.attrs?.maxLevel) || 3;
        node.content = headings
          .filter((heading) => heading.level <= max)
          .map((heading) => {
            const page = heading.id ? pages?.[heading.id] : undefined;
            const listed = `Section ${heading.section}: ${heading.text}`;
            const text =
              typeof page === "number" && Number.isInteger(page) && page >= 1 && page <= 9999
                ? `${listed}, ${page}`
                : listed;
            return {
              type: "paragraph",
              content: [{ type: "text", text }],
            };
          });
        continue;
      }
      if (node.content) walk(node.content);
    }
  };
  walk(copy.content ?? []);
  return copy;
}

/** Rebuild contents, heading references, and the figure and table lists. The input document is not changed. */
export function refreshReport<T extends { content?: ContentsNode[] }>(
  doc: T,
  pages?: Readonly<Record<string, number>>,
  headingPages?: Readonly<Record<string, number>>,
): T {
  const captions = refreshCaptions(doc as never, pages);
  const headings = refreshHeadingRefs(captions as never);
  return refreshContents(headings as T, headingPages);
}
