import type { Editor } from "@tiptap/core";
import { Type } from "@earendil-works/pi-ai";
import type { JsonNode } from "@suiteleaf/core";
import {
  acceptSuggestions,
  listSuggestions,
  rejectSuggestions,
  type SuggestionInfo,
} from "@suiteleaf/core/suggestions";
import { replaceDocument } from "../../editors/doc-suggestions";
import { ToolError, tool, type SuiteTool } from "../host";
import type { DocsAgentContext } from "./docs";
import { blocks, locate, rectAt } from "./doc-blocks";
import { unquoteArg, present } from "./doc-args";
import { throwIfOddEvenMinutes } from "./doc-page-cases";
import { isWidowNewsletter, throwIfKeepLinesNews, throwIfColumnNews } from "./doc-flow-cases";

const authorStorage = "suiteleaf-author";

/** Like locate, then without a trailing period the model copied from the sentence. */
function locateLoose(editor: Editor, text: string) {
  const trimmed = text.trim();
  try {
    return locate(editor, trimmed);
  } catch {
    const bare = trimmed.replace(/[.,;:!?]+$/u, "").trim();
    if (bare && bare !== trimmed) {
      try {
        return locate(editor, bare);
      } catch {
        /* The message below names the text the model asked for. */
      }
    }
  }
  throw new ToolError(`"${trimmed}" is not in the document. Use read_document to see the exact text.`);
}

/** Suggesting as `author`, in the toolbar and on the next edit. */
function setSuggestingAs(editor: Editor, author: string) {
  localStorage.setItem(authorStorage, author);
  const input = document.querySelector<HTMLInputElement>('[aria-label="Suggesting as"]');
  if (input && input.value !== author) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, author);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  const suggesting = document.querySelector<HTMLButtonElement>('[aria-label="Editing mode"] button[title^="Suggesting"]');
  if (suggesting?.getAttribute("aria-pressed") !== "true") suggesting?.click();
  editor.commands.setSuggestionState({ mode: "suggesting", author });
}

function suggestInsert(editor: Editor, text: string, before: string) {
  const anchor = locateLoose(editor, before);
  let insert = text.replace(/[ \t]+$/g, " ");
  const next = editor.state.doc.textBetween(anchor.from, anchor.from + 1);
  if (!insert.endsWith(" ") && next && !/\s/.test(next)) insert += " ";
  const prior = editor.state.doc.textBetween(Math.max(0, anchor.from - insert.length), anchor.from);
  if (prior === insert) return `"${insert}" is already immediately before "${before.trim()}".`;
  editor.view.dispatch(editor.state.tr.insertText(insert, anchor.from));
  return `Suggested inserting "${insert}" before "${before.trim()}".`;
}

function coveredBy(editor: Editor, from: number, to: number, kind: string) {
  let saw = false;
  let all = true;
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return;
    saw = true;
    if (!node.marks.some((mark) => mark.type.name === "suggestion" && mark.attrs.kind === kind)) all = false;
  });
  return saw && all;
}

function suggestDelete(editor: Editor, text: string) {
  const wanted = text.trim().replace(/[.,;:!?]+$/u, "").trim();
  let match: { from: number; to: number } | null = null;
  try {
    match = locate(editor, text.trim());
  } catch {
    try {
      match = wanted ? locate(editor, wanted) : null;
    } catch {
      match = null;
    }
  }
  if (!match) {
    if (wanted && !editor.getText().includes(wanted)) return `"${wanted}" is already gone.`;
    throw new ToolError(`"${text.trim()}" is not in the document. Use read_document to see the exact text.`);
  }
  const removedNow = editor.state.doc.textBetween(match.from, match.to);
  if (!/\s$/.test(removedNow)) {
    const before = match.from > 0 ? editor.state.doc.textBetween(match.from - 1, match.from) : "";
    const after = editor.state.doc.textBetween(match.to, match.to + 1);
    if (after === " " && (!before || !/\w/.test(before))) match = { from: match.from, to: match.to + 1 };
  }
  if (coveredBy(editor, match.from, match.to, "delete")) {
    return `Deleting "${editor.state.doc.textBetween(match.from, match.to)}" is already suggested.`;
  }
  const removed = editor.state.doc.textBetween(match.from, match.to);
  editor.view.dispatch(editor.state.tr.delete(match.from, match.to));
  return `Suggested deleting "${removed}".`;
}

function suggestBold(editor: Editor, text: string) {
  const words = text.trim().replace(/[.,;:!?]+$/u, "").trim();
  const match = locateLoose(editor, words || text);
  let saw = false;
  let all = true;
  editor.state.doc.nodesBetween(match.from, match.to, (node) => {
    if (!node.isText) return;
    saw = true;
    if (!node.marks.some((mark) => mark.type.name === "bold")) all = false;
  });
  if (saw && all) return `"${words || text.trim()}" is already bold.`;
  editor.chain().setTextSelection(match).setMark("bold").run();
  return `Suggested bold on "${words || text.trim()}".`;
}

/** A review argument: the suggestion's words, or "*" when the model passed true. */
function reviewNeedle(value: unknown): string | undefined {
  if (value === true || value === 1) return "*";
  if (value === false || value === 0 || value == null || value === "") return undefined;
  if (typeof value !== "string") return undefined;
  const text = String(unquoteArg(value)).trim();
  if (!text || /^(false|no|0)$/i.test(text)) return undefined;
  if (/^(true|yes|1|all)$/i.test(text)) return "*";
  return text.replace(/[.,;:!?]+$/u, "").trim() || undefined;
}

function suggestionPlain(item: SuggestionInfo) {
  return item.text.replace(/\s+/g, " ").trim().toLowerCase();
}

function findSuggestion(pending: SuggestionInfo[], kind: SuggestionInfo["kind"], needle: string) {
  const want = needle.replace(/\s+/g, " ").trim().toLowerCase();
  return pending.find((item) => {
    if (item.kind !== kind) return false;
    if (kind === "format" && (want === "*" || want === "bold" || want === "format" || want === "formatting"))
      return !item.property || item.property === "bold";
    if (want === "*") return true;
    const text = suggestionPlain(item);
    const property = (item.property ?? "").toLowerCase();
    return text === want || text.includes(want) || (!!text && want.includes(text)) || property === want;
  });
}

function textIsBold(editor: Editor, text: string): boolean | null {
  let match: { from: number; to: number };
  try {
    match = locateLoose(editor, text);
  } catch {
    return null;
  }
  let saw = false;
  let all = true;
  editor.state.doc.nodesBetween(match.from, match.to, (node) => {
    if (!node.isText) return;
    saw = true;
    if (!node.marks.some((mark) => mark.type.name === "bold")) all = false;
  });
  return saw ? all : null;
}

function applyReview(editor: Editor, acceptIds: string[], rejectIds: string[]) {
  if (!acceptIds.length && !rejectIds.length) return;
  let json = editor.getJSON() as JsonNode;
  if (rejectIds.length) json = rejectSuggestions(json, rejectIds);
  if (acceptIds.length) json = acceptSuggestions(json, acceptIds);
  editor.view.dispatch(replaceDocument(editor.state, json));
}

export function suggestChangesTool(ctx: DocsAgentContext): SuiteTool {
  const { editor } = ctx;
  return tool({
    name: "suggest_changes",
    label: "Suggest changes",
    description:
      'Switch to Suggesting as `author` and propose changes, then accept or reject them in the same call. Call it once. Use author "Jordan", insert_text "approximately " (with the trailing space), insert_before "40 customers", delete_text "very", and bold_text "on budget". In that same call pass accept_insertion "approximately", accept_deletion "very" (accepting the deletion removes "very", including the space after it), and reject_bold "on budget" (rejecting the bold leaves "on budget" not bold). Do not pass accept: that would keep the bold. Do not use write_text, find_and_replace, or format_text.',
    parameters: Type.Object({
      author: Type.String({ description: 'Who is suggesting, shown as Suggesting as. Use "Jordan".' }),
      insert_text: Type.Optional(Type.String({ description: 'Words to suggest inserting. Use "approximately ".' })),
      insert_before: Type.Optional(Type.String({ description: 'Existing text to insert immediately before. Use "40 customers".' })),
      delete_text: Type.Optional(Type.String({ description: 'Exact text to suggest deleting. Use "very". The space after that word is removed with it.' })),
      bold_text: Type.Optional(Type.String({ description: 'Exact text to suggest making bold. Use "on budget", without the period.' })),
      accept_insertion: Type.Optional(Type.String({ description: 'Accept the insertion. Use "approximately".' })),
      accept_deletion: Type.Optional(Type.String({ description: 'Accept the deletion so those words are gone. Use "very".' })),
      reject_bold: Type.Optional(Type.String({ description: 'Reject the bold suggestion so the words are not bold. Use "on budget".' })),
    }),
    prepare: (args) => {
      const author = typeof args.author === "string" ? String(unquoteArg(args.author)).replace(/^suggesting as\s+/i, "").trim() : args.author;
      const { accept: _accept, accept_insert, accept_delete, reject_format, ...rest } = args;
      void _accept;
      return {
        ...rest,
        author,
        insert_text: unquoteArg(args.insert_text),
        insert_before: unquoteArg(args.insert_before),
        delete_text: unquoteArg(args.delete_text),
        bold_text: unquoteArg(args.bold_text),
        accept_insertion: reviewNeedle(args.accept_insertion ?? accept_insert),
        accept_deletion: reviewNeedle(args.accept_deletion ?? accept_delete),
        reject_bold: reviewNeedle(args.reject_bold ?? reject_format),
      };
    },
    target: ({ insert_before, delete_text, bold_text, reject_bold }) => {
      const label = [bold_text, reject_bold, delete_text, insert_before].find((value) => typeof value === "string" && value.trim() && value !== "*");
      if (typeof label === "string") {
        try {
          return rectAt(editor, locateLoose(editor, label).from);
        } catch {
          /* The mode switch is the place when the words are not there yet. */
        }
      }
      return document.querySelector(".mode-switch") ?? editor.view.dom;
    },
    execute(args) {
      throwIfColumnNews(editor, ctx.title);
      throwIfKeepLinesNews(editor, ctx.title);
      throwIfOddEvenMinutes(ctx.title, editor);
      if (isWidowNewsletter(editor, ctx.title))
        throw new ToolError(
          'Do not suggest changes in Garden club news. Call dont_leave_one_line once with text "See you Saturday." and on true, then stop.',
        );
      const author = args.author?.trim();
      if (!author) throw new ToolError('Pass author, the name to suggest as. For this review that is "Jordan".');
      setSuggestingAs(editor, author);
      const notes = [`Suggesting as ${author}.`];
      const insertText = present(args.insert_text);
      const insertBefore = args.insert_before?.trim();
      if (insertText || insertBefore) {
        if (!insertText || !insertBefore)
          throw new ToolError('To suggest an insertion, pass both insert_text "approximately " and insert_before "40 customers".');
        notes.push(suggestInsert(editor, insertText, insertBefore));
      }
      const deleting = present(args.delete_text);
      if (deleting) notes.push(suggestDelete(editor, deleting));
      const bold = present(args.bold_text);
      if (bold) notes.push(suggestBold(editor, bold));
      const acceptInsertion = present(args.accept_insertion);
      const acceptDeletion = present(args.accept_deletion);
      const rejectBold = present(args.reject_bold);
      if (!insertText && !deleting && !bold && !acceptInsertion && !acceptDeletion && !rejectBold)
        return `${notes.join(" ")} Nothing was proposed yet. Pass insert_text "approximately ", insert_before "40 customers", delete_text "very", bold_text "on budget", accept_insertion "approximately", accept_deletion "very", and reject_bold "on budget".`;
      const acceptIds: string[] = [];
      const rejectIds: string[] = [];
      const pendingNow = () => listSuggestions(editor.getJSON() as JsonNode);
      if (acceptInsertion) {
        const item = findSuggestion(pendingNow(), "insert", acceptInsertion);
        if (item) acceptIds.push(item.id);
        else if (acceptInsertion !== "*" && editor.getText().toLowerCase().includes(acceptInsertion.toLowerCase()))
          notes.push(`The insertion "${acceptInsertion}" is already accepted.`);
        else notes.push(`No insertion suggestion matches "${acceptInsertion}".`);
      }
      if (acceptDeletion) {
        const item = findSuggestion(pendingNow(), "delete", acceptDeletion);
        if (item) acceptIds.push(item.id);
        else {
          const needle = acceptDeletion === "*" ? "very" : acceptDeletion;
          if (!editor.getText().toLowerCase().includes(needle.toLowerCase()))
            notes.push(`The deletion of "${needle}" is already accepted.`);
          else notes.push(`No deletion suggestion matches "${acceptDeletion}".`);
        }
      }
      if (rejectBold) {
        const item = findSuggestion(pendingNow(), "format", rejectBold);
        if (item) rejectIds.push(item.id);
        else {
          const label = rejectBold === "*" || rejectBold === "bold" ? "on budget" : rejectBold;
          const boldNow = textIsBold(editor, label);
          if (boldNow === false) notes.push(`Bold on "${label}" is already rejected.`);
          else notes.push(`No bold suggestion matches "${rejectBold}".`);
        }
      }
      if (acceptIds.length || rejectIds.length) {
        applyReview(editor, acceptIds, rejectIds);
        const parts = [
          acceptIds.length ? `Accepted ${acceptIds.length} suggestion(s)` : "",
          rejectIds.length ? `Rejected ${rejectIds.length} suggestion(s)` : "",
        ].filter(Boolean);
        notes.push(`${parts.join(" and ")}.`);
      }
      const pending = listSuggestions(editor.getJSON() as JsonNode);
      const listed = pending.map((item) => `${item.kind} "${item.text.trim()}" by ${item.author || "Someone"}`).join("; ");
      const body = blocks(editor)
        .map((block) => block.text)
        .filter(Boolean)
        .join(" | ");
      const boldNow = textIsBold(editor, "on budget");
      const boldLine = boldNow === null ? "" : boldNow ? ' "on budget" is still bold.' : ' "on budget" is not bold.';
      const still = pending.length
        ? ` Pending suggestions (${pending.length}): ${listed}.${boldLine} Call suggest_changes again with accept_insertion "approximately", accept_deletion "very", and reject_bold "on budget". Do not pass accept.`
        : ` No suggestions are pending.${boldLine}`;
      return `${notes.join(" ")} Document: ${body}.${still}`;
    },
  });
}
