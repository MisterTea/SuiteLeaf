import type { JsonNode } from "./index";

/**
 * Word highlighter names this story needs, plus the rest of the named set so
 * an unknown name is left plain instead of being painted yellow.
 * Yellow is the editor's highlight yellow.
 */
const WORD_HIGHLIGHT: Record<string, string> = {
  yellow: "#ffff00",
  green: "#00ff00",
  cyan: "#00ffff",
  magenta: "#ff00ff",
  blue: "#0000ff",
  red: "#ff0000",
  darkblue: "#00008b",
  darkcyan: "#008b8b",
  darkgreen: "#006400",
  darkmagenta: "#8b008b",
  darkred: "#8b0000",
  darkyellow: "#808000",
  darkgray: "#a9a9a9",
  lightgray: "#d3d3d3",
  black: "#000000",
  white: "#ffffff",
};

type HighlightRun = { text: string; color: string | null };

type HighlightParagraph = { text: string; runs: HighlightRun[] };

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

function hexFill(fill: string | undefined): string | null {
  if (!fill || !/^[0-9a-f]{6}$/i.test(fill)) return null;
  return `#${fill.toLowerCase()}`;
}

/** Highlighter wins. A run with neither stays plain. Paragraph shading is ignored. */
function runColor(inner: string): string | null {
  const properties = tagInner(inner, "rPr");
  const highlight = /<(?:[\w.-]+:)?highlight\b([^>]*?)\/?>/.exec(properties);
  const named = /(?:[\w.-]+:)?val="([^"]+)"/i
    .exec(highlight?.[1] ?? "")?.[1]
    ?.toLowerCase();
  if (named && named !== "none" && WORD_HIGHLIGHT[named])
    return WORD_HIGHLIGHT[named];
  const shading = /<(?:[\w.-]+:)?shd\b([^>]*?)\/?>/.exec(properties);
  const fill = /(?:[\w.-]+:)?fill="([^"]+)"/i.exec(shading?.[1] ?? "")?.[1];
  return hexFill(fill);
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

function runsIn(paragraphXml: string): HighlightRun[] {
  const body = stripTag(stripTag(paragraphXml, "pPr"), "del");
  const runs: HighlightRun[] = [];
  for (const match of body.matchAll(
    /<(?:[\w.-]+:)?r\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?r>/g,
  )) {
    const text = runText(match[1]);
    if (!text) continue;
    runs.push({ text, color: runColor(match[1]) });
  }
  return runs;
}

function readHighlights(xml: string): HighlightParagraph[] {
  const body =
    /<(?:[\w.-]+:)?body\b[^>]*>([\s\S]*)<\/(?:[\w.-]+:)?body>/.exec(xml)?.[1] ??
    xml;
  const flat = stripTag(
    stripTag(stripTag(body, "txbxContent"), "drawing"),
    "pict",
  );
  const paragraphs: HighlightParagraph[] = [];
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

function copyMarks(
  marks: JsonNode["marks"] | undefined,
): JsonNode["marks"] | undefined {
  if (!marks?.length) return undefined;
  return marks
    .filter((mark) => mark.type !== "highlight")
    .map((mark) => ({
      type: mark.type,
      ...(mark.attrs ? { attrs: { ...mark.attrs } } : {}),
    }));
}

function withHighlight(node: JsonNode, color: string): JsonNode {
  const marks = copyMarks(node.marks) ?? [];
  marks.push({ type: "highlight", attrs: { color } });
  return { ...node, marks };
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
    return color ? [withHighlight(node, color)] : [node];
  }
  const out: JsonNode[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i];
    const to = sorted[i + 1];
    if (from === to) continue;
    const marks = copyMarks(node.marks);
    const slice: JsonNode = {
      type: "text",
      text: text.slice(from - start, to - start),
      ...(marks?.length ? { marks } : {}),
    };
    const color = colorCovering(ranges, from, to);
    out.push(color ? withHighlight(slice, color) : slice);
  }
  return out;
}

function paint(
  node: JsonNode,
  source: HighlightParagraph,
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
 * Copies `w:highlight` and run `w:shd` onto highlight marks.
 * Only the runs that carry the color get it. Other character marks stay.
 * A paragraph indent, line spacing, or space before on the same paragraph is
 * left on the node.
 */
export function applyWordHighlights(
  content: JsonNode,
  xml: string,
  textOf: (node: JsonNode) => string,
): JsonNode {
  const sources = readHighlights(xml);
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
