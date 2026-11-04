/** Figure and table captions with a page taken from page breaks. Caption ids are not returned. */

import { countBreak, countedPage, startPageCount } from "./doc-toc-pages";

type ListNode = {
  type?: string;
  text?: string;
  attrs?: { captionId?: string; captionKind?: string; kind?: string; restartAt?: unknown };
  content?: ListNode[];
};

function nodeText(node: ListNode): string {
  if (node.text) return node.text;
  return (node.content ?? []).map(nodeText).join("");
}

function listedLabel(text: string, kind: "figure" | "table"): string {
  const visible = text.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  return visible || (kind === "figure" ? "Figure" : "Table");
}

export function figureListEntries(
  doc: { content?: ListNode[] },
  kind: "figure" | "table",
): { label: string; page: number }[] {
  const entries: { label: string; page: number }[] = [];
  const count = startPageCount();
  const walk = (nodes: ListNode[]) => {
    for (const node of nodes) {
      if (node.type === "note" || node.type === "tableOfContents" || node.type === "figureList") continue;
      if (node.type === "sectionBreak") {
        countBreak(count, node.attrs?.restartAt);
        continue;
      }
      if (node.type === "pageBreak") {
        countBreak(count);
        continue;
      }
      const id = node.attrs?.captionId;
      if (id && node.attrs?.captionKind === kind) {
        entries.push({ label: listedLabel(nodeText(node), kind), page: countedPage(count) });
      }
      if (node.content) walk(node.content);
    }
  };
  walk(doc.content ?? []);
  return entries;
}
