import JSZip from "jszip";
import type { JsonNode } from "./index";

/** Private-use sentinels carry suggestion identity through HTML and DOCX text. */
const START = "\uE000";
const END = "\uE001";
const CLOSE = "\uE000/\uE001";

export type SuggestionKind = "insert" | "delete" | "format" | "heading";
type Mark = NonNullable<JsonNode["marks"]>[number];
type Payload = {
  k: SuggestionKind;
  id: string;
  author: string;
  time: string;
  property?: string;
  before?: string;
  after?: string;
};
export type HeadingSuggestion = {
  id: string;
  author: string;
  time: string;
  before: string;
  after: string;
};
export type SuggestionInfo = {
  id: string;
  kind: SuggestionKind;
  author: string;
  time: string;
  text: string;
  property?: string;
  before?: string;
  after?: string;
};

const FORMAT = new Set(["bold", "italic", "underline"]);

function b64url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
function fromB64url(text: string): string {
  const pad = text.length % 4 === 0 ? "" : "=".repeat(4 - (text.length % 4));
  const bin = atob(text.replaceAll("-", "+").replaceAll("_", "/") + pad);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
function encode(payload: Payload): string {
  return START + b64url(JSON.stringify(payload)) + END;
}
function decode(body: string): Payload | null {
  try {
    const value = JSON.parse(fromB64url(body)) as Payload;
    if (!value || typeof value.id !== "string" || !value.k) return null;
    return value;
  } catch {
    return null;
  }
}

type Segment = { text: string; stack: Payload[] };
function segments(text: string): Segment[] {
  const out: Segment[] = [];
  const stack: Payload[] = [];
  let buf = "";
  const flush = () => {
    if (!buf) return false;
    out.push({ text: buf, stack: stack.slice() });
    buf = "";
    return true;
  };
  for (let i = 0; i < text.length; ) {
    if (text.startsWith(CLOSE, i)) {
      const top = stack.at(-1);
      const emitted = flush();
      stack.pop();
      if (top?.k === "heading" && !emitted) out.push({ text: "", stack: [top] });
      i += CLOSE.length;
      continue;
    }
    if (text.startsWith(START, i)) {
      const end = text.indexOf(END, i + START.length);
      const payload = end < 0 ? null : decode(text.slice(i + START.length, end));
      if (payload && end >= 0) {
        flush();
        stack.push(payload);
        i = end + END.length;
        continue;
      }
    }
    buf += text[i];
    i++;
  }
  flush();
  return out;
}

function suggestionMark(payload: Payload): Mark {
  return {
    type: "suggestion",
    attrs: {
      id: payload.id,
      kind: payload.k,
      author: payload.author,
      time: payload.time,
      property: payload.property ?? null,
      before: payload.before ?? null,
      after: payload.after ?? null,
    },
  };
}
function asPayload(mark: Mark): Payload | null {
  if (mark.type !== "suggestion") return null;
  const a = mark.attrs ?? {};
  const kind = String(a.kind ?? "");
  if (kind !== "insert" && kind !== "delete" && kind !== "format") return null;
  return {
    k: kind,
    id: String(a.id ?? ""),
    author: String(a.author ?? ""),
    time: String(a.time ?? ""),
    property: a.property == null ? undefined : String(a.property),
    before: a.before == null ? undefined : String(a.before),
    after: a.after == null ? undefined : String(a.after),
  };
}
function headingOf(node: JsonNode): HeadingSuggestion | null {
  const value = node.attrs?.suggestionHeading as Partial<HeadingSuggestion> | undefined;
  if (!value || typeof value.id !== "string" || !value.id) return null;
  return {
    id: value.id,
    author: String(value.author ?? ""),
    time: String(value.time ?? ""),
    before: String(value.before ?? "0"),
    after: String(value.after ?? "1"),
  };
}

function marksWithout(marks: Mark[] | undefined, id: string): Mark[] {
  return (marks ?? []).filter(
    (mark) => !(mark.type === "suggestion" && mark.attrs?.id === id),
  );
}
function withFormat(marks: Mark[], property: string | undefined, on: boolean): Mark[] {
  if (!property || !FORMAT.has(property)) return marks;
  const without = marks.filter((mark) => mark.type !== property);
  return on ? [...without, { type: property }] : without;
}
function mapContent(
  node: JsonNode,
  ids: Set<string> | "all",
  op: "accept" | "reject",
): JsonNode | null {
  const heading = headingOf(node);
  let current = node;
  if (heading && (ids === "all" || ids.has(heading.id))) {
    const attrs = { ...(current.attrs ?? {}) };
    delete attrs.suggestionHeading;
    if (op === "reject") {
      const level = Number(heading.before);
      current =
        level >= 1 && level <= 6
          ? {
              ...current,
              type: "heading",
              attrs: { ...attrs, level },
            }
          : { ...current, type: "paragraph", attrs: Object.keys(attrs).length ? attrs : undefined };
      if (current.type === "paragraph" && current.attrs?.level != null) {
        const rest = { ...current.attrs };
        delete rest.level;
        current = { ...current, attrs: Object.keys(rest).length ? rest : undefined };
      }
    } else current = { ...current, attrs: Object.keys(attrs).length ? attrs : undefined };
  }
  if (current.type === "text") {
    const payloads = (current.marks ?? [])
      .map(asPayload)
      .filter((payload): payload is Payload => !!payload && (ids === "all" || ids.has(payload.id)));
    if (!payloads.length) return current;
    let marks = current.marks ?? [];
    let drop = false;
    for (const payload of payloads) {
      marks = marksWithout(marks, payload.id);
      if (op === "accept" && payload.k === "delete") drop = true;
      if (op === "reject" && payload.k === "insert") drop = true;
      if (op === "reject" && payload.k === "format")
        marks = withFormat(marks, payload.property, payload.before === "true");
    }
    if (drop) return null;
    return { ...current, marks: marks.length ? marks : undefined };
  }
  if (!current.content) return current;
  const content = current.content
    .map((child) => mapContent(child, ids, op))
    .filter((child): child is JsonNode => !!child);
  return { ...current, content };
}

function idSet(ids: string[] | "all"): Set<string> | "all" {
  return ids === "all" ? "all" : new Set(ids);
}
export function acceptSuggestions(doc: JsonNode, ids: string[] | "all"): JsonNode {
  return mapContent(structuredClone(doc), idSet(ids), "accept") ?? doc;
}
export function rejectSuggestions(doc: JsonNode, ids: string[] | "all"): JsonNode {
  return mapContent(structuredClone(doc), idSet(ids), "reject") ?? doc;
}
export function resolveSuggestions(
  doc: JsonNode,
  which: "accepted" | "original",
): JsonNode {
  return which === "accepted" ? acceptSuggestions(doc, "all") : rejectSuggestions(doc, "all");
}

export function listSuggestions(doc: JsonNode): SuggestionInfo[] {
  const order: string[] = [];
  const byId = new Map<string, SuggestionInfo>();
  const take = (info: SuggestionInfo, text: string) => {
    const existing = byId.get(info.id);
    if (!existing) {
      order.push(info.id);
      byId.set(info.id, { ...info, text });
      return;
    }
    if (text) existing.text += text;
  };
  const walk = (node: JsonNode) => {
    const heading = headingOf(node);
    if (heading)
      take(
        {
          id: heading.id,
          kind: "heading",
          author: heading.author,
          time: heading.time,
          text: "",
          before: heading.before,
          after: heading.after,
        },
        "",
      );
    if (node.type === "text") {
      for (const payload of (node.marks ?? []).map(asPayload)) {
        if (!payload) continue;
        take(
          {
            id: payload.id,
            kind: payload.k,
            author: payload.author,
            time: payload.time,
            text: "",
            property: payload.property,
            before: payload.before,
            after: payload.after,
          },
          node.text ?? "",
        );
      }
    }
    if (heading) {
      const info = byId.get(heading.id);
      if (info && !info.text) info.text = textOf(node);
    }
    node.content?.forEach(walk);
  };
  walk(doc);
  return order.map((id) => byId.get(id)!);
}
function textOf(node: JsonNode): string {
  return (node.text ?? "") + (node.content ?? []).map(textOf).join("");
}

function wrap(text: string, payloads: Payload[]): string {
  return payloads.reduce((value, payload) => encode(payload) + value + CLOSE, text);
}
/** Puts suggestion identity into the text so a DOCX writer can turn it into revisions. */
export function embedSuggestionMarkers(doc: JsonNode): JsonNode {
  const embed = (node: JsonNode): JsonNode => {
    if (node.type === "text") {
      const payloads = (node.marks ?? []).map(asPayload).filter((p): p is Payload => !!p);
      if (!payloads.length) return node;
      return {
        ...node,
        text: wrap(node.text ?? "", payloads),
        marks: (node.marks ?? []).filter((mark) => mark.type !== "suggestion"),
      };
    }
    const heading = headingOf(node);
    let content = node.content?.map(embed);
    if (heading) {
      const payload: Payload = { k: "heading", ...heading };
      const marker = encode(payload) + CLOSE;
      const first = content?.findIndex((child) => child.type === "text");
      if (content && first != null && first >= 0 && content[first].type === "text")
        content = content.map((child, index) =>
          index === first ? { ...child, text: marker + (child.text ?? "") } : child,
        );
      else content = [{ type: "text", text: marker }, ...(content ?? [])];
    }
    return content ? { ...node, content } : node;
  };
  return embed(structuredClone(doc));
}

function applyHeading(node: JsonNode, payload: Payload): JsonNode {
  const suggestionHeading: HeadingSuggestion = {
    id: payload.id,
    author: payload.author,
    time: payload.time,
    before: payload.before ?? "0",
    after: payload.after ?? "1",
  };
  return {
    ...node,
    attrs: { ...(node.attrs ?? {}), suggestionHeading },
  };
}
/** Turns sentinel text from an imported document back into suggestion marks. */
export function absorbSuggestionMarkers(doc: JsonNode): { doc: JsonNode; count: number } {
  const ids = new Set<string>();
  const childrenOf = (nodes: JsonNode[] | undefined): { nodes: JsonNode[]; headings: Payload[] } => {
    const next: JsonNode[] = [];
    const headings: Payload[] = [];
    for (const child of nodes ?? []) {
      if (child.type === "text" && child.text?.includes(START)) {
        for (const segment of segments(child.text)) {
          for (const payload of segment.stack) if (payload.k === "heading") headings.push(payload);
          const extra = segment.stack
            .filter((payload) => payload.k !== "heading")
            .map((payload) => {
              ids.add(payload.id);
              return suggestionMark(payload);
            });
          if (!segment.text) continue;
          const marks = [...(child.marks ?? []).filter((mark) => mark.type !== "suggestion"), ...extra];
          next.push({ type: "text", text: segment.text, ...(marks.length ? { marks } : {}) });
        }
        continue;
      }
      if (child.content) {
        const inner = childrenOf(child.content);
        let node: JsonNode = { ...child, content: inner.nodes };
        const heading = inner.headings[0];
        if (heading && (node.type === "paragraph" || node.type === "heading")) {
          ids.add(heading.id);
          node = applyHeading(node, heading);
        } else headings.push(...inner.headings);
        next.push(node);
      } else next.push(child);
    }
    return { nodes: next, headings };
  };
  const content = childrenOf(doc.content);
  return {
    doc: { ...doc, content: content.nodes },
    count: ids.size,
  };
}

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (match, entity: string) => {
    if (entity === "amp") return "&";
    if (entity === "lt") return "<";
    if (entity === "gt") return ">";
    if (entity === "quot") return '"';
    if (entity === "apos") return "'";
    const code = entity.startsWith("#x")
      ? parseInt(entity.slice(2), 16)
      : parseInt(entity.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : match;
  });
}
function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
function xmlAttr(source: string, name: string): string {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(source);
  return match ? decodeXml(match[1]) : "";
}
function styleLevel(xml: string): string {
  const style = /<w:pStyle\b[^>]*w:val="([^"]+)"/.exec(xml);
  const level = style ? /heading\s*(\d)/i.exec(style[1]) : null;
  return level ? String(Math.min(6, Number(level[1]))) : "0";
}
function wordDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}
let revisionIds = 1;
function revisionId(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 33 + ch.charCodeAt(0)) >>> 0;
  return String((hash % 900000) + 1000 + revisionIds++);
}

function flag(xml: string, tag: string): boolean {
  const match = new RegExp(`<w:${tag}\\b([^>/]*)\\/?>`).exec(xml);
  if (!match) return false;
  return !/\bw:val="(?:0|false|off)"/.test(match[1]);
}
function setFlag(inner: string, tag: string, on: boolean): string {
  const without = inner.replace(new RegExp(`<w:${tag}\\b[^>]*/>`, "g"), "");
  if (!on) return without;
  return `${without}<w:${tag}/>`;
}

/**
 * Rewrites Word revisions into sentinel text so the HTML converter keeps
 * insertions, deletions, and formatting changes instead of accepting them.
 */
export function annotateTrackedChanges(xml: string): string {
  let next = xml;
  const innermost = /<w:(ins|del)\b([^>]*)>((?:(?!<w:(?:ins|del)\b)[\s\S])*?)<\/w:\1>/g;
  for (let pass = 0; pass < 8; pass++) {
    const before = next;
    next = next.replace(innermost, (_full, kind: string, attrs: string, inner: string) => {
      const payload: Payload = {
        k: kind === "ins" ? "insert" : "delete",
        id: `w${xmlAttr(attrs, "w:id") || revisionId(attrs)}`,
        author: xmlAttr(attrs, "w:author") || "Someone",
        time: xmlAttr(attrs, "w:date") || new Date(0).toISOString(),
      };
      const body = inner.replaceAll("<w:delText", "<w:t").replaceAll("</w:delText>", "</w:t>");
      const open = encode(payload);
      if (!/<w:t\b/.test(body)) return body;
      // Each text node is parsed on its own, so every run needs both sentinels.
      return body.replace(/<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g, (_tag, tagAttrs: string, text: string) => {
        return `<w:t${tagAttrs}>${open}${text}${CLOSE}</w:t>`;
      });
    });
    if (next === before) break;
  }
  next = next.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, (run) => {
    const change = /<w:rPrChange\b([^>]*)>([\s\S]*?)<\/w:rPrChange>/.exec(run);
    if (!change) return run;
    const outer = (/<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/.exec(run)?.[1] ?? "").replace(
      /<w:rPrChange\b[\s\S]*?<\/w:rPrChange>/,
      "",
    );
    const before = /<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/.exec(change[2])?.[1] ?? "";
    const props = ["bold", "italic", "underline"] as const;
    const tags = { bold: "b", italic: "i", underline: "u" };
    const payloads: Payload[] = [];
    for (const property of props) {
      const tag = tags[property];
      const was = flag(before, tag);
      const now = flag(outer, tag);
      if (was === now) continue;
      payloads.push({
        k: "format",
        id: `w${xmlAttr(change[1], "w:id") || revisionId(property)}-${property}`,
        author: xmlAttr(change[1], "w:author") || "Someone",
        time: xmlAttr(change[1], "w:date") || new Date(0).toISOString(),
        property,
        before: String(was),
        after: String(now),
      });
    }
    let stripped = run.replace(/<w:rPrChange\b[\s\S]*?<\/w:rPrChange>/, "");
    if (!payloads.length) return stripped;
    const open = payloads.map(encode).join("");
    const close = CLOSE.repeat(payloads.length);
    let seen = 0;
    const count = stripped.match(/<w:t\b/g)?.length ?? 0;
    if (!count) return stripped;
    stripped = stripped.replace(/<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g, (_tag, attrs: string, text: string) => {
      seen += 1;
      return `<w:t${attrs}>${seen === 1 ? open : ""}${text}${seen === count ? close : ""}</w:t>`;
    });
    return stripped;
  });
  next = next.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (paragraph) => {
    const change = /<w:pPrChange\b([^>]*)>([\s\S]*?)<\/w:pPrChange>/.exec(paragraph);
    if (!change) return paragraph;
    const before = styleLevel(change[2]);
    const props = /<w:pPr\b[^>]*>([\s\S]*?)<\/w:pPr>/.exec(paragraph)?.[1] ?? "";
    const after = styleLevel(props.replace(/<w:pPrChange\b[\s\S]*?<\/w:pPrChange>/, ""));
    let stripped = paragraph.replace(/<w:pPrChange\b[\s\S]*?<\/w:pPrChange>/, "");
    if (before === after) return stripped;
    const marker =
      encode({
        k: "heading",
        id: `w${xmlAttr(change[1], "w:id") || revisionId(before + after)}`,
        author: xmlAttr(change[1], "w:author") || "Someone",
        time: xmlAttr(change[1], "w:date") || new Date(0).toISOString(),
        before,
        after,
      }) + CLOSE;
    if (/<w:t\b/.test(stripped))
      stripped = stripped.replace(/<w:t\b([^>]*)>/, `<w:t$1>${marker}`);
    return stripped;
  });
  return next;
}

function runXml(rPr: string, text: string, deleted = false): string {
  if (!text) return "";
  const tag = deleted ? "w:delText" : "w:t";
  const space = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : "";
  return `<w:r>${rPr}<${tag}${space}>${escapeXml(text)}</${tag}></w:r>`;
}
function withFormatChange(rPr: string, formats: Payload[]): string {
  const inner = (/<w:rPr\b[^>]*>([\s\S]*?)<\/w:rPr>/.exec(rPr)?.[1] ?? "").replace(
    /<w:rPrChange\b[\s\S]*?<\/w:rPrChange>/,
    "",
  );
  const tags = { bold: "b", italic: "i", underline: "u" };
  let previous = inner;
  for (const format of formats) {
    const tag = tags[format.property as "bold"];
    if (!tag) continue;
    previous = setFlag(previous, tag, format.before === "true");
  }
  const sample = formats[0];
  const change = `<w:rPrChange w:id="${revisionId(sample.id)}" w:author="${escapeXml(sample.author)}" w:date="${wordDate(sample.time)}"><w:rPr>${previous}</w:rPr></w:rPrChange>`;
  if (!rPr) return `<w:rPr>${change}</w:rPr>`;
  if (rPr.includes("</w:rPr>")) return rPr.replace("</w:rPr>", `${change}</w:rPr>`);
  return `<w:rPr>${change}</w:rPr>`;
}
function renderSegment(segment: Segment, rPr: string): string {
  const stack = segment.stack.filter((payload) => payload.k !== "heading");
  const insert = stack.find((payload) => payload.k === "insert");
  const deletion = stack.find((payload) => payload.k === "delete");
  const formats = stack.filter((payload) => payload.k === "format");
  const props = formats.length ? withFormatChange(rPr, formats) : rPr;
  const author = (insert ?? deletion)?.author ?? "";
  const time = (insert ?? deletion)?.time ?? "";
  const id = (insert ?? deletion)?.id ?? "";
  let run = runXml(props, segment.text, !!deletion);
  if (!run) return "";
  const attrs = ` w:id="${revisionId(id)}" w:author="${escapeXml(author || "Someone")}" w:date="${wordDate(time)}"`;
  if (deletion) run = `<w:del${attrs}>${run}</w:del>`;
  else if (insert) run = `<w:ins${attrs}>${run}</w:ins>`;
  return run;
}
function addParagraphChange(paragraph: string, payload: Payload): string {
  const before = payload.before ?? "0";
  const style =
    before !== "0" ? `<w:pStyle w:val="Heading${before}"/>` : "";
  const change = `<w:pPrChange w:id="${revisionId(payload.id)}" w:author="${escapeXml(payload.author || "Someone")}" w:date="${wordDate(payload.time)}"><w:pPr>${style}</w:pPr></w:pPrChange>`;
  if (/<w:pPr\b[^>]*>/.test(paragraph))
    return paragraph.replace("</w:pPr>", `${change}</w:pPr>`);
  return paragraph.replace(/(<w:p\b[^>]*>)/, `$1<w:pPr>${change}</w:pPr>`);
}

/** Converts sentinel text in word/document.xml into w:ins, w:del, and w:rPrChange. */
export function revisionizeDocumentXml(xml: string): string {
  if (!xml.includes(START)) return xml;
  revisionIds = 1;
  return xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (paragraph) => {
    if (!paragraph.includes(START)) return paragraph;
    let heading: Payload | null = null;
    const next = paragraph.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, (run) => {
      if (!run.includes(START)) return run;
      const rPr = /<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>/.exec(run)?.[0] ?? "";
      const text = [...run.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
        .map((match) => decodeXml(match[1]))
        .join("");
      const parts = segments(text);
      for (const part of parts) {
        const found = part.stack.find((payload) => payload.k === "heading");
        if (found) heading = found;
      }
      return parts.map((part) => renderSegment(part, rPr)).join("");
    });
    return heading ? addParagraphChange(next, heading) : next;
  });
}

export async function revisionizeDocx(bytes: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  const file = zip.file("word/document.xml");
  if (!file) return bytes;
  const xml = await file.async("string");
  const revised = revisionizeDocumentXml(xml);
  if (revised === xml) return bytes;
  zip.file("word/document.xml", revised);
  const settings = zip.file("word/settings.xml");
  if (settings) {
    const text = await settings.async("string");
    if (!text.includes("<w:trackRevisions"))
      zip.file(
        "word/settings.xml",
        text.replace("</w:settings>", "<w:trackRevisions/></w:settings>"),
      );
  }
  return zip.generateAsync({ type: "uint8array" });
}
