import { XMLParser } from "fast-xml-parser";
import type { JsonNode } from "./index";
import {
  imageCropActive,
  imageCropFromSrcRect,
  type ImageCrop,
} from "./image-crop";
import { type DrawingPlacement, type ImageWrap } from "./image-wrap";

/**
 * Word's drawing extent is in English Metric Units. 914400 EMU is one inch,
 * and SuiteLeaf's page is 96 CSS pixels per inch.
 */
const EMU_PER_CSS_PIXEL = 914400 / 96;

/** The on-page size of one picture, or null when the drawing has no extent. */
export type ImagePageSize = { width: number; height: number } | null;

type OrderedNode = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  preserveOrder: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
});

/**
 * Page sizes for the pictures Mammoth will emit from a document part, in
 * document order. Header and footer parts are separate files and are not read.
 * `mc:AlternateContent` is special: Mammoth keeps only the fallback, while the
 * drawing extent is usually on the choice.
 */
export function imagePageSizes(xml: string): ImagePageSize[] {
  try {
    const tree = parser.parse(xml) as OrderedNode[];
    return pageSizes(Array.isArray(tree) ? tree : []);
  } catch {
    return [];
  }
}

/** Give each imported picture the extent that was stored for it. */
export function applyImagePageSizes(
  doc: JsonNode,
  sizes: ImagePageSize[],
): JsonNode {
  let index = 0;
  const walk = (node: JsonNode): JsonNode => {
    if (node.type === "image") {
      const size = sizes[index++];
      if (!size) return node;
      return {
        ...node,
        attrs: { ...node.attrs, width: size.width, height: size.height },
      };
    }
    if (!node.content) return node;
    return { ...node, content: node.content.map(walk) };
  };
  return walk(doc);
}

export type ImportedDrawing = {
  size: ImagePageSize;
  crop: ImageCrop | null;
  placement: DrawingPlacement;
  /** The Word paragraph also contained words, so Mammoth's split should be joined. */
  sharesParagraph: boolean;
};

/**
 * Body pictures in the order Mammoth emits them.
 * Deleted drawings are skipped. A fallback picture keeps the choice drawing's
 * extent, crop, and wrap, because that is the drawing Word showed.
 */
export function importedDrawings(xml: string): ImportedDrawing[] {
  try {
    const tree = parser.parse(xml) as OrderedNode[];
    return drawingFacts(Array.isArray(tree) ? tree : []);
  } catch {
    return [];
  }
}

/** Copy each body picture's extent, crop, and wrap. Header pictures are separate parts. */
export function applyImportedDrawings(
  doc: JsonNode,
  xml: string,
): { doc: JsonNode; placements: DrawingPlacement[]; sharesParagraph: boolean[] } {
  const facts = importedDrawings(xml);
  const placements: DrawingPlacement[] = [];
  const sharesParagraph: boolean[] = [];
  let index = 0;
  const walk = (node: JsonNode): JsonNode => {
    if (node.type === "image") {
      const fact = facts[index++];
      if (!fact) {
        sharesParagraph.push(false);
        return node;
      }
      placements.push(fact.placement);
      sharesParagraph.push(fact.sharesParagraph);
      const attrs = { ...(node.attrs ?? {}) };
      if (fact.size) {
        attrs.width = fact.size.width;
        attrs.height = fact.size.height;
      }
      if (fact.crop) {
        attrs.cropLeft = fact.crop.left;
        attrs.cropTop = fact.crop.top;
        attrs.cropRight = fact.crop.right;
        attrs.cropBottom = fact.crop.bottom;
      }
      if (fact.placement.wrap) attrs.wrap = fact.placement.wrap;
      return { ...node, attrs };
    }
    if (!node.content) return node;
    return { ...node, content: node.content.map(walk) };
  };
  return { doc: walk(doc), placements, sharesParagraph };
}

function drawingFacts(
  nodes: OrderedNode[],
  sharesParagraph = false,
): ImportedDrawing[] {
  const facts: ImportedDrawing[] = [];
  for (const node of nodes) {
    const name = tag(node);
    if (!name || name === ":@") continue;
    if (name === "del" || name === "moveFrom") continue;
    if (name === "tr" && rowDeleted(node)) continue;
    if (name === "p") {
      facts.push(...drawingFacts(childNodes(node), paragraphHasText(node)));
      continue;
    }
    if (name === "AlternateContent") {
      facts.push(...alternateFacts(node, sharesParagraph));
      continue;
    }
    if (name === "inline" || name === "anchor") {
      const fact = drawingFact(name, node, sharesParagraph);
      const blips = countTags(node, "blip");
      for (let i = 0; i < blips; i++) facts.push(fact);
      continue;
    }
    if (name === "imagedata") {
      facts.push({
        size: null,
        crop: null,
        placement: { wrap: null, floating: false, represented: true },
        sharesParagraph,
      });
      continue;
    }
    facts.push(...drawingFacts(childNodes(node), sharesParagraph));
  }
  return facts;
}

function paragraphHasText(node: OrderedNode): boolean {
  const walk = (current: OrderedNode): boolean => {
    const name = tag(current);
    if (!name || name === "drawing" || name === "pict") return false;
    if (name === "t" && textOf(current).trim()) return true;
    return childNodes(current).some(walk);
  };
  return childNodes(node).some(walk);
}

function alternateFacts(
  node: OrderedNode,
  sharesParagraph: boolean,
): ImportedDrawing[] {
  const choice = childNodes(node).find((part) => tag(part) === "Choice");
  const fallback = childNodes(node).find((part) => tag(part) === "Fallback");
  const fallen = fallback
    ? drawingFacts(childNodes(fallback), sharesParagraph)
    : [];
  if (!fallen.length) return [];
  const chosen = choice
    ? drawingFacts(childNodes(choice), sharesParagraph)
    : [];
  return fallen.map((fact, index) => {
    const alt = chosen[index];
    return {
      size: fact.size ?? alt?.size ?? null,
      crop: alt?.crop ?? fact.crop,
      placement: alt?.placement ?? fact.placement,
      sharesParagraph,
    };
  });
}

function drawingFact(
  name: string,
  node: OrderedNode,
  sharesParagraph: boolean,
): ImportedDrawing {
  return {
    size: extentIn(node),
    crop: srcRectCrop(node),
    placement: name === "inline" ? inlinePlacement : anchorPlacement(node),
    sharesParagraph,
  };
}

const inlinePlacement: DrawingPlacement = {
  wrap: null,
  floating: false,
  represented: true,
};

function anchorPlacement(node: OrderedNode): DrawingPlacement {
  const wrap = findTag(node, [
    "wrapSquare",
    "wrapTight",
    "wrapThrough",
    "wrapTopAndBottom",
    "wrapNone",
  ]);
  if (!wrap || wrap.name === "wrapNone")
    return { wrap: null, floating: true, represented: false };
  if (wrap.name === "wrapTopAndBottom")
    return { wrap: "break", floating: true, represented: true };
  return {
    wrap: squareSide(node, wrap.attrs),
    floating: true,
    represented: true,
  };
}

function squareSide(
  node: OrderedNode,
  wrapAttrs: string,
): Extract<ImageWrap, "left" | "right"> {
  const position = findTag(node, ["positionH"]);
  const align = position
    ? textOf(position.node).match(/\b(left|right|center)\b/)?.[1]
    : undefined;
  if (align === "right") return "right";
  if (align === "left") return "left";
  const offset = position
    ? textOf(position.node).match(/(-?\d+)/)?.[1]
    : undefined;
  if (offset && Number(offset) > 3_000_000) return "right";
  const side = /\bwrapText="(left|right|bothSides|largest)"/.exec(wrapAttrs);
  if (side?.[1] === "left") return "right";
  if (side?.[1] === "right") return "left";
  return "left";
}

function srcRectCrop(node: OrderedNode): ImageCrop | null {
  const rect = findTag(node, ["srcRect"]);
  if (!rect) return null;
  const crop = imageCropFromSrcRect({
    l: attr(rect.node, "l"),
    t: attr(rect.node, "t"),
    r: attr(rect.node, "r"),
    b: attr(rect.node, "b"),
  });
  return imageCropActive(crop) ? crop : null;
}

function findTag(
  node: OrderedNode,
  names: string[],
): { name: string; node: OrderedNode; attrs: string } | null {
  let found: { name: string; node: OrderedNode; attrs: string } | null = null;
  const walk = (current: OrderedNode) => {
    if (found) return;
    const name = tag(current);
    if (name && names.includes(name)) {
      const wrapText = attr(current, "wrapText");
      found = {
        name,
        node: current,
        attrs: wrapText ? ` wrapText="${wrapText}"` : "",
      };
      return;
    }
    for (const child of childNodes(current)) walk(child);
  };
  walk(node);
  return found;
}

function textOf(node: OrderedNode): string {
  const name = tag(node);
  if (!name) return "";
  const value = node[name];
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((child) => textOf(child as OrderedNode)).join("");
}

function pageSizes(nodes: OrderedNode[]): ImagePageSize[] {
  const sizes: ImagePageSize[] = [];
  for (const node of nodes) {
    const name = tag(node);
    if (!name || name === ":@") continue;
    // Deleted runs and moves are ignored by Mammoth, so they emit no picture.
    if (name === "del" || name === "moveFrom") continue;
    if (name === "tr" && rowDeleted(node)) continue;
    if (name === "AlternateContent") {
      sizes.push(...alternateSizes(node));
      continue;
    }
    if (name === "inline" || name === "anchor") {
      const size = extentIn(node);
      const blips = countTags(node, "blip");
      for (let i = 0; i < blips; i++) sizes.push(size);
      continue;
    }
    if (name === "imagedata") {
      sizes.push(null);
      continue;
    }
    sizes.push(...pageSizes(childNodes(node)));
  }
  return sizes;
}

function alternateSizes(node: OrderedNode): ImagePageSize[] {
  const choice = childNodes(node).find((part) => tag(part) === "Choice");
  const fallback = childNodes(node).find((part) => tag(part) === "Fallback");
  const fallen = fallback ? pageSizes(childNodes(fallback)) : [];
  if (!fallen.length) return [];
  const chosen = choice ? pageSizes(childNodes(choice)) : [];
  return fallen.map((size, index) => size ?? chosen[index] ?? null);
}

function extentIn(node: OrderedNode): ImagePageSize {
  let found: ImagePageSize = null;
  const walk = (current: OrderedNode) => {
    if (found) return;
    if (tag(current) === "extent") {
      const width = pixels(attr(current, "cx"));
      const height = pixels(attr(current, "cy"));
      if (width && height) found = { width, height };
      return;
    }
    for (const child of childNodes(current)) walk(child);
  };
  walk(node);
  return found;
}

function countTags(node: OrderedNode, name: string): number {
  let count = 0;
  const walk = (current: OrderedNode) => {
    if (tag(current) === name) count++;
    for (const child of childNodes(current)) walk(child);
  };
  for (const child of childNodes(node)) walk(child);
  return count;
}

function rowDeleted(node: OrderedNode): boolean {
  return childNodes(node).some(
    (child) =>
      tag(child) === "trPr" &&
      childNodes(child).some((prop) => tag(prop) === "del"),
  );
}

function pixels(emu: string | undefined): number | null {
  if (!emu) return null;
  const value = Number(emu);
  if (!Number.isFinite(value) || value <= 0) return null;
  const px = Math.round(value / EMU_PER_CSS_PIXEL);
  return px > 0 ? px : null;
}

function tag(node: OrderedNode): string | null {
  const name = Object.keys(node).find((key) => key !== ":@");
  return name ?? null;
}

function childNodes(node: OrderedNode): OrderedNode[] {
  const name = tag(node);
  if (!name) return [];
  const value = node[name];
  return Array.isArray(value) ? (value as OrderedNode[]) : [];
}

function attr(node: OrderedNode, name: string): string | undefined {
  const attrs = node[":@"];
  if (!attrs || typeof attrs !== "object") return undefined;
  const value = (attrs as Record<string, unknown>)[`@_${name}`];
  return value == null ? undefined : String(value);
}
