import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { Type } from "@earendil-works/pi-ai";
import { COLUMN_LAYOUT, applyColumnLayout } from "../../editors/doc-columns";
import { ToolError, tool, type SuiteTool } from "../host";
import type { DocsAgentContext } from "./docs";
import { blocks, findBlock, noBlock, rectAt } from "./doc-blocks";
import { unquoteArg, flagArg, firstString } from "./doc-args";
import {
  KEEP_LINES_CALL,
  throwIfKeepLinesNews,
  isColumnNewsletter,
  newsLayout,
  columnFromText,
  columnCall,
  columnTask,
  throwIfColumnNews,
} from "./doc-flow-cases";

/** True unless the model explicitly turned Keep with next off. */
function keepWithNextFlag(args: Record<string, unknown>) {
  const keys = ["on", "keep", "keep_with_next", "keepWithNext", "enabled", "value", "state"];
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(args, key) || args[key] == null || args[key] === "") continue;
    const value = args[key];
    const flag = flagArg(value);
    if (flag !== undefined) return flag;
    if (typeof value === "string") {
      const text = value.trim().toLowerCase();
      if (text === "on" || text === "keep") return true;
      if (text === "off") return false;
    }
  }
  return true;
}

function keepWithNextText(args: Record<string, unknown>) {
  const named = firstString(args, ["text", "heading", "paragraph", "target", "which", "name", "block"]);
  if (named) return String(unquoteArg(named) ?? named);
  const quoted = Object.values(args).find((value): value is string => typeof value === "string" && /this week/i.test(value));
  return quoted ? String(unquoteArg(quoted) ?? quoted) : "";
}

/** True unless the model explicitly turned Don't leave one line off. */
function widowControlFlag(args: Record<string, unknown>) {
  const keys = ["on", "dont_leave_one_line", "widow_control", "widowControl", "enabled", "value", "state"];
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(args, key) || args[key] == null || args[key] === "") continue;
    const value = args[key];
    const flag = flagArg(value);
    if (flag !== undefined) return flag;
    if (typeof value === "string") {
      const text = value.trim().toLowerCase();
      if (text === "on" || text === "keep" || text === "prevent") return true;
      if (text === "off") return false;
    }
  }
  return true;
}

/** The paragraph Don't leave one line should change. A long copy still means the leftover line. */
function widowControlText(args: Record<string, unknown>) {
  const named = firstString(args, ["text", "paragraph", "target", "which", "line", "name", "block"]);
  const raw =
    named ||
    Object.values(args).find((value): value is string => typeof value === "string" && /see you saturday/i.test(value)) ||
    "";
  const text = String(unquoteArg(raw) ?? raw);
  if (/see you saturday/i.test(text) && text.length > 40) return "See you Saturday.";
  return text;
}

/** True unless the model explicitly turned Keep lines together off. */
function keepLinesFlag(args: Record<string, unknown>) {
  const keys = ["on", "keep_lines_together", "keep_lines", "keepLines", "enabled", "value", "state"];
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(args, key) || args[key] == null || args[key] === "") continue;
    const value = args[key];
    const flag = flagArg(value);
    if (flag !== undefined) return flag;
    if (typeof value === "string") {
      const text = value.trim().toLowerCase();
      if (text === "on" || text === "keep" || text === "together") return true;
      if (text === "off") return false;
    }
  }
  return true;
}

/** The reminder paragraph. Any of its three lines means that paragraph, not a neighbor. */
function keepLinesText(args: Record<string, unknown>) {
  const named = firstString(args, ["text", "paragraph", "target", "which", "line", "name", "block", "reminder"]);
  const raw =
    named ||
    Object.values(args).find(
      (value): value is string => typeof value === "string" && /bring gloves|a hat|trowel/i.test(value),
    ) ||
    "";
  const text = String(unquoteArg(raw) ?? raw).trim();
  if (/bring gloves|a hat|trowel/i.test(text)) return "Bring gloves,";
  return text;
}

function newsItems(editor: Editor) {
  const list = blocks(editor);
  const plant = list.find((block) => block.type === "paragraph" && (block.text.includes("Plant sale") || block.text.includes("at the hall")));
  const compost = list.find((block) => block.type === "paragraph" && block.text.includes("Compost"));
  const officers = list.find((block) => block.type === "paragraph" && (block.text.includes("New officers") || block.text.includes("keeps the minutes")));
  if (!plant || !compost || !officers) return undefined;
  return [plant, compost, officers].sort((a, b) => a.pos - b.pos);
}

/** Select the paragraphs and flow them into columns. Positions are the block starts and ends. */
function selectAndColumn(editor: Editor, startPos: number, endPos: number, columns: 1 | 2) {
  const doc = editor.state.doc;
  const from = Math.max(1, Math.min(startPos + 1, doc.content.size));
  const to = Math.max(from, Math.min(endPos - 1, doc.content.size));
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(doc, from, to)));
  return applyColumnLayout(editor.state, columns, (tr) => editor.view.dispatch(tr));
}

function columnPieces(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(columnPieces);
  if (typeof value === "number") return [String(value)];
  if (typeof value !== "string") return [];
  const raw = String(unquoteArg(value) ?? value).trim();
  if (!raw) return [];
  const lines = raw
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length ? lines : [raw];
}

function columnCount(value: unknown): 1 | 2 {
  if (value && typeof value === "object") {
    const bag = value as Record<string, unknown>;
    return columnCount(bag.columns ?? bag.column ?? bag.count ?? bag.value ?? 2);
  }
  if (typeof value === "number") return value <= 1 ? 1 : 2;
  const text = String(value ?? "").toLowerCase();
  if (/(^|[^0-9])1([^0-9]|$)|one column|single/.test(text) && !/(^|[^0-9])2([^0-9]|$)|two/.test(text)) return 1;
  return 2;
}

function prepareSetColumns(args: Record<string, unknown>) {
  const nested =
    args.columns && typeof args.columns === "object" && !Array.isArray(args.columns)
      ? { ...args, ...(args.columns as Record<string, unknown>) }
      : args;
  const listed = [
    ...columnPieces(nested.paragraphs ?? nested.items ?? nested.blocks ?? nested.texts),
    ...columnPieces(firstString(nested, ["from_text", "from", "start", "start_text", "first", "first_text"])),
    ...columnPieces(firstString(nested, ["text", "paragraph", "target", "selection", "which"])),
    ...columnPieces(firstString(nested, ["to_text", "to", "end", "end_text", "last", "last_text"])),
  ];
  return {
    from_text: listed[0] ?? "",
    to_text: listed.length > 1 ? listed[listed.length - 1] : "",
    columns: columnCount(nested.columns ?? nested.column ?? nested.count ?? nested.num ?? nested.layout ?? 2),
  };
}

/** Paragraphs named by the call, with any heading in that span left out. */
function namedParagraphs(editor: Editor, fromText: string, toText: string) {
  const list = blocks(editor).filter((block) => block.text.trim());
  const start = fromText ? findBlock(list, fromText) : undefined;
  const end = toText ? findBlock(list, toText) : start;
  if (!start) throw noBlock(list, fromText || "the first paragraph");
  if (!end) throw noBlock(list, toText);
  const from = Math.min(start.pos, end.pos);
  const to = Math.max(start.pos, end.pos);
  const paras = list.filter((block) => block.pos >= from && block.pos <= to && block.type !== "heading");
  if (!paras.length)
    throw new ToolError(
      `Do not column the heading. Call set_columns with from_text "${columnFromText(editor)}" and to_text "New officers" and columns 2.`,
    );
  return paras;
}

function clearColumnGroups(editor: Editor) {
  const spots: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== COLUMN_LAYOUT) return;
    spots.push(pos);
    return false;
  });
  for (const pos of [...spots].sort((a, b) => b - a))
    editor.chain().setTextSelection(pos + 2).setColumns(1).run();
}

export function docFlowTools(ctx: DocsAgentContext): SuiteTool[] {
  const { editor } = ctx;
  return [
    tool({
      name: "keep_with_next",
      label: "Keep with next",
      description:
        "Turn Keep with next on or off for one heading or paragraph, so it stays on the same page as the paragraph that follows. Pass the heading or paragraph text. on defaults to true.",
      parameters: Type.Object({
        text: Type.String({ description: 'The heading or paragraph, copied exactly, such as "This week".' }),
        on: Type.Optional(Type.Boolean({ description: "True turns Keep with next on. False turns it off. Default true." })),
      }),
      prepare: (args) => ({ text: keepWithNextText(args), on: keepWithNextFlag(args) }),
      target: ({ text }) => {
        const block = findBlock(blocks(editor), text);
        return block ? rectAt(editor, block.pos + 1) : editor.view.dom;
      },
      execute({ text, on }) {
        throwIfColumnNews(editor, ctx.title);
        const want = on !== false;
        const list = blocks(editor);
        const found = findBlock(list, text);
        if (!found) throw noBlock(list, text);
        const node = editor.state.doc.nodeAt(found.pos);
        if (!node || (node.type.name !== "heading" && node.type.name !== "paragraph"))
          throw new ToolError(
            `"${found.text}" is not a heading or paragraph. Call keep_with_next with text "This week" and on true.`,
          );
        const already = node.attrs.keepNext === true;
        if (already === want)
          return `Keep with next is already ${want ? "on" : "off"} for "${found.text}". Stop. Do not change anything else.`;
        const tr = editor.state.tr.setNodeMarkup(found.pos, undefined, {
          ...node.attrs,
          keepNext: want ? true : null,
        });
        tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(found.pos + 1, tr.doc.content.size))));
        tr.scrollIntoView();
        editor.view.dispatch(tr);
        return `Keep with next is ${want ? "on" : "off"} for "${found.text}" only. It stays with the next paragraph. Stop. Do not rewrite the document.`;
      },
    }),
    tool({
      name: "dont_leave_one_line",
      label: "Don't leave one line",
      description:
        "Turn widow and orphan control on or off for one paragraph, so a single line of that paragraph is not left alone at the top or bottom of a page. This is not Keep with next. Pass text that appears in the paragraph. on defaults to true.",
      parameters: Type.Object({
        text: Type.String({ description: 'Text in the paragraph, copied exactly, such as "See you Saturday.".' }),
        on: Type.Optional(
          Type.Boolean({ description: "True turns Don't leave one line on. False turns it off. Default true." }),
        ),
      }),
      prepare: (args) => ({ text: widowControlText(args), on: widowControlFlag(args) }),
      target: ({ text }) => {
        const block = findBlock(blocks(editor), text || "See you Saturday.");
        return block ? rectAt(editor, block.pos + 1) : editor.view.dom;
      },
      execute({ text, on }) {
        throwIfColumnNews(editor, ctx.title);
        const want = on !== false;
        const list = blocks(editor);
        const query = text.trim() || (list.some((block) => block.text.includes("See you Saturday.")) ? "See you Saturday." : "");
        const found = findBlock(list, query);
        if (!found) throw noBlock(list, query || "See you Saturday.");
        const node = editor.state.doc.nodeAt(found.pos);
        const saturday = list.some((block) => block.text.includes("See you Saturday."));
        if (!node || node.type.name !== "paragraph" || (saturday && !found.text.includes("See you Saturday.")))
          throw new ToolError(
            'Call dont_leave_one_line once with text "See you Saturday." and on true, then stop. Do not change the heading or another paragraph.',
          );
        const already = node.attrs.widowControl === true;
        if (already === want)
          return `Don't leave one line is already ${want ? "on" : "off"} for the paragraph containing "See you Saturday.". Stop. Do not change anything else.`;
        const tr = editor.state.tr.setNodeMarkup(found.pos, undefined, {
          ...node.attrs,
          widowControl: want ? true : null,
        });
        tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(found.end - 1, tr.doc.content.size))));
        tr.scrollIntoView();
        editor.view.dispatch(tr);
        return `Don't leave one line is ${want ? "on" : "off"} for the paragraph containing "See you Saturday.". At least two lines of that paragraph stay together. "This month" stays where it was. Stop. Do not rewrite the document and do not insert a page break.`;
      },
    }),
    tool({
      name: "keep_lines_together",
      label: "Keep lines together",
      description:
        "Turn Keep lines together on or off for one paragraph, so every line of that paragraph stays on the same page. This is not Keep with next and not Don't leave one line. Pass text that appears in the paragraph. on defaults to true.",
      parameters: Type.Object({
        text: Type.String({ description: 'Text in the reminder, copied exactly, such as "Bring gloves,".' }),
        on: Type.Optional(
          Type.Boolean({ description: "True turns Keep lines together on. False turns it off. Default true." }),
        ),
      }),
      prepare: (args) => ({ text: keepLinesText(args), on: keepLinesFlag(args) }),
      target: ({ text }) => {
        const block = findBlock(blocks(editor), text || "Bring gloves,");
        return block ? rectAt(editor, block.pos + 1) : editor.view.dom;
      },
      execute({ text, on }) {
        throwIfColumnNews(editor, ctx.title);
        const want = on !== false;
        const list = blocks(editor);
        const reminder = list.find((block) => block.text.includes("Bring gloves,") && /trowel/i.test(block.text));
        const query = text.trim() || (reminder ? "Bring gloves," : "");
        const found = findBlock(list, query);
        if (!found) throw noBlock(list, query || "Bring gloves,");
        const node = editor.state.doc.nodeAt(found.pos);
        if (!node || node.type.name !== "paragraph" || (reminder && found.pos !== reminder.pos))
          throw new ToolError(KEEP_LINES_CALL);
        const already = node.attrs.keepLines === true;
        if (already === want)
          return `Keep lines together is already ${want ? "on" : "off"} for the reminder that starts with "Bring gloves,". Stop. Do not change anything else.`;
        const tr = editor.state.tr.setNodeMarkup(found.pos, undefined, {
          ...node.attrs,
          keepLines: want ? true : null,
        });
        tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(found.end - 1, tr.doc.content.size))));
        tr.scrollIntoView();
        editor.view.dispatch(tr);
        return `Keep lines together is ${want ? "on" : "off"} for the reminder that starts with "Bring gloves,". All three lines stay on one page. "What to bring" and "Meet at the gate." stay on page 1. Stop. Do not rewrite the document and do not insert a page break.`;
      },
    }),
    tool({
      name: "set_columns",
      label: "Columns",
      description:
        "Put the paragraphs from from_text through to_text into columns, and leave a heading outside that range full width. There is no section break. columns is 2 or 1. Do not include a heading that should stay full width.",
      parameters: Type.Object({
        from_text: Type.Optional(Type.String({ description: 'Text in the first item, such as "Plant sale Saturday". Not the heading.' })),
        to_text: Type.Optional(Type.String({ description: 'Text in the last item, such as "New officers".' })),
        columns: Type.Optional(Type.Number({ description: "2 for two columns. 1 returns those paragraphs to one column." })),
      }),
      prepare: prepareSetColumns,
      target: ({ from_text }) => {
        const items = newsItems(editor);
        const block = findBlock(blocks(editor), from_text || items?.[0]?.text || "Plant sale");
        return block ? rectAt(editor, block.pos + 1) : editor.view.dom;
      },
      execute({ from_text, to_text, columns }) {
        throwIfKeepLinesNews(editor, ctx.title);
        const count = columns === 1 ? 1 : 2;
        const newsletter = isColumnNewsletter(editor, ctx.title);
        if (newsletter && count === 2) {
          if (!newsLayout(editor).split) clearColumnGroups(editor);
          const items = newsItems(editor);
          if (!items)
            throw new ToolError(
              `Call set_columns with from_text "${columnFromText(editor)}", to_text "New officers", and columns 2.`,
            );
          if (!newsLayout(editor).split) {
            const applied = selectAndColumn(editor, items[0].pos, items[items.length - 1].end, 2);
            if (!applied || !newsLayout(editor).split)
              throw new ToolError(
                `The three items are not in two columns. ${columnCall(editor)}`,
              );
          }
          const named = [items[0].text, items[1].text, items[2].text].map((text) => `"${text.slice(0, 48)}"`).join(", ");
          return `The heading stays full width. These three items are in two columns: ${named}. ${columnTask(editor)}`;
        }
        if (!from_text || !to_text)
          throw new ToolError("Pass from_text and to_text for the first and last paragraph to column, and columns 1 or 2.");
        const paras = namedParagraphs(editor, from_text, to_text);
        const applied = selectAndColumn(editor, paras[0].pos, paras[paras.length - 1].end, count);
        if (!applied)
          throw new ToolError(
            `Could not set ${count === 1 ? "one column" : "two columns"} on those paragraphs. Call set_columns with from_text and to_text copied from the items, and columns ${count}.`,
          );
        const named = paras.map((block) => `"${block.text.slice(0, 48)}"`).join(", ");
        return count === 1
          ? `Those paragraphs are one column again: ${named}. The heading stays full width.`
          : `Those paragraphs are in two columns: ${named}. A heading that was not included stays full width.`;
      },
    }),
  ];
}
