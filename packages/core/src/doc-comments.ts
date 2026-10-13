import JSZip from "jszip";
import { commentIdToParaId } from "docx";
import type { JsonNode } from "./index";

/**
 * A person named in a comment. Stored beside the sentence, not inside `text`,
 * so the name can be matched without parsing the words. No address is required,
 * and nothing here is an instruction to send mail.
 */
export interface DocMention {
  name: string;
  /** Offset in `text` where the name is shown. The name itself is not in `text`. */
  at: number;
  /** Server account, when the mention was picked from the directory. */
  accountId?: string;
  /** Shown while picking an account. Never used to send mail. */
  email?: string;
}

/** One message in a document comment thread. The first message is the comment. */
export interface DocCommentMessage {
  id: string;
  authorId: string;
  authorName: string;
  createdAt: string;
  text: string;
  mentions?: DocMention[];
}

/** A comment anchored to a range of document text, plus its replies. */
export interface DocCommentThread {
  id: string;
  /** Text the comment was attached to, kept after that text is deleted. */
  quote: string;
  messages: DocCommentMessage[];
  resolved: boolean;
  resolvedBy?: string;
  resolvedAt?: string;
  /** The anchor text is gone, so the thread lives only in the comments panel. */
  orphaned?: boolean;
}

export function commentThreads(content: JsonNode): DocCommentThread[] {
  const raw = content.attrs?.commentThreads;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (thread): thread is DocCommentThread =>
      !!thread &&
      typeof thread === "object" &&
      typeof (thread as DocCommentThread).id === "string" &&
      Array.isArray((thread as DocCommentThread).messages),
  );
}

export function commentImportSummary(count: number) {
  const threads = count === 1 ? "thread" : "threads";
  return `${count} comment ${threads} imported`;
}

interface WordCommentPlan {
  wordId: number;
  parentWordId?: number;
  author: string;
  initials: string;
  date?: Date;
  text: string;
  resolved: boolean;
}

export interface DocxCommentPlan {
  comments: WordCommentPlan[];
  /** Text-node index → Word comment ids whose range starts on that node. */
  starts: Map<number, number[]>;
  /** Text-node index → Word comment ids whose range ends on that node. */
  ends: Map<number, number[]>;
  /** Advanced as text nodes are written, so range markers stay on the same words. */
  index: number;
  /** Threads with no anchor, referenced after the body so Word does not drop them. */
  trailing: number[];
  resolvedWordIds: number[];
}

function initials(name: string) {
  const letters = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "");
  return letters.join("").toUpperCase() || "•";
}

function eachText(node: JsonNode, visit: (text: JsonNode, index: number) => void) {
  let index = 0;
  const walk = (current: JsonNode) => {
    if (current.type === "note") return;
    if (current.type === "text") {
      visit(current, index);
      index += 1;
      return;
    }
    for (const child of current.content ?? []) walk(child);
  };
  walk(node);
}

/** Word comment ids and the text-node ranges they anchor to. */
export function planDocxComments(content: JsonNode): DocxCommentPlan {
  const threads = commentThreads(content).filter((thread) => thread.messages.length);
  const starts = new Map<number, number[]>();
  const ends = new Map<number, number[]>();
  const comments: WordCommentPlan[] = [];
  const trailing: number[] = [];
  const resolvedWordIds: number[] = [];
  const anchors = new Map<string, { start: number; end: number }>();
  eachText(content, (text, index) => {
    for (const mark of text.marks ?? []) {
      if (mark.type !== "comment") continue;
      const id = String(mark.attrs?.threadId ?? "");
      if (!id) continue;
      const span = anchors.get(id);
      if (span) span.end = index;
      else anchors.set(id, { start: index, end: index });
    }
  });
  let nextId = 0;
  const push = (id: number, bucket: Map<number, number[]>, index: number) => {
    const list = bucket.get(index) ?? [];
    list.push(id);
    bucket.set(index, list);
  };
  for (const thread of threads) {
    const rootId = nextId;
    nextId += 1;
    const root = thread.messages[0];
    const anchor = anchors.get(thread.id);
    if (anchor) {
      push(rootId, starts, anchor.start);
      push(rootId, ends, anchor.end);
    } else trailing.push(rootId);
    if (thread.resolved) resolvedWordIds.push(rootId);
    comments.push({
      wordId: rootId,
      author: root.authorName,
      initials: initials(root.authorName),
      date: parseDate(root.createdAt),
      text: wordCommentText(root),
      resolved: thread.resolved,
    });
    for (const reply of thread.messages.slice(1)) {
      const replyId = nextId;
      nextId += 1;
      if (thread.resolved) resolvedWordIds.push(replyId);
      comments.push({
        wordId: replyId,
        parentWordId: rootId,
        author: reply.authorName,
        initials: initials(reply.authorName),
        date: parseDate(reply.createdAt),
        text: wordCommentText(reply),
        resolved: thread.resolved,
      });
    }
  }
  return { comments, starts, ends, index: 0, trailing, resolvedWordIds };
}

function parseDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function attr(source: string, name: string) {
  const match = new RegExp(`(?:^|\\s)${name.replace(":", "\\:")}="([^"]*)"`).exec(
    source,
  );
  return match?.[1] ?? "";
}

function decodeXml(value: string) {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
    (all, body: string) => {
      const token = body.toLowerCase();
      if (token === "amp") return "&";
      if (token === "lt") return "<";
      if (token === "gt") return ">";
      if (token === "quot") return '"';
      if (token === "apos") return "'";
      if (token.startsWith("#x"))
        return String.fromCodePoint(Number.parseInt(token.slice(2), 16));
      if (token.startsWith("#"))
        return String.fromCodePoint(Number.parseInt(token.slice(1), 10));
      return all;
    },
  );
}

interface RawWordComment {
  id: string;
  author: string;
  date: string;
  paraId: string;
  text: string;
}

function parseCommentParts(xml: string): RawWordComment[] {
  const comments: RawWordComment[] = [];
  for (const match of xml.matchAll(/<w:comment\b([^>]*)>([\s\S]*?)<\/w:comment>/g)) {
    const text = [...match[2].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
      .map((part) => decodeXml(part[1]))
      .join("");
    const para =
      attr(match[2], "w14:paraId") ||
      commentIdToParaId(Number(attr(match[1], "w:id")));
    comments.push({
      id: attr(match[1], "w:id"),
      author: decodeXml(attr(match[1], "w:author")),
      date: attr(match[1], "w:date"),
      paraId: para,
      text,
    });
  }
  return comments;
}

function parseExtended(xml: string) {
  const byPara = new Map<string, { parent?: string; done: boolean }>();
  for (const match of xml.matchAll(/<w15:commentEx\b([^>]*)\/?>/g)) {
    const paraId = attr(match[1], "w15:paraId");
    if (!paraId) continue;
    byPara.set(paraId, {
      parent: attr(match[1], "w15:paraIdParent") || undefined,
      done: attr(match[1], "w15:done") === "1",
    });
  }
  return byPara;
}

/** Text between each comment range in document.xml, keyed by Word comment id. */
export function commentAnchorText(documentXml: string) {
  const anchors = new Map<string, string>();
  const open = new Map<string, string>();
  const token =
    /<w:commentRangeStart\b([^>]*)\/?>|<w:commentRangeEnd\b([^>]*)\/?>|<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
  for (const match of documentXml.matchAll(token)) {
    if (match[1] !== undefined) {
      const id = attr(match[1], "w:id");
      if (id && !open.has(id)) open.set(id, "");
      continue;
    }
    if (match[2] !== undefined) {
      const id = attr(match[2], "w:id");
      if (id && open.has(id)) {
        anchors.set(id, open.get(id) ?? "");
        open.delete(id);
      }
      continue;
    }
    const text = decodeXml(match[3] ?? "");
    for (const id of open.keys()) open.set(id, (open.get(id) ?? "") + text);
  }
  return anchors;
}

function stampMarks(
  content: JsonNode,
  ranges: { start: number; end: number; threadId: string; resolved: boolean }[],
) {
  if (!ranges.length) return content;
  const spans: {
    parent: JsonNode;
    index: number;
    start: number;
    text: string;
    marks: NonNullable<JsonNode["marks"]>;
  }[] = [];
  let offset = 0;
  const walk = (node: JsonNode) => {
    node.content?.forEach((child, index) => {
      if (child.type === "text" && child.text) {
        spans.push({
          parent: node,
          index,
          start: offset,
          text: child.text,
          marks: child.marks ?? [],
        });
        offset += child.text.length;
      } else walk(child);
    });
  };
  walk(content);
  const byParent = new Map<JsonNode, typeof spans>();
  for (const span of spans) {
    const list = byParent.get(span.parent) ?? [];
    list.push(span);
    byParent.set(span.parent, list);
  }
  for (const [parent, list] of byParent) {
    for (const span of [...list].reverse()) {
      const localEnd = span.start + span.text.length;
      const hits = ranges.filter(
        (range) => range.end > span.start && range.start < localEnd,
      );
      if (!hits.length) continue;
      const points = new Set([0, span.text.length]);
      for (const range of hits) {
        points.add(Math.max(0, Math.min(span.text.length, range.start - span.start)));
        points.add(Math.max(0, Math.min(span.text.length, range.end - span.start)));
      }
      const cuts = [...points].sort((a, b) => a - b);
      const parts: JsonNode[] = [];
      for (let i = 0; i < cuts.length - 1; i++) {
        const from = cuts[i];
        const to = cuts[i + 1];
        if (from === to) continue;
        const mid = span.start + from;
        const marks = [...span.marks];
        for (const range of ranges) {
          if (range.start <= mid && mid < range.end)
            marks.push({
              type: "comment",
              attrs: { threadId: range.threadId, resolved: range.resolved },
            });
        }
        parts.push({
          type: "text",
          text: span.text.slice(from, to),
          ...(marks.length ? { marks } : {}),
        });
      }
      parent.content!.splice(span.index, 1, ...parts);
    }
  }
  return content;
}

/**
 * Read Word comments, replies, and done state, and anchor them to the same
 * text in the imported document. Threads whose text cannot be found are kept
 * and marked as deleted rather than dropped.
 */
export function importWordComments(
  content: JsonNode,
  parts: { documentXml: string; commentsXml?: string; extendedXml?: string },
): { content: JsonNode; count: number } {
  if (!parts.commentsXml?.includes("<w:comment"))
    return { content, count: 0 };
  const raw = parseCommentParts(parts.commentsXml);
  if (!raw.length) return { content, count: 0 };
  const extended = parseExtended(parts.extendedXml ?? "");
  const anchors = commentAnchorText(parts.documentXml);
  const repliesOf = new Map<string, RawWordComment[]>();
  const roots: RawWordComment[] = [];
  for (const comment of raw) {
    const parent = extended.get(comment.paraId)?.parent;
    if (!parent) {
      roots.push(comment);
      continue;
    }
    const list = repliesOf.get(parent) ?? [];
    list.push(comment);
    repliesOf.set(parent, list);
  }
  // A reply whose parent paragraph is missing still becomes its own thread.
  const rootParas = new Set(roots.map((root) => root.paraId));
  for (const [parent, replies] of repliesOf) {
    if (!rootParas.has(parent)) roots.push(...replies);
  }
  const doc = structuredClone(content);
  const full = documentPlain(doc);
  const used: { start: number; end: number }[] = [];
  const ranges: {
    start: number;
    end: number;
    threadId: string;
    resolved: boolean;
  }[] = [];
  const threads: DocCommentThread[] = [];
  for (const root of roots) {
    const parentPara = extended.get(root.paraId)?.parent;
    const replies = parentPara ? [] : (repliesOf.get(root.paraId) ?? []);
    const messages = [root, ...replies];
    const resolved =
      !!extended.get(root.paraId)?.done ||
      replies.some((reply) => extended.get(reply.paraId)?.done);
    const quote = anchors.get(root.id) ?? "";
    const threadId = `word-${root.id}`;
    let orphaned = !quote;
    if (quote) {
      let from = 0;
      let at = -1;
      while (from <= full.length) {
        const found = full.indexOf(quote, from);
        if (found < 0) break;
        const end = found + quote.length;
        if (!used.some((span) => found < span.end && end > span.start)) {
          at = found;
          break;
        }
        from = found + 1;
      }
      if (at < 0) orphaned = true;
      else {
        used.push({ start: at, end: at + quote.length });
        ranges.push({
          start: at,
          end: at + quote.length,
          threadId,
          resolved,
        });
      }
    }
    threads.push({
      id: threadId,
      quote,
      orphaned,
      resolved,
      ...(resolved ? { resolvedBy: root.author } : {}),
      messages: messages.map((message) => {
        const body = mentionsFromWordText(message.text);
        return {
          id: `word-${message.id}`,
          authorId: `word:${message.author}`,
          authorName: message.author,
          createdAt: isoDate(message.date),
          text: body.text,
          ...(body.mentions.length ? { mentions: body.mentions } : {}),
        };
      }),
    });
  }
  stampMarks(doc, ranges);
  doc.attrs = { ...doc.attrs, commentThreads: threads };
  return { content: doc, count: threads.length };
}

function documentPlain(node: JsonNode): string {
  return (node.text ?? "") + (node.content ?? []).map(documentPlain).join("");
}

function isoDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? new Date(0).toISOString()
    : date.toISOString();
}

function wrapCommentReferences(xml: string) {
  return xml.replace(
    /<w:commentReference\b([^>]*?)\/>/g,
    (whole, attrs: string, offset: number, full: string) => {
      const before = full.slice(Math.max(0, offset - 6), offset);
      if (before.endsWith("<w:r>")) return whole;
      return `<w:r><w:commentReference${attrs}/></w:r>`;
    },
  );
}

/**
 * Word only writes resolved state when a thread has a reply. Put w15:done on
 * every resolved comment, including threads that have no reply, and keep
 * comment references inside runs so Word shows them on the anchored text.
 */
export async function stampDocxComments(
  bytes: Uint8Array,
  resolvedWordIds: number[],
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  const commentsFile = zip.file("word/comments.xml");
  if (!commentsFile) return bytes;
  let comments = await commentsFile.async("string");
  const documentFile = zip.file("word/document.xml");
  if (documentFile) {
    const documentXml = wrapCommentReferences(await documentFile.async("string"));
    zip.file("word/document.xml", documentXml);
  }
  const paraById = new Map<number, string>();
  let injected = false;
  comments = comments.replace(
    /<w:comment\b([^>]*)>([\s\S]*?)<\/w:comment>/g,
    (block, attrs: string, inner: string) => {
      const id = Number(attr(attrs, "w:id"));
      let para = attr(inner, "w14:paraId");
      if (!para) {
        para = commentIdToParaId(id);
        injected = true;
        inner = inner.replace(/<w:p\b([^>]*)>/, (_tag, paragraphAttrs: string) =>
          paragraphAttrs.includes("w14:paraId")
            ? `<w:p${paragraphAttrs}>`
            : `<w:p${paragraphAttrs} w14:paraId="${para}" w14:textId="${para}">`,
        );
      }
      paraById.set(id, para);
      return `<w:comment${attrs}>${inner}</w:comment>`;
    },
  );
  if (injected && !comments.includes("xmlns:w14="))
    comments = comments.replace(
      "<w:comments",
      '<w:comments xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"',
    );
  zip.file("word/comments.xml", comments);
  if (!resolvedWordIds.length && !injected) {
    return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
  }
  const resolvedParas = new Set(
    resolvedWordIds.map((id) => paraById.get(id) ?? commentIdToParaId(id)),
  );
  const existing = zip.file("word/commentsExtended.xml");
  const previous = existing ? await existing.async("string") : "";
  const rows = new Map<string, { parent?: string; done: boolean }>();
  if (previous) {
    for (const [para, row] of parseExtended(previous)) rows.set(para, row);
  }
  for (const para of paraById.values()) {
    const row = rows.get(para) ?? { done: false };
    if (resolvedParas.has(para)) row.done = true;
    rows.set(para, row);
  }
  const body = [...rows.entries()]
    .map(([para, row]) => {
      const parent = row.parent ? ` w15:paraIdParent="${row.parent}"` : "";
      const done = row.done ? ' w15:done="1"' : ' w15:done="0"';
      return `<w15:commentEx w15:paraId="${para}"${parent}${done}/>`;
    })
    .join("");
  zip.file(
    "word/commentsExtended.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w15:commentsEx xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" mc:Ignorable="w15">${body}</w15:commentsEx>`,
  );
  if (!existing) {
    const types = await zip.file("[Content_Types].xml")!.async("string");
    if (!types.includes("/word/commentsExtended.xml"))
      zip.file(
        "[Content_Types].xml",
        types.replace(
          "</Types>",
          '<Override PartName="/word/commentsExtended.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml"/></Types>',
        ),
      );
    const relsPath = "word/_rels/document.xml.rels";
    const rels = await zip.file(relsPath)!.async("string");
    if (!rels.includes("commentsExtended.xml")) {
      const ids = [...rels.matchAll(/Id="rId(\d+)"/g)].map((match) =>
        Number(match[1]),
      );
      const id = Math.max(0, ...ids) + 1;
      zip.file(
        relsPath,
        rels.replace(
          "</Relationships>",
          `<Relationship Id="rId${id}" Type="http://schemas.microsoft.com/office/2011/relationships/commentsExtended" Target="commentsExtended.xml"/></Relationships>`,
        ),
      );
    }
  }
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

/** Drop mentions that are not a name at a real offset in the sentence. */
export function normalizeMentions(raw: unknown, textLength: number): DocMention[] {
  if (!Array.isArray(raw)) return [];
  const mentions: DocMention[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim().slice(0, 80) : "";
    if (!name) continue;
    const at =
      typeof record.at === "number" && Number.isFinite(record.at) ? Math.floor(record.at) : 0;
    const mention: DocMention = {
      name,
      at: Math.max(0, Math.min(textLength, at)),
    };
    if (typeof record.email === "string" && record.email.trim())
      mention.email = record.email.trim();
    if (typeof record.accountId === "string" && record.accountId.trim())
      mention.accountId = record.accountId.trim();
    mentions.push(mention);
  }
  mentions.sort((a, b) => a.at - b.at);
  const placed: DocMention[] = [];
  for (const mention of mentions) {
    if (placed.some((kept) => kept.at === mention.at && kept.name === mention.name)) continue;
    placed.push(mention);
  }
  return placed;
}

/** Word comment text. The name is written so Word shows it; the file keeps it separate. */
export function wordCommentText(message: { text: string; mentions?: unknown }): string {
  const text = message.text ?? "";
  const mentions = normalizeMentions(message.mentions, text.length);
  if (!mentions.length) return text;
  let out = "";
  let cursor = 0;
  for (const mention of mentions) {
    out += text.slice(cursor, mention.at);
    out += `@${mention.name}`;
    cursor = mention.at;
  }
  return out + text.slice(cursor);
}

const mentionWord = /^[\p{L}][\p{L}'’.\-]*/u;

function takeMentionName(rest: string) {
  const words: string[] = [];
  let index = 0;
  while (words.length < 4) {
    const match = mentionWord.exec(rest.slice(index));
    if (!match?.[0]) break;
    if (words.length > 0 && match[0][0] !== match[0][0].toUpperCase()) break;
    words.push(match[0]);
    index += match[0].length;
    if (rest[index] !== " ") break;
    const peek = mentionWord.exec(rest.slice(index + 1));
    if (!peek?.[0] || peek[0][0] !== peek[0][0].toUpperCase()) break;
    index += 1;
  }
  return words.length ? words.join(" ") : null;
}

/**
 * Pull @Name tokens out of a Word comment. The name is returned as a mention
 * and removed from the sentence, which is how a round trip stays structured.
 */
export function mentionsFromWordText(source: string): {
  text: string;
  mentions: DocMention[];
} {
  let text = "";
  const mentions: DocMention[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const boundary = index === 0 || /\s/.test(source[index - 1] ?? "");
    if (source[index] === "@" && boundary) {
      const name = takeMentionName(source.slice(index + 1));
      if (name) {
        mentions.push({ name, at: text.length });
        index += name.length;
        continue;
      }
    }
    text += source[index];
  }
  return { text, mentions };
}

export type MentionPiece =
  | { kind: "text"; text: string }
  | { kind: "mention"; name: string };

/** Pieces for drawing a comment: the sentence, with each mention at its offset. */
export function mentionPieces(text: string, raw: unknown): MentionPiece[] {
  const mentions = normalizeMentions(raw, text.length);
  if (!mentions.length) return text ? [{ kind: "text", text }] : [];
  const pieces: MentionPiece[] = [];
  let cursor = 0;
  for (const mention of mentions) {
    if (mention.at > cursor)
      pieces.push({ kind: "text", text: text.slice(cursor, mention.at) });
    pieces.push({ kind: "mention", name: mention.name });
    cursor = mention.at;
  }
  if (cursor < text.length) pieces.push({ kind: "text", text: text.slice(cursor) });
  return pieces;
}

/** Someone opening the file. Matching uses the name, and an account id or email when signed in. */
export interface MentionReader {
  name?: string;
  email?: string;
  accountId?: string;
}

function sameText(a?: string, b?: string) {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

function sameAccount(a?: string, b?: string) {
  if (!a || !b) return false;
  if (a === b) return true;
  return a.replace(/^user-/, "") === b.replace(/^user-/, "");
}

export function mentionMatches(mention: DocMention, reader: MentionReader) {
  if (sameText(mention.name, reader.name)) return true;
  if (sameText(mention.email, reader.email)) return true;
  return sameAccount(mention.accountId, reader.accountId);
}

function threadMentions(thread: DocCommentThread, reader: MentionReader) {
  return thread.messages.some((message) =>
    normalizeMentions(message.mentions, message.text.length).some((mention) =>
      mentionMatches(mention, reader),
    ),
  );
}

/**
 * The comment to land on when this person opens the file. An open thread wins
 * over a resolved one. Someone who is not named gets nothing, so the page stays put.
 */
export function threadForReader(
  threads: DocCommentThread[],
  reader: MentionReader,
): DocCommentThread | null {
  if (!reader.name && !reader.email && !reader.accountId) return null;
  const open = threads.find((thread) => !thread.resolved && threadMentions(thread, reader));
  if (open) return open;
  return threads.find((thread) => threadMentions(thread, reader)) ?? null;
}

/** A row in the @ menu. `unmatched` is a name with no stored person and no account. */
export interface MentionChoice {
  name: string;
  email?: string;
  accountId?: string;
  unmatched?: boolean;
}

export interface MentionAccount {
  id: string;
  name: string | null;
  email: string | null;
  username: string | null;
}

function exactChoice(choices: MentionChoice[], query: string) {
  const q = query.trim().toLowerCase();
  return choices.some(
    (choice) =>
      choice.name.toLowerCase() === q || (choice.email?.toLowerCase() ?? "") === q,
  );
}

/** Names already stored on this computer. At least two characters. */
export function choicesFromNames(query: string, names: string[]): MentionChoice[] {
  const q = query.trim();
  const lower = q.toLowerCase();
  if (lower.length < 2) return [];
  const seen = new Set<string>();
  const ranked: { name: string; rank: number }[] = [];
  for (const raw of names) {
    const name = raw.trim();
    const key = name.toLowerCase();
    if (!name || key === "you" || seen.has(key)) continue;
    seen.add(key);
    const starts = key.startsWith(lower);
    const word = key.split(/\s+/).some((part) => part.startsWith(lower));
    if (!starts && !word) continue;
    ranked.push({ name, rank: starts ? 0 : 1 });
  }
  ranked.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  const choices: MentionChoice[] = ranked.slice(0, 6).map((item) => ({ name: item.name }));
  if (!exactChoice(choices, q)) choices.push({ name: q, unmatched: true });
  return choices;
}

/**
 * Accounts from the server directory. Each row keeps the name and the email
 * for display. A name the directory does not have is still offered, with no account.
 */
export function choicesFromAccounts(
  query: string,
  accounts: MentionAccount[],
): MentionChoice[] {
  const q = query.trim();
  if (q.length < 2) return [];
  const choices: MentionChoice[] = [];
  const seen = new Set<string>();
  for (const account of accounts) {
    const name = (account.name || account.username || account.email || "").trim();
    if (!name || seen.has(account.id)) continue;
    seen.add(account.id);
    choices.push({
      name,
      ...(account.email?.trim() ? { email: account.email.trim() } : {}),
      accountId: account.id,
    });
  }
  const shown = choices.slice(0, exactChoice(choices, q) ? 8 : 7);
  if (!exactChoice(shown, q)) shown.push({ name: q, unmatched: true });
  return shown;
}
