import { Mark } from "@tiptap/core";

/** A marked index entry. `see` points at another term and has no page number. */
export const IndexMark = Mark.create({
  name: "index",
  inclusive: false,
  addAttributes() {
    return {
      term: { default: "" },
      subentry: { default: "" },
      see: { default: "" },
      seeAlso: { default: "" },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-index-term]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", { ...HTMLAttributes, "data-index-term": HTMLAttributes.term ?? "" }, 0];
  },
});
