import { XMLParser } from "fast-xml-parser";
import type { JsonNode } from "./index";
import {
  imageRotation,
  imageRotationFromXfrmRot,
  type ImageRotation,
} from "./image-rotation";

/**
 * A Word caption is the Caption-styled paragraph immediately after a photo.
 * The drawing's `docPr descr` is the description. `a:xfrm rot` is the quarter
 * turn. A later sentence stays a paragraph. Width and height stay the extent.
 */
type CaptionSlot = {
  descr: string;
  caption: string | null;
  rotation: ImageRotation;
};

type WordParagraph = {
  styleId: string;
  text: string;
  images: { descr: string; rotation: ImageRotation }[];
};

const orderedParser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  trimValues: false,
  parseTagValue: false,
  processEntities: true,
});

const normalize = (value: string) => value.replace(/[\s\u200b\ufeff]+/gu, "");

function localName(key: string): string {
  const at = key.lastIndexOf(":");
  return at >= 0 ? key.slice(at + 1) : key;
}

function attrsOf(node: Record<string, unknown>): Record<string, unknown> {
  const attrs = node[":@"];
  return attrs && typeof attrs === "object"
    ? (attrs as Record<string, unknown>)
    : {};
}

function attr(attrs: Record<string, unknown>, name: string): string {
  for (const key of [`@_w:${name}`, `@_wp:${name}`, `@_${name}`]) {
    const value = attrs[key];
    if (typeof value === "string") return value;
  }
  return "";
}

function elements(
  nodes: unknown,
): { name: string; children: unknown[]; attrs: Record<string, unknown> }[] {
  if (!Array.isArray(nodes)) return [];
  const out: {
    name: string;
    children: unknown[];
    attrs: Record<string, unknown>;
  }[] = [];
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const record = node as Record<string, unknown>;
    const attrs = attrsOf(record);
    for (const [key, value] of Object.entries(record)) {
      if (key === ":@" || key === "#text") continue;
      out.push({
        name: localName(key),
        children: Array.isArray(value) ? value : [],
        attrs,
      });
    }
  }
  return out;
}

function textIn(nodes: unknown): string {
  if (!Array.isArray(nodes)) return "";
  let text = "";
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const value = (node as Record<string, unknown>)["#text"];
    if (typeof value === "string") text += value;
  }
  return text;
}

/** Style ids whose id or display name is Caption, plus the literal id. */
function captionStyleIds(stylesXml: string): Set<string> {
  const ids = new Set<string>(["Caption"]);
  for (const match of stylesXml.matchAll(
    /<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g,
  )) {
    const id = /w:styleId="([^"]+)"/.exec(match[1])?.[1];
    const type = /w:type="([^"]+)"/.exec(match[1])?.[1] ?? "paragraph";
    if (!id || type !== "paragraph") continue;
    const name = /<w:name\b[^>]*w:val="([^"]+)"/.exec(match[2])?.[1] ?? "";
    if (id.toLowerCase() === "caption" || name.toLowerCase() === "caption")
      ids.add(id);
  }
  return ids;
}

function isCaptionStyle(styleId: string, ids: Set<string>): boolean {
  if (!styleId) return false;
  return styleId.toLowerCase() === "caption" || ids.has(styleId);
}

function paragraphStyleId(children: unknown[]): string {
  for (const child of elements(children)) {
    if (child.name !== "pPr") continue;
    for (const prop of elements(child.children)) {
      if (prop.name === "pStyle") return attr(prop.attrs, "val");
    }
  }
  return "";
}

function paragraphText(children: unknown[]): string {
  let text = "";
  const walk = (nodes: unknown[]) => {
    for (const child of elements(nodes)) {
      if (
        child.name === "drawing" ||
        child.name === "pict" ||
        child.name === "txbxContent" ||
        child.name === "del" ||
        child.name === "instrText"
      )
        continue;
      if (child.name === "t") text += textIn(child.children);
      else if (child.name === "tab") text += "\t";
      else if (child.name === "br" || child.name === "cr") text += "\n";
      else walk(child.children);
    }
  };
  walk(children);
  return text;
}

function blipCount(nodes: unknown[]): number {
  let count = 0;
  const walk = (list: unknown[]) => {
    for (const child of elements(list)) {
      if (child.name === "AlternateContent") {
        const choice = elements(child.children).find(
          (part) => part.name === "Choice",
        );
        walk(choice ? choice.children : child.children);
        continue;
      }
      if (child.name === "Fallback") continue;
      if (child.name === "blip" || child.name === "imagedata") count += 1;
      else walk(child.children);
    }
  };
  walk(nodes);
  return count;
}

/** The picture's `a:xfrm rot`. The first transform in the picture wins. */
function xfrmRotation(nodes: unknown[]): ImageRotation {
  let rotation: ImageRotation | null = null;
  const walk = (list: unknown[]) => {
    if (rotation !== null) return;
    for (const child of elements(list)) {
      if (child.name === "AlternateContent") {
        const choice = elements(child.children).find(
          (part) => part.name === "Choice",
        );
        walk(choice ? choice.children : child.children);
        continue;
      }
      if (child.name === "Fallback") continue;
      if (child.name === "xfrm") {
        rotation = imageRotationFromXfrmRot(attr(child.attrs, "rot"));
        return;
      }
      walk(child.children);
      if (rotation !== null) return;
    }
  };
  walk(nodes);
  return rotation ?? 0;
}

/** One slot per blip. `docPr descr` only; a picture's empty `cNvPr descr` is not the description. */
function imagesIn(nodes: unknown[]): { descr: string; rotation: ImageRotation }[] {
  const images: { descr: string; rotation: ImageRotation }[] = [];
  const drawingImages = (nodes: unknown[]) => {
    let descr = "";
    const rotations: ImageRotation[] = [];
    const walk = (list: unknown[]) => {
      for (const child of elements(list)) {
        if (child.name === "AlternateContent") {
          const choice = elements(child.children).find(
            (part) => part.name === "Choice",
          );
          walk(choice ? choice.children : child.children);
          continue;
        }
        if (child.name === "Fallback") continue;
        if (child.name === "docPr") {
          const value = attr(child.attrs, "descr").trim();
          if (value && !descr) descr = value;
        }
        // The turn lives on the picture's own transform, not a swapped extent.
        if (child.name === "pic") {
          const count = blipCount(child.children);
          const rotation = xfrmRotation(child.children);
          for (let i = 0; i < count; i++) rotations.push(rotation);
          continue;
        }
        if (child.name === "blip" || child.name === "imagedata") {
          rotations.push(0);
          continue;
        }
        walk(child.children);
      }
    };
    walk(nodes);
    for (const rotation of rotations) images.push({ descr, rotation });
  };
  const walk = (list: unknown[]) => {
    for (const child of elements(list)) {
      if (child.name === "drawing" || child.name === "pict") {
        drawingImages(child.children);
        continue;
      }
      walk(child.children);
    }
  };
  walk(nodes);
  return images;
}

function paragraphsIn(xml: string): WordParagraph[] | null {
  let tree: unknown;
  try {
    tree = orderedParser.parse(xml);
  } catch {
    return null;
  }
  const paragraphs: WordParagraph[] = [];
  const walk = (nodes: unknown[]) => {
    for (const child of elements(nodes)) {
      if (child.name === "p") {
        paragraphs.push({
          styleId: paragraphStyleId(child.children),
          text: paragraphText(child.children),
          images: imagesIn(child.children),
        });
        continue;
      }
      if (
        child.name === "drawing" ||
        child.name === "pict" ||
        child.name === "txbxContent"
      )
        continue;
      walk(child.children);
    }
  };
  walk(Array.isArray(tree) ? tree : []);
  return paragraphs;
}

function captionSlots(xml: string, stylesXml: string): CaptionSlot[] {
  const paragraphs = paragraphsIn(xml);
  if (!paragraphs) return [];
  const ids = captionStyleIds(stylesXml);
  const slots: CaptionSlot[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const images = paragraphs[i].images;
    if (!images.length) continue;
    const next = paragraphs[i + 1];
    const caption =
      next &&
      !next.images.length &&
      isCaptionStyle(next.styleId, ids) &&
      next.text.trim()
        ? next.text.trim()
        : null;
    for (let j = 0; j < images.length; j++) {
      const last = j === images.length - 1;
      slots.push({
        descr: images[j].descr,
        caption: last ? caption : null,
        rotation: images[j].rotation,
      });
    }
  }
  return slots;
}

function plainText(node: JsonNode): string {
  let text = node.text ?? "";
  for (const child of node.content ?? []) text += plainText(child);
  return text;
}

function hasImage(node: JsonNode): boolean {
  if (node.type === "image" || node.type === "inlineImage") return true;
  return (node.content ?? []).some(hasImage);
}

/**
 * Puts a following Caption paragraph on the image and drops it from the body.
 * The description stays on `alt`. `a:xfrm rot` becomes the image rotation.
 * Width and height are left as stored. A paragraph that is not Caption stays put.
 */
export function applyImportedImageCaptions(
  doc: JsonNode,
  documentXml: string,
  stylesXml: string,
): JsonNode {
  const slots = captionSlots(documentXml, stylesXml);
  if (!slots.length) return doc;
  let index = 0;
  const pending: string[] = [];
  const visit = (node: JsonNode): JsonNode | null => {
    if (node.type === "image") {
      const slot = slots[index];
      index += 1;
      if (!slot) return node;
      const existing = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
      const descr = slot.descr.trim();
      const caption = slot.caption?.trim() ?? "";
      const rotation = slot.rotation;
      if (caption) pending.push(caption);
      if (!descr && !caption && rotation === 0) return node;
      if (
        descr === existing &&
        !caption &&
        node.attrs?.caption == null &&
        imageRotation(node.attrs?.rotation) === rotation
      )
        return node;
      return {
        ...node,
        attrs: {
          ...(node.attrs ?? {}),
          ...(descr ? { alt: descr } : {}),
          ...(caption ? { caption } : {}),
          ...(rotation !== 0 ? { rotation } : {}),
        },
      };
    }
    if (
      (node.type === "paragraph" || node.type === "heading") &&
      pending.length &&
      !hasImage(node) &&
      normalize(plainText(node)) === normalize(pending[0])
    ) {
      pending.shift();
      return null;
    }
    if (!node.content?.length) return node;
    let changed = false;
    const content: JsonNode[] = [];
    for (const child of node.content ?? []) {
      const next = visit(child);
      if (next !== child) changed = true;
      if (next) content.push(next);
    }
    return changed ? { ...node, content } : node;
  };
  return visit(doc) ?? doc;
}
