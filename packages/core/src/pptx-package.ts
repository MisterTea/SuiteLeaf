import type JSZip from "jszip";

function xmlCharacter(code: number, fallback: string): string {
  return Number.isInteger(code) &&
    code > 0 &&
    code <= 0x10ffff &&
    !(code >= 0xd800 && code <= 0xdfff)
    ? String.fromCodePoint(code)
    : fallback;
}

export function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (entity, n) => xmlCharacter(+n, entity))
    .replace(/&#x([0-9a-fA-F]+);/g, (entity, h) =>
      xmlCharacter(parseInt(h, 16), entity),
    )
    .replace(/&amp;/g, "&");
}

/** The picture description a person wrote. Internal SuiteLeaf markers stay out of the alt text. */
export function pictureAlt(xml: string): string {
  const raw = /<p:cNvPr\b[^>]*\bdescr="([^"]*)"/.exec(xml)?.[1];
  if (!raw) return "Slide image";
  const text = decodeXmlEntities(raw).trim();
  if (!text || text.startsWith("SuiteLeaf ")) return "Slide image";
  return text;
}

export function parseXmlAttrs(tagStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const rx = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(tagStr)) !== null) {
    attrs[m[1]] = m[2] !== undefined ? m[2] : m[3];
  }
  return attrs;
}

export function resolveZipPath(basePath: string, relativePath: string): string {
  if (relativePath.startsWith("/")) return relativePath.slice(1);
  const parts = basePath.split("/");
  parts.pop(); // remove filename
  for (const seg of relativePath.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== "." && seg !== "") parts.push(seg);
  }
  return parts.join("/");
}
// Parse Relationships XML
export function parseRels(
  xml: string,
): Record<string, { target: string; type: string }> {
  const rels: Record<string, { target: string; type: string }> = {};
  const rx = /<Relationship\b([^>]*)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(xml)) !== null) {
    const attrs = parseXmlAttrs(m[1]);
    if (attrs.Id && attrs.Target) {
      rels[attrs.Id] = { target: attrs.Target, type: attrs.Type || "" };
    }
  }
  return rels;
}

export type PptxPart = {
  path: string;
  xml: string;
  rels: ReturnType<typeof parseRels>;
};

export async function readRelatedPart(
  zip: JSZip,
  ownerPath: string,
  relationships: ReturnType<typeof parseRels>,
  kind: string,
): Promise<PptxPart | undefined> {
  const relation = Object.values(relationships).find((rel) =>
    rel.type.endsWith(`/${kind}`),
  );
  if (!relation) return undefined;
  const partPath = resolveZipPath(ownerPath, relation.target);
  const part = zip.file(partPath);
  if (!part) return undefined;
  const relPath = partPath.replace(/([^/]+)$/, "_rels/$1.rels");
  const relFile = zip.file(relPath);
  return {
    path: partPath,
    xml: await part.async("string"),
    rels: relFile ? parseRels(await relFile.async("string")) : {},
  };
}
