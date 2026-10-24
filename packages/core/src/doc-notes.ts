import type { JsonNode } from "./index";

export type NoteKind = "footnote" | "endnote";

export type ImportedNote = {
  kind: NoteKind;
  /** Stable id shared by the marker and the note body. */
  id: string;
  /** Marker label in reading order: "1" or "i". */
  label: string;
  text: string;
};

export type ImportedToc = {
  pageNumbers: boolean;
  /** 1 or 3. Word's \o range is clamped to the heading levels the editor styles. */
  maxLevel: number;
};

const TOKEN =
  /SLFN(\d+)END|SLEN(\d+)END|SLTOC(\d)([PL])/g;

/** Lower-case roman, matching Word's default endnote format and the importer's text check. */
export function toRoman(n: number): string {
  const romans: [number, string][] = [
    [1000, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let rest = Math.max(0, Math.floor(n));
  let out = "";
  for (const [val, sym] of romans) {
    while (rest >= val) {
      out += sym;
      rest -= val;
    }
  }
  return out || String(n);
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Paragraph text the same way the Word importer reads body paragraphs, so a removed TOC line can be dropped from the missing-text check. */
function paragraphTexts(xml: string): string[] {
  const out: string[] = [];
  for (const match of xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)) {
    const body = match[0].replace(/<w:instrText\b[\s\S]*?<\/w:instrText>/g, "");
    let text = "";
    for (const part of body.matchAll(
      /<w:(t|tab|br)\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:\1>)/g,
    )) {
      if (part[1] === "tab") text += "\t";
      else if (part[1] === "br") text += "\n";
      else text += decodeXml(part[2] ?? "");
    }
    if (text.trim()) out.push(text);
  }
  return out;
}

function paragraphsOf(inner: string): string {
  return inner
    .split(/<\/w:p>/i)
    .map((part) =>
      [...part.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
        .map((m) => decodeXml(m[1]))
        .join(""),
    )
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function readNotePart(xml: string, tag: "footnote" | "endnote"): Map<string, string> {
  const map = new Map<string, string>();
  if (!xml) return map;
  const re = new RegExp(`<w:${tag}\\b([^>]*)>([\\s\\S]*?)</w:${tag}>`, "g");
  for (const match of xml.matchAll(re)) {
    const id = /w:id="([^"]+)"/.exec(match[1])?.[1];
    if (!id || id === "-1" || id === "0") continue;
    const inner = match[2].replace(/<w:(?:footnote|endnote)Ref\b[^>]*\/>/g, "");
    map.set(id, paragraphsOf(inner));
  }
  return map;
}

function replaceReferences(
  xml: string,
  tag: "footnoteReference" | "endnoteReference",
  token: "SLFN" | "SLEN",
): { xml: string; ids: string[] } {
  const ids: string[] = [];
  const next = xml.replace(
    new RegExp(`<(?:\\w+:)?${tag}\\b([^>]*?)(?:/>|></(?:\\w+:)?${tag}>)`, "g"),
    (_whole, attrs: string) => {
      ids.push(/w:id="([^"]+)"/.exec(attrs)?.[1] ?? String(ids.length + 1));
      // A terminator keeps adjacent literal digits out of the reference number.
      return `<w:t xml:space="preserve">${token}${ids.length}END</w:t>`;
    },
  );
  return { xml: next, ids };
}

function paragraphOpen(xml: string, before: number): number {
  const matches = [...xml.slice(0, before).matchAll(/<w:p(?=[\s>])/g)];
  return matches.length ? (matches[matches.length - 1].index ?? -1) : -1;
}

/** Index of the fldChar end that closes the field whose begin is at `beginAt`. */
function closingField(xml: string, beginAt: number): number {
  const re = /w:fldCharType="(begin|end)"/g;
  re.lastIndex = beginAt;
  let depth = 0;
  for (const match of xml.matchAll(re)) {
    depth += match[1] === "begin" ? 1 : -1;
    if (depth === 0) return match.index ?? -1;
  }
  return -1;
}

function tocFromInstruction(text: string): ImportedToc {
  const instruction = decodeXml(text);
  const range = /\\o\s+"(\d+)\s*-\s*(\d+)"/.exec(instruction);
  const maxLevel = range ? Math.min(3, Math.max(1, Number(range[2]))) : 3;
  const omitted = /\\n(?:\s+"(\d+)\s*-\s*(\d+)")?/.exec(instruction);
  const pageNumbers = !(
    omitted &&
    (!omitted[1] || omitted[1] === "1")
  );
  return { pageNumbers, maxLevel: maxLevel === 2 ? 3 : maxLevel };
}

/**
 * Turn Word footnote/endnote references and TOC fields into tokens Mammoth
 * keeps as text. Note bodies stay in footnotes.xml / endnotes.xml; the cached
 * TOC paragraphs are returned so the importer can drop them from the
 * "missing text" check instead of pasting a stale contents page.
 */
export function rewriteWordNotes(
  documentXml: string,
  footnotesXml = "",
  endnotesXml = "",
): {
  xml: string;
  notes: ImportedNote[];
  tocs: ImportedToc[];
  removedParagraphs: string[];
  changed: boolean;
} {
  const footnoteTexts = readNotePart(footnotesXml, "footnote");
  const endnoteTexts = readNotePart(endnotesXml, "endnote");
  const footnotes = replaceReferences(documentXml, "footnoteReference", "SLFN");
  const endnotes = replaceReferences(footnotes.xml, "endnoteReference", "SLEN");
  const notes: ImportedNote[] = [
    ...footnotes.ids.map((wordId, i) => ({
      kind: "footnote" as const,
      id: `f${i + 1}`,
      label: String(i + 1),
      text: footnoteTexts.get(wordId) ?? "",
    })),
    ...endnotes.ids.map((wordId, i) => ({
      kind: "endnote" as const,
      id: `e${i + 1}`,
      label: toRoman(i + 1),
      text: endnoteTexts.get(wordId) ?? "",
    })),
  ];

  const removedParagraphs: string[] = [];
  const tocs: ImportedToc[] = [];
  let xml = endnotes.xml;
  const spans: { start: number; end: number; toc: ImportedToc }[] = [];
  for (const match of xml.matchAll(/<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>/g)) {
    if (!/\bTOC\b/.test(decodeXml(match[1]))) continue;
    const at = match.index ?? 0;
    const windowStart = Math.max(0, at - 8000);
    const beginRel = xml.slice(windowStart, at).lastIndexOf('w:fldCharType="begin"');
    if (beginRel < 0) continue;
    const beginAt = windowStart + beginRel;
    const endAt = closingField(xml, beginAt);
    if (endAt < 0) continue;
    const regionStart = paragraphOpen(xml, beginAt);
    const endPara = xml.indexOf("</w:p>", endAt);
    if (regionStart < 0 || endPara < 0) continue;
    const regionEnd = endPara + "</w:p>".length;
    if (spans.some((s) => regionStart < s.end && regionEnd > s.start)) continue;
    const fragment = xml.slice(regionStart, regionEnd);
    removedParagraphs.push(...paragraphTexts(fragment));
    spans.push({ start: regionStart, end: regionEnd, toc: tocFromInstruction(match[1]) });
  }
  spans.sort((a, b) => b.start - a.start);
  for (const span of spans) {
    const token = `SLTOC${span.toc.maxLevel}${span.toc.pageNumbers ? "P" : "L"}`;
    xml =
      xml.slice(0, span.start) +
      `<w:p><w:r><w:t>${token}</w:t></w:r></w:p>` +
      xml.slice(span.end);
    tocs.unshift(span.toc);
  }
  return {
    xml,
    notes,
    tocs,
    removedParagraphs,
    changed: xml !== documentXml,
  };
}

function plain(node: JsonNode): string {
  return (node.text ?? "") + (node.content ?? []).map(plain).join("");
}

function splitText(node: JsonNode): JsonNode[] {
  const text = node.text ?? "";
  TOKEN.lastIndex = 0;
  if (!TOKEN.test(text)) return [node];
  TOKEN.lastIndex = 0;
  const out: JsonNode[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) {
      const slice = text.slice(last, index);
      if (slice)
        out.push({ type: "text", text: slice, ...(node.marks ? { marks: node.marks } : {}) });
    }
    if (match[1])
      out.push({
        type: "noteReference",
        attrs: { id: `f${match[1]}`, kind: "footnote", label: match[1] },
      });
    else if (match[2])
      out.push({
        type: "noteReference",
        attrs: { id: `e${match[2]}`, kind: "endnote", label: toRoman(Number(match[2])) },
      });
    else
      out.push({
        type: "tableOfContents",
        attrs: {
          maxLevel: Number(match[3]) === 1 ? 1 : 3,
          pageNumbers: match[4] === "P",
        },
      });
    last = index + match[0].length;
  }
  if (last < text.length) {
    const slice = text.slice(last);
    if (slice)
      out.push({ type: "text", text: slice, ...(node.marks ? { marks: node.marks } : {}) });
  }
  return out.length ? out : [node];
}

function liftBlocks(nodes: JsonNode[]): JsonNode[] {
  const out: JsonNode[] = [];
  for (const node of nodes) {
    const content = node.content ? liftBlocks(node.content.flatMap(rewriteInline)) : undefined;
    const next = content ? { ...node, content } : node;
    if (
      next.type === "paragraph" &&
      next.content?.some((child) => child.type === "tableOfContents")
    ) {
      let inline: JsonNode[] = [];
      const flush = () => {
        if (inline.some((child) => child.type !== "text" || child.text))
          out.push({ ...next, content: inline });
        inline = [];
      };
      for (const child of next.content) {
        if (child.type === "tableOfContents") {
          flush();
          out.push(child);
        } else inline.push(child);
      }
      flush();
      continue;
    }
    out.push(next);
  }
  return out;
}

function rewriteInline(node: JsonNode): JsonNode[] {
  if (node.type === "text") return splitText(node);
  if (!node.content) return [node];
  return [{ ...node, content: node.content.flatMap(rewriteInline) }];
}

function noteContent(text: string): JsonNode[] {
  const parts = text.split("\n").filter((part) => part.length > 0);
  if (!parts.length) return [{ type: "paragraph" }];
  return parts.map((part) => ({
    type: "paragraph",
    content: [{ type: "text", text: part }],
  }));
}

/**
 * Replace import tokens with linked note markers, a live table of contents,
 * and note bodies. Markers that Mammoth left as superscript links are already
 * tokens by the time this runs.
 */
export function applyImportedNotes(
  content: JsonNode,
  notes: ImportedNote[],
): { content: JsonNode; footnotes: number; endnotes: number; tocs: number } {
  const blocks = liftBlocks(content.content ?? []);
  const seen = new Set<string>();
  const walk = (node: JsonNode) => {
    if (node.type === "noteReference") seen.add(String(node.attrs?.id ?? ""));
    node.content?.forEach(walk);
  };
  blocks.forEach(walk);
  for (const note of notes) {
    if (!seen.has(note.id)) continue;
    blocks.push({
      type: "note",
      attrs: { id: note.id, kind: note.kind, label: note.label },
      content: noteContent(note.text),
    });
  }
  const tocs = blocks.filter((node) => node.type === "tableOfContents").length;
  return {
    content: { ...content, content: blocks.length ? blocks : [{ type: "paragraph" }] },
    footnotes: notes.filter((note) => note.kind === "footnote" && seen.has(note.id)).length,
    endnotes: notes.filter((note) => note.kind === "endnote" && seen.has(note.id)).length,
    tocs,
  };
}

/** The import banner phrase, e.g. "4 footnotes, 1 endnote, 1 table of contents". */
export function notesImportSummary(counts: {
  footnotes: number;
  endnotes: number;
  tocs: number;
}): string {
  const parts: string[] = [];
  if (counts.footnotes)
    parts.push(`${counts.footnotes} footnote${counts.footnotes === 1 ? "" : "s"}`);
  if (counts.endnotes)
    parts.push(`${counts.endnotes} endnote${counts.endnotes === 1 ? "" : "s"}`);
  if (counts.tocs)
    parts.push(`${counts.tocs} table${counts.tocs === 1 ? "" : "s"} of contents`);
  return parts.join(", ");
}

export function notePlainText(node: JsonNode): string {
  return plain(node);
}
