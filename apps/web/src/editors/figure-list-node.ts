import { Node } from "@tiptap/core";
import { countBreak, countedPage, startPageCount } from "./doc-toc-pages";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    figureList: {
      insertFigureList: (kind?: "figure" | "table") => ReturnType;
    };
  }
}

/** Figure and table captions with a page taken from page breaks. Caption ids are not returned. */

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
        const label = nodeText(node).trim() || (kind === "figure" ? "Figure" : "Table");
        entries.push({ label, page: countedPage(count) });
      }
      if (node.content) walk(node.content);
    }
  };
  walk(doc.content ?? []);
  return entries;
}

export const FigureList = Node.create({
  name: "figureList",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return { kind: { default: "figure" } };
  },
  addCommands() {
    return {
      insertFigureList:
        (kind: "figure" | "table" = "figure") =>
        ({ chain }) =>
          chain()
            .focus()
            .insertContent({ type: this.name, attrs: { kind: kind === "table" ? "table" : "figure" } })
            .run(),
    };
  },
  parseHTML: () => [{ tag: "nav[data-figure-list]" }],
  renderHTML: ({ node }) => [
    "nav",
    {
      "data-figure-list": "true",
      "data-kind": node.attrs.kind === "table" ? "table" : "figure",
    },
  ],
  addNodeView() {
    return ({ node, editor }) => {
      const dom = document.createElement("nav");
      const kind = node.attrs.kind === "table" ? "table" : "figure";
      dom.setAttribute("data-figure-list", "true");
      dom.setAttribute("aria-label", kind === "table" ? "Table list" : "Figure list");
      const render = () => {
        const entries = figureListEntries(editor.getJSON(), kind);
        dom.replaceChildren();
        if (!entries.length) {
          const empty = document.createElement("p");
          empty.textContent = kind === "table" ? "No tables are captioned." : "No figures are captioned.";
          dom.append(empty);
          return;
        }
        for (const entry of entries) {
          const row = document.createElement("p");
          row.textContent = `${entry.label}, ${entry.page}`;
          dom.append(row);
        }
      };
      render();
      editor.on("update", render);
      return {
        dom,
        ignoreMutation: () => true,
        destroy: () => {
          editor.off("update", render);
        },
      };
    };
  },
});
