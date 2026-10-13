import type { Editor } from "@tiptap/core";
import { NodeSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { imageWrap, type ImageWrap } from "@suiteleaf/core/image-wrap";

/** The description stored on an image. A missing value is empty, not a file name. */
export function imageAlt(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** The visible line under a photo. A missing value is empty, so older documents still open. */
export function imageCaption(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isPhoto(name: string) {
  return name === "image" || name === "inlineImage";
}

export function selectedImage(
  state: EditorState,
): { pos: number; alt: string; caption: string; wrap: ImageWrap | null; inline: boolean } | null {
  const { selection } = state;
  if (!(selection instanceof NodeSelection)) return null;
  const name = selection.node.type.name;
  if (!isPhoto(name)) return null;
  return {
    pos: selection.from,
    alt: imageAlt(selection.node.attrs.alt),
    caption: imageCaption(selection.node.attrs.caption),
    wrap: imageWrap(selection.node.attrs),
    inline: name === "inlineImage",
  };
}

/** Writes the description onto the image and leaves the image selected. */
export function applyImageAlt(editor: Editor, pos: number, description: string): boolean {
  const tr = imageAttrTransaction(editor.state, pos, { alt: description });
  if (!tr) return false;
  editor.view.dispatch(tr);
  return true;
}

/**
 * Writes the caption onto the image. The description, size, wrap, and crop stay.
 * An empty caption removes the line and leaves the photo in place.
 */
export function setImageCaption(
  state: EditorState,
  pos: number,
  caption: string,
): Transaction | null {
  return imageAttrTransaction(state, pos, { caption });
}

export function applyImageCaption(editor: Editor, pos: number, caption: string): boolean {
  const tr = setImageCaption(editor.state, pos, caption);
  if (!tr) return false;
  editor.view.dispatch(tr);
  return true;
}

function imageAttrTransaction(
  state: EditorState,
  pos: number,
  patch: { alt?: string; caption?: string },
): Transaction | null {
  const node = state.doc.nodeAt(pos);
  if (!node || !isPhoto(node.type.name)) return null;
  const tr = state.tr.setNodeMarkup(pos, undefined, {
    ...node.attrs,
    ...patch,
  });
  tr.setSelection(NodeSelection.create(tr.doc, pos));
  return tr;
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
