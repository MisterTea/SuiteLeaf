import { Type } from "@earendil-works/pi-ai";
import type { Editor } from "@tiptap/core";
import { isLineSpacing, type LineSpacing } from "@suiteleaf/core/line-spacing";
import type { SpecialIndent } from "@suiteleaf/core/paragraph-indent";
import { applyImageWrap } from "../../editors/doc-image-wrap";
import { placeImageInline } from "../../editors/doc-image-place";
import "../../editors/doc-line-spacing";
import "../../editors/doc-paragraph-indent";
import "../../editors/doc-tab-stops";
import { tool, ToolError, type SuiteTool } from "../host";
import type { DocsAgentContext } from "./docs";

type Block = { pos: number; end: number; text: string; type: string };

function blocks(editor: Editor): Block[] {
  const list: Block[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    list.push({
      pos,
      end: pos + node.nodeSize,
      text: node.textContent.replace(/\u00a0/g, " ").trim(),
      type: node.type.name,
    });
  });
  return list;
}

function findBlock(list: Block[], query: string) {
  const needle = query.trim();
  if (!needle) return undefined;
  return (
    list.find((block) => block.text === needle) ??
    list.find((block) => block.text.includes(needle))
  );
}

function pointAt(editor: Editor, pos: number) {
  try {
    const coords = editor.view.coordsAtPos(Math.min(pos + 1, editor.state.doc.content.size));
    return new DOMRect(coords.left, coords.top, 4, Math.max(2, coords.bottom - coords.top));
  } catch {
    return editor.view.dom;
  }
}

function firstImage(editor: Editor) {
  let found: { pos: number } | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === "image" || node.type.name === "inlineImage") {
      found = { pos };
      return false;
    }
  });
  return found;
}

function lineSpacing(value: string): LineSpacing {
  const raw = value.trim().toLowerCase();
  if (raw === "1" || raw === "1.0" || raw === "single") return "single";
  if (raw === "2" || raw === "2.0" || raw === "double") return "double";
  if (isLineSpacing(raw)) return raw;
  throw new ToolError('spacing is single, 1.15, 1.5, or double.');
}

function indentKind(value: string): SpecialIndent {
  const raw = value.trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (raw === "first" || raw === "firstline") return "firstLine";
  if (raw === "hanging" || raw === "hang") return "hanging";
  if (raw === "none" || raw === "off") return "none";
  throw new ToolError('kind is first-line, hanging, or none.');
}

const WRAPS = ["inline", "left", "right", "break", "behind"] as const;
type Wrap = (typeof WRAPS)[number];

function wrapArg(value: string): Wrap {
  const raw = value.trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (raw === "inline" || raw === "intext") return "inline";
  if (raw === "left") return "left";
  if (raw === "right") return "right";
  if (raw === "break" || raw === "breaktext" || raw === "block") return "break";
  if (raw === "behind" || raw === "behindtext") return "behind";
  throw new ToolError('wrap is inline, left, right, break, or behind.');
}

/**
 * Paragraph and picture tools that apply to whatever document is open.
 * Page furniture (margins, headers, numbering) stays on page_setup.
 */
export function docFormatTools(ctx: DocsAgentContext): SuiteTool[] {
  const { editor } = ctx;
  return [
    tool({
      name: "set_line_spacing",
      label: "Line spacing",
      description:
        "Set line spacing on the paragraphs that contain `text`. spacing is single, 1.15, 1.5, or double. Other paragraphs stay as they are. Call it once per group of paragraphs that should share a spacing.",
      parameters: Type.Object({
        text: Type.String({ description: "Text in the paragraph or paragraphs to change." }),
        spacing: Type.String({ description: "single, 1.15, 1.5, or double." }),
      }),
      target: ({ text }) => {
        const block = findBlock(blocks(editor), text);
        return block ? pointAt(editor, block.pos) : editor.view.dom;
      },
      execute({ text, spacing }) {
        const value = lineSpacing(spacing);
        const matches = blocks(editor).filter((block) => block.text.includes(text.trim()));
        if (!matches.length) throw new ToolError(`No paragraph contains "${text}".`);
        const applied = editor
          .chain()
          .setTextSelection({ from: matches[0].pos + 1, to: matches[matches.length - 1].end - 1 })
          .setLineSpacing(value)
          .run();
        if (!applied) throw new ToolError("Could not set line spacing on that paragraph.");
        return `Set ${value} line spacing on ${matches.length} paragraph${matches.length === 1 ? "" : "s"} containing "${text.trim()}".`;
      },
    }),
    tool({
      name: "set_paragraph_spacing",
      label: "Space before and after",
      description:
        "Set space before and/or space after one paragraph, in points. This does not change line spacing. Pass the paragraph's text and before_pt, after_pt, or both. Omit a side to leave it.",
      parameters: Type.Object({
        text: Type.String({ description: "Text in the paragraph to space." }),
        before_pt: Type.Optional(Type.Number({ description: "Points of space before the paragraph." })),
        after_pt: Type.Optional(Type.Number({ description: "Points of space after the paragraph." })),
      }),
      target: ({ text }) => {
        const block = findBlock(blocks(editor), text);
        return block ? pointAt(editor, block.pos) : editor.view.dom;
      },
      execute({ text, before_pt, after_pt }) {
        const found = findBlock(blocks(editor), text);
        if (!found) throw new ToolError(`No paragraph contains "${text}".`);
        const node = editor.state.doc.nodeAt(found.pos);
        if (!node) throw new ToolError(`No paragraph contains "${text}".`);
        if (before_pt == null && after_pt == null)
          throw new ToolError("Pass before_pt, after_pt, or both.");
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(found.pos, undefined, {
            ...node.attrs,
            ...(before_pt != null ? { spaceBefore: before_pt } : {}),
            ...(after_pt != null ? { spaceAfter: after_pt } : {}),
          }),
        );
        const bits = [
          before_pt != null ? `${before_pt} pt before` : "",
          after_pt != null ? `${after_pt} pt after` : "",
        ].filter(Boolean);
        return `Set ${bits.join(" and ")} on "${found.text.slice(0, 80)}". Line spacing is unchanged.`;
      },
    }),
    tool({
      name: "set_indent",
      label: "Indent",
      description:
        "Set a first-line or hanging indent on the paragraphs that contain `text`, in inches. kind is first-line, hanging, or none. A first-line indent moves only the first line. A hanging indent leaves the first line at the margin and indents the lines after it. This does not shift the whole paragraph.",
      parameters: Type.Object({
        text: Type.String({ description: "Text in the paragraphs to indent." }),
        kind: Type.String({ description: "first-line, hanging, or none." }),
        inches: Type.Optional(Type.Number({ description: "Indent in inches. Default 0.5. Ignored when kind is none." })),
      }),
      target: ({ text }) => {
        const block = findBlock(blocks(editor), text);
        return block ? pointAt(editor, block.pos) : editor.view.dom;
      },
      execute({ text, kind, inches }) {
        const indent = indentKind(kind);
        const amount = indent === "none" ? 0 : inches ?? 0.5;
        const matches = blocks(editor).filter((block) => block.text.includes(text.trim()));
        if (!matches.length) throw new ToolError(`No paragraph contains "${text}".`);
        const applied = editor
          .chain()
          .setTextSelection({ from: matches[0].pos + 1, to: matches[matches.length - 1].end - 1 })
          .setSpecialIndent(indent, amount)
          .run();
        if (!applied) throw new ToolError("Could not set that indent.");
        return `Set a ${indent === "none" ? "no" : `${amount} inch ${indent}`} indent on ${matches.length} paragraph${matches.length === 1 ? "" : "s"} containing "${text.trim()}".`;
      },
    }),
    tool({
      name: "set_tab_stop",
      label: "Tab stop",
      description:
        "Set a tab stop, in inches, on the paragraph that contains `text`. Pass `before` to insert a tab immediately before that word in the same paragraph, so the word jumps to the stop. Does not rewrite the rest of the line.",
      parameters: Type.Object({
        text: Type.String({ description: "Text in the paragraph that gets the stop." }),
        inches: Type.Number({ description: "Tab stop in inches, such as 3." }),
        before: Type.Optional(Type.String({ description: "Word in that paragraph to put a tab in front of." })),
      }),
      target: ({ text }) => {
        const block = findBlock(blocks(editor), text);
        return block ? pointAt(editor, block.pos) : editor.view.dom;
      },
      execute({ text, inches, before }) {
        const found = findBlock(blocks(editor), text);
        if (!found) throw new ToolError(`No paragraph contains "${text}".`);
        const applied = editor.chain().setTextSelection(found.pos + 1).setTabStop(inches).run();
        if (!applied) throw new ToolError("Could not set that tab stop.");
        if (before) {
          const node = editor.state.doc.nodeAt(found.pos);
          const body = node?.textContent ?? "";
          const at = body.indexOf(before);
          if (at < 0) throw new ToolError(`"${before}" is not in that paragraph.`);
          if (at === 0 || body[at - 1] !== "\t") {
            editor
              .chain()
              .setTextSelection(found.pos + 1 + at)
              .insertContent("\t")
              .run();
          }
        }
        return `Set a ${inches} inch tab stop on "${found.text.slice(0, 60)}"${before ? ` and put a tab before "${before}"` : ""}.`;
      },
    }),
    tool({
      name: "set_image_wrap",
      label: "Image wrap",
      description:
        "Change how the picture already in the document sits with the text. wrap is inline (in the line, about as tall as the words), left, right, break (its own line), or behind (under the words, which stay put). Does not replace the picture or its pixels. To insert a new picture, use insert_image.",
      parameters: Type.Object({
        wrap: Type.String({ description: "inline, left, right, break, or behind." }),
      }),
      target: () => document.querySelector(".document-content img, .ProseMirror img") ?? editor.view.dom,
      execute({ wrap }) {
        const placement = wrapArg(wrap);
        const image = firstImage(editor);
        if (!image) throw new ToolError("There is no picture in the document. Use insert_image to add one.");
        editor.chain().focus().setNodeSelection(image.pos).scrollIntoView().run();
        const ok =
          placement === "inline"
            ? placeImageInline(editor, image.pos)
            : applyImageWrap(editor, image.pos, placement);
        if (!ok) throw new ToolError(`Could not set the picture to ${placement}.`);
        return `The picture is now ${placement}. Its pixels were not replaced.`;
      },
    }),
    tool({
      name: "set_numbering_restart",
      label: "Restart page numbers",
      description:
        "Mark one heading as the place Arabic page numbers start at 1. Pages before that heading keep the current format, such as roman numerals from page_setup. Does not type a number into the footer. Pass the heading's text.",
      parameters: Type.Object({
        heading: Type.String({ description: "Heading where Arabic numbers begin, such as a chapter title." }),
      }),
      target: ({ heading }) => {
        const block = findBlock(blocks(editor), heading);
        return block ? pointAt(editor, block.pos) : editor.view.dom;
      },
      execute({ heading }) {
        const list = blocks(editor).filter((block) => block.type === "heading");
        const found = findBlock(list, heading);
        if (!found) throw new ToolError(`No heading contains "${heading}".`);
        let tr = editor.state.tr;
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name !== "heading") return;
          const on = pos === found.pos;
          if (Boolean(node.attrs.startArabic) === on) return;
          tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, startArabic: on ? true : false });
        });
        editor.view.dispatch(tr);
        return `Arabic page numbers start at 1 on "${found.text}". Earlier pages keep their current number format.`;
      },
    }),
  ];
}
