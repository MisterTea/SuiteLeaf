import { Type } from "@earendil-works/pi-ai";
import type { Slide, SlideElement } from "@suiteleaf/core";
import { addSlideComment, elementLabel, replyToSlideComment } from "../../editors/slide-comments";
import { ToolError, tool, type SuiteTool } from "../host";
import type { SlidesAgentContext } from "./slides";
import { textOf } from "./slide-describe";
import {
  wait,
  plainArg,
  findSlide,
  asWhich,
  stringArgs,
  canvas,
  slideUpdater,
} from "./slide-targets";

/** One comment per call. A second line is left for reply_slide_comment. */
function commentPrepare(args: Record<string, unknown>, reply: boolean) {
  const next = stringArgs(args);
  const text = plainArg(next.text, next.comment, next.body, next.message, next.note, next.content);
  const signed = plainArg(next.signed_as, next.signedAs, next.author, next.author_name, next.authorName, next.name, next.by);
  const object = plainArg(next.object, next.element, next.target, next.on, next.chart);
  const thread = plainArg(next.thread, next.thread_id, next.threadId);
  const out: Record<string, unknown> = {};
  if (text) out.text = text;
  if (signed) out.signed_as = signed;
  if (object) out.object = object;
  if (next.slide !== undefined && next.slide !== "") out.slide = String(next.slide);
  if (reply && thread) out.thread = thread;
  return out;
}

function stripSignedName(text: string, author: string) {
  const escaped = author.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const withoutTail = text.replace(new RegExp(`[\\s,]*(?:[-–—~]|\\n)\\s*${escaped}[.!]?\\s*$`, "i"), "").trim();
  const withoutHead = (withoutTail || text).replace(new RegExp(`^${escaped}\\s*[:\\-]\\s*`, "i"), "").trim();
  return withoutHead || text.trim();
}

function commentBody(text: string, signedAs: string | undefined): { text: string; author: string; remainder: string } {
  let author = signedAs?.trim() ?? "";
  let body = text.trim();
  if (!author) {
    const tail = /(?:[-–—~]|,\s*|\n)\s*([A-Z][A-Za-z]{1,40})\s*$/.exec(body);
    if (tail) author = tail[1];
  }
  if (author) body = stripSignedName(body, author);
  const lines = body.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return { text: lines[0] ?? "", author, remainder: lines.slice(1).join(" ") };
}

/** The chart image, not the text box titled Chart. */
function findCommentElement(slide: Slide, object: string | undefined, selectedId: string | null): SlideElement {
  const elements = slide.elements;
  const hint = (object ?? "").trim().toLowerCase().replace(/^(?:the|a|an)\s+/, "").replace(/\s+object$/, "");
  const image =
    elements.find((el) => el.type === "image") ??
    elements.find((el) => el.type !== "text" && /chart/i.test(`${el.id} ${el.alt ?? ""}`));
  if (hint) {
    const byId = elements.find((el) => el.id.toLowerCase() === hint);
    if (byId) return byId;
    const byAlt = elements.find((el) => (el.alt ?? "").toLowerCase().includes(hint));
    if (byAlt) return byAlt;
    if (/\b(chart|image|picture|photo|graph)\b/.test(hint) && image) return image;
    const byText = elements.find((el) => el.type === "text" && textOf(el).toLowerCase() === hint);
    if (byText) return byText;
  }
  if (selectedId) {
    const selected = elements.find((el) => el.id === selectedId);
    if (selected) return selected;
  }
  if (image) return image;
  const listed = elements
    .map((el) =>
      el.alt ? `${el.type} "${el.alt}" (${el.id})` : el.type === "text" ? `"${textOf(el).slice(0, 40)}" (${el.id})` : `${el.type} (${el.id})`,
    )
    .join(", ");
  throw new ToolError(`Say which object the comment is on${listed ? ` (${listed})` : ""}.`);
}

/** A name that only appears inside the reply is not the author. */
function replyAuthor(signed: string, text: string, threadAuthor: string) {
  if (!signed) return threadAuthor;
  if (!threadAuthor || signed.toLowerCase() === threadAuthor.toLowerCase()) return signed;
  const mentioned = new RegExp(`\\b${signed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
  return mentioned ? threadAuthor : signed;
}

export function slideCommentTools(ctx: SlidesAgentContext): SuiteTool[] {
  const update = slideUpdater(ctx);
  return [
    tool({
      name: "add_slide_comment",
      label: "Comment on object",
      description:
        'Start one comment thread on an object, such as the chart image. The comment is a mark on that object. It is not written into the speaker notes. Do not call set_speaker_notes. signed_as is the author. Example: object "chart", text "Use the September numbers", signed_as "Maria". If that object already has an open thread, call reply_slide_comment instead of starting another one. Do not resolve the thread.',
      parameters: Type.Object({
        text: Type.Optional(Type.String({ description: 'The comment, without a signature. Example: "Use the September numbers".' })),
        signed_as: Type.Optional(Type.String({ description: 'Author name. Example: "Maria".' })),
        object: Type.Optional(Type.String({ description: 'The object. Use "chart" for the chart image, not the title text box.' })),
        slide: Type.Optional(Type.String({ description: "Slide number or title. Default: the current slide." })),
      }),
      prepare: (args) => commentPrepare(args, false),
      target: ({ slide, object }) => {
        try {
          const found = findSlide(ctx.deck(), asWhich(slide), ctx.activeSlideId);
          const element = findCommentElement(
            ctx.deck().slides[found.id],
            object,
            found.id === ctx.activeSlideId ? ctx.selectedElementId : null,
          );
          return document.querySelector(`.slide-canvas [data-element-id="${CSS.escape(element.id)}"]`) ?? canvas();
        } catch {
          return canvas();
        }
      },
      async execute({ text, signed_as, object, slide }) {
        const { id, index } = findSlide(ctx.deck(), asWhich(slide), ctx.activeSlideId);
        const element = findCommentElement(ctx.deck().slides[id], object, id === ctx.activeSlideId ? ctx.selectedElementId : null);
        const parsed = commentBody(text ?? "", signed_as);
        if (!parsed.author)
          throw new ToolError('Pass signed_as with the author, for example "Maria". The speaker notes were not changed.');
        if (!parsed.text) throw new ToolError("Pass text with the comment. The speaker notes were not changed.");
        const existing = ctx.deck().slides[id].comments?.find((thread) => thread.elementId === element.id && !thread.resolved);
        if (existing) {
          ctx.select(id, element.id);
          const author = existing.messages[0]?.authorName ?? parsed.author;
          return `The ${elementLabel(element)} already has open thread ${existing.id}: "${existing.messages[0]?.text ?? ""}". Call reply_slide_comment with the reply and signed_as "${author}". Do not start another thread, do not resolve it, and do not call set_speaker_notes.`;
        }
        const added = addSlideComment(ctx.deck(), id, element.id, parsed.text, parsed.author);
        if (!added.threadId) throw new ToolError("Could not add that comment. The speaker notes were not changed.");
        ctx.commit(added.deck);
        ctx.select(id, element.id);
        await wait(300);
        const remainder = parsed.remainder
          ? ` The rest ("${parsed.remainder}") was not stored. Call reply_slide_comment with that text and signed_as "${parsed.author}".`
          : ` Call reply_slide_comment to add a reply under thread ${added.threadId} with signed_as "${parsed.author}".`;
        return `Started comment thread ${added.threadId} on the ${elementLabel(element)} (object ${element.id}) on slide ${index + 1}. ${parsed.author}: "${parsed.text}". Speaker notes were not changed.${remainder} Do not call set_speaker_notes and do not resolve the thread.`;
      },
    }),
    tool({
      name: "reply_slide_comment",
      label: "Reply to comment",
      description:
        'Add a reply under the open comment thread on an object. It stays in that same thread and is not resolved. Speaker notes are not changed. Do not call set_speaker_notes. signed_as is the author of the thread, not a name that appears in the reply. Example: text "Priya has them.", signed_as "Maria". Call add_slide_comment first.',
      parameters: Type.Object({
        text: Type.Optional(Type.String({ description: 'The reply. Example: "Priya has them."' })),
        signed_as: Type.Optional(Type.String({ description: 'Same author who started the thread. Example: "Maria".' })),
        object: Type.Optional(Type.String({ description: 'The object. Use "chart" for the chart image.' })),
        slide: Type.Optional(Type.String({ description: "Slide number or title. Default: the current slide." })),
        thread: Type.Optional(Type.String({ description: "Thread id from add_slide_comment. Default: the open thread on that object." })),
      }),
      prepare: (args) => commentPrepare(args, true),
      target: ({ slide, object }) => {
        try {
          const found = findSlide(ctx.deck(), asWhich(slide), ctx.activeSlideId);
          const element = findCommentElement(
            ctx.deck().slides[found.id],
            object,
            found.id === ctx.activeSlideId ? ctx.selectedElementId : null,
          );
          return document.querySelector(`.slide-canvas [data-element-id="${CSS.escape(element.id)}"]`) ?? canvas();
        } catch {
          return canvas();
        }
      },
      async execute({ text, signed_as, object, slide, thread }) {
        const { id, index } = findSlide(ctx.deck(), asWhich(slide), ctx.activeSlideId);
        const element = findCommentElement(ctx.deck().slides[id], object, id === ctx.activeSlideId ? ctx.selectedElementId : null);
        const open = (ctx.deck().slides[id].comments ?? []).filter((item) => !item.resolved && item.elementId === element.id);
        const chosen = (thread ? open.find((item) => item.id === thread) : undefined) ?? open[0];
        if (!chosen)
          throw new ToolError(
            `No open comment on the ${elementLabel(element)}. Call add_slide_comment first. Speaker notes were not changed.`,
          );
        const parsed = commentBody(text ?? "", signed_as);
        const author = replyAuthor(parsed.author, parsed.text, chosen.messages[0]?.authorName ?? "");
        if (!parsed.text) throw new ToolError("Pass text with the reply. Speaker notes were not changed.");
        if (!author)
          throw new ToolError('Pass signed_as with the thread author, for example "Maria". Speaker notes were not changed.');
        const next = replyToSlideComment(ctx.deck(), id, chosen.id, parsed.text, author);
        if (next === ctx.deck())
          throw new ToolError("That reply was not added. The thread stays open and the speaker notes were not changed.");
        ctx.commit(next);
        ctx.select(id, element.id);
        await wait(300);
        const saved = ctx.deck().slides[id].comments?.find((item) => item.id === chosen.id);
        const lines = saved?.messages.map((message) => `${message.authorName}: "${message.text}"`).join("; ") ?? "";
        return `Added a reply under thread ${chosen.id} on the ${elementLabel(element)}, slide ${index + 1}. The thread is still open. ${lines}. Speaker notes were not changed. Do not call set_speaker_notes and do not resolve the thread.`;
      },
    }),
    tool({
      name: "set_speaker_notes",
      label: "Speaker notes",
      description:
        "Write the speaker notes for a slide (what to say; only the presenter sees them). A comment on a chart or another object is not a speaker note: use add_slide_comment and reply_slide_comment, which leave the notes unchanged.",
      parameters: Type.Object({ slide: Type.Optional(Type.Number()), notes: Type.String() }),
      target: () => document.querySelector(".notes-textarea"),
      async execute({ slide, notes }) {
        const { id, index } = findSlide(ctx.deck(), slide, ctx.activeSlideId);
        ctx.select(id, null);
        await wait(250);
        let typed = "";
        for (const word of notes.match(/\S+\s*|\s+/g) ?? [notes]) {
          typed += word;
          update(id, (s) => ({ ...s, notes: typed }));
          await wait(20);
        }
        return `Wrote speaker notes for slide ${index + 1}.`;
      },
    }),
  ];
}
