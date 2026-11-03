import { Mark } from "@tiptap/core";

/** The character style id on a text run. Bold and italic come from that style. */
export const CharacterStyleMark = Mark.create({
  name: "characterStyle",
  addAttributes() {
    return { style: { default: null } };
  },
});
