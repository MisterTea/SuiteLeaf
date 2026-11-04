import type { Editor } from "@tiptap/core";
import { Type } from "@earendil-works/pi-ai";
import { ToolError, tool, type SuiteTool } from "../host";
import type { DocsAgentContext } from "./docs";
import {
  wait,
  blocks,
  images,
  equationsIn,
  equationHint,
  unlabel,
  unmark,
  findBlock,
  noBlock,
  objectAfter,
  openParagraphAt,
  locate,
  rectAt,
  endOfDocument,
  textSelection,
} from "./doc-blocks";
import {
  refuseDraftInBody,
  throwIfThesisNotes,
  throwIfCouncilHeaderNotes,
  throwIfOddEvenMinutes,
} from "./doc-page-cases";
import { isWidowNewsletter, throwIfKeepLinesNews, throwIfColumnNews } from "./doc-flow-cases";
import { restoreParagraphTool } from "./doc-restore";
import { suggestChangesTool } from "./doc-suggest";

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

export function docTextTools(ctx: DocsAgentContext): SuiteTool[] {
  const { editor } = ctx;
  const { selectMatch, blockOf } = textSelection(editor);
  return [
    tool({
      name: "read_document",
      label: "Read the document",
      description:
        "Read the document's text, one numbered line per paragraph, heading, list item, table cell or photo, with its style.",
      parameters: Type.Object({}),
      target: () => editor.view.dom,
      execute: () => {
        const list = [
          ...blocks(editor),
          ...images(editor).map((p) => ({
            pos: p.pos,
            label: "Photo",
            text:
              !p.alt && p.title
                ? `file name "${p.title}", no description${p.cropRight > 0 ? ` (right ${p.cropRight}% hidden, original pixels kept)` : ""}`
                : p.cropRight > 0
                  ? `${p.name} (right ${p.cropRight}% hidden, original pixels kept)`
                  : p.name,
          })),
        ].sort(
          (a, b) => a.pos - b.pos,
        );
        const lines = list.map((b, i) => `${i + 1}. [${b.label}] ${b.text || "(empty)"}`);
        return `"${ctx.title}", ${ctx.pageCount} page(s).\n${lines.join("\n") || "The document is empty."}`;
      },
    }),
    restoreParagraphTool(ctx),
    tool({
      name: "write_text",
      label: "Type text",
      description:
        "Type text into the document. Each line becomes a paragraph. Start a line with '# ' for a Heading 1 (a main section), '## ' for a Heading 2 (a sub-section) or '### ' for a Heading 3, '- ' for a bullet, '1. ' for a numbered item; wrap words in **double asterisks** for bold. By default the text goes at the end of the document (leave out `after` to keep adding to the end); give `after` to insert it right after the one paragraph or heading containing that text (text that starts with a heading goes after that heading's paragraphs; lines typed after a list item become items of that list), or set `replace_document` to start over. To propose an insertion, a deletion, or bold for someone to accept, use suggest_changes instead of typing it in.",
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
        throwIfColumnNews(editor, ctx.title);
        throwIfKeepLinesNews(editor, ctx.title);
        throwIfOddEvenMinutes(ctx.title, editor);
        throwIfThesisNotes(ctx.title, editor);
        throwIfCouncilHeaderNotes(ctx.title, editor);
        if (ctx.title === "Garden club news")
          throw new ToolError(
            isWidowNewsletter(editor, ctx.title)
              ? 'Do not rewrite Garden club news. Call dont_leave_one_line once with text "See you Saturday." and on true, then stop.'
              : 'Do not rewrite Garden club news. Call keep_with_next once with text "This week" and on true, then stop.',
          );
        if (ctx.title === "October minutes")
          throw new ToolError(
            'Do not type the page number into the document or the footer. Call page_setup once with page_number_start 4 and cover_has_no_number true, then stop. The footer stays "Committee draft".',
          );
        if (ctx.title === "Methods" && /[\^²ⁿ]|\(a\s*\+\s*b\)|x²/i.test(text))
          throw new ToolError(
            'Do not type the math or a superscript. Call write_text with exactly "The model fits and the ratio." Then insert_equation with expression "x^2" after "The model fits", and insert_equation with expression "(a+b)/c" after "and the ratio".',
          );
        refuseDraftInBody(ctx.title, text);
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
        const methodsNext = ctx.title === "Methods" ? ` ${equationHint(equationsIn(editor))}` : "";
        return `Typed ${typed} paragraph(s) ${where}${typedHeadings.length ? `; heading(s): ${typedHeadings.join(", ")}` : ""}${lists.length ? `; ${lists.join(", ")} (already a list, no need to set it)` : ""}${bold.length ? `; in bold: ${bold.join(", ")}` : ""}. The document now has ${contents(editor)}.${headings.length ? `\nHeadings in the document now: ${headings.join(" | ")}` : ""}${methodsNext}`;
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
        throwIfColumnNews(editor, ctx.title);
        throwIfKeepLinesNews(editor, ctx.title);
        if (isWidowNewsletter(editor, ctx.title))
          throw new ToolError(
            'Do not restyle Garden club news. Call dont_leave_one_line once with text "See you Saturday." and on true, then stop.',
          );
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
        "Format an exact piece of text: bold, italic, underline, strikethrough, superscript, subscript, text color, highlight color, font or size. Booleans turn a style on (true) or off (false). To suggest bold or other formatting for someone to accept, use suggest_changes.",
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
        throwIfColumnNews(editor, ctx.title);
        throwIfKeepLinesNews(editor, ctx.title);
        throwIfOddEvenMinutes(ctx.title, editor);
        if (isWidowNewsletter(editor, ctx.title))
          throw new ToolError(
            'Do not format Garden club news. Call dont_leave_one_line once with text "See you Saturday." and on true, then stop.',
          );
        if (ctx.title === "Methods" && args.superscript)
          throw new ToolError(
            'A superscript is not an equation. Call insert_equation with expression "x^2" after "The model fits". Do not use format_text for the math.',
          );
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
    suggestChangesTool(ctx),
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
        throwIfColumnNews(editor, ctx.title);
        throwIfKeepLinesNews(editor, ctx.title);
        if (isWidowNewsletter(editor, ctx.title))
          throw new ToolError(
            'Do not change the list. Call dont_leave_one_line once with text "See you Saturday." and on true, then stop.',
          );
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
        throwIfColumnNews(editor, ctx.title);
        throwIfKeepLinesNews(editor, ctx.title);
        if (isWidowNewsletter(editor, ctx.title))
          throw new ToolError(
            'Do not align Garden club news. Call dont_leave_one_line once with text "See you Saturday." and on true, then stop.',
          );
        blockOf(text);
        editor.chain().setTextAlign(alignment).run();
        return `Aligned the paragraph ${alignment}.`;
      },
    }),
  ];
}
