import type { Editor } from "@tiptap/core";
import { NodeSelection, type EditorState } from "@tiptap/pm/state";
import { imageWrap, type ImageWrap } from "@suiteleaf/core/image-wrap";

/** The description stored on an image. A missing value is empty, not a file name. */
export function imageAlt(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function selectedImage(
  state: EditorState,
): { pos: number; alt: string; wrap: ImageWrap | null; inline: boolean } | null {
  const { selection } = state;
  if (!(selection instanceof NodeSelection)) return null;
  const name = selection.node.type.name;
  if (name !== "image" && name !== "inlineImage") return null;
  return {
    pos: selection.from,
    alt: imageAlt(selection.node.attrs.alt),
    wrap: imageWrap(selection.node.attrs),
    inline: name === "inlineImage",
  };
}

/** Writes the description onto the image and leaves the image selected. */
export function applyImageAlt(editor: Editor, pos: number, description: string): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || (node.type.name !== "image" && node.type.name !== "inlineImage")) return false;
  const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
    ...node.attrs,
    alt: description,
  });
  tr.setSelection(NodeSelection.create(tr.doc, pos));
  editor.view.dispatch(tr);
  return true;
}

export interface ImageAltBox {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

/**
 * Puts the alt-text card beside the photo, clear of the corner resize handles.
 * When the page is too narrow for that, the card sits below the photo instead.
 */
export function placeImageAltCard(
  image: ImageAltBox,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  wrap: ImageWrap | null = null,
  inline = false,
): { top: number; left: number } {
  const margin = 8;
  const gap = 16;
  if (inline) {
    return {
      top: margin,
      left: Math.max(margin, viewport.width - card.width - margin),
    };
  }
  if (wrap === "left" || wrap === "right") {
    const left = Math.max(
      margin,
      Math.min(image.left, viewport.width - card.width - margin),
    );
    const above = image.top - gap - card.height - 20;
    if (above >= margin) return { top: above, left };
    if (wrap === "left") {
      const leftSide = image.left - gap - card.width;
      if (leftSide >= margin) return { top: Math.max(margin, image.top), left: leftSide };
    }
    if (wrap === "right") {
      const right = image.right + gap;
      if (right + card.width <= viewport.width - margin)
        return { top: Math.max(margin, image.top), left: right };
    }
    return { top: Math.min(image.bottom + gap, viewport.height - card.height - margin), left };
  }
  const right = image.right + gap;
  const leftSide = image.left - gap - card.width;
  const fitsRight = right + card.width <= viewport.width - margin;
  const fitsLeft = leftSide >= margin;
  let left = right;
  let top = image.top;
  if (!fitsRight && fitsLeft) left = leftSide;
  else if (!fitsRight) {
    left = Math.max(margin, Math.min(image.left, viewport.width - card.width - margin));
    top = image.bottom + gap;
  }
  const maxTop = viewport.height - card.height - margin;
  if (top > maxTop) top = Math.max(margin, maxTop);
  if (top < margin) top = margin;
  return { top, left };
}
