import { XMLParser } from "fast-xml-parser";
import type { JsonNode } from "./index";

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
