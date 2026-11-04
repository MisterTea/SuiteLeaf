import { TextSelection } from "@tiptap/pm/state";
import { Type } from "@earendil-works/pi-ai";
import { ToolError, tool, type SuiteTool } from "../host";
import { requestFile } from "../file-request";
import type { DocsAgentContext } from "./docs";
import {
  wait,
  blocks,
  images,
  findBlock,
  noBlock,
  objectAfter,
  openParagraphAt,
  locate,
  rectAt,
  endOfDocument,
  textSelection,
} from "./doc-blocks";
import { throwIfKeepLinesNews, throwIfColumnNews } from "./doc-flow-cases";

export function docInsertTools(ctx: DocsAgentContext): SuiteTool[] {
  const { editor } = ctx;
  const { selectMatch } = textSelection(editor);
  return [
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
        throwIfColumnNews(editor, ctx.title);
        throwIfKeepLinesNews(editor, ctx.title);
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
        "Ask the user to choose a photo from their computer and insert it after the paragraph containing `after` (or at the cursor). To describe a photo already in the document, use set_image_description. Do not insert another photo to add a description.",
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
  ];
}
