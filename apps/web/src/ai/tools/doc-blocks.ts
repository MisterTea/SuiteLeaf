import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { asEquation, plainOf, type EqNode } from "@suiteleaf/core/equations";
import { imageCrop } from "@suiteleaf/core/image-crop";
import { documentMatches } from "../../editors/doc-search-plugin";
import { ToolError } from "../host";

export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Blocks with their text, for reading and for finding where things are. */
export function blocks(editor: Editor) {
  const list: { pos: number; end: number; type: string; text: string; label: string }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    const parent = editor.state.doc.resolve(pos).parent;
    const inList = parent.type.name === "listItem";
    const label =
      node.type.name === "heading"
        ? `Heading ${node.attrs.level}`
        : parent.type.name === "note"
          ? parent.attrs.kind === "endnote"
            ? "Endnote"
            : "Footnote"
          : inList
            ? editor.state.doc.resolve(pos).node(-1)?.type.name === "orderedList"
              ? "Numbered item"
              : "Bullet"
            : editor.state.doc.resolve(pos).node(-1)?.type.name?.startsWith("table")
              ? "Table cell"
              : "Paragraph";
    list.push({ pos, end: pos + node.nodeSize, type: node.type.name, text: shownText(node), label });
    return false;
  });
  return list;
}

export function imageAltText(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function imageTitle(value: unknown) {
  return typeof value === "string" ? value : "";
}

/** Photos, on their own line or in the line, which blocks() leaves out because they hold no text. */
export function images(editor: Editor) {
  const list: { pos: number; end: number; name: string; alt: string; title: string; cropRight: number }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "image" || node.type.name === "inlineImage") {
      const alt = imageAltText(node.attrs.alt);
      const title = imageTitle(node.attrs.title);
      list.push({
        pos,
        end: pos + node.nodeSize,
        alt,
        title,
        name: alt || title || "photo",
        cropRight: imageCrop(node.attrs).right,
      });
    }
  });
  return list;
}

const SUPER: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ" };
const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎" };

export function equationLabel(expr: EqNode) {
  if (expr.kind === "sup") return `${plainOf(expr.base)}^${plainOf(expr.exp)}`;
  if (expr.kind === "frac") return `(${plainOf(expr.num)})/${plainOf(expr.den)}`;
  return plainOf(expr);
}

export function equationsIn(editor: Editor) {
  const list: { kind: string; label: string; key: string; pos: number; expr: EqNode }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "equation") return;
    const expr = asEquation(node.attrs.expr);
    list.push({ kind: expr.kind, label: equationLabel(expr), key: JSON.stringify(expr), pos, expr });
  });
  return list;
}

/** What is still missing from the Methods sentence, so the next call is exact. */
export function equationHint(list: { kind: string; expr?: EqNode }[]) {
  if (!list.some((item) => item.kind === "sup"))
    return 'Next, call insert_equation with expression "x^2" and after "The model fits".';
  if (!list.some((item) => item.kind === "frac"))
    return 'Next, call insert_equation with expression "(a+b)/c" and after "and the ratio".';
  const frac = list.find((item) => item.kind === "frac" && item.expr?.kind === "frac");
  const den = frac?.expr?.kind === "frac" ? plainOf(frac.expr.den) : "";
  if (den !== "d")
    return `Next, call edit_equation with symbol "${den || "c"}" and replacement "d" so the denominator becomes d. Then stop.`;
  return "The square and the fraction are in the sentence, and the denominator is d. Stop. Do not insert another equation.";
}

/** A block's text as it looks: superscript and subscript digits read as ² and ₂, the way people type them. */
function shownText(node: PMNode) {
  let text = "";
  node.forEach((child) => {
    if (child.type.name === "equation") {
      text += ` [equation ${equationLabel(asEquation(child.attrs.expr))}]`;
      return;
    }
    const t = child.textContent;
    const map = child.marks.some((m) => m.type.name === "superscript")
      ? SUPER
      : child.marks.some((m) => m.type.name === "subscript")
        ? SUB
        : undefined;
    text += map && [...t].every((c) => map[c]) ? [...t].map((c) => map[c]).join("") : t;
  });
  return text;
}

/** Text compared loosely: any case, and ² the same as 2. */
export const loose = (text: string) => text.normalize("NFKC").toLowerCase();
/** Drop a "6. [Paragraph] " prefix copied from read_document. */
export const unlabel = (text: string) => text.replace(/^\s*(\d+\.\s*)?\[(Heading \d|Paragraph|Bullet|Numbered item|Table cell|Photo)\]\s*/, "");

/** Drop Markdown marks ("# ", "- ", "**") the model copies from what it typed. */
export const unmark = (text: string) =>
  text.replace(/\*\*/g, "").replace(/^\s*(#{1,3}|[-*•]|\d+[.)])\s+/, "").trim() || text;

/** The first block containing `text`, matched loosely if not exactly. */
export function findBlock(list: ReturnType<typeof blocks>, text: string) {
  const want = unmark(unlabel(text));
  if (!want.trim()) return undefined;
  return list.find((b) => b.text.includes(want)) ?? list.find((b) => loose(b.text).includes(loose(want)));
}

export function noBlock(list: ReturnType<typeof blocks>, text: string) {
  // A table reads as one entry, not one per cell.
  const texts = list
    .filter((b) => b.text)
    .filter((b, i, all) => b.label !== "Table cell" || all[i - 1]?.label !== "Table cell")
    .slice(0, 20)
    .map((b) => (b.label === "Table cell" ? `a table starting "${b.text.slice(0, 40)}"` : `"${b.text.slice(0, 60)}"`));
  const objects = list.some((b) => b.label === "Table cell") ? ' To go right below a table or photo, use "table" or "photo".' : "";
  return new ToolError(
    texts.length
      ? `No paragraph contains "${text}". Use a few words copied exactly from one of them; the paragraphs are: ${texts.join(", ")}.${objects}`
      : `No paragraph contains "${text}". The document is empty.`,
  );
}

/**
 * The table or photo `after` points at, to put things right below it: text in
 * a table cell means below the whole table; a photo's file name means that
 * photo; "table", "[Photo]" or "the image" mean the last one, unless a
 * paragraph contains that word.
 */
export function objectAfter(editor: Editor, after: string, found?: { pos: number; label: string }) {
  const doc = editor.state.doc;
  if (found?.label === "Table cell") {
    const $pos = doc.resolve(found.pos);
    for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).type.name === "table") return { end: $pos.after(d), label: "the table" };
  }
  const named =
    !found && images(editor).filter((p) => !doc.nodeAt(p.pos)?.isInline && loose(after).includes(loose(p.name))).at(-1);
  if (named) return { end: named.end, label: `the photo "${named.name}"` };
  const word = /^\W*(?:the\s+)?(table|photo|image|picture)\W*$/i.exec(after)?.[1]?.toLowerCase();
  if (!word || (found && !/^\s*\[/.test(after))) return undefined;
  const type = word === "table" ? "table" : "image";
  let last: { end: number; label: string } | undefined;
  doc.descendants((node, pos) => {
    if (node.type.name === type)
      last = {
        end: pos + node.nodeSize,
        label: type === "table" ? "the table" : `the photo "${node.attrs.alt || node.attrs.title || "photo"}"`,
      };
  });
  return last;
}

/** Put the cursor in an empty paragraph at `pos` (between blocks), adding one if needed. */
export function openParagraphAt(editor: Editor, pos: number) {
  const next = editor.state.doc.resolve(pos).nodeAfter;
  if (next?.type.name === "paragraph" && !next.textContent) {
    editor.chain().setTextSelection(pos + 1).run();
    return;
  }
  const tr = editor.state.tr.insert(pos, editor.schema.nodes.paragraph.create());
  editor.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + 1)));
}

/** Find the n-th (1-based) occurrence of `text`, ignoring case if needed. */
export function locate(editor: Editor, raw: string, occurrence = 1) {
  const text = unlabel(raw);
  if (!text) throw new ToolError("Say which text to use.");
  let matches = documentMatches(editor.state.doc, text, { matchCase: true, regex: false, ignoreDiacritics: false }).matches;
  if (!matches.length)
    matches = documentMatches(editor.state.doc, text, { matchCase: false, regex: false, ignoreDiacritics: true }).matches;
  if (!matches.length && text.normalize("NFKC") !== text)
    matches = documentMatches(editor.state.doc, text.normalize("NFKC"), { matchCase: false, regex: false, ignoreDiacritics: true }).matches;
  if (!matches.length && unmark(text) !== text)
    matches = documentMatches(editor.state.doc, unmark(text), { matchCase: false, regex: false, ignoreDiacritics: true }).matches;
  if (!matches.length)
    throw new ToolError(`"${text}" is not in the document. Use read_document to see the exact text.`);
  const match = matches[Math.min(Math.max(1, occurrence), matches.length) - 1];
  return match;
}

export function rectAt(editor: Editor, pos: number) {
  try {
    const c = editor.view.coordsAtPos(Math.min(pos, editor.state.doc.content.size));
    return new DOMRect(c.left, c.top, Math.max(2, c.right - c.left), c.bottom - c.top);
  } catch {
    return undefined;
  }
}

/** The paragraph containing `text`, ignoring Markdown copied from write_text ("# ", "- ", "**"). */
export const endOfDocument = (editor: Editor) => {
  const last = blocks(editor).at(-1);
  return last ? last.end - 1 : 1;
};

/** Selecting the match of `text` the tools edit, and the block it is in. */
export function textSelection(editor: Editor) {
  const selectMatch = (text: string, occurrence?: number) => {
    const m = locate(editor, text, occurrence);
    editor.chain().setTextSelection(m).scrollIntoView().run();
    return m;
  };
  const blockOf = (text?: string, occurrence?: number) => {
    if (text) selectMatch(text, occurrence);
    return editor.state.selection.$from.parent;
  };
  return { selectMatch, blockOf };
}

export function headingNamesNow(editor: Editor) {
  return blocks(editor)
    .filter((b) => b.type === "heading" && b.text.trim())
    .map((b) => b.text.trim())
    .join(" | ");
}
