import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { undoDepth } from "@tiptap/pm/history";
import { Type } from "@earendil-works/pi-ai";
import type { PageSettings } from "@suiteleaf/core/document-layout";
import { documentMatches } from "../../editors/doc-search-plugin";
import { misspelledWords, spellingSuggestions } from "../../editors/doc-spelling";
import { ToolError, tool, type SuiteTool } from "../host";
import { requestFile } from "../file-request";
import { baselineSnapshot, markBaseline, ownUndoSteps } from "../guard";

/** What the Docs editor lends the agent. */
export interface DocsAgentContext {
  editor: Editor;
  title: string;
  /** Show the find and replace dialog with these values. */
  showFind: (query: string, replacement: string, matchCase: boolean) => void;
  /** Record a "Replaced N" result in the dialog. */
  showReplaced: (count: number) => void;
  closeFind: () => void;
  showPageSetup: (draft: PageSettings) => void;
  pageSettings: () => PageSettings;
  closePageSetup: () => void;
  showSpelling: () => void;
  jumpToHeading: (pos: number) => void;
  insertImage: (file: File) => Promise<void>;
  /** Undefined once the browser downloads it; on the desktop, the saved path or null if cancelled. */
  exportAs: (format: "docx" | "html" | "txt") => Promise<string | null | undefined>;
  pageCount: number;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Blocks with their text, for reading and for finding where things are. */
function blocks(editor: Editor) {
  const list: { pos: number; end: number; type: string; text: string; label: string }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    const parent = editor.state.doc.resolve(pos).parent;
    const inList = parent.type.name === "listItem";
    const label =
      node.type.name === "heading"
        ? `Heading ${node.attrs.level}`
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

/** Photos, which blocks() leaves out because they hold no text. */
function images(editor: Editor) {
  const list: { pos: number; end: number; name: string }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "image")
      list.push({
        pos,
        end: pos + node.nodeSize,
        name: String(node.attrs.alt || node.attrs.title || "photo"),
      });
  });
  return list;
}

/** What the document holds, counting table cells as a table rather than as paragraphs. */
function contents(editor: Editor) {
  let tables = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "table") tables++;
  });
  const paragraphs = blocks(editor).filter((b) => b.text && b.label !== "Table cell").length;
  const photos = images(editor).length;
  return `${paragraphs} paragraph(s) with text${tables ? `, ${tables} table(s)` : ""}${photos ? `, ${photos} photo(s)` : ""}`;
}

const SUPER: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ" };
const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎" };

/** A block's text as it looks: superscript and subscript digits read as ² and ₂, the way people type them. */
function shownText(node: PMNode) {
  let text = "";
  node.forEach((child) => {
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
const loose = (text: string) => text.normalize("NFKC").toLowerCase();
/** Drop a "6. [Paragraph] " prefix copied from read_document. */
const unlabel = (text: string) => text.replace(/^\s*(\d+\.\s*)?\[(Heading \d|Paragraph|Bullet|Numbered item|Table cell|Photo)\]\s*/, "");

/** Drop Markdown marks ("# ", "- ", "**") the model copies from what it typed. */
const unmark = (text: string) =>
  text.replace(/\*\*/g, "").replace(/^\s*(#{1,3}|[-*•]|\d+[.)])\s+/, "").trim() || text;

/** The first block containing `text`, matched loosely if not exactly. */
function findBlock(list: ReturnType<typeof blocks>, text: string) {
  const want = unmark(unlabel(text));
  if (!want.trim()) return undefined;
  return list.find((b) => b.text.includes(want)) ?? list.find((b) => loose(b.text).includes(loose(want)));
}

function noBlock(list: ReturnType<typeof blocks>, text: string) {
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
function objectAfter(editor: Editor, after: string, found?: { pos: number; label: string }) {
  const doc = editor.state.doc;
  if (found?.label === "Table cell") {
    const $pos = doc.resolve(found.pos);
    for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).type.name === "table") return { end: $pos.after(d), label: "the table" };
  }
  const named = !found && images(editor).filter((p) => loose(after).includes(loose(p.name))).at(-1);
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
function openParagraphAt(editor: Editor, pos: number) {
  const next = editor.state.doc.resolve(pos).nodeAfter;
  if (next?.type.name === "paragraph" && !next.textContent) {
    editor.chain().setTextSelection(pos + 1).run();
    return;
  }
  const tr = editor.state.tr.insert(pos, editor.schema.nodes.paragraph.create());
  editor.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + 1)));
}

/** Find the n-th (1-based) occurrence of `text`, ignoring case if needed. */
function locate(editor: Editor, raw: string, occurrence = 1) {
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

function rectAt(editor: Editor, pos: number) {
  try {
    const c = editor.view.coordsAtPos(Math.min(pos, editor.state.doc.content.size));
    return new DOMRect(c.left, c.top, Math.max(2, c.right - c.left), c.bottom - c.top);
  } catch {
    return undefined;
  }
}

/** The paragraph containing `text`, ignoring Markdown copied from write_text ("# ", "- ", "**"). */
const endOfDocument = (editor: Editor) => {
  const last = blocks(editor).at(-1);
  return last ? last.end - 1 : 1;
};

/** Text the model quoted with Markdown marks ("# Volunteers"), as it reads in the document. */
const withoutMarks = (text: string) => text.replace(/^\s*(#{1,6}|[-*•]|\d+[.)])\s+/, "").replace(/\*\*/g, "");

/**
 * Insert lightweight Markdown: "# " headings, "- " bullets, "1. " numbers, **bold**.
 * With `keepList`, plain lines typed in a list stay list items (as Enter in a list does).
 * Returns how many plain lines became list items that way.
 */
async function writeLines(editor: Editor, text: string, animate: boolean, keepList = false) {
  // Blank lines separate paragraphs; they don't become empty paragraphs.
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => line.trim());
  let continued = 0;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (i > 0) {
      if (editor.isActive("listItem")) editor.chain().splitListItem("listItem").run();
      else editor.chain().splitBlock().run();
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const leaveList = () => {
      while (editor.isActive("listItem") && editor.chain().liftListItem("listItem").run());
    };
    if (heading) {
      leaveList();
      editor.chain().setHeading({ level: heading[1].length as 1 | 2 | 3 }).run();
      line = heading[2];
    } else if (bullet || numbered) {
      const want = bullet ? "bulletList" : "orderedList";
      if (!editor.isActive(want)) {
        leaveList();
        editor.chain().setParagraph().run();
        if (bullet) editor.chain().toggleBulletList().run();
        else editor.chain().toggleOrderedList().run();
      }
      line = (bullet ?? numbered)![1];
    } else if (keepList && editor.isActive("listItem")) {
      continued++;
    } else {
      leaveList();
      editor.chain().setParagraph().run();
    }
    const content = line
      .split(/\*\*/)
      .flatMap((part, index) =>
        part ? [{ type: "text", text: part, ...(index % 2 === 1 ? { marks: [{ type: "bold" }] } : {}) }] : [],
      );
    if (content.length) editor.chain().focus().insertContent(content).run();
    if (animate) await wait(18);
  }
  return continued;
}

export function docTools(ctx: DocsAgentContext): SuiteTool[] {
  const { editor } = ctx;
  const selectMatch = (text: string, occurrence?: number) => {
    const m = locate(editor, text, occurrence);
    editor.chain().setTextSelection(m).scrollIntoView().run();
    return m;
  };
  const blockOf = (text?: string, occurrence?: number) => {
    if (text) selectMatch(text, occurrence);
    return editor.state.selection.$from.parent;
  };
  return [
    tool({
      name: "read_document",
      label: "Read the document",
      description:
        "Read the document's text, one numbered line per paragraph, heading, list item, table cell or photo, with its style.",
      parameters: Type.Object({}),
      target: () => editor.view.dom,
      execute: () => {
        const list = [...blocks(editor), ...images(editor).map((p) => ({ pos: p.pos, label: "Photo", text: p.name }))].sort(
          (a, b) => a.pos - b.pos,
        );
        const lines = list.map((b, i) => `${i + 1}. [${b.label}] ${b.text || "(empty)"}`);
        return `"${ctx.title}", ${ctx.pageCount} page(s).\n${lines.join("\n") || "The document is empty."}`;
      },
    }),
    tool({
      name: "write_text",
      label: "Type text",
      description:
        "Type text into the document. Each line becomes a paragraph. Start a line with '# ' for a Heading 1 (a main section), '## ' for a Heading 2 (a sub-section) or '### ' for a Heading 3, '- ' for a bullet, '1. ' for a numbered item; wrap words in **double asterisks** for bold. By default the text goes at the end of the document (leave out `after` to keep adding to the end); give `after` to insert it right after the one paragraph or heading containing that text (text that starts with a heading goes after that heading's paragraphs; lines typed after a list item become items of that list), or set `replace_document` to start over.",
      parameters: Type.Object({
        text: Type.String({ description: "The text to type." }),
        after: Type.Optional(
          Type.String({
            description:
              'Insert the text right after the paragraph or heading containing this text, before whatever follows it. "table" or "photo" means right below the last table or photo.',
          }),
        ),
        replace_document: Type.Optional(Type.Boolean({ description: "Replace everything in the document." })),
      }),
      intent: /\b(replace|rewrite|re-?type|start (over|again)|overwrite|clear|wipe|instead of (what|everything))\b/i,
      confirm: ({ replace_document }) => {
        const words = editor.getText().trim().split(/\s+/).filter(Boolean).length;
        return replace_document && words ? `Replace everything in this document (${words} words) with new text?` : undefined;
      },
      target: ({ after }) => {
        try {
          if (!after) return rectAt(editor, endOfDocument(editor));
          const found = findBlock(blocks(editor), after);
          return rectAt(editor, objectAfter(editor, after, found)?.end ?? found?.end ?? 0);
        } catch {
          return editor.view.dom;
        }
      },
      async execute({ text, after: anchor, replace_document }) {
        const after = anchor && withoutMarks(anchor);
        if (replace_document) editor.chain().clearContent().run();
        const list = blocks(editor);
        const empty = list.length === 1 && !list[0].text;
        const quote = (b: { text: string; label: string }) => `"${b.text.length > 60 ? `${b.text.slice(0, 60)}…` : b.text}" (${b.label})`;
        let where = replace_document ? "in place of everything that was in the document" : "at the end of the document";
        let listKind = "";
        if (after) {
          const want = unmark(unlabel(after)).trim();
          const found = (want ? list.find((b) => b.text.trim() === want) : undefined) ?? findBlock(list, after);
          const object = objectAfter(editor, after, found);
          if (!found && !object) throw noBlock(list, after);
          if (object) {
            const next = list.find((b) => b.pos >= object.end && b.text);
            where = `right after ${object.label}${next ? `, before ${quote(next)}` : ", at the end of the document"}`;
            openParagraphAt(editor, object.end);
          } else {
            // A new section never goes between a heading and its own text.
            let i = list.indexOf(found!) + 1;
            if (found!.type === "heading" && /^\s*#{1,3}\s/.test(text)) while (list[i]?.label === "Paragraph") i++;
            const block = list[i - 1],
              next = list.slice(i).find((b) => b.text);
            where = `right after ${quote(block)}${next ? `, before ${quote(next)}` : ", at the end of the document"}`;
            listKind = block.label === "Bullet" ? "bulleted" : block.label === "Numbered item" ? "numbered" : "";
            // setParagraph on a list item's paragraph would lift it out of the list.
            if (listKind) editor.chain().setTextSelection(block.end - 1).splitListItem("listItem").run();
            else {
              editor.chain().setTextSelection(block.end - 1).splitBlock().run();
              editor.chain().setParagraph().run();
            }
          }
        } else {
          const last = blocks(editor).at(-1);
          editor.chain().setTextSelection(endOfDocument(editor)).run();
          // Type into an empty last paragraph rather than after it.
          if (!empty && !replace_document && (last?.text || last?.type !== "paragraph")) {
            editor.chain().splitBlock().run();
            editor.chain().setParagraph().run();
          }
        }
        const continued = await writeLines(editor, text, text.length < 1500, !!listKind);
        // Typing in the middle can leave the old empty last paragraph behind.
        const [prev, last] = blocks(editor).slice(-2);
        if (last && prev && !last.text && last.type === "paragraph" && prev.label === "Paragraph" && last.pos > editor.state.selection.to)
          editor.view.dispatch(editor.state.tr.delete(last.pos, last.end));
        const typed = text.split("\n").filter((l) => l.trim()).length;
        const typedHeadings = [...text.matchAll(/^#{1,3}\s+(.*)$/gm)].map((m) => `"${m[1].replace(/\*\*/g, "").trim()}"`);
        const bold = [...text.matchAll(/\*\*(.+?)\*\*/g)].map((m) => `"${m[1]}"`);
        const bullets = text.match(/^\s*[-*•]\s+\S/gm)?.length ?? 0;
        const numbered = text.match(/^\s*\d+[.)]\s+\S/gm)?.length ?? 0;
        const lists = [
          continued && `${continued} as new items of the ${listKind} list`,
          bullets && `${bullets} as bulleted list items`,
          numbered && `${numbered} as numbered list items`,
        ].filter(Boolean);
        const headings = blocks(editor).filter((b) => b.type === "heading").map((b) => `${b.label}: ${b.text}`);
        return `Typed ${typed} paragraph(s) ${where}${typedHeadings.length ? `; heading(s): ${typedHeadings.join(", ")}` : ""}${lists.length ? `; ${lists.join(", ")} (already a list, no need to set it)` : ""}${bold.length ? `; in bold: ${bold.join(", ")}` : ""}. The document now has ${contents(editor)}.${headings.length ? `\nHeadings in the document now: ${headings.join(" | ")}` : ""}`;
      },
    }),
    tool({
      name: "set_style",
      label: "Paragraph style",
      description: "Change the style of the paragraph that contains `text`: Normal text, Heading 1, Heading 2 or Heading 3.",
      parameters: Type.Object({
        text: Type.String({ description: "Text in the paragraph to restyle." }),
        style: Type.String({ enum: ["Normal text", "Heading 1", "Heading 2", "Heading 3"] }),
      }),
      target: () => document.querySelector('[aria-label="Paragraph style"]'),
      execute({ text, style }) {
        const node = blockOf(text);
        const level = /Heading (\d)/.exec(style)?.[1];
        const current = node.type.name === "heading" ? `Heading ${node.attrs.level}` : node.type.name === "paragraph" ? "Normal text" : "";
        if (current === style) return `The paragraph containing "${text}" is already ${style}; nothing changed.`;
        if (level) editor.chain().setHeading({ level: Number(level) as 1 | 2 | 3 }).run();
        else editor.chain().setParagraph().run();
        return `The paragraph containing "${text}" is now ${style}.`;
      },
    }),
    tool({
      name: "format_text",
      label: "Format text",
      description:
        "Format an exact piece of text: bold, italic, underline, strikethrough, superscript, subscript, text color, highlight color, font or size. Booleans turn a style on (true) or off (false).",
      parameters: Type.Object({
        text: Type.String({ description: "The exact text to format." }),
        occurrence: Type.Optional(Type.Number({ description: "Which occurrence, counting from 1. Default 1." })),
        bold: Type.Optional(Type.Boolean()),
        italic: Type.Optional(Type.Boolean()),
        underline: Type.Optional(Type.Boolean()),
        strikethrough: Type.Optional(Type.Boolean()),
        superscript: Type.Optional(Type.Boolean()),
        subscript: Type.Optional(Type.Boolean()),
        color: Type.Optional(Type.String({ description: "Text color as #rrggbb." })),
        highlight: Type.Optional(Type.String({ description: "Highlight color as #rrggbb, or 'none'." })),
        font: Type.Optional(Type.String({ description: "Font family, e.g. Arial, Georgia." })),
        size: Type.Optional(Type.Number({ description: "Font size in points." })),
      }),
      target: ({ text, occurrence }) => {
        const m = locate(editor, text, occurrence);
        return rectAt(editor, m.from);
      },
      execute(args) {
        selectMatch(args.text, args.occurrence);
        const set = (on: boolean | undefined, mark: string) => {
          if (on === undefined) return;
          const chain = editor.chain();
          (on ? chain.setMark(mark) : chain.unsetMark(mark)).run();
        };
        set(args.bold, "bold");
        set(args.italic, "italic");
        set(args.underline, "underline");
        set(args.strikethrough, "strike");
        set(args.superscript, "superscript");
        set(args.subscript, "subscript");
        if (args.color) editor.chain().setColor(args.color).run();
        if (args.highlight === "none") editor.chain().unsetHighlight().run();
        else if (args.highlight) editor.chain().setHighlight({ color: args.highlight }).run();
        if (args.font) editor.chain().setFontFamily(args.font).run();
        if (args.size) editor.chain().setFontSize(`${args.size}pt`).run();
        return `Formatted "${args.text}".`;
      },
    }),
    tool({
      name: "set_list",
      label: "Lists",
      description:
        "Make paragraphs a bulleted or numbered list, or plain paragraphs again. Covers every paragraph from the one containing `from_text` to the one containing `to_text` (or just the first).",
      parameters: Type.Object({
        from_text: Type.String(),
        to_text: Type.Optional(Type.String()),
        list: Type.String({ enum: ["bullet", "numbered", "none"] }),
      }),
      target: () => document.querySelector('[aria-label="Bulleted list"]'),
      execute({ from_text, to_text, list }) {
        const start = locate(editor, from_text);
        const end = to_text ? locate(editor, to_text) : start;
        editor.chain().setTextSelection({ from: start.from, to: Math.max(start.to, end.to) }).run();
        const bullet = editor.isActive("bulletList"),
          numbered = editor.isActive("orderedList");
        const which = to_text ? `The paragraphs from "${from_text}" to "${to_text}" are` : `Only the paragraph containing "${from_text}" was covered, and it is`;
        if ((list === "bullet" && bullet) || (list === "numbered" && numbered) || (list === "none" && !bullet && !numbered))
          return `${which} already ${list === "none" ? "plain paragraphs" : `in a ${list} list`}; nothing changed.${to_text ? "" : " To cover the paragraphs after it too, give to_text (text in the last one)."}`;
        const covered = blocks(editor).filter((b) => b.end > start.from && b.pos < Math.max(start.to, end.to));
        const chain = editor.chain();
        if (list === "bullet" && !bullet) chain.toggleBulletList().run();
        else if (list === "numbered" && !numbered) chain.toggleOrderedList().run();
        else if (list === "none") {
          if (bullet) chain.toggleBulletList().run();
          else if (numbered) chain.toggleOrderedList().run();
        }
        const named = covered.slice(0, 12).map((b) => `"${b.text.slice(0, 50)}" (was ${b.label})`);
        return `Made ${covered.length} paragraph(s) ${list === "none" ? "plain paragraphs" : `a ${list} list`}: ${named.join(", ")}${covered.length > 12 ? ", …" : ""}.`;
      },
    }),
    tool({
      name: "align_text",
      label: "Align",
      description: "Align the paragraph that contains `text`: left, center, right or justify.",
      parameters: Type.Object({ text: Type.String(), alignment: Type.String({ enum: ["left", "center", "right", "justify"] }) }),
      target: ({ alignment }) =>
        document.querySelector(`[aria-label="${alignment === "justify" ? "Justify" : `Align ${alignment}`}"]`),
      execute({ text, alignment }) {
        blockOf(text);
        editor.chain().setTextAlign(alignment).run();
        return `Aligned the paragraph ${alignment}.`;
      },
    }),
    tool({
      name: "insert_table",
      label: "Insert table",
      description:
        "Insert a table after the paragraph containing `after` (or at the end) and fill it. `cells` is a list of rows, each a list of cell texts; the first row is the header row when header_row is true.",
      parameters: Type.Object({
        cells: Type.Array(Type.Array(Type.String())),
        header_row: Type.Optional(Type.Boolean()),
        after: Type.Optional(Type.String({ description: 'Text in the paragraph to put the table after; "table" or "photo" means right below the last table or photo.' })),
      }),
      target: () => document.querySelector('[aria-label="Insert table"]'),
      async execute({ cells, header_row = true, after }) {
        const rows = Math.max(1, cells.length);
        const cols = Math.max(1, ...cells.map((r) => r.length));
        const list = blocks(editor);
        const block = after ? findBlock(list, after) : list.at(-1);
        const object = after ? objectAfter(editor, after, block) : undefined;
        if (after && !block && !object) throw noBlock(list, after);
        const short = (text: string) => `"${text.length > 60 ? `${text.slice(0, 60)}…` : text}"`;
        const next = object ? list.find((b) => b.pos >= object.end && b.text) : block && list[list.indexOf(block) + 1];
        const where = after && (object || block)
          ? `right after ${object ? object.label : short(block!.text)}${next?.text ? `, before ${short(next.text)}` : ", at the end of the document"}`
          : "at the end of the document";
        if (object) openParagraphAt(editor, object.end);
        else {
          editor.chain().setTextSelection((block?.end ?? 1) - 1).run();
          if (block?.text) editor.chain().splitBlock().run();
        }
          editor.chain().setParagraph().run();
        editor.chain().insertTable({ rows, cols, withHeaderRow: header_row }).run();
        // Fill cell by cell, moving with Tab like a person would.
        for (let r = 0; r < rows; r++)
          for (let c = 0; c < cols; c++) {
            const value = cells[r]?.[c] ?? "";
            if (value) editor.chain().insertContent(value).run();
            await wait(25);
            if (r < rows - 1 || c < cols - 1) editor.chain().goToNextCell().run();
          }
        const first = (row: string[] = []) => row.find((c) => c.trim()) ?? "(empty)";
        const body = cells.slice(1).map((row) => first(row));
        return `Inserted a ${rows}×${cols} table ${where}: ${header_row ? "a header row" : "first row"} (${(cells[0] ?? []).join(" | ")})${body.length ? `, then ${body.length} row(s) whose first cells are ${body.join(", ")}` : ""}.`;
      },
    }),
    tool({
      name: "insert_link",
      label: "Insert link",
      description: "Turn existing text into a link to `url`. If `text` is not in the document, it is added at the end as a link.",
      parameters: Type.Object({ text: Type.String(), url: Type.String() }),
      target: ({ text }) => {
        try {
          return rectAt(editor, locate(editor, text).from);
        } catch {
          return document.querySelector('[aria-label="Insert link"]');
        }
      },
      execute({ text, url }) {
        const href = /^[a-z]+:/i.test(url) || url.startsWith("#") ? url : `https://${url}`;
        let range: { from: number; to: number };
        let added = false;
        try {
          range = selectMatch(text);
        } catch {
          editor.chain().setTextSelection(endOfDocument(editor)).insertContent(" ").run();
          const from = editor.state.selection.from;
          editor.chain().insertContent(text).run();
          range = { from, to: from + text.length };
          added = true;
        }
        editor.chain().setTextSelection(range).setLink({ href }).run();
        editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, range.to)));
        if (added) {
          const line = editor.state.selection.$from.parent.textContent.trim();
          return `"${text}" was not in the document, so it was added at the end of the document as a link to ${href}; that paragraph now reads "${line}".`;
        }
        return `Linked "${text}" to ${href}.`;
      },
    }),
    tool({
      name: "insert_image",
      label: "Insert image",
      description:
        "Ask the user to choose a photo from their computer and insert it after the paragraph containing `after` (or at the cursor).",
      parameters: Type.Object({
        after: Type.Optional(Type.String({ description: 'Text in the paragraph to put the photo after; "table" or "photo" means right below the last table or photo.' })),
      }),
      target: () => document.querySelector('[aria-label="Insert image"]'),
      async execute({ after }) {
        const place = () => {
          const block = after ? findBlock(blocks(editor), after) : undefined;
          const object = after ? objectAfter(editor, after, block) : undefined;
          if (after && !block && !object) throw noBlock(blocks(editor), after);
          return { block, object };
        };
        // Check the place before asking, so the user never picks a photo twice.
        place();
        const file = await requestFile("Choose a photo to insert", "image/png,image/jpeg,image/gif,image/webp");
        if (!file) return "The user did not choose a photo.";
        const { block, object } = place();
        if (object) openParagraphAt(editor, object.end);
        else if (block) {
          editor.chain().setTextSelection(block.end - 1).splitBlock().run();
          editor.chain().setParagraph().run();
        }
        const before = images(editor).length;
        await ctx.insertImage(file);
        if (images(editor).length === before)
          throw new ToolError(`"${file.name}" could not be inserted. Photos must be PNG, JPEG, GIF or WebP and smaller than 5 MB.`);
        const cursor = editor.state.selection.from;
        const photo = images(editor).filter((p) => p.end <= cursor).at(-1);
        const list = blocks(editor);
        const above = photo && list.filter((b) => b.end <= photo.pos && b.text).at(-1);
        const below = photo && list.find((b) => b.pos >= photo.end && b.text);
        const short = (text: string) => `"${text.length > 60 ? `${text.slice(0, 60)}…` : text}"`;
        return `Inserted the photo "${file.name}"${above ? ` below ${short(above.text)}` : " at the top of the document"}${below ? `, above ${short(below.text)}` : ", at the end of the document"}.`;
      },
    }),
    tool({
      name: "find_and_replace",
      label: "Find and replace",
      description:
        "Replace text. With all=true every match is replaced; otherwise only the first match. Returns how many were replaced.",
      parameters: Type.Object({
        find: Type.String(),
        replace: Type.String(),
        all: Type.Optional(Type.Boolean()),
        match_case: Type.Optional(Type.Boolean()),
      }),
      target: () => document.querySelector('[aria-label="Find and replace"]') ?? editor.view.dom,
      async execute({ find, replace, all = true, match_case = false }) {
        if (/\n/.test(replace))
          throw new ToolError("find_and_replace changes text within a paragraph. To add a new paragraph, use write_text with `after`.");
        // **double asterisks** mean bold here too, as in write_text.
        const parts = replace.split("**");
        const boldMark = parts.length > 2 ? editor.schema.marks.bold : undefined;
        if (boldMark) replace = parts.join("");
        ctx.showFind(find, replace, match_case);
        await wait(700);
        const options = { matchCase: match_case, regex: false, ignoreDiacritics: !match_case };
        const matches = documentMatches(editor.state.doc, find, options).matches;
        if (!matches.length) {
          ctx.closeFind();
          const already = replace.trim() ? documentMatches(editor.state.doc, replace, options).matches.length : 0;
          if (already)
            return `Nothing to replace: "${find}" is not in the document, and "${replace}" is there ${already} time(s), so it is already replaced.`;
          throw new ToolError(
            `"${find}" was not found.${/[#*]/.test(find) ? " The document's text has no Markdown marks such as # or **; use read_document to see the exact text." : ""}`,
          );
        }
        let tr = editor.state.tr;
        const chosen = all ? [...matches].reverse() : [matches[0]];
        for (const m of chosen) {
          if (!boldMark) {
            tr = tr.insertText(replace, m.from, m.to);
            continue;
          }
          const marks = tr.doc.resolve(m.from).marksAcross(tr.doc.resolve(m.to)) ?? [];
          const nodes = parts.flatMap((part, i) =>
            part ? [editor.schema.text(part, i % 2 ? boldMark.create().addToSet(marks) : marks)] : [],
          );
          tr = tr.replaceWith(m.from, m.to, nodes);
        }
        editor.view.dispatch(tr.scrollIntoView());
        ctx.showReplaced(chosen.length);
        await wait(900);
        ctx.closeFind();
        const left = matches.length - chosen.length;
        const bold = boldMark ? parts.filter((p, i) => i % 2 && p).map((p) => `"${p}"`) : [];
        // Where each replacement went, as a short quote around it.
        const doc = editor.state.doc;
        const quotes = chosen
          .map((m) => tr.mapping.map(m.from, -1))
          .sort((a, b) => a - b)
          .slice(0, 8)
          .map((from) => {
            const b = blocks(editor).find((x) => x.pos < from && from < x.end);
            if (!b) return "";
            const start = Math.max(b.pos + 1, from - 30),
              end = Math.min(b.end - 1, from + replace.length + 30);
            return `"${start > b.pos + 1 ? "…" : ""}${doc.textBetween(start, end)}${end < b.end - 1 ? "…" : ""}"`;
          })
          .filter(Boolean);
        return `Replaced ${chosen.length} of ${matches.length} "${find}" with "${replace}"${bold.length ? ` (${bold.join(", ")} in bold)` : ""}${quotes.length ? `, in: ${quotes.join(", ")}` : ""}. ${left ? `${left} "${find}" left.` : `No "${find}" is left in the document.`}`;
      },
    }),
    tool({
      name: "check_spelling",
      label: "Check spelling",
      description:
        "Check the document's spelling. Returns each misspelled word with suggestions. Fix words with find_and_replace.",
      parameters: Type.Object({}),
      target: () => [...document.querySelectorAll(".menu-trigger")].find((el) => el.textContent === "Tools") ?? editor.view.dom,
      async execute() {
        ctx.showSpelling();
        const words = new Map<string, number>();
        for (const word of misspelledWords(editor.getJSON()))
          words.set(word, (words.get(word) ?? 0) + 1);
        if (!words.size) return "No spelling mistakes found.";
        return [...words]
          .map(([w, count]) => {
            const suggestions = spellingSuggestions(w);
            return `"${w}" (${count}×): ${suggestions.length ? suggestions.join(", ") : "no suggestions"}`;
          })
          .join("\n");
      },
    }),
    tool({
      name: "page_setup",
      label: "Page setup",
      description:
        "Change page setup: paper (letter or a4), orientation (portrait or landscape), margins in inches, header and footer text, page numbers on or off. Give only the settings the user asked to change; the others stay as they are.",
      parameters: Type.Object({
        paper: Type.Optional(Type.String({ enum: ["letter", "a4"] })),
        orientation: Type.Optional(Type.String({ enum: ["portrait", "landscape"] })),
        margin_inches: Type.Optional(Type.Number({ description: "One margin for all four sides, from 0.25 to 1.5 inches." })),
        header: Type.Optional(Type.String()),
        footer: Type.Optional(Type.String()),
        page_numbers: Type.Optional(Type.Boolean()),
      }),
      target: () => document.querySelector('[aria-label="Page setup"]'),
      async execute(args) {
        const current = ctx.pageSettings();
        const next: PageSettings = {
          ...current,
          ...(args.paper ? { size: args.paper as PageSettings["size"] } : {}),
          ...(args.orientation ? { landscape: args.orientation === "landscape" } : {}),
          // Margins are stored in CSS pixels (96 per inch). Each edge is stored too;
          // a file that already has per-edge margins ignores the single `margin`.
          ...(args.margin_inches !== undefined
            ? (() => {
                const margin = Math.round(Math.min(1.5, Math.max(0.25, args.margin_inches)) * 96);
                return {
                  margin,
                  marginTop: margin,
                  marginBottom: margin,
                  marginLeft: margin,
                  marginRight: margin,
                  top: margin,
                  bottom: margin,
                  left: margin,
                  right: margin,
                };
              })()
            : {}),
          ...(args.header !== undefined ? { header: args.header } : {}),
          ...(args.footer !== undefined ? { footer: args.footer } : {}),
          ...(args.page_numbers !== undefined ? { pageNumbers: args.page_numbers } : {}),
        };
        ctx.showPageSetup(next);
        await wait(1100);
        editor.view.dispatch(editor.state.tr.setDocAttribute("pageSettings", next));
        ctx.closePageSetup();
        const clamped =
          args.margin_inches !== undefined && (args.margin_inches < 0.25 || args.margin_inches > 1.5)
            ? ` (${args.margin_inches}" is outside 0.25" to 1.5", so the nearest was used)`
            : "";
        return `Page setup: ${next.size.toUpperCase()} ${next.landscape ? "landscape" : "portrait"}, ${(next.margin / 96).toFixed(2)}" margins${clamped}${next.header ? `, header "${next.header}"` : ""}${next.footer ? `, footer "${next.footer}"` : ""}${next.pageNumbers ? ", page numbers" : ""}.`;
      },
    }),
    tool({
      name: "insert_page_break",
      label: "Page break",
      description: "Start a new page before the paragraph that contains `before_text`.",
      parameters: Type.Object({ before_text: Type.String() }),
      target: ({ before_text }) => rectAt(editor, locate(editor, before_text).from),
      execute({ before_text }) {
        const block = findBlock(blocks(editor), before_text);
        if (!block) throw noBlock(blocks(editor), before_text);
        editor.chain().setTextSelection(block.pos + 1).setPageBreak().run();
        return `Inserted a page break before "${before_text}".`;
      },
    }),
    tool({
      name: "go_to_heading",
      label: "Go to heading",
      description:
        "Go to a section: shows the heading at the top of the window, as clicking it in the outline does, and puts the cursor there. Use when the user asks to go to, jump to or show a section.",
      parameters: Type.Object({ heading: Type.String() }),
      target: ({ heading }) =>
        [...document.querySelectorAll(".outline-item")].find((el) => el.textContent?.includes(heading)),
      execute({ heading }) {
        const block = blocks(editor).find((b) => b.type === "heading" && b.text.toLowerCase().includes(heading.toLowerCase()));
        if (!block) throw new ToolError(`There is no heading "${heading}". Headings: ${blocks(editor).filter((b) => b.type === "heading").map((b) => b.text).join("; ")}`);
        ctx.jumpToHeading(block.pos);
        return `Showing "${block.text}".`;
      },
    }),
    tool({
      name: "export_document",
      label: "Export",
      description:
        "Export a copy in another format, for other apps: a Word file (docx), a web page (html) or plain text (txt). Only when the user asks for one of these; to download or save the file itself, use download_file.",
      parameters: Type.Object({ format: Type.String({ enum: ["docx", "html", "txt"] }) }),
      target: () => document.querySelector(".workspace-header .menu-trigger, .workspace-header [aria-haspopup]"),
      async execute({ format }) {
        const saved = await ctx.exportAs(format as "docx");
        const name = `"${ctx.title}.${format}"`;
        if (saved === null) return `The user closed the save dialog, so ${name} was not exported. Tell them; export again only if they ask.`;
        return `Exported ${name}${saved ? `; the user saved it as ${saved}` : ""}.`;
      },
    }),
    tool({
      name: "undo",
      label: "Undo",
      description: "Undo your own last change in this request. Changes from before the request are the user's and can't be undone with this.",
      parameters: Type.Object({}),
      target: () => document.querySelector('[aria-label="Undo"]'),
      execute() {
        const own = ownUndoSteps(editor, undoDepth(editor.state));
        if (!own)
          throw new ToolError(
            "Nothing you changed in this request is left to undo. Earlier changes in this document are the user's, so undo would take away their work.",
          );
        const before = blockLines(editor),
          beforeJson = JSON.stringify(editor.getJSON());
        editor.commands.undo();
        const change = describeChange(before, blockLines(editor), beforeJson !== JSON.stringify(editor.getJSON()));
        return `Undid your last change: ${change}. ${own > 1 ? `${own - 1} more of your changes in this request can be undone.` : "That was your first change in this request; none of yours are left to undo."}`;
      },
    }),
  ];
}

/** Each paragraph as "Label: text", to tell what a change did. */
const blockLines = (editor: Editor) => blocks(editor).map((b) => `${b.label}: ${b.text}`);

/** What an undo changed, from the paragraphs before and after it. */
function describeChange(before: string[], after: string[], changed: boolean) {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  const gone = before.slice(start, before.length - end),
    back = after.slice(start, after.length - end);
  const quote = (lines: string[]) =>
    lines
      .slice(0, 3)
      .map((l) => `"${l.length > 70 ? `${l.slice(0, 70)}…` : l}"`)
      .join(", ") + (lines.length > 3 ? ` and ${lines.length - 3} more` : "");
  const parts = [gone.length ? `the document no longer has ${quote(gone)}` : "", back.length ? `it has back ${quote(back)}` : ""].filter(Boolean);
  return parts.length ? parts.join("; ") : changed ? "a formatting change, the text is the same" : "nothing visible changed";
}

/** Notes the editor's state before the request's first change, for undo and the review. */
export const docBeforeTool = (ctx: DocsAgentContext) => markBaseline(ctx.editor, undoDepth(ctx.editor.state), () => blockLines(ctx.editor));

/** Problems in the paragraphs this request wrote or changed. */
export function docReview(ctx: DocsAgentContext) {
  const before = baselineSnapshot<string[]>(ctx.editor);
  if (!before) return [];
  const old = new Set(before);
  const issues: string[] = [];
  for (const b of blocks(ctx.editor)) {
    if (old.has(`${b.label}: ${b.text}`)) continue;
    const short = b.text.length > 60 ? `${b.text.slice(0, 60)}…` : b.text;
    if (/\*\*[^*]+\*\*|__[^_]+__/.test(b.text)) issues.push(`"${short}" shows ** or __ as text instead of bold.`);
    else if (b.label === "Paragraph" && /^(#{1,6}|[-*]|\d+\.)\s/.test(b.text))
      issues.push(`"${short}" starts with Markdown (# , - or 1.) shown as text instead of a heading or list.`);
    if (b.type === "heading" && !b.text.trim()) issues.push("There is an empty heading.");
  }
  return issues;
}

export function docSnapshot(ctx: DocsAgentContext) {
  const list = blocks(ctx.editor);
  const headings = list.filter((b) => b.type === "heading").map((b) => `${b.label}: ${b.text}`);
  const words = ctx.editor.getText().trim().split(/\s+/).filter(Boolean).length;
  const preview = list
    .slice(0, 12)
    .map((b) => `[${b.label}] ${b.text.slice(0, 80)}`)
    .join("\n");
  const page = ctx.pageSettings();
  const setup = `Page setup: ${page.size.toUpperCase()} ${page.landscape ? "landscape" : "portrait"}, ${(page.margin / 96).toFixed(2)}" margins, ${page.header ? `header "${page.header}"` : "no header"}, ${page.footer ? `footer "${page.footer}"` : "no footer"}, page numbers ${page.pageNumbers ? "on" : "off"}.`;
  return `Open document: "${ctx.title}" (${words} words, ${ctx.pageCount} page(s)). ${setup}${headings.length ? `\nHeadings: ${headings.join(" | ")}` : ""}\n${words ? `Start of the document:\n${preview}` : "The document is empty."}`;
}
