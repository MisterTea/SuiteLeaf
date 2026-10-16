import { Node } from "@tiptap/core";

/** A floating Word text box, kept as its own block so the words survive export. */
export const TextBox = Node.create({
  name: "textBox",
  group: "block",
  atom: true,
  selectable: true,
  attrs: {
    text: { default: "" },
  },
  parseHTML: () => [{ tag: "div[data-text-box]" }],
  renderHTML: ({ node }) => [
    "div",
    { "data-text-box": "", class: "doc-text-box" },
    String(node.attrs.text ?? ""),
  ],
});
