import { XMLParser } from "fast-xml-parser";
import { hex as dingbatHex } from "dingbat-to-unicode";
import type { JsonNode } from "./file-schema";
import { paragraphIndentFromWord } from "./paragraph-indent";
import { isSymbolFont, symbolCode } from "./symbol-fonts";
import { documentText, normalize } from "./word-html";

function toLowerRoman(n: number): string {
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
  let res = "";
  for (const [val, sym] of romans) {
    while (n >= val) {
      res += sym;
      n -= val;
    }
  }
  return res || String(n);
}
const orderedParser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  trimValues: false,
  parseTagValue: false,
  processEntities: true,
});
type WordIndentAttrs = { firstLineIndent: number } | { hangingIndent: number };
type WordBodyParagraph = { text: string; indent: WordIndentAttrs | null };
function wordAttribute(attrs: Record<string, unknown>, name: string): unknown {
  return attrs[`@_w:${name}`] ?? attrs[`@_${name}`];
}
/** `w:ind` on this paragraph's own `w:pPr`, not a nested paragraph. */
function indentFromParagraph(nodes: any[]): WordIndentAttrs | null {
  for (const node of nodes) {
    for (const [key, value] of Object.entries(node)) {
      if (key === ":@" || !(key.endsWith(":pPr") || key === "pPr")) continue;
      if (!Array.isArray(value)) continue;
      for (const child of value as any[]) {
        const indKey = Object.keys(child).find(
          (name) => name === "ind" || name.endsWith(":ind"),
        );
        if (!indKey) continue;
        return paragraphIndentFromWord({
          firstLine: wordAttribute(child[":@"] ?? {}, "firstLine"),
          hanging: wordAttribute(child[":@"] ?? {}, "hanging"),
        });
      }
    }
  }
  return null;
}
/**
 * Body paragraphs in document order, with the special indent from `w:ind`.
 * Null means the XML could not be read as paragraphs.
 */
/**
 * A `w:sym` character: a symbol font's code, as the import keeps it (markWordSymbols), else the
 * same dingbat mapping Mammoth uses, so a symbol is the character beside it.
 */
function wordSymbol(attrs: Record<string, string> | undefined): string {
  const font = attrs?.["@_w:font"] ?? attrs?.["@_font"] ?? "";
  const char = attrs?.["@_w:char"] ?? attrs?.["@_char"] ?? "";
  if (!font || !char) return "";
  if (isSymbolFont(font)) return symbolCode(char);
  const mapped = dingbatHex(font, char) ?? (/^F0..$/i.test(char) ? dingbatHex(font, char.slice(2)) : undefined);
  return mapped?.string ?? "";
}
function readWordBody(xml: string, markers = true): WordBodyParagraph[] | null {
  let tree: any[];
  try {
    tree = orderedParser.parse(xml) as any[];
  } catch {
    return null;
  }
  const result: WordBodyParagraph[] = [];
  let footnoteCount = 0;
  let endnoteCount = 0;
  function text(nodes: any[]): string {
    let s = "";
    for (const n of nodes)
      for (const [k, v] of Object.entries(n)) {
        if (k === ":@" || k.endsWith(":del") || k.endsWith(":instrText"))
          continue;
        if (k.endsWith(":t") || k === "t")
          s += (v as any[]).map((n) => n["#text"] ?? "").join("");
        else if (k.endsWith(":tab")) s += "\t";
        else if (k.endsWith(":br")) s += "\n";
        else if (k.endsWith(":noBreakHyphen")) s += "\u2011";
        else if (k.endsWith(":softHyphen")) s += "\u00AD";
        else if (k.endsWith(":sym") || k === "sym") s += wordSymbol(n[":@"]);
        else if (
          k.endsWith(":footnoteReference") ||
          k === "footnoteReference"
        ) {
          footnoteCount++;
          if (markers) s += String(footnoteCount);
        } else if (
          k.endsWith(":endnoteReference") ||
          k === "endnoteReference"
        ) {
          endnoteCount++;
          if (markers) s += toLowerRoman(endnoteCount);
        } else if (k.endsWith(":checkBox") || k === "checkBox") {
          let checked = false;
          if (Array.isArray(v)) {
            for (const child of v) {
              const attrs = child[":@"] ?? {};
              const val = attrs["@_w:val"] ?? attrs["@_val"];
              for (const childKey of Object.keys(child)) {
                if (childKey === ":@") continue;
                if (childKey.endsWith(":checked") || childKey === "checked") {
                  if (
                    val === undefined ||
                    val === "1" ||
                    val === "true" ||
                    val === "on"
                  )
                    checked = true;
                } else if (
                  childKey.endsWith(":default") ||
                  childKey === "default"
                ) {
                  if (val === "1" || val === "true" || val === "on")
                    checked = true;
                }
              }
            }
          }
          s += checked ? "☒" : "☐";
        } else if (Array.isArray(v)) s += text(v);
      }
    return s;
  }
  function walk(nodes: any[]) {
    for (const n of nodes)
      for (const [k, v] of Object.entries(n)) {
        if (k === ":@" || k.endsWith(":del")) continue;
        if (k.endsWith(":p") || k === "p") {
          const t = text(v as any[]);
          if (t)
            result.push({ text: t, indent: indentFromParagraph(v as any[]) });
        } else if (Array.isArray(v)) walk(v);
      }
  }
  walk(tree);
  return result;
}
export function wordParagraphs(xml: string, markers = true): string[] {
  const body = readWordBody(xml, markers);
  if (!body) {
    const texts = [
      ...xml.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g),
    ];
    return texts.map((m) =>
      String(
        new XMLParser({ parseTagValue: false, trimValues: false }).parse(
          `<text>${m[1]}</text>`,
        ).text ?? "",
      ),
    );
  }
  return body.map((paragraph) => paragraph.text);
}
/**
 * Copies `w:ind` onto the imported paragraphs.
 * First line becomes `firstLineIndent`. Hanging becomes `hangingIndent`.
 * A paragraph with no `w:ind` is left alone, including any spacing it already has.
 */
export function applyWordParagraphIndents(content: JsonNode, xml: string): JsonNode {
  const sources = readWordBody(xml);
  if (!sources) return content;
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
  const stamp = (node: JsonNode, indent: WordIndentAttrs): JsonNode => {
    const attrs = { ...(node.attrs ?? {}) };
    if ("firstLineIndent" in indent) {
      delete attrs.hangingIndent;
      attrs.firstLineIndent = indent.firstLineIndent;
    } else {
      delete attrs.firstLineIndent;
      attrs.hangingIndent = indent.hangingIndent;
    }
    return { ...node, attrs };
  };
  const visit = (node: JsonNode): JsonNode => {
    if (node.type === "paragraph" || node.type === "heading") {
      const source = take(documentText(node));
      if (!source?.indent || node.type !== "paragraph") return node;
      return stamp(node, source.indent);
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
