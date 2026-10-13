import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { Type } from "@earendil-works/pi-ai";
import type { PageSettings } from "@suiteleaf/core/document-layout";
import { documentMatches } from "../../editors/doc-search-plugin";
import { findMisspellings, spellchecker } from "../../editors/doc-spelling";
import { ToolError, tool, type SuiteTool } from "../host";
import { requestFile } from "../file-request";

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
  exportAs: (format: "docx" | "html" | "txt") => Promise<void>;
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
    if (node.type.name === "image") list.push({ pos, end: pos + node.nodeSize, name: String(node.attrs.alt || "photo") });
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
 * a table cell means below the whole table; "table", "[Photo]" or "the image"
 * mean the last one, unless a paragraph contains that word.
 */
function objectAfter(editor: Editor, after: string, found?: { pos: number; label: string }) {
  const doc = editor.state.doc;
  if (found?.label === "Table cell") {
    const $pos = doc.resolve(found.pos);
    for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).type.name === "table") return { end: $pos.after(d), label: "the table" };
  }
  const word = /^\W*(?:the\s+)?(table|photo|image|picture)\W*$/i.exec(after)?.[1]?.toLowerCase();
  if (!word || (found && !/^\s*\[/.test(after))) return undefined;
  const type = word === "table" ? "table" : "image";
  let last: { end: number; label: string } | undefined;
  doc.descendants((node, pos) => {
    if (node.type.name === type)
      last = { end: pos + node.nodeSize, label: type === "table" ? "the table" : `the photo "${node.attrs.alt || "photo"}"` };
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

/** Insert lightweight Markdown: "# " headings, "- " bullets, "1. " numbers, **bold**. */
async function writeLines(editor: Editor, text: string, animate: boolean) {
  // Blank lines separate paragraphs; they don't become empty paragraphs.
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => line.trim());
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
    } else {
      leaveList();
      editor.chain().setParagraph().run();
    }
    for (const [index, part] of line.split(/\*\*/).entries()) {
      if (!part) continue;
      const bold = index % 2 === 1;
      const words = animate ? part.match(/\S+\s*|\s+/g) ?? [part] : [part];
      for (const word of words) {
        editor
          .chain()
          .focus()
          .insertContent(bold ? { type: "text", text: word, marks: [{ type: "bold" }] } : { type: "text", text: word })
          .run();
        if (animate) await wait(18);
      }
      editor.chain().unsetBold().run();
    }
  }
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
        "Type text into the document. Each line becomes a paragraph. Start a line with '# ' for a Heading 1 (a main section), '## ' for a Heading 2 (a sub-section) or '### ' for a Heading 3, '- ' for a bullet, '1. ' for a numbered item; wrap words in **double asterisks** for bold. By default the text goes at the end of the document (leave out `after` to keep adding to the end); give `after` to insert it right after the one paragraph or heading containing that text (text that starts with a heading goes after that heading's paragraphs), or set `replace_document` to start over.",
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
        let where = "at the end of the document";
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
              next = list[i];
            where = `right after ${quote(block)}${next ? `, before ${quote(next)}` : ", at the end of the document"}`;
            editor.chain().setTextSelection(block.end - 1).splitBlock().run();
            editor.chain().setParagraph().run();
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
        await writeLines(editor, text, text.length < 1500);
        // Typing in the middle can leave the old empty last paragraph behind.
        const [prev, last] = blocks(editor).slice(-2);
        if (last && prev && !last.text && last.type === "paragraph" && prev.label === "Paragraph" && last.pos > editor.state.selection.to)
          editor.view.dispatch(editor.state.tr.delete(last.pos, last.end));
        const typed = text.split("\n").filter((l) => l.trim()).length;
        const typedHeadings = [...text.matchAll(/^#{1,3}\s+(.*)$/gm)].map((m) => `"${m[1].replace(/\*\*/g, "").trim()}"`);
        const bold = [...text.matchAll(/\*\*(.+?)\*\*/g)].map((m) => `"${m[1]}"`);
        const headings = blocks(editor).filter((b) => b.type === "heading").map((b) => `${b.label}: ${b.text}`);
        return `Typed ${typed} paragraph(s) ${where}${typedHeadings.length ? `; heading(s): ${typedHeadings.join(", ")}` : ""}${bold.length ? `; in bold: ${bold.join(", ")}` : ""}. The document now has ${contents(editor)}.${headings.length ? `\nHeadings in the document now: ${headings.join(" | ")}` : ""}`;
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
        const chain = editor.chain();
        if (list === "bullet" && !bullet) chain.toggleBulletList().run();
        else if (list === "numbered" && !numbered) chain.toggleOrderedList().run();
        else if (list === "none") {
          if (bullet) chain.toggleBulletList().run();
          else if (numbered) chain.toggleOrderedList().run();
        }
        return `Set the paragraphs to ${list === "none" ? "plain paragraphs" : `a ${list} list`}.`;
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
        return `Replaced ${chosen.length} of ${matches.length} "${find}" with "${replace}"${bold.length ? ` (${bold.join(", ")} in bold)` : ""}${left ? `; ${left} left` : ""}.`;
      },
    }),
    tool({
      name: "check_spelling",
      label: "Check spelling",
      description:
        "Check the document's spelling. Returns each misspelled word with suggestions. Fix words with find_and_replace.",
      parameters: Type.Object({}),
      target: () => editor.view.dom,
      async execute() {
        ctx.showSpelling();
        const spell = await spellchecker();
        const found = findMisspellings(editor.state.doc, spell);
        if (!found.length) return "No spelling mistakes found.";
        const words = new Map<string, { count: number; suggestions: string[] }>();
        for (const f of found) {
          const entry = words.get(f.word) ?? { count: 0, suggestions: f.suggestions };
          entry.count++;
          words.set(f.word, entry);
        }
        return [...words]
          .map(([w, e]) => `"${w}" (${e.count}×): ${e.suggestions.length ? e.suggestions.join(", ") : "no suggestions"}`)
          .join("\n");
      },
    }),
    tool({
      name: "page_setup",
      label: "Page setup",
      description:
        "Change page setup: paper (letter or a4), orientation (portrait or landscape), margins in inches, header and footer text, page numbers on or off.",
      parameters: Type.Object({
        paper: Type.Optional(Type.String({ enum: ["letter", "a4"] })),
        orientation: Type.Optional(Type.String({ enum: ["portrait", "landscape"] })),
        margin_inches: Type.Optional(Type.Number()),
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
          ...(args.margin_inches !== undefined ? { margin: Math.round(Math.min(2, Math.max(1 / 3, args.margin_inches)) * 72) } : {}),
          ...(args.header !== undefined ? { header: args.header } : {}),
          ...(args.footer !== undefined ? { footer: args.footer } : {}),
          ...(args.page_numbers !== undefined ? { pageNumbers: args.page_numbers } : {}),
        };
        ctx.showPageSetup(next);
        await wait(1100);
        editor.view.dispatch(editor.state.tr.setDocAttribute("pageSettings", next));
        ctx.closePageSetup();
        return `Page setup: ${next.size.toUpperCase()} ${next.landscape ? "landscape" : "portrait"}, ${(next.margin / 72).toFixed(2)}" margins${next.header ? `, header "${next.header}"` : ""}${next.footer ? `, footer "${next.footer}"` : ""}${next.pageNumbers ? ", page numbers" : ""}.`;
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
      description: "Export the document as a Word file (docx), a web page (html) or plain text (txt). The file downloads.",
      parameters: Type.Object({ format: Type.String({ enum: ["docx", "html", "txt"] }) }),
      target: () => document.querySelector(".workspace-header .menu-trigger, .workspace-header [aria-haspopup]"),
      async execute({ format }) {
        await ctx.exportAs(format as "docx");
        return `Exported "${ctx.title}.${format}".`;
      },
    }),
    tool({
      name: "undo",
      label: "Undo",
      description: "Undo the last change.",
      parameters: Type.Object({}),
      target: () => document.querySelector('[aria-label="Undo"]'),
      execute() {
        editor.commands.undo();
        return "Undid the last change.";
      },
    }),
  ];
}

export function docSnapshot(ctx: DocsAgentContext) {
  const list = blocks(ctx.editor);
  const headings = list.filter((b) => b.type === "heading").map((b) => `${b.label}: ${b.text}`);
  const words = ctx.editor.getText().trim().split(/\s+/).filter(Boolean).length;
  const preview = list
    .slice(0, 12)
    .map((b) => `[${b.label}] ${b.text.slice(0, 80)}`)
    .join("\n");
  return `Open document: "${ctx.title}" (${words} words, ${ctx.pageCount} page(s)).${headings.length ? `\nHeadings: ${headings.join(" | ")}` : ""}\n${words ? `Start of the document:\n${preview}` : "The document is empty."}`;
}
