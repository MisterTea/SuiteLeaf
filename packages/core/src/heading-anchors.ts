/**
 * Links within a document. SuiteLeaf links to a heading by `#<slug>`, where the
 * slug comes from the heading's text. Word links to a named bookmark. Import
 * turns a link to a bookmark inside a heading into a link to that heading.
 * Export puts a bookmark on each heading a link points at and writes the link
 * as an internal hyperlink.
 */
import type { JsonNode } from "./index";

/** Turn heading text into a deterministic, URL-friendly slug. */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return slug || "heading";
}

const textOf = (node: JsonNode): string => (node.text ?? "") + (node.content ?? []).map(textOf).join("");

/**
 * Word bookmark names allow letters, digits, and underscores, start with a
 * letter, and hold at most 40 characters. The slug's hyphens become
 * underscores, and a short hash keeps two long slugs apart.
 */
export function bookmarkName(slug: string): string {
  const base = `h_${slug.replace(/[^A-Za-z0-9]+/g, "_")}`;
  if (base.length <= 40) return base;
  let hash = 0;
  for (const ch of slug) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `${base.slice(0, 32)}_${hash.toString(36).slice(0, 7)}`;
}

/**
 * Bookmark names in each paragraph of a Word body, with that paragraph's text.
 * Whether the paragraph is a heading is decided later, by the imported
 * document: Word styles can be renamed or localized, so their names are not
 * trusted here.
 */
export function headingBookmarks(documentXml: string): { names: string[]; text: string }[] {
  const out: { names: string[]; text: string }[] = [];
  for (const match of documentXml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)) {
    const names = [...match[1]!.matchAll(/<w:bookmarkStart\b[^>]*w:name="([^"]+)"/g)]
      .map((m) => m[1]!)
      .filter((name) => name !== "_GoBack");
    if (!names.length) continue;
    const text = [...match[1]!.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");
    out.push({ names, text });
  }
  return out;
}

/**
 * Point each link to a Word bookmark inside a heading at that heading's slug.
 * Returns how many links changed and how many internal links still point at a
 * bookmark that is not on a heading, which SuiteLeaf cannot follow.
 */
export function relinkWordBookmarks(content: JsonNode, documentXml: string): { relinked: number; unresolved: number } {
  const slugs = new Map<string, string>();
  for (const { names, text } of headingBookmarks(documentXml)) {
    if (!text.trim()) continue;
    for (const name of names) if (!slugs.has(name)) slugs.set(name, slugify(text));
  }
  const headings = new Set<string>();
  const collect = (node: JsonNode) => {
    if (node.type === "heading") headings.add(slugify(textOf(node)));
    for (const child of node.content ?? []) collect(child);
  };
  collect(content);
  let relinked = 0;
  let unresolved = 0;
  const visit = (node: JsonNode) => {
    for (const mark of node.marks ?? []) {
      if (mark.type !== "link") continue;
      const href = String(mark.attrs?.href ?? "");
      if (!href.startsWith("#") || href.length < 2) continue;
      const target = slugs.get(href.slice(1));
      if (target && headings.has(target)) {
        if (href !== `#${target}`) {
          mark.attrs = { ...mark.attrs, href: `#${target}` };
          relinked += 1;
        }
      } else if (!headings.has(href.slice(1))) unresolved += 1;
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(content);
  return { relinked, unresolved };
}

/** Slugs that a `#<slug>` link points at and that a heading in the document has. */
export function linkedHeadingSlugs(content: JsonNode): Set<string> {
  const targets = new Set<string>();
  const headings = new Set<string>();
  const visit = (node: JsonNode) => {
    if (node.type === "heading") headings.add(slugify(textOf(node)));
    for (const mark of node.marks ?? []) {
      const href = mark.type === "link" ? String(mark.attrs?.href ?? "") : "";
      if (href.startsWith("#") && href.length > 1) targets.add(href.slice(1));
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(content);
  return new Set([...targets].filter((slug) => headings.has(slug)));
}
