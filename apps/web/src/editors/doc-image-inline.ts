import { mergeAttributes } from "@tiptap/core";
import { wrappedImage } from "./doc-image-crop";

/**
 * The same picture as the block image, living inside the sentence.
 * Left, Right, and Break text stay on the block image and lift this one back out.
 */
export const inlineImage = wrappedImage
  .extend({
    name: "inlineImage",
    parseHTML() {
      return [{ tag: 'img[data-inline="true"]', priority: 60 }];
    },
    renderHTML({ HTMLAttributes }) {
      return [
        "img",
        mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
          "data-inline": "true",
        }),
      ];
    },
    // The block image keeps Insert image. This node is only the in-sentence form.
    addCommands() {
      return {};
    },
    addInputRules() {
      return [];
    },
    addPasteRules() {
      return [];
    },
  })
  .configure({
    inline: true,
    allowBase64: true,
    resize: {
      enabled: true,
      directions: ["top-left", "top-right", "bottom-left", "bottom-right"],
      minWidth: 12,
      minHeight: 12,
      alwaysPreserveAspectRatio: true,
    },
  });
