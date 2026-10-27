/**
 * Edits to SVG source text that leave everything else as it was typed. Each
 * element is found by its position in document order, which is the order a
 * DOM parser gives the same elements, so the picture and the text agree.
 */

export type SvgTag = {
  name: string;
  /** Offset of the `<` that opens the element. */
  start: number;
  /** Offset just past the `>` that ends the start tag. */
  openEnd: number;
  /** Offset of the `</` that closes it; equal to `end` when it closes itself. */
  closeStart: number;
  /** Offset just past the element, closing tag included. */
  end: number;
  selfClosing: boolean;
  parent: number | null;
};

const NAME = /[A-Za-z_:][-\w.:]*/y;

function skipTo(source: string, from: number, marker: string) {
  const at = source.indexOf(marker, from);
  return at < 0 ? source.length : at + marker.length;
}

/** The end of a start or end tag, past quoted attribute values that may hold `>`. */
function tagEnd(source: string, from: number) {
  let quote = "";
  for (let i = from; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ">") return i + 1;
  }
  return source.length;
}

/** Every element in the source, in document order. Unclosed elements end where the source does. */
export function scanSvg(source: string): SvgTag[] {
  const tags: SvgTag[] = [];
  const open: number[] = [];
  let i = 0;
  while (i < source.length) {
    const lt = source.indexOf("<", i);
    if (lt < 0) break;
    if (source.startsWith("<!--", lt)) i = skipTo(source, lt + 4, "-->");
    else if (source.startsWith("<![CDATA[", lt)) i = skipTo(source, lt + 9, "]]>");
    else if (source.startsWith("<?", lt)) i = skipTo(source, lt + 2, "?>");
    else if (source.startsWith("<!", lt)) {
      const close = source.indexOf(">", lt);
      const subset = source.indexOf("[", lt);
      i = subset >= 0 && (close < 0 || subset < close) ? skipTo(source, subset, "]>") : skipTo(source, lt, ">");
    } else if (source[lt + 1] === "/") {
      const end = tagEnd(source, lt + 2);
      const index = open.pop();
      if (index !== undefined) {
        tags[index].closeStart = lt;
        tags[index].end = end;
      }
      i = end;
    } else {
      NAME.lastIndex = lt + 1;
      const name = NAME.exec(source)?.[0];
      if (!name) {
        i = lt + 1;
        continue;
      }
      const openEnd = tagEnd(source, lt + 1 + name.length);
      const selfClosing = source[openEnd - 2] === "/";
      tags.push({
        name,
        start: lt,
        openEnd,
        closeStart: selfClosing ? openEnd : source.length,
        end: selfClosing ? openEnd : source.length,
        selfClosing,
        parent: open.at(-1) ?? null,
      });
      if (!selfClosing) open.push(tags.length - 1);
      i = openEnd;
    }
  }
  return tags;
}

/** The local part of an element name, so `svg:rect` is a `rect`. */
export function localName(tag: Pick<SvgTag, "name">) {
  return tag.name.slice(tag.name.indexOf(":") + 1);
}

const ATTRIBUTE = /([^\s=/>]+)\s*=\s*("[^"]*"|'[^']*')/g;

export function decodeXml(text: string) {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, code: string) => {
    const lower = code.toLowerCase();
    if (lower === "amp") return "&";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "quot") return '"';
    if (lower === "apos") return "'";
    const value = lower.startsWith("#x") ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
    return Number.isFinite(value) ? String.fromCodePoint(value) : whole;
  });
}

export function escapeXml(text: string, quotes = false) {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return quotes ? escaped.replace(/"/g, "&quot;") : escaped;
}

type Found = { name: string; value: string; start: number; end: number };

function attributesOf(source: string, tag: SvgTag): Found[] {
  const from = tag.start + 1 + tag.name.length;
  const text = source.slice(from, tag.openEnd);
  const found: Found[] = [];
  for (const match of text.matchAll(ATTRIBUTE)) {
    const start = from + match.index;
    found.push({
      name: match[1],
      value: decodeXml(match[2].slice(1, -1)),
      start,
      end: start + match[0].length,
    });
  }
  return found;
}

export function svgAttributes(source: string, tag: SvgTag): Record<string, string> {
  return Object.fromEntries(attributesOf(source, tag).map((a) => [a.name, a.value]));
}

/** Set, add, or (with `null`) remove attributes of one element. */
export function setSvgAttributes(
  source: string,
  index: number,
  changes: Record<string, string | null>,
): string {
  const tag = scanSvg(source)[index];
  if (!tag) return source;
  const existing = attributesOf(source, tag);
  const edits: { start: number; end: number; text: string }[] = [];
  const added: string[] = [];
  for (const [name, value] of Object.entries(changes)) {
    const current = existing.find((a) => a.name === name);
    if (current && value === null) {
      let start = current.start;
      while (start > tag.start && /\s/.test(source[start - 1])) start--;
      edits.push({ start, end: current.end, text: "" });
    } else if (current && value !== null) {
      edits.push({ start: current.start, end: current.end, text: `${name}="${escapeXml(value, true)}"` });
    } else if (value !== null) added.push(` ${name}="${escapeXml(value, true)}"`);
  }
  if (added.length) {
    let at = tag.openEnd - (tag.selfClosing ? 2 : 1);
    while (at > tag.start && /\s/.test(source[at - 1])) at--;
    edits.push({ start: at, end: at, text: added.join("") });
  }
  edits.sort((a, b) => b.start - a.start);
  let next = source;
  for (const edit of edits) next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
  return next;
}

/** The range of the element's own line when nothing else shares it, otherwise the element. */
function wholeLines(source: string, start: number, end: number) {
  const lineStart = source.lastIndexOf("\n", start - 1) + 1;
  const newline = source.indexOf("\n", end);
  const lineEnd = newline < 0 ? source.length : newline + 1;
  if (source.slice(lineStart, start).trim() || source.slice(end, lineEnd).trim()) return { start, end };
  return { start: lineStart, end: lineEnd };
}

export function removeSvgElement(source: string, index: number): string {
  const tag = scanSvg(source)[index];
  if (!tag || tag.parent === null) return source;
  const range = wholeLines(source, tag.start, tag.end);
  return source.slice(0, range.start) + source.slice(range.end);
}

/** The indentation the root's children use, or two spaces. */
function childIndent(source: string, tags: SvgTag[]) {
  const child = tags.find((t) => t.parent === 0);
  if (!child) return "  ";
  const lineStart = source.lastIndexOf("\n", child.start - 1) + 1;
  const indent = source.slice(lineStart, child.start);
  return /^\s*$/.test(indent) ? indent : "  ";
}

/** Add markup as the root's last child, on its own line. Returns the new element's index too. */
export function appendSvgElement(source: string, markup: string): { source: string; index: number } {
  const tags = scanSvg(source);
  const root = tags[0];
  if (!root || root.selfClosing) return { source, index: -1 };
  const indent = childIndent(source, tags);
  const lineStart = source.lastIndexOf("\n", root.closeStart - 1) + 1;
  const ownLine = lineStart > root.openEnd && !source.slice(lineStart, root.closeStart).trim();
  const at = ownLine ? lineStart : root.closeStart;
  const text = ownLine ? `${indent}${markup}\n` : `\n${indent}${markup}\n`;
  const next = source.slice(0, at) + text + source.slice(at);
  const index = scanSvg(next).findIndex((t) => t.start === at + text.indexOf("<"));
  return { source: next, index };
}

/** Plain text inside an element that has no child elements; null when it has some. */
export function svgText(source: string, index: number): string | null {
  const tags = scanSvg(source);
  const tag = tags[index];
  if (!tag || tags.some((t) => t.parent === index)) return null;
  if (tag.selfClosing) return "";
  return decodeXml(source.slice(tag.openEnd, tag.closeStart));
}

export function setSvgText(source: string, index: number, text: string): string {
  const tags = scanSvg(source);
  const tag = tags[index];
  if (!tag || tags.some((t) => t.parent === index)) return source;
  const body = escapeXml(text);
  if (tag.selfClosing) {
    let at = tag.openEnd - 2;
    while (at > tag.start && /\s/.test(source[at - 1])) at--;
    return `${source.slice(0, at)}>${body}</${tag.name}>${source.slice(tag.openEnd)}`;
  }
  return source.slice(0, tag.openEnd) + body + source.slice(tag.closeStart);
}

/** The innermost element whose text covers the offset, or null outside the root. */
export function svgElementAt(source: string, offset: number): number | null {
  const tags = scanSvg(source);
  let found: number | null = null;
  tags.forEach((tag, index) => {
    if (offset >= tag.start && offset < tag.end) found = index;
  });
  return found;
}

/** Where an element's start tag sits in the source. */
export function svgTagRange(source: string, index: number) {
  const tag = scanSvg(source)[index];
  return tag ? { start: tag.start, end: tag.openEnd } : null;
}

const round = (value: number) => String(Math.round(value * 100) / 100);
const number = (value: string | undefined) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : null;
};

const POSITIONED: Record<string, string[][]> = {
  rect: [["x", "y"]],
  image: [["x", "y"]],
  use: [["x", "y"]],
  foreignObject: [["x", "y"]],
  svg: [["x", "y"]],
  text: [["x", "y"]],
  circle: [["cx", "cy"]],
  ellipse: [["cx", "cy"]],
  line: [
    ["x1", "y1"],
    ["x2", "y2"],
  ],
};

/** Prepend a translation, folding it into a leading translate that is already there. */
function translated(transform: string | undefined, dx: number, dy: number) {
  const current = transform?.trim() ?? "";
  const lead = /^translate\(\s*(-?[\d.eE+-]+)(?:[\s,]+(-?[\d.eE+-]+))?\s*\)/.exec(current);
  if (lead) {
    const x = Number(lead[1]) + dx;
    const y = Number(lead[2] ?? 0) + dy;
    const rest = current.slice(lead[0].length).trim();
    return `translate(${round(x)} ${round(y)})${rest ? ` ${rest}` : ""}`;
  }
  return `translate(${round(dx)} ${round(dy)})${current ? ` ${current}` : ""}`;
}

/**
 * The attributes that move an element by a distance in its parent's units.
 * Shapes with plain coordinates and no transform change those; anything else
 * gets a translate.
 */
export function movedAttributes(
  name: string,
  attrs: Record<string, string>,
  dx: number,
  dy: number,
): Record<string, string> {
  const pairs = POSITIONED[name];
  const plain =
    pairs &&
    !attrs.transform &&
    pairs.every(([x, y]) => number(attrs[x]) !== null && number(attrs[y]) !== null);
  if (!plain) return { transform: translated(attrs.transform, dx, dy) };
  const changes: Record<string, string> = {};
  for (const [x, y] of pairs) {
    changes[x] = round(number(attrs[x])! + dx);
    changes[y] = round(number(attrs[y])! + dy);
  }
  return changes;
}

export function moveSvgElement(source: string, index: number, dx: number, dy: number): string {
  const tag = scanSvg(source)[index];
  if (!tag || tag.parent === null || (!dx && !dy)) return source;
  return setSvgAttributes(source, index, movedAttributes(localName(tag), svgAttributes(source, tag), dx, dy));
}

/** Which elements a corner handle can resize, by changing their own size attributes. */
export function canResize(name: string, attrs: Record<string, string> = {}) {
  if (["circle", "ellipse", "line"].includes(name)) return true;
  return (
    ["rect", "image", "foreignObject", "use", "svg"].includes(name) &&
    !attrs.width?.endsWith("%") &&
    !attrs.height?.endsWith("%")
  );
}

/**
 * The attributes that grow or shrink an element by a distance in its own
 * units, dragging its far corner: a box keeps its top-left corner, a circle or
 * ellipse its centre, and a line its start.
 */
export function resizedAttributes(
  name: string,
  attrs: Record<string, string>,
  dx: number,
  dy: number,
): Record<string, string> {
  const grow = (key: string, by: number) => round(Math.max(1, (number(attrs[key]) ?? 0) + by));
  if (!canResize(name, attrs)) return {};
  if (name === "circle") return { r: grow("r", Math.max(dx, dy)) };
  if (name === "ellipse") return { rx: grow("rx", dx), ry: grow("ry", dy) };
  if (name === "line")
    return { x2: round((number(attrs.x2) ?? 0) + dx), y2: round((number(attrs.y2) ?? 0) + dy) };
  return { width: grow("width", dx), height: grow("height", dy) };
}

export function resizeSvgElement(source: string, index: number, dx: number, dy: number): string {
  const tag = scanSvg(source)[index];
  if (!tag || tag.parent === null) return source;
  return setSvgAttributes(source, index, resizedAttributes(localName(tag), svgAttributes(source, tag), dx, dy));
}

/** The root's drawing area in its own units, from its viewBox or its width and height. */
export function svgViewBox(source: string) {
  const root = scanSvg(source)[0];
  const attrs = root ? svgAttributes(source, root) : {};
  const box = attrs.viewBox?.trim().split(/[\s,]+/).map(Number);
  if (box?.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0)
    return { x: box[0], y: box[1], width: box[2], height: box[3] };
  const width = parseFloat(attrs.width ?? "");
  const height = parseFloat(attrs.height ?? "");
  return {
    x: 0,
    y: 0,
    width: Number.isFinite(width) && width > 0 ? width : 300,
    height: Number.isFinite(height) && height > 0 ? height : 150,
  };
}

export type SvgShape = "rect" | "ellipse" | "line" | "text";

/** Markup for a new shape, centred in the drawing and sized to a quarter of it. */
export function newShapeMarkup(source: string, shape: SvgShape) {
  const box = svgViewBox(source);
  const w = Math.max(20, Math.round(box.width / 4));
  const h = Math.max(20, Math.round(box.height / 4));
  const cx = Math.round(box.x + box.width / 2);
  const cy = Math.round(box.y + box.height / 2);
  if (shape === "rect")
    return `<rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" fill="#e8f0fe" stroke="#1a73e8" stroke-width="2"/>`;
  if (shape === "ellipse")
    return `<ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}" fill="#fef7e0" stroke="#f9ab00" stroke-width="2"/>`;
  if (shape === "line")
    return `<line x1="${cx - w / 2}" y1="${cy - h / 2}" x2="${cx + w / 2}" y2="${cy + h / 2}" stroke="#202124" stroke-width="2"/>`;
  const size = Math.max(12, Math.round(box.height / 16));
  return `<text x="${cx}" y="${cy}" font-family="sans-serif" font-size="${size}" text-anchor="middle" fill="#202124">Text</text>`;
}
