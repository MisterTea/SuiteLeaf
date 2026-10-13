import type { JsonNode } from "./index";

type ColorRun = { text: string; color: string | null };

type ColorParagraph = { text: string; runs: ColorRun[] };

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

/**
 * A run's `w:color`. `auto` and a missing element are no font color.
 * Only a 6-digit hex is copied, so a highlight or shading fill is not a font color.
 */
function runFontColor(inner: string): string | null {
  const properties = tagInner(inner, "rPr");
  const tag = /<(?:[\w.-]+:)?color\b([^>]*?)\/?>/.exec(properties);
  const val =
    /(?:[\w.-]+:)?val="([^"]*)"/i.exec(tag?.[1] ?? "")?.[1]?.trim() ?? "";
  if (!/^[0-9a-f]{6}$/i.test(val)) return null;
  return `#${val.toLowerCase()}`;
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

function runsIn(paragraphXml: string): ColorRun[] {
  const body = stripTag(stripTag(paragraphXml, "pPr"), "del");
  const runs: ColorRun[] = [];
  for (const match of body.matchAll(
    /<(?:[\w.-]+:)?r\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?r>/g,
  )) {
    const text = runText(match[1]);
    if (!text) continue;
    runs.push({ text, color: runFontColor(match[1]) });
  }
  return runs;
}

function readColors(xml: string): ColorParagraph[] {
  const body =
    /<(?:[\w.-]+:)?body\b[^>]*>([\s\S]*)<\/(?:[\w.-]+:)?body>/.exec(xml)?.[1] ??
    xml;
  const flat = stripTag(
    stripTag(stripTag(body, "txbxContent"), "drawing"),
    "pict",
  );
  const paragraphs: ColorParagraph[] = [];
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

function marksWithColor(
  marks: JsonNode["marks"] | undefined,
  color: string | null,
): JsonNode["marks"] | undefined {
  const kept = (marks ?? [])
    .filter((mark) => mark.type !== "textStyle")
    .map((mark) => ({
      type: mark.type,
      ...(mark.attrs ? { attrs: { ...mark.attrs } } : {}),
    }));
  const previous = marks?.find((mark) => mark.type === "textStyle");
  const attrs: Record<string, unknown> = { ...(previous?.attrs ?? {}) };
  if (color) attrs.color = color;
  else delete attrs.color;
  const styled = Object.entries(attrs).filter(
    ([, value]) => value != null && value !== "",
  );
  if (styled.length)
    kept.push({ type: "textStyle", attrs: Object.fromEntries(styled) });
  return kept.length ? kept : undefined;
}

function withColor(node: JsonNode, color: string): JsonNode {
  const marks = marksWithColor(node.marks, color);
  return { ...node, ...(marks ? { marks } : {}) };
}

function colorCovering(
  ranges: { from: number; to: number; color: string }[],
  from: number,
  to: number,
): string | null {
  return (
    ranges.find((range) => range.from <= from && range.to >= to)?.color ?? null
  );
}

function splitText(
  node: JsonNode,
  start: number,
  ranges: { from: number; to: number; color: string }[],
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
    const color = colorCovering(ranges, start, end);
    return color ? [withColor(node, color)] : [node];
  }
  const out: JsonNode[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i];
    const to = sorted[i + 1];
    if (from === to) continue;
    const sliceText = text.slice(from - start, to - start);
    const marks = marksWithColor(node.marks, colorCovering(ranges, from, to));
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
  source: ColorParagraph,
  editorText: string,
): JsonNode {
  if (!source.runs.some((run) => run.color)) return node;
  if (editorText !== source.text) return node;
  const ranges: { from: number; to: number; color: string }[] = [];
  let at = 0;
  for (const run of source.runs) {
    const next = at + run.text.length;
    if (run.color) ranges.push({ from: at, to: next, color: run.color });
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
 * Copies a run's `w:color` onto that run's text-style mark.
 * `w:val="auto"` and a missing `w:color` leave the word uncolored.
 * Bold, highlight, indent, line spacing, and space before or after stay.
 */
export function applyWordTextColors(
  content: JsonNode,
  xml: string,
  textOf: (node: JsonNode) => string,
): JsonNode {
  const sources = readColors(xml);
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
