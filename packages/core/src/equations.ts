import { XMLParser } from "fast-xml-parser";
import type { JsonNode } from "./index";

/** Shown when a Word file has math we could not turn into an equation. */
export const EQUATION_LAYOUT_UNSUPPORTED =
  "Equations are retained as recovered text when available; editable equation layout is not supported.";

export type EqText = { kind: "text"; text: string };
export type EqSup = { kind: "sup"; base: EqNode; exp: EqNode };
export type EqSub = { kind: "sub"; base: EqNode; sub: EqNode };
export type EqFrac = { kind: "frac"; num: EqNode; den: EqNode };
export type EqRow = { kind: "row"; items: EqNode[] };
export type EqNode = EqText | EqSup | EqSub | EqFrac | EqRow;

export type ImportedEquation = { plain: string; expr: EqNode };

const orderedParser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  trimValues: false,
  parseTagValue: false,
  processEntities: true,
});

const ATOM = /^[A-Za-z0-9\u00C0-\u024F\u0370-\u03FF.]+/;

/** Linear math for the composer: `x^2` is a power, `(a+b)/c` is a stacked fraction. */
export function parseLinear(input: string): EqNode | null {
  const s = input.trim();
  if (!s) return null;
  let i = 0;
  const skip = () => {
    while (s[i] === " ") i++;
  };
  const expr = (): EqNode | null => {
    skip();
    const first = term();
    if (!first) return null;
    const items: EqNode[] = [first];
    for (;;) {
      skip();
      if (s[i] !== "+" && s[i] !== "-") break;
      const op = s[i++];
      const right = term();
      if (!right) return null;
      items.push({ kind: "text", text: op }, right);
    }
    return items.length === 1 ? first : { kind: "row", items };
  };
  const term = (): EqNode | null => {
    skip();
    let left = factor();
    if (!left) return null;
    for (;;) {
      skip();
      if (s[i] !== "/") break;
      i++;
      const right = factor();
      if (!right) return null;
      left = { kind: "frac", num: left, den: right };
    }
    return left;
  };
  const factor = (): EqNode | null => {
    skip();
    let left = primary();
    if (!left) return null;
    skip();
    if (s[i] === "^") {
      i++;
      const exp = factor();
      if (!exp) return null;
      left = { kind: "sup", base: left, exp };
    }
    return left;
  };
  const primary = (): EqNode | null => {
    skip();
    if (s[i] === "(" || s[i] === "{") {
      const close = s[i] === "(" ? ")" : "}";
      i++;
      const inner = expr();
      if (!inner) return null;
      skip();
      if (s[i] !== close) return null;
      i++;
      return inner;
    }
    const match = ATOM.exec(s.slice(i));
    if (!match) return null;
    i += match[0].length;
    return { kind: "text", text: match[0] };
  };
  const node = expr();
  skip();
  if (!node || i !== s.length) return null;
  return node;
}

export function plainOf(node: EqNode): string {
  switch (node.kind) {
    case "text":
      return node.text;
    case "sup":
      return plainOf(node.base) + plainOf(node.exp);
    case "sub":
      return plainOf(node.base) + plainOf(node.sub);
    case "frac":
      return plainOf(node.num) + plainOf(node.den);
    case "row":
      return node.items.map(plainOf).join("");
  }
}

/** Replace one text slot, counted in the same order the editor paints them. */
export function replaceSlot(node: EqNode, id: number, text: string): EqNode | null {
  let cursor = 0;
  let found = false;
  const walk = (current: EqNode): EqNode => {
    if (current.kind === "text") {
      if (cursor++ === id) {
        found = true;
        return { kind: "text", text };
      }
      return current;
    }
    if (current.kind === "sup")
      return { kind: "sup", base: walk(current.base), exp: walk(current.exp) };
    if (current.kind === "sub")
      return { kind: "sub", base: walk(current.base), sub: walk(current.sub) };
    if (current.kind === "frac")
      return { kind: "frac", num: walk(current.num), den: walk(current.den) };
    return { kind: "row", items: current.items.map(walk) };
  };
  const next = walk(node);
  return found ? next : null;
}

export function isEquation(value: unknown): value is EqNode {
  if (!value || typeof value !== "object") return false;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === "text") return typeof (value as EqText).text === "string";
  if (kind === "sup") {
    const node = value as EqSup;
    return isEquation(node.base) && isEquation(node.exp);
  }
  if (kind === "sub") {
    const node = value as EqSub;
    return isEquation(node.base) && isEquation(node.sub);
  }
  if (kind === "frac") {
    const node = value as EqFrac;
    return isEquation(node.num) && isEquation(node.den);
  }
  if (kind === "row") {
    const node = value as EqRow;
    return Array.isArray(node.items) && node.items.every(isEquation);
  }
  return false;
}

export function asEquation(value: unknown): EqNode {
  if (isEquation(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (isEquation(parsed)) return parsed;
    } catch {
      /* a linear expression, or plain text */
    }
    return parseLinear(value) ?? { kind: "text", text: value };
  }
  return { kind: "text", text: "" };
}

export function speakEquation(node: EqNode): string {
  switch (node.kind) {
    case "text":
      return node.text;
    case "sup":
      return `${speakEquation(node.base)} to the power of ${speakEquation(node.exp)}`;
    case "sub":
      return `${speakEquation(node.base)} sub ${speakEquation(node.sub)}`;
    case "frac":
      return `${speakEquation(node.num)} over ${speakEquation(node.den)}`;
    case "row":
      return node.items.map(speakEquation).join(" ");
  }
}

type Ordered = Record<string, unknown>;

function tagOf(node: Ordered): string {
  for (const key of Object.keys(node)) {
    if (key === ":@" || key === "#text") continue;
    const colon = key.lastIndexOf(":");
    return colon >= 0 ? key.slice(colon + 1) : key;
  }
  return "";
}

function childrenOf(node: Ordered): Ordered[] {
  for (const [key, value] of Object.entries(node)) {
    if (key === ":@" || key === "#text") continue;
    return Array.isArray(value) ? (value as Ordered[]) : [];
  }
  return [];
}

function textContent(nodes: Ordered[]): string {
  let text = "";
  for (const node of nodes) {
    if (typeof node["#text"] === "string") text += node["#text"];
    else text += textContent(childrenOf(node));
  }
  return text;
}

function combine(items: EqNode[]): EqNode {
  const flat: EqNode[] = [];
  for (const item of items) {
    if (item.kind === "text" && item.text === "") continue;
    if (item.kind === "row") flat.push(...item.items);
    else flat.push(item);
  }
  if (flat.length === 0) return { kind: "text", text: "" };
  if (flat.length === 1) return flat[0];
  return { kind: "row", items: flat };
}

function arg(nodes: Ordered[], name: string): EqNode {
  const found = nodes.find((node) => tagOf(node) === name);
  return found ? parseOmmlNodes(childrenOf(found)) : { kind: "text", text: "" };
}

function parseOmmlNodes(nodes: Ordered[]): EqNode {
  const items: EqNode[] = [];
  for (const node of nodes) {
    const tag = tagOf(node);
    if (!tag || tag.endsWith("Pr")) continue;
    if (tag === "t") {
      const text = textContent(childrenOf(node));
      if (text) items.push({ kind: "text", text });
      continue;
    }
    const kids = childrenOf(node);
    if (tag === "sSup")
      items.push({ kind: "sup", base: arg(kids, "e"), exp: arg(kids, "sup") });
    else if (tag === "sSub")
      items.push({ kind: "sub", base: arg(kids, "e"), sub: arg(kids, "sub") });
    else if (tag === "f")
      items.push({ kind: "frac", num: arg(kids, "num"), den: arg(kids, "den") });
    else {
      const inner = parseOmmlNodes(kids);
      if (!(inner.kind === "text" && inner.text === "")) items.push(inner);
    }
  }
  return combine(items);
}

function decodeXml(value: string) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function mathTexts(fragment: string) {
  return [...fragment.matchAll(/<m:t\b[^>]*>([\s\S]*?)<\/m:t>/g)]
    .map((match) => decodeXml(match[1]))
    .join("");
}

function readEquation(fragment: string): ImportedEquation {
  const plain = mathTexts(fragment);
  try {
    const tree = orderedParser.parse(fragment) as Ordered[];
    const expr = parseOmmlNodes(tree);
    if (expr.kind === "text" && expr.text === "" && plain)
      return { plain, expr: { kind: "text", text: plain } };
    return { plain: plain || plainOf(expr), expr };
  } catch {
    return { plain, expr: { kind: "text", text: plain } };
  }
}

function nextMath(xml: string, from: number) {
  const start = xml.indexOf("<m:oMath", from);
  if (start < 0) return null;
  const para = xml.startsWith("<m:oMathPara", start);
  return { start, endTag: para ? "</m:oMathPara>" : "</m:oMath>" };
}

/**
 * Replace each Office math element with a text token. Mammoth keeps the token,
 * and the importer swaps it for an equation node. `plain` is the original
 * math text so the body-text check still matches the untouched source.
 */
export function extractOfficeMath(xml: string): {
  xml: string;
  equations: ImportedEquation[];
} {
  const equations: ImportedEquation[] = [];
  let result = "";
  let cursor = 0;
  for (;;) {
    const found = nextMath(xml, cursor);
    if (!found) {
      result += xml.slice(cursor);
      break;
    }
    const end = xml.indexOf(found.endTag, found.start);
    if (end < 0) {
      result += xml.slice(cursor);
      break;
    }
    const close = end + found.endTag.length;
    result += xml.slice(cursor, found.start);
    const index = equations.length;
    equations.push(readEquation(xml.slice(found.start, close)));
    result += `<w:r><w:t>SLEQTOKEN${index}END</w:t></w:r>`;
    cursor = close;
  }
  return { xml: result, equations };
}

const TOKEN = /SLEQTOKEN(\d+)END/g;

function splitText(node: JsonNode, equations: ImportedEquation[]): JsonNode[] {
  const text = node.text ?? "";
  if (!text.includes("SLEQTOKEN")) return [node];
  const parts: JsonNode[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) {
      const slice = text.slice(last, index);
      if (slice) parts.push({ ...node, text: slice });
    }
    const equation = equations[Number(match[1])];
    if (equation)
      parts.push({
        type: "equation",
        attrs: { expr: equation.expr, plain: equation.plain },
      });
    else parts.push({ ...node, text: match[0] });
    last = index + match[0].length;
  }
  if (last < text.length) {
    const slice = text.slice(last);
    if (slice) parts.push({ ...node, text: slice });
  }
  return parts;
}

export function spliceEquationTokens(
  node: JsonNode,
  equations: ImportedEquation[],
): JsonNode {
  if (!equations.length) return node;
  const walk = (current: JsonNode): JsonNode => {
    if (!current.content) return current;
    return {
      ...current,
      content: current.content.flatMap((child) => {
        if (child.type === "text") return splitText(child, equations);
        return [walk(child)];
      }),
    };
  };
  return walk(node);
}
