import JSZip from "jszip";
import type { JsonNode } from "./index";

/** The three styles Google Docs offers. APA is the default. */
export type CitationStyle = "apa" | "mla" | "chicago";
export type SourceKind = "book" | "article";

export type CitationSource = {
  id: string;
  /** Word CITATION field tag. Stable when the year changes. */
  tag: string;
  guid: string;
  kind: SourceKind;
  author: string;
  title: string;
  year: string;
  /** Optional page. Empty means the citation has no page, and never a "#" stand-in. */
  page: string;
};

export type CitationLibrary = {
  style: CitationStyle;
  sources: CitationSource[];
};

export type BibRun = { text: string; italic?: boolean };

const BIBLIOGRAPHY_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/bibliography";

export function citationLibrary(doc: {
  attrs?: Record<string, unknown> | null;
}): CitationLibrary {
  const style = doc.attrs?.citationStyle;
  const raw = doc.attrs?.citationSources;
  return {
    style: style === "mla" || style === "chicago" ? style : "apa",
    sources: Array.isArray(raw) ? raw.filter(isSource) : [],
  };
}

function isSource(value: unknown): value is CitationSource {
  if (!value || typeof value !== "object") return false;
  const source = value as Partial<CitationSource>;
  if (typeof source.id !== "string" || !source.id) return false;
  if (typeof source.author !== "string") return false;
  if (typeof source.title !== "string") return false;
  if (typeof source.year !== "string") return false;
  if (source.kind !== "book" && source.kind !== "article") return false;
  if (typeof source.tag !== "string") source.tag = source.id;
  if (typeof source.guid !== "string") source.guid = "";
  if (typeof source.page !== "string") source.page = "";
  return true;
}

export function createSource(
  input: {
    kind: SourceKind;
    author: string;
    title: string;
    year: string;
    page?: string;
  },
  existing: CitationSource[],
): CitationSource {
  const author = input.author.trim();
  const year = input.year.trim();
  return {
    id: `c${Math.random().toString(36).slice(2, 10)}`,
    tag: uniqueTag(author, year, existing.map((source) => source.tag)),
    guid: `{${crypto.randomUUID().toUpperCase()}}`,
    kind: input.kind,
    author,
    title: input.title.trim(),
    year,
    page: (input.page ?? "").trim(),
  };
}

function uniqueTag(author: string, year: string, taken: string[]): string {
  const last = author.split(/\s+/).filter(Boolean).pop() ?? "Src";
  const stem =
    (last.replace(/[^A-Za-z]/g, "").slice(0, 3) || "Src") +
    year.replace(/\D/g, "").slice(-2);
  let tag = stem || "Src";
  let n = 2;
  while (taken.includes(tag)) tag = `${stem}${n++}`;
  return tag;
}

/** In-text citation. A blank page is omitted; the result never contains "#". */
export function inText(source: CitationSource, style: CitationStyle): string {
  const author = source.author.trim() || "Unknown";
  const year = source.year.trim();
  const page = source.page.trim();
  if (style === "mla") return page ? `(${author} ${page})` : `(${author})`;
  if (style === "chicago") {
    const core = year ? `${author} ${year}` : author;
    return page ? `(${core}, ${page})` : `(${core})`;
  }
  const core = year ? `${author}, ${year}` : author;
  return page ? `(${core}, p. ${page})` : `(${core})`;
}

export function bibliographyTitle(style: CitationStyle): string {
  return style === "mla" ? "Works Cited" : "References";
}

export function bibliographyRuns(
  source: CitationSource,
  style: CitationStyle,
): BibRun[] {
  const author = source.author.trim() || "Unknown";
  const year = source.year.trim();
  const title = source.title.trim() || "Untitled";
  if (source.kind === "article" && style !== "apa") {
    const quoted = `"${title}."`;
    if (style === "mla")
      return [
        { text: `${author}. ` },
        { text: quoted },
        { text: year ? ` ${year}.` : "" },
      ];
    return [
      { text: year ? `${author}. ${year}. ` : `${author}. ` },
      { text: quoted },
    ];
  }
  const titleRun: BibRun = { text: title, italic: source.kind === "book" };
  if (style === "mla")
    return [
      { text: `${author}. ` },
      titleRun,
      { text: year ? `. ${year}.` : "." },
    ];
  if (style === "chicago")
    return [
      { text: year ? `${author}. ${year}. ` : `${author}. ` },
      titleRun,
      { text: "." },
    ];
  return [
    { text: year ? `${author}. (${year}). ` : `${author}. ` },
    titleRun,
    { text: "." },
  ];
}

export function bibliographyPlain(
  source: CitationSource,
  style: CitationStyle,
): string {
  return bibliographyRuns(source, style)
    .map((run) => run.text)
    .join("");
}

export function citedSources(
  doc: JsonNode,
  sources: CitationSource[],
): CitationSource[] {
  const used = new Set<string>();
  const walk = (node: JsonNode) => {
    if (node.type === "citation") used.add(String(node.attrs?.sourceId ?? ""));
    else node.content?.forEach(walk);
  };
  walk(doc);
  return sources
    .filter((source) => used.has(source.id))
    .slice()
    .sort(
      (a, b) =>
        a.author.localeCompare(b.author, undefined, { sensitivity: "base" }) ||
        a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
    );
}

export function citationsImportSummary(counts: {
  citations: number;
  bibliographies: number;
}): string {
  const parts: string[] = [];
  if (counts.citations)
    parts.push(
      `${counts.citations} citation${counts.citations === 1 ? "" : "s"}`,
    );
  if (counts.bibliographies)
    parts.push(
      `${counts.bibliographies} ${counts.bibliographies === 1 ? "bibliography" : "bibliographies"}`,
    );
  return parts.join(", ");
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function attr(attrs: string, name: string): string {
  return decodeXml(new RegExp(`${name}="([^"]*)"`).exec(attrs)?.[1] ?? "");
}

const STYLE_FILE: Record<CitationStyle, { name: string; file: string }> = {
  apa: { name: "APA", file: "\\APASixthEditionOfficeOnline.xsl" },
  mla: { name: "MLA", file: "\\MLASeventhEditionOfficeOnline.xsl" },
  chicago: { name: "Chicago", file: "\\CHICAGO.XSL" },
};

function styleFromName(name: string): CitationStyle {
  const value = name.toLowerCase();
  if (value.includes("mla")) return "mla";
  if (value.includes("chicago")) return "chicago";
  return "apa";
}

/** Sources Word's citation manager reads from the bibliography custom XML part. */
export function bibliographyXml(
  sources: CitationSource[],
  style: CitationStyle,
): string {
  const picked = STYLE_FILE[style];
  const body = sources
    .map((source) => {
      const pages = source.page.trim()
        ? `<b:Pages>${xmlEscape(source.page.trim())}</b:Pages>`
        : "";
      return `<b:Source><b:Tag>${xmlEscape(source.tag)}</b:Tag><b:SourceType>${source.kind === "article" ? "JournalArticle" : "Book"}</b:SourceType><b:Guid>${xmlEscape(source.guid || `{${crypto.randomUUID().toUpperCase()}}`)}</b:Guid><b:Title>${xmlEscape(source.title)}</b:Title><b:Year>${xmlEscape(source.year)}</b:Year>${pages}<b:Author><b:Author><b:NameList><b:Person><b:Last>${xmlEscape(source.author)}</b:Last></b:Person></b:NameList></b:Author></b:Author></b:Source>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<b:Sources SelectedStyle="${xmlEscape(picked.file)}" StyleName="${picked.name}" xmlns:b="${BIBLIOGRAPHY_NS}" xmlns="${BIBLIOGRAPHY_NS}">${body}</b:Sources>`;
}

export function parseBibliographyXml(xml: string): CitationLibrary {
  if (!xml.includes("2006/bibliography"))
    return { style: "apa", sources: [] };
  const styleName =
    /<(?:b:)?Sources\b[^>]*\bStyleName="([^"]*)"/.exec(xml)?.[1] ??
    /<(?:b:)?Sources\b[^>]*\bSelectedStyle="([^"]*)"/.exec(xml)?.[1] ??
    "";
  const sources: CitationSource[] = [];
  for (const match of xml.matchAll(
    /<(?:b:)?Source\b[^>]*>([\s\S]*?)<\/(?:b:)?Source>/g,
  )) {
    const block = match[1];
    const text = (name: string) =>
      decodeXml(
        new RegExp(`<(?:b:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:b:)?${name}>`).exec(
          block,
        )?.[1] ?? "",
      ).trim();
    const tag = text("Tag");
    const author = text("Last");
    if (!tag && !author) continue;
    const type = text("SourceType");
    const id = tag || `c${sources.length + 1}`;
    sources.push({
      id,
      tag: tag || id,
      guid: text("Guid"),
      kind: /article/i.test(type) ? "article" : "book",
      author,
      title: text("Title"),
      year: text("Year"),
      page: text("Pages"),
    });
  }
  return { style: styleFromName(decodeXml(styleName)), sources };
}

function paragraphTexts(xml: string): string[] {
  const out: string[] = [];
  for (const match of xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)) {
    const body = match[0].replace(/<w:instrText\b[\s\S]*?<\/w:instrText>/g, "");
    let text = "";
    for (const part of body.matchAll(
      /<w:t\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:t>)/g,
    ))
      text += decodeXml(part[1] ?? "");
    if (text.trim() && text.trim() !== "SLBIB") out.push(text);
  }
  if (!out.length) {
    const text = [
      ...xml
        .replace(/<w:instrText\b[\s\S]*?<\/w:instrText>/g, "")
        .matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g),
    ]
      .map((part) => decodeXml(part[1]))
      .join("");
    if (text.trim() && text.trim() !== "SLBIB") out.push(text);
  }
  return out;
}

function paragraphOpen(xml: string, before: number): number {
  const matches = [...xml.slice(0, before).matchAll(/<w:p(?=[\s>])/g)];
  return matches.length ? (matches[matches.length - 1].index ?? -1) : -1;
}

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

function runOpen(xml: string, index: number): number {
  const before = xml.slice(0, index);
  return Math.max(before.lastIndexOf("<w:r>"), before.lastIndexOf("<w:r "));
}

/**
 * Turn Word CITATION and BIBLIOGRAPHY fields into tokens Mammoth keeps.
 * Cached bibliography lines are returned so the importer can drop them
 * instead of pasting a second, stale references list.
 */
export function rewriteWordCitations(xml: string): {
  xml: string;
  removedParagraphs: string[];
  changed: boolean;
} {
  const removed: string[] = [];
  let next = xml.replace(
    /<w:fldSimple\b([^>]*?)(?:\/>|>([\s\S]*?)<\/w:fldSimple>)/g,
    (whole, attrs: string, inner?: string) => {
      const instruction = attr(attrs, "w:instr");
      const cite = /\bCITATION\s+([A-Za-z0-9]+)/.exec(instruction);
      if (cite)
        return `<w:r><w:t xml:space="preserve">SLCITE${cite[1]}</w:t></w:r>`;
      if (/\bBIBLIOGRAPHY\b/.test(instruction)) {
        removed.push(...paragraphTexts(inner ?? ""));
        return `<w:r><w:t>SLBIB</w:t></w:r>`;
      }
      return whole;
    },
  );
  const spans: {
    start: number;
    end: number;
    replacement: string;
    removed: string[];
  }[] = [];
  for (const match of next.matchAll(
    /<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>/g,
  )) {
    const instruction = decodeXml(match[1]);
    const cite = /\bCITATION\s+([A-Za-z0-9]+)/.exec(instruction);
    const bibliography = /\bBIBLIOGRAPHY\b/.test(instruction);
    if (!cite && !bibliography) continue;
    const at = match.index ?? 0;
    const windowStart = Math.max(0, at - 8000);
    const beginRel = next
      .slice(windowStart, at)
      .lastIndexOf('w:fldCharType="begin"');
    if (beginRel < 0) continue;
    const beginAt = windowStart + beginRel;
    const endAt = closingField(next, beginAt);
    if (endAt < 0) continue;
    if (bibliography) {
      const regionStart = paragraphOpen(next, beginAt);
      const endPara = next.indexOf("</w:p>", endAt);
      if (regionStart < 0 || endPara < 0) continue;
      const regionEnd = endPara + "</w:p>".length;
      const fragment = next.slice(regionStart, regionEnd);
      spans.push({
        start: regionStart,
        end: regionEnd,
        replacement: `<w:p><w:r><w:t>SLBIB</w:t></w:r></w:p>`,
        removed: paragraphTexts(fragment),
      });
      continue;
    }
    const runStart = runOpen(next, beginAt);
    const runEnd = next.indexOf("</w:r>", endAt);
    if (runStart < 0 || runEnd < 0) continue;
    spans.push({
      start: runStart,
      end: runEnd + "</w:r>".length,
      replacement: `<w:r><w:t xml:space="preserve">SLCITE${cite![1]}</w:t></w:r>`,
      removed: [],
    });
  }
  const kept = spans.filter(
    (span) =>
      !spans.some(
        (other) =>
          other !== span &&
          other.start <= span.start &&
          other.end >= span.end &&
          other.end - other.start > span.end - span.start,
      ),
  );
  kept.sort((a, b) => b.start - a.start);
  for (const span of kept) {
    next = next.slice(0, span.start) + span.replacement + next.slice(span.end);
    removed.push(...span.removed);
  }
  return { xml: next, removedParagraphs: removed, changed: next !== xml };
}

const CITE_TOKEN = /SLCITE([A-Za-z0-9]+)/g;

function splitCites(node: JsonNode): JsonNode[] {
  if (node.type !== "text" || !node.text || !node.text.includes("SLCITE"))
    return [node];
  const text = node.text;
  CITE_TOKEN.lastIndex = 0;
  const out: JsonNode[] = [];
  let last = 0;
  for (const match of text.matchAll(CITE_TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) {
      const slice = text.slice(last, index);
      if (slice)
        out.push({
          type: "text",
          text: slice,
          ...(node.marks ? { marks: node.marks } : {}),
        });
    }
    out.push({ type: "citation", attrs: { sourceId: match[1] } });
    last = index + match[0].length;
  }
  if (last < text.length) {
    const slice = text.slice(last);
    if (slice)
      out.push({
        type: "text",
        text: slice,
        ...(node.marks ? { marks: node.marks } : {}),
      });
  }
  return out.length ? out : [node];
}

function rewriteBlocks(nodes: JsonNode[]): JsonNode[] {
  const out: JsonNode[] = [];
  for (const node of nodes) {
    const content = node.content
      ? rewriteBlocks(node.content.flatMap(splitCites))
      : undefined;
    const next = content ? { ...node, content } : node;
    if (next.type === "paragraph") {
      const text = (next.content ?? [])
        .map((child) => (child.type === "text" ? (child.text ?? "") : ""))
        .join("")
        .trim();
      const onlyBib =
        text === "SLBIB" &&
        (next.content ?? []).every(
          (child) => child.type === "text" || child.type === "citation",
        );
      if (onlyBib) {
        out.push({ type: "bibliography" });
        continue;
      }
    }
    out.push(next);
  }
  return out;
}

function countType(nodes: JsonNode[], type: string): number {
  let count = 0;
  const walk = (node: JsonNode) => {
    if (node.type === type) count += 1;
    node.content?.forEach(walk);
  };
  nodes.forEach(walk);
  return count;
}

/**
 * Restore citation tokens as citation nodes linked to the Word source list,
 * and a bibliography token as a bibliography that follows those sources.
 */
export function applyImportedCitations(
  content: JsonNode,
  parsed: CitationLibrary,
): { content: JsonNode; citations: number; bibliographies: number } {
  const blocks = rewriteBlocks(content.content ?? []);
  const citations = countType(blocks, "citation");
  const bibliographies = countType(blocks, "bibliography");
  if (!citations && !bibliographies && !parsed.sources.length)
    return { content, citations: 0, bibliographies: 0 };
  const sources = parsed.sources.map((source) => ({ ...source }));
  const known = new Set(sources.map((source) => source.id));
  const walk = (node: JsonNode) => {
    if (node.type === "citation") {
      const id = String(node.attrs?.sourceId ?? "");
      if (id && !known.has(id)) {
        known.add(id);
        sources.push({
          id,
          tag: id,
          guid: "",
          kind: "book",
          author: id,
          title: "",
          year: "",
          page: "",
        });
      }
    }
    node.content?.forEach(walk);
  };
  blocks.forEach(walk);
  return {
    content: {
      ...content,
      attrs: {
        ...(content.attrs ?? {}),
        citationStyle: parsed.style,
        citationSources: sources,
      },
      content: blocks.length ? blocks : [{ type: "paragraph" }],
    },
    citations,
    bibliographies,
  };
}

export async function bibliographyParts(zip: JSZip): Promise<string> {
  const names = Object.keys(zip.files).filter((name) =>
    /^customXml\/item\d+\.xml$/i.test(name),
  );
  const chunks: string[] = [];
  for (const name of names) {
    const xml = await zip.file(name)!.async("string");
    if (xml.includes("2006/bibliography")) chunks.push(xml);
  }
  return chunks.join("\n");
}

function bibliographyFieldXml(
  sources: CitationSource[],
  style: CitationStyle,
): string {
  const begin = `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> BIBLIOGRAPHY \\l 1033 </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>`;
  const end = `<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  const title = `<w:r><w:t>${xmlEscape(bibliographyTitle(style))}</w:t></w:r>`;
  if (!sources.length)
    return `<w:p>${begin}${title}${end}</w:p>`;
  const entries = sources.map((source) =>
    bibliographyRuns(source, style)
      .map((run) => {
        const props = run.italic ? "<w:rPr><w:i/></w:rPr>" : "";
        return `<w:r>${props}<w:t xml:space="preserve">${xmlEscape(run.text)}</w:t></w:r>`;
      })
      .join(""),
  );
  const last = entries[entries.length - 1];
  const middle = entries.slice(0, -1).map((runs) => `<w:p>${runs}</w:p>`);
  return [
    `<w:p>${begin}${title}</w:p>`,
    ...middle,
    `<w:p>${last}${end}</w:p>`,
  ].join("");
}

/**
 * Replace the bibliography placeholder with a Word BIBLIOGRAPHY field and
 * store every source, cited or not, where Word's citation manager looks.
 */
export async function stampDocxCitations(
  bytes: Uint8Array,
  library: CitationLibrary,
  doc: JsonNode,
): Promise<Uint8Array> {
  const cited = citedSources(doc, library.sources);
  const zip = await JSZip.loadAsync(bytes);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) return bytes;
  let documentXml = await documentFile.async("string");
  const hasPlaceholder = documentXml.includes("SLBIBFIELD");
  if (!hasPlaceholder && !library.sources.length) return bytes;
  if (hasPlaceholder) {
    const field = bibliographyFieldXml(cited, library.style);
    documentXml = documentXml.replace(
      /<w:p\b[^>]*>(?:(?!<\/w:p>)[\s\S])*SLBIBFIELD(?:(?!<\/w:p>)[\s\S])*<\/w:p>/,
      field,
    );
    zip.file("word/document.xml", documentXml);
  }
  if (!library.sources.length)
    return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
  const numbers = Object.keys(zip.files)
    .map((name) => /^customXml\/item(\d+)\.xml$/i.exec(name)?.[1])
    .filter((value): value is string => !!value)
    .map(Number);
  const item = Math.max(0, ...numbers) + 1;
  const propsId = `{${crypto.randomUUID().toUpperCase()}}`;
  zip.file(`customXml/item${item}.xml`, bibliographyXml(library.sources, library.style));
  zip.file(
    `customXml/itemProps${item}.xml`,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<ds:datastoreItem ds:itemID="${propsId}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs><ds:schemaRef ds:uri="${BIBLIOGRAPHY_NS}"/></ds:schemaRefs></ds:datastoreItem>`,
  );
  zip.file(
    `customXml/_rels/item${item}.xml.rels`,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXmlProps" Target="itemProps${item}.xml"/></Relationships>`,
  );
  const typesPath = "[Content_Types].xml";
  const types = await zip.file(typesPath)!.async("string");
  let nextTypes = types;
  const itemPart = `/customXml/item${item}.xml`;
  const propsPart = `/customXml/itemProps${item}.xml`;
  if (!nextTypes.includes(itemPart))
    nextTypes = nextTypes.replace(
      "</Types>",
      `<Override PartName="${itemPart}" ContentType="application/xml"/></Types>`,
    );
  if (!nextTypes.includes(propsPart))
    nextTypes = nextTypes.replace(
      "</Types>",
      `<Override PartName="${propsPart}" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/></Types>`,
    );
  zip.file(typesPath, nextTypes);
  const relsPath = "word/_rels/document.xml.rels";
  const rels = await zip.file(relsPath)!.async("string");
  if (!rels.includes(`customXml/item${item}.xml`)) {
    const ids = [...rels.matchAll(/Id="rId(\d+)"/g)].map((match) =>
      Number(match[1]),
    );
    const id = Math.max(0, ...ids) + 1;
    zip.file(
      relsPath,
      rels.replace(
        "</Relationships>",
        `<Relationship Id="rId${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item${item}.xml"/></Relationships>`,
      ),
    );
  }
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}
