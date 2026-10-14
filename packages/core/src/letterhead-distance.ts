import { MARGIN_DEFAULT_PX } from "./document-layout";
import { EDGE_MIN_PX, formatEdgeInches, resolveEdgePx } from "./header-edge";
import {
  firstSectionEdgeDistances,
  type WordPageEdges,
} from "./word-page-margins";

/**
 * Header and footer distance from a Word section, in the existing
 * headerFromEdge and footerFromEdge fields. Body margins are not part of
 * this patch. An attribute Word omitted stays unset, so the current default
 * (the body margin, when no distance was saved) still applies.
 */
export function letterheadDistancePatch(
  documentXml: string,
  margins: WordPageEdges | null,
): { headerFromEdge?: number; footerFromEdge?: number } | null {
  const edges = firstSectionEdgeDistances(documentXml);
  if (!edges) return null;
  const marginTop = margins?.marginTop ?? MARGIN_DEFAULT_PX;
  const marginBottom = margins?.marginBottom ?? MARGIN_DEFAULT_PX;
  const patch: { headerFromEdge?: number; footerFromEdge?: number } = {};
  if (
    edges.headerFromEdge != null &&
    edges.headerFromEdge >= EDGE_MIN_PX - 0.5
  )
    patch.headerFromEdge = resolveEdgePx(edges.headerFromEdge, marginTop);
  if (
    edges.footerFromEdge != null &&
    edges.footerFromEdge >= EDGE_MIN_PX - 0.5
  )
    patch.footerFromEdge = resolveEdgePx(edges.footerFromEdge, marginBottom);
  return patch.headerFromEdge == null && patch.footerFromEdge == null
    ? null
    : patch;
}

/** Shown on the import line so the distance is visible before anyone opens Page setup. */
export function letterheadDistanceNote(
  distances: { headerFromEdge?: number; footerFromEdge?: number } | null,
): string | null {
  if (!distances) return null;
  const parts: string[] = [];
  if (distances.headerFromEdge != null)
    parts.push(`header ${formatEdgeInches(distances.headerFromEdge)} in`);
  if (distances.footerFromEdge != null)
    parts.push(`footer ${formatEdgeInches(distances.footerFromEdge)} in`);
  if (!parts.length) return null;
  return `Letterhead: ${parts.join(", ")} from the edge`;
}

export type LetterheadText = {
  header?: string;
  footer?: string;
  /** Zip paths whose plain text is now the page header or footer. */
  absorbed: Set<string>;
};

type ZipReader = {
  file(path: string): { async(kind: "string"): Promise<string> } | null;
};

const sectionPattern =
  /<(?:[\w.-]+:)?sectPr\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?sectPr>/;

function decodeXml(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Plain paragraphs from a header or footer part. Drawings, text boxes, and
 * tabs are left out: this story only places the letterhead's words.
 */
export function furniturePlainText(xml: string): string {
  const stripped = xml
    .replace(/<(?:[\w.-]+:)?drawing\b[\s\S]*?<\/(?:[\w.-]+:)?drawing>/g, "")
    .replace(/<(?:[\w.-]+:)?pict\b[\s\S]*?<\/(?:[\w.-]+:)?pict>/g, "")
    .replace(
      /<(?:[\w.-]+:)?txbxContent\b[\s\S]*?<\/(?:[\w.-]+:)?txbxContent>/g,
      "",
    );
  const lines: string[] = [];
  for (const paragraph of stripped.matchAll(
    /<(?:[\w.-]+:)?p\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?p>/g,
  )) {
    const text = [...paragraph[1].matchAll(/<(?:[\w.-]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?t>/g)]
      .map((part) => decodeXml(part[1]))
      .join("")
      .replace(/\t/g, "")
      .trim();
    if (text) lines.push(text);
  }
  return lines.join("\n").slice(0, 500);
}

function referenceId(sectionXml: string, kind: "header" | "footer"): string | undefined {
  const tags = [
    ...sectionXml.matchAll(
      new RegExp(`<(?:[\\w.-]+:)?${kind}Reference\\b([^>]*)\\/?>`, "g"),
    ),
  ].map((tag) => tag[1]);
  const chosen =
    tags.find((attrs) => /(?:[\w.-]+:)?type=["']default["']/.test(attrs)) ??
    tags.find((attrs) => !/(?:[\w.-]+:)?type=/.test(attrs));
  if (!chosen) return undefined;
  return chosen.match(/(?:[\w.-]+:)?id=["']([^"']+)["']/)?.[1];
}

function relationshipTarget(relsXml: string, id: string): string | undefined {
  for (const tag of relsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const found = tag[1].match(/\bId=["']([^"']+)["']/);
    if (found?.[1] !== id) continue;
    return tag[1].match(/\bTarget=["']([^"']+)["']/)?.[1];
  }
  return undefined;
}

function wordPart(target: string): string {
  let clean = target.split("?")[0].replace(/\\/g, "/");
  try {
    clean = decodeURIComponent(clean);
  } catch {
    // Keep the raw target when it is not percent-encoded.
  }
  if (clean.startsWith("/")) clean = clean.slice(1);
  if (clean.startsWith("./")) clean = clean.slice(2);
  if (clean.startsWith("../")) clean = clean.slice(3);
  if (!clean.startsWith("word/")) clean = `word/${clean}`;
  return clean.replace(/^\/+/, "");
}

async function partText(zip: ZipReader, path: string): Promise<string | undefined> {
  const file = zip.file(path);
  if (!file) return undefined;
  try {
    return furniturePlainText(await file.async("string"));
  } catch {
    return undefined;
  }
}

/**
 * Plain text of the first section's default header and footer.
 * A different first page or an even page keeps its own part; this one
 * distance uses the default letterhead only.
 */
export async function readDefaultLetterhead(
  zip: ZipReader,
  documentXml: string,
): Promise<LetterheadText> {
  const absorbed = new Set<string>();
  const section = documentXml.match(sectionPattern);
  if (!section) return { absorbed };
  const relsFile = zip.file("word/_rels/document.xml.rels");
  if (!relsFile) return { absorbed };
  let rels = "";
  try {
    rels = await relsFile.async("string");
  } catch {
    return { absorbed };
  }
  const result: LetterheadText = { absorbed };
  for (const kind of ["header", "footer"] as const) {
    const id = referenceId(section[0], kind);
    if (!id) continue;
    const target = relationshipTarget(rels, id);
    if (!target) continue;
    const path = wordPart(target);
    const text = await partText(zip, path);
    if (!text) continue;
    if (kind === "header") result.header = text;
    else result.footer = text;
    absorbed.add(path);
  }
  return result;
}
