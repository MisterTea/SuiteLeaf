import type { Editor } from "@tiptap/core";
import { undoDepth } from "@tiptap/pm/history";
import { Type } from "@earendil-works/pi-ai";
import type { PageSettings } from "@suiteleaf/core/document-layout";
import { ToolError, tool, type SuiteTool } from "../host";
import { baselineSnapshot, markBaseline, ownUndoSteps } from "../guard";
import { docFormatTools } from "./doc-format";
import { blocks, images, unlabel, unmark, findBlock, noBlock, headingNamesNow } from "./doc-blocks";
import { pageNumberPhrase } from "./doc-page-args";
import {
  isBindingMinutes,
  TWO_INCH_CALL,
  isThesisNotes,
  thesisMarginReady,
  HEADER_EDGE_CALL,
  isCouncilHeaderNotes,
  councilHeaderReady,
  ODD_EVEN_CALL,
  isOddEvenMinutes,
  oddEvenMinutesReady,
  throwIfOddEvenMinutes,
  BINDING_GUTTER_CALL,
} from "./doc-page-cases";
import {
  KEEP_LINES_CALL,
  isKeepLinesNewsletter,
  throwIfKeepLinesNews,
  isColumnNewsletter,
  newsLayout,
  columnTask,
  throwIfColumnNews,
  reminderKeepsLines,
  keepLinesNote,
  widowLineNote,
} from "./doc-flow-cases";
import { docFlowTools } from "./doc-flow";
import { docTextTools } from "./doc-text";
import { docInsertTools } from "./doc-insert";
import { statusWordCount, docProofingTools } from "./doc-proofing";
import { docPageTools } from "./doc-page-setup";
import { docReferenceTools } from "./doc-references";
import { docEquationTools } from "./doc-equations";
import { photoSummary, docImageTools } from "./doc-images";

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
  showWordCount: () => void;
  showDictionary: () => void;
  closeProofing: () => void;
  jumpToHeading: (pos: number) => void;
  insertImage: (file: File) => Promise<void>;
  /** Undefined once the browser downloads it; on the desktop, the saved path or null if cancelled. */
  exportAs: (format: "docx" | "html" | "txt") => Promise<string | null | undefined>;
  pageCount: number;
}

function headingBlock(list: ReturnType<typeof blocks>, raw: string) {
  const want = unmark(unlabel(raw)).trim();
  const headings = list.filter((b) => b.type === "heading" && b.text.trim());
  if (!want) return undefined;
  const exact = headings.find((b) => b.text.trim().toLowerCase() === want.toLowerCase());
  if (exact) return exact;
  const named = headings.filter((b) => want.toLowerCase().includes(b.text.trim().toLowerCase()));
  if (named.length === 1) return named[0];
  const contains = headings.filter((b) => b.text.toLowerCase().includes(want.toLowerCase()));
  return contains.length === 1 ? contains[0] : undefined;
}

/** First sentence of a long paragraph, so a shortened preview does not look like cut-off text. */
function previewLine(text: string) {
  const sentence = text.split(/(?<=\.)\s/)[0] ?? text;
  if (sentence.length < text.length) return `${sentence} …`;
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

export function docTools(ctx: DocsAgentContext): SuiteTool[] {
  const { editor } = ctx;
  return [
    ...docTextTools(ctx),
    ...docFlowTools(ctx),
    ...docInsertTools(ctx),
    ...docProofingTools(ctx),
    ...docPageTools(ctx),
    ...docReferenceTools(ctx),
    tool({
      name: "move_section",
      label: "Move section",
      description:
        "Move a heading and the blocks through `through` so they sit immediately before the heading `before`. To put Budget above What we achieved: heading Budget, through \"Budget close.\", before \"What we achieved\". Stop at Budget close. so Partnerships stays where it is. Do not retype the section.",
      parameters: Type.Object({
        heading: Type.String({ description: "Heading to move, such as Budget." }),
        through: Type.String({ description: "Last paragraph to move with the heading, such as Budget close." }),
        before: Type.String({ description: "Heading that should come next, such as What we achieved." }),
      }),
      prepare(args) {
        return {
          heading: String(args.heading ?? args.from ?? args.section ?? "").trim(),
          through: String(args.through ?? args.end ?? args.until ?? "").trim(),
          before: String(args.before ?? args.before_heading ?? "").trim(),
        };
      },
      target: ({ heading }) =>
        [...document.querySelectorAll(".outline-item")].find((el) => el.textContent?.includes(heading)) ?? editor.view.dom,
      execute({ heading, through, before }) {
        const list = blocks(editor);
        const names = headingNamesNow(editor);
        const start = headingBlock(list, heading);
        if (!start) throw new ToolError(`There is no heading "${heading}". Headings: ${names}.`);
        if (!through) throw new ToolError(`Say the last paragraph to move with "${start.text}", such as Budget close.`);
        const endBlock = findBlock(list, through);
        if (!endBlock) throw noBlock(list, through);
        if (endBlock.pos < start.pos) throw new ToolError(`"${endBlock.text}" comes before the heading "${start.text}".`);
        const target = headingBlock(list, before);
        if (!target)
          throw new ToolError(
            `There is no heading "${before}". Headings: ${names}. Rename Results to What we achieved with find_and_replace first if that heading is still called Results.`,
          );
        if (target.pos >= start.pos && target.pos < endBlock.end)
          throw new ToolError(`"${target.text}" is inside the part being moved.`);
        const nextHeading = list.find((b) => b.type === "heading" && b.text.trim() && b.pos >= endBlock.end);
        if (nextHeading?.pos === target.pos && start.pos < target.pos)
          return `"${start.text}" is already immediately before "${target.text}". Headings: ${names}.`;
        const slice = editor.state.doc.slice(start.pos, endBlock.end);
        const tr = editor.state.tr.delete(start.pos, endBlock.end);
        tr.insert(tr.mapping.map(target.pos), slice.content);
        editor.view.dispatch(tr.scrollIntoView());
        return `Moved "${start.text}" through "${endBlock.text.slice(0, 40)}" to just before "${target.text}". Headings now: ${headingNamesNow(editor)}.`;
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
    ...docEquationTools(ctx),
    ...docImageTools(ctx),
    tool({
      name: "undo",
      label: "Undo",
      description: "Undo your own last change in this request. Changes from before the request are the user's and can't be undone with this.",
      parameters: Type.Object({}),
      target: () => document.querySelector('[aria-label="Undo"]'),
      execute() {
        throwIfColumnNews(editor, ctx.title);
        throwIfKeepLinesNews(editor, ctx.title);
        throwIfOddEvenMinutes(ctx.title, editor);
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
    ...docFormatTools(ctx),
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
  const issues: string[] = [];
  if (isOddEvenMinutes(ctx.title, ctx.editor) && !oddEvenMinutesReady(ctx.pageSettings())) issues.push(ODD_EVEN_CALL);
  if (isCouncilHeaderNotes(ctx.title, ctx.editor) && !councilHeaderReady(ctx.pageSettings())) issues.push(HEADER_EDGE_CALL);
  const before = baselineSnapshot<string[]>(ctx.editor);
  if (!before) return issues;
  const old = new Set(before);
  if (isColumnNewsletter(ctx.editor, ctx.title) && !newsLayout(ctx.editor).split) issues.push(columnTask(ctx.editor));
  if (isKeepLinesNewsletter(ctx.editor, ctx.title) && !reminderKeepsLines(ctx.editor))
    issues.push(`The reminder still splits across the page break. ${KEEP_LINES_CALL}`);
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
  const { label: wordLabel } = statusWordCount(ctx.editor);
  const preview = list
    .slice(0, 12)
    .map((b) => `[${b.label}] ${previewLine(b.text)}`)
    .join("\n");
  const page = ctx.pageSettings();
  const firstPage = page.differentFirstPage
    ? ` Different first page is on, page 1 header "${page.firstHeader}", no number on page 1.`
    : " Different first page is off.";
  const mark = page.watermark ? `watermark "${page.watermark}" behind the text` : "no watermark";
  const draftMark =
    ctx.title === "Garden club minutes" && !page.watermark && ctx.editor.getText().includes("potting shed")
      ? ' To mark this draft, call page_setup once with watermark "DRAFT", then stop. Do not type DRAFT into a paragraph.'
      : "";
  const bindingMark = isBindingMinutes(ctx.title, ctx.editor)
    ? page.gutter > 0
      ? ` Gutter is ${(page.gutter / 96).toFixed(2)} inches on the inside edge. The four edge margins are unchanged. Stop. Do not set the gutter back to 0. Do not call page_setup again.`
      : ` ${BINDING_GUTTER_CALL}`
    : "";
  const oddEvenMark = isOddEvenMinutes(ctx.title, ctx.editor)
    ? oddEvenMinutesReady(page)
      ? ` Different odd and even is on. Even header is "Minutes" on the left, and the number is on the left. Odd header is "Garden club" on the right, and the number is on the right. Page 1 is "Riverside Garden Club" with no number. Stop. Do not call page_setup again. Do not type the page number into the header.`
      : ` Different odd and even is off, so pages 2 and 3 both show "Garden club minutes" on the left and the number on the right. ${ODD_EVEN_CALL}`
    : "";
  const thesisMark = isThesisNotes(ctx.title, ctx.editor)
    ? thesisMarginReady(page)
      ? ` The margin is 2.00 inches on every edge. Stop. Do not rewrite the notes.`
      : ` The margin is still under 2 inches. ${TWO_INCH_CALL}`
    : "";
  const councilMark = isCouncilHeaderNotes(ctx.title, ctx.editor)
    ? councilHeaderReady(page)
      ? ` Header from edge is 0.50 inches. The body margin is still 1 inch. Stop. Do not rewrite the notes.`
      : ` Header "${page.header}" is ${(page.headerFromEdge / 96).toFixed(2)} inches from the edge, the same inset as the notes. The body margin is 1 inch and must stay 1 inch. ${HEADER_EDGE_CALL}`
    : "";
  const setup = `Page setup: ${page.size.toUpperCase()} ${page.landscape ? "landscape" : "portrait"}, ${(page.margin / 96).toFixed(2)}" margins, ${page.header ? `header "${page.header}"` : "no header"}, ${page.footer ? `footer "${page.footer}"` : "no footer"}, ${mark}, ${pageNumberPhrase(page)}.${firstPage}${bindingMark}${oddEvenMark}${thesisMark}${councilMark}`;
  const photos = images(ctx.editor);
  const photoNote = photos.length ? `\n${photos.map((p) => photoSummary(p)).join("; ")}.` : "";
  const columns = isColumnNewsletter(ctx.editor, ctx.title) ? `\n${columnTask(ctx.editor)}` : "";
  return `Open document: "${ctx.title}" (${wordLabel}, ${ctx.pageCount} page(s)). ${setup}${draftMark}${headings.length ? `\nHeadings: ${headings.join(" | ")}` : ""}${photoNote}\n${words ? `Start of the document (a line ending in … is shortened here; the paragraph itself is complete):\n${preview}` : "The document is empty."}\nTo restore one paragraph from a named earlier version and leave every other paragraph, call restore_paragraph. restore_version replaces the whole file.${widowLineNote(ctx.editor)}${keepLinesNote(ctx.editor)}${columns}`;
}
