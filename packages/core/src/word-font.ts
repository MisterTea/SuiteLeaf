import type { JsonNode } from "./index";

type FontRun = { text: string; fontFamily: string | null };

type FontParagraph = { text: string; runs: FontRun[] };

const normalize = (value: string) => value.replace(/[\s\u200b\ufeff]+/gu, "");

function decodeXml(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function stripTag(xml: string, tag: string): string {
  return xml.replace(
    new RegExp(
      `<(?:[\\w.-]+:)?${tag}\\b[\\s\\S]*?<\\/(?:[\\w.-]+:)?${tag}>`,
      "g",
    ),
    "",
  );
}

function tagInner(xml: string, tag: string): string {
  return (
    new RegExp(
      `<(?:[\\w.-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${tag}>`,
    ).exec(xml)?.[1] ?? ""
  );
}

/** A named face on `w:rFonts`. Theme attributes such as `w:asciiTheme` are not names. */
function namedFont(attrs: string, name: string): string | null {
  const raw =
    new RegExp(`(?:[\\w.-]+:)?${name}="([^"]*)"`, "i").exec(attrs)?.[1] ?? "";
  const value = decodeXml(raw).trim();
  return value ? value : null;
}

/**
 * A run's face, stored the way the toolbar writes it (`Georgia`).
 * `w:ascii` wins. A run with only `w:hAnsi` uses that name.
 * A theme font with no name, or a run with no `w:rFonts`, stays the body font.
 */
function runFontFamily(inner: string): string | null {
  const properties = tagInner(inner, "rPr");
  const tag = /<(?:[\w.-]+:)?rFonts\b([^>]*?)\/?>/.exec(properties);
  if (!tag) return null;
  return namedFont(tag[1], "ascii") ?? namedFont(tag[1], "hAnsi");
}

function runText(inner: string): string {
  const body = stripTag(inner, "rPr");
  let text = "";
  const tokens =
    /<(?:[\w.-]+:)?(t|tab|br|cr)\b([^>]*)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?\1>)/g;
  for (const match of body.matchAll(tokens)) {
    if (match[1] === "t") text += decodeXml(match[3] ?? "");
    else if (match[1] === "tab") text += "\t";
    else text += "\n";
  }
  return text;
}

function runsIn(paragraphXml: string): FontRun[] {
  const body = stripTag(stripTag(paragraphXml, "pPr"), "del");
  const runs: FontRun[] = [];
  for (const match of body.matchAll(
    /<(?:[\w.-]+:)?r\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?r>/g,
  )) {
    const text = runText(match[1]);
    if (!text) continue;
    runs.push({ text, fontFamily: runFontFamily(match[1]) });
  }
  return runs;
}

function readFonts(xml: string): FontParagraph[] {
  const body =
    /<(?:[\w.-]+:)?body\b[^>]*>([\s\S]*)<\/(?:[\w.-]+:)?body>/.exec(xml)?.[1] ??
    xml;
  const flat = stripTag(
    stripTag(stripTag(body, "txbxContent"), "drawing"),
    "pict",
  );
  const paragraphs: FontParagraph[] = [];
  for (const match of flat.matchAll(
    /<(?:[\w.-]+:)?p\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?p>/g,
  )) {
    const runs = runsIn(match[0]);
    const text = runs.map((run) => run.text).join("");
    if (text) paragraphs.push({ text, runs });
  }
  return paragraphs;
}

type Piece = { node: JsonNode; text: string };

function piecesOf(node: JsonNode): Piece[] {
  const pieces: Piece[] = [];
  for (const child of node.content ?? []) {
    if (child.type === "text")
      pieces.push({ node: child, text: child.text ?? "" });
    else if (child.type === "hardBreak")
      pieces.push({ node: child, text: "\n" });
    else if (child.type === "tab") pieces.push({ node: child, text: "\t" });
    else pieces.push({ node: child, text: "" });
  }
  return pieces;
}

function marksWithFont(
  marks: JsonNode["marks"] | undefined,
  fontFamily: string | null,
): JsonNode["marks"] | undefined {
  const kept = (marks ?? [])
    .filter((mark) => mark.type !== "textStyle")
    .map((mark) => ({
      type: mark.type,
      ...(mark.attrs ? { attrs: { ...mark.attrs } } : {}),
    }));
  const previous = marks?.find((mark) => mark.type === "textStyle");
  const attrs: Record<string, unknown> = { ...(previous?.attrs ?? {}) };
  if (fontFamily) attrs.fontFamily = fontFamily;
  else delete attrs.fontFamily;
  const styled = Object.entries(attrs).filter(
    ([, value]) => value != null && value !== "",
  );
  if (styled.length)
    kept.push({ type: "textStyle", attrs: Object.fromEntries(styled) });
  return kept.length ? kept : undefined;
}

function withFont(node: JsonNode, fontFamily: string): JsonNode {
  const marks = marksWithFont(node.marks, fontFamily);
  return { ...node, ...(marks ? { marks } : {}) };
}

function fontCovering(
  ranges: { from: number; to: number; fontFamily: string }[],
  from: number,
  to: number,
): string | null {
  return (
    ranges.find((range) => range.from <= from && range.to >= to)?.fontFamily ??
    null
  );
}

function splitText(
  node: JsonNode,
  start: number,
  ranges: { from: number; to: number; fontFamily: string }[],
): JsonNode[] {
  const text = node.text ?? "";
  const end = start + text.length;
  const points = new Set<number>([start, end]);
  for (const range of ranges) {
    if (range.to <= start || range.from >= end) continue;
    points.add(Math.max(range.from, start));
    points.add(Math.min(range.to, end));
  }
  const sorted = [...points].sort((a, b) => a - b);
  if (sorted.length === 2) {
    const fontFamily = fontCovering(ranges, start, end);
    return fontFamily ? [withFont(node, fontFamily)] : [node];
  }
  const out: JsonNode[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i];
    const to = sorted[i + 1];
    if (from === to) continue;
    const sliceText = text.slice(from - start, to - start);
    const marks = marksWithFont(node.marks, fontCovering(ranges, from, to));
    out.push({
      type: "text",
      text: sliceText,
      ...(marks ? { marks } : {}),
    });
  }
  return out;
}

function paint(
  node: JsonNode,
  source: FontParagraph,
  editorText: string,
): JsonNode {
  if (!source.runs.some((run) => run.fontFamily)) return node;
  if (editorText !== source.text) return node;
  const ranges: { from: number; to: number; fontFamily: string }[] = [];
  let at = 0;
  for (const run of source.runs) {
    const next = at + run.text.length;
    if (run.fontFamily)
      ranges.push({ from: at, to: next, fontFamily: run.fontFamily });
    at = next;
  }
  const pieces = piecesOf(node);
  if (pieces.map((piece) => piece.text).join("") !== source.text) return node;
  let offset = 0;
  let changed = false;
  const content: JsonNode[] = [];
  for (const piece of pieces) {
    if (piece.node.type !== "text") {
      content.push(piece.node);
      offset += piece.text.length;
      continue;
    }
    const next = splitText(piece.node, offset, ranges);
    if (next.length !== 1 || next[0] !== piece.node) changed = true;
    content.push(...next);
    offset += piece.text.length;
  }
  return changed ? { ...node, content } : node;
}

/**
 * Copies a run's `w:rFonts` onto that run's text-style mark as `fontFamily`.
 * Only the run that carries a name gets it. Bold, color, highlight, size,
 * indent, line spacing, and space before or after stay.
 */
export function applyWordFonts(
  content: JsonNode,
  xml: string,
  textOf: (node: JsonNode) => string,
): JsonNode {
  const sources = readFonts(xml);
  if (!sources.length) return content;
  let cursor = 0;
  const take = (value: string) => {
    const key = normalize(value);
    if (!key) return null;
    for (let i = cursor; i < sources.length; i++) {
      if (normalize(sources[i].text) !== key) continue;
      cursor = i + 1;
      return sources[i];
    }
    return null;
  };
  const visit = (node: JsonNode): JsonNode => {
    if (node.type === "paragraph" || node.type === "heading") {
      const editorText = textOf(node);
      const source = take(editorText);
      if (!source) return node;
      return paint(node, source, editorText);
    }
    if (!node.content?.length) return node;
    let changed = false;
    const next = node.content.map((child) => {
      const updated = visit(child);
      if (updated !== child) changed = true;
      return updated;
    });
    return changed ? { ...node, content: next } : node;
  };
  return visit(content);
}
