import { Node } from "@tiptap/core";
import { figureListEntries } from "./figure-list-entries";

export { figureListEntries } from "./figure-list-entries";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    figureList: {
      insertFigureList: (kind?: "figure" | "table") => ReturnType;
    };
  }
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
