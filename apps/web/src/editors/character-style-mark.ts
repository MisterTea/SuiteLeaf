import { Mark } from "@tiptap/core";

/** The character style id on a text run. Bold and italic come from that style. */
export const CharacterStyleMark = Mark.create({
  name: "characterStyle",
  addAttributes() {
    return {
      style: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-character-style"),
        renderHTML: (attributes) =>
          attributes.style ? { "data-character-style": String(attributes.style) } : {},
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-character-style]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", HTMLAttributes, 0];
  },
});
