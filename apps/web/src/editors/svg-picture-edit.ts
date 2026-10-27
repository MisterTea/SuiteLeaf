import type { Node as ProseNode } from "@tiptap/pm/model";
import type { Presentation, SlideElement } from "@suiteleaf/core";
import { marpMediaSrc } from "./slide-marp-import";
import { heightForNewShape, isSvgDataUri, svgDataUri, svgFromDataUri } from "./svg-data";

/**
 * An SVG picture on a slide, open in Drawing, and its SVG when it opened. In a
 * MARP deck, `asset` is the file the markdown names, which Drawing edits instead.
 */
export type SlidePictureEdit = { slideId: string; id: string; svg: string; asset: string | null };

/** What double-clicking a slide picture opens: its SVG, a file the deck does not have, or nothing. */
export function slidePictureToEdit(
  deck: Presentation,
  slideId: string,
  el: SlideElement,
): { edit: SlidePictureEdit } | { missing: string } | { unreadable: true } | null {
  if (el.type !== "image") return null;
  const shown = marpMediaSrc(el.src, deck.marpAssets);
  if (!isSvgDataUri(shown)) return deck.marp && /\.svg$/i.test(el.src ?? "") ? { missing: el.src! } : null;
  const svg = svgFromDataUri(shown);
  if (svg === null) return { unreadable: true };
  // A picture added on a MARP canvas keeps its data until the markdown names its file.
  const asset = !deck.marp
    ? null
    : el.src && el.src !== shown
      ? el.src
      : (Object.entries(deck.marpAssets ?? {}).find(([, uri]) => uri === shown)?.[0] ?? null);
  return { edit: { slideId, id: el.id, svg, asset } };
}

/**
 * The deck with a picture's new SVG. A MARP file changes for every picture
 * that names it, and the markdown is left as it was. Otherwise the picture keeps
 * its width, and its height follows the drawing's shape.
 */
export function applySlidePictureEdit(
  deck: Presentation,
  edit: SlidePictureEdit,
  svg: string,
): { deck: Presentation } | { error: string } {
  if (edit.asset) {
    if (!deck.marpAssets?.[edit.asset]) return { error: `${edit.asset} was removed while it was open in Drawing.` };
    return { deck: { ...deck, marpAssets: { ...deck.marpAssets, [edit.asset]: svgDataUri(svg) } } };
  }
  const slide = deck.slides[edit.slideId];
  const picture = slide?.elements.find((el) => el.id === edit.id);
  if (!slide || !picture) return { error: "The picture was removed while it was open in Drawing." };
  // A MARP deck lays its pictures out from the markdown.
  const height = deck.marp ? null : heightForNewShape(picture.width, edit.svg, svg);
  const changed = { ...picture, src: svgDataUri(svg), ...(height ? { height } : {}) };
  return {
    deck: {
      ...deck,
      slides: {
        ...deck.slides,
        [slide.id]: { ...slide, elements: slide.elements.map((el) => (el.id === edit.id ? changed : el)) },
      },
    },
  };
}

/** A document picture open in Drawing: where it was, its source, and its SVG when it opened. */
export type DocPictureEdit = { pos: number; src: string; svg: string };

export function docPictureToEdit(node: ProseNode, pos: number): DocPictureEdit | null {
  if (node.type.name !== "image" && node.type.name !== "inlineImage") return null;
  const src = node.attrs.src;
  const svg = isSvgDataUri(src) ? svgFromDataUri(src) : null;
  return svg === null ? null : { pos, src, svg };
}

/**
 * Where the picture is now and its new attributes, or null if it is gone. It
 * is looked for where it was, then anywhere, since another person's edit may
 * have moved it while it was open.
 */
export function docPictureChange(
  doc: ProseNode,
  edit: DocPictureEdit,
  svg: string,
): { pos: number; attrs: Record<string, unknown> } | null {
  const there = edit.pos <= doc.content.size ? doc.nodeAt(edit.pos) : null;
  let pos = there?.attrs.src === edit.src ? edit.pos : -1;
  if (pos < 0)
    doc.descendants((node, at) => {
      if (pos < 0 && node.attrs.src === edit.src) pos = at;
      return pos < 0;
    });
  const node = pos < 0 ? null : doc.nodeAt(pos);
  if (!node) return null;
  const height = node.attrs.height ? heightForNewShape(Number(node.attrs.width), edit.svg, svg) : null;
  return { pos, attrs: { ...node.attrs, src: svgDataUri(svg), ...(height ? { height } : {}) } };
}
