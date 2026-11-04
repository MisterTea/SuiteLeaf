import { Type } from "@earendil-works/pi-ai";
import type { Slide } from "@suiteleaf/core";
import { applyLayout, newSlide, type Layout } from "../../editors/slide-layouts";
import { ToolError, tool, type SuiteTool } from "../host";
import { deckToMarp } from "../../editors/slide-marp";
import { deckFromMarkdown } from "../../editors/slide-marp-sync";
import type { SlidesAgentContext } from "./slides";
import { LAYOUT_FIELDS, boxName, describeSlide, themeLine } from "./slide-describe";
import { wait, findSlide, canvas, slideUpdater, slideButtonOf } from "./slide-targets";
import { refuseSlideSpellingRetype } from "./slide-spelling";

const LAYOUTS: Record<string, Layout> = {
  title: "title",
  "title slide": "title",
  "title-body": "title-body",
  "title and body": "title-body",
  "two-column": "two-column",
  "two columns": "two-column",
  section: "section",
  "section header": "section",
  blank: "blank",
};
const layoutParam = Type.String({ enum: ["title", "title-body", "two-column", "section", "blank"] });

/** Typed bullets ("- ", "* ") become "• "; in a bulleted box every line gets one, as a person types them. */
function bulleted(text: string, bullets: boolean) {
  return text
    .split("\n")
    .map((line) => {
      const marked = /^\s*[-*•▪◦]\s+(.*)$/.exec(line);
      if (marked) return `• ${marked[1]}`;
      return bullets && line.trim() ? `• ${line.trim()}` : line;
    })
    .join("\n");
}

/** Fill a slide's text boxes in order: title, then body (or subtitle, columns). */
function fillText(slide: Slide, texts: (string | undefined)[]): Slide {
  const boxes = slide.elements.filter((e) => e.type === "text");
  const elements = slide.elements.map((e) => {
    const i = boxes.indexOf(e);
    return i >= 0 && texts[i] !== undefined ? { ...e, content: i === 0 ? texts[i] : bulleted(texts[i]!, !!e.bullet) } : e;
  });
  return { ...slide, elements };
}

interface SlideText {
  title?: string;
  body?: string;
  subtitle?: string;
  column1?: string;
  column2?: string;
}

/** Put text into a slide's boxes, and say what had no box and which boxes are still empty. */
function fillSlide(slide: Slide, { title, body: text, subtitle, column1, column2 }: SlideText) {
  const body = text ?? column1;
  const title1 = slide.layout === "title";
  const next = fillText(slide, [title, title1 ? (subtitle ?? body) : body, column2]);
  const count = next.elements.filter((e) => e.type === "text").length;
  const unused = [
    subtitle !== undefined && !title1 && "subtitle",
    body !== undefined && (count < 2 || (title1 && subtitle !== undefined)) && "body",
    column2 !== undefined && count < 3 && "column2",
    title !== undefined && count < 1 && "title",
  ].filter(Boolean);
  const empty = next.elements
    .filter((e) => e.type === "text")
    .map((e, i) => (e.placeholder !== undefined && !e.content?.trim() ? boxName(next, i) : ""))
    .filter(Boolean);
  const notes = [
    unused.length
      ? `Not used: ${unused.join(", ")}, because a ${next.layout ?? "custom"} slide has ${LAYOUT_FIELDS[next.layout ?? ""] ?? "other boxes"}.`
      : "",
    empty.length ? `Still empty: ${empty.join(", ")}.` : "",
  ];
  return { slide: next, notes: notes.filter(Boolean).join(" ") };
}

export function slideContentTools(ctx: SlidesAgentContext): SuiteTool[] {
  const update = slideUpdater(ctx);
  const slideButton = slideButtonOf(ctx);
  return [
    tool({
      name: "read_presentation",
      label: "Read slides",
      description: "List every slide: its number, layout, text in each box, other objects, background and speaker notes.",
      parameters: Type.Object({}),
      target: () => document.querySelector('[aria-label="Slide thumbnails"]'),
      execute() {
        const deck = ctx.deck();
        return `"${ctx.title}", ${deck.slideOrder.length} slide(s)${themeLine(deck)}:\n${deck.slideOrder.map((id, i) => describeSlide(deck.slides[id], i)).join("\n")}`;
      },
    }),
    tool({
      name: "read_marp",
      label: "Read markdown",
      description:
        "Read a MARP presentation as markdown. A slide is one column, or two columns written as a pair of <div> blocks. Only a presentation created as MARP has this.",
      parameters: Type.Object({}),
      target: () =>
        document.querySelector(".marp-textarea") ??
        document.querySelector('[aria-label="Slide thumbnails"]'),
      execute() {
        const deck = ctx.deck();
        if (!deck.marp) throw new ToolError("This presentation is not a MARP deck. MARP is chosen when the presentation is created, or when a markdown file is imported.");
        return deck.marpSource ?? deckToMarp(deck);
      },
    }),
    tool({
      name: "replace_marp",
      label: "Replace markdown",
      description:
        "Replace a MARP presentation from markdown. Separate slides with ---. One column is a heading and the text under it. Two columns are two <div> blocks. A trailing HTML comment is speaker notes. The theme is a built-in name (paper, meadow, ink, sand) or a theme: block of colors and fonts. A document that cannot be read is left unchanged. This only works on a presentation created as MARP.",
      parameters: Type.Object({
        markdown: Type.String({ description: "The full MARP document." }),
      }),
      target: () => document.querySelector(".marp-textarea") ?? canvas(),
      execute({ markdown }) {
        if (!ctx.deck().marp)
          throw new ToolError("This presentation is not a MARP deck. MARP is chosen when the presentation is created, or when a markdown file is imported.");
        const result = deckFromMarkdown(ctx.deck(), markdown);
        if (result.problem) throw new ToolError(result.problem);
        ctx.commit(result.deck);
        if (!result.deck.slides[ctx.activeSlideId])
          ctx.select(result.deck.slideOrder[0], null);
        const count = result.deck.slideOrder.length;
        const extra = result.warnings.length ? ` ${result.warnings.join(" ")}` : "";
        return `Updated ${count} slide${count === 1 ? "" : "s"} from markdown.${extra}`;
      },
    }),
    tool({
      name: "add_slide",
      label: "New slide",
      description:
        "Add a slide after slide `after` (default: the current slide) with a layout: title (title + subtitle), title-body (title + bulleted body), two-column (title + two lists side by side), section (section header: a dark slide with only a title), blank. Fill its text: title; subtitle on a title slide; body (one bullet per line); on a two-column slide, column1 is the left column and column2 the right column.",
      parameters: Type.Object({
        layout: layoutParam,
        title: Type.Optional(Type.String()),
        body: Type.Optional(Type.String()),
        subtitle: Type.Optional(Type.String()),
        column1: Type.Optional(Type.String({ description: "Left column of a two-column slide." })),
        column2: Type.Optional(Type.String({ description: "Right column of a two-column slide." })),
        after: Type.Optional(Type.Number({ description: "Slide number to add after." })),
      }),
      target: () => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("New slide")),
      async execute({ layout, title, body, subtitle, column1, column2, after }) {
        const deck = ctx.deck();
        const l = LAYOUTS[layout] ?? "title-body";
        const { slide, notes } = fillSlide(newSlide(l), { title, body, subtitle, column1, column2 });
        const at = after !== undefined ? Math.max(0, Math.min(deck.slideOrder.length, after)) : deck.slideOrder.indexOf(ctx.activeSlideId) + 1;
        const order = [...deck.slideOrder];
        order.splice(at, 0, slide.id);
        ctx.commit({ ...deck, slideOrder: order, slides: { ...deck.slides, [slide.id]: slide } });
        ctx.select(slide.id, null);
        await wait(300);
        return `Added ${describeSlide(slide, at)}. ${notes ? `${notes} ` : ""}The presentation has ${order.length} slides.`;
      },
    }),
    tool({
      name: "set_slide_text",
      label: "Edit slide text",
      description:
        "Replace the text on a slide: title, subtitle (title slides), body (one bullet per line), and on a two-column slide column1 for the left column and column2 for the right column. Leave out what should not change.",
      parameters: Type.Object({
        slide: Type.Optional(Type.Number({ description: "Slide number; default the current slide." })),
        title: Type.Optional(Type.String()),
        body: Type.Optional(Type.String()),
        subtitle: Type.Optional(Type.String()),
        column1: Type.Optional(Type.String({ description: "Left column of a two-column slide." })),
        column2: Type.Optional(Type.String({ description: "Right column of a two-column slide." })),
      }),
      target: ({ title, body, subtitle, column1, column2 }) => {
        const boxes = canvas()?.querySelectorAll(".slide-element textarea") ?? [];
        const first = title !== undefined ? 0 : [body ?? subtitle ?? column1, column2].findIndex((t) => t !== undefined) + 1;
        return boxes[first] ?? boxes[0] ?? canvas();
      },
      async execute({ slide, title, body, subtitle, column1, column2 }) {
        refuseSlideSpellingRetype();
        const { id, index } = findSlide(ctx.deck(), slide, ctx.activeSlideId);
        ctx.select(id, null);
        await wait(250);
        let notes = "";
        const deck = update(id, (s) => {
          const boxes = s.elements.filter((e) => e.type === "text");
          const filled = fillSlide(boxes.length ? s : { ...s, layout: "title-body", elements: [...s.elements, ...newSlide("title-body").elements] }, {
            title,
            body,
            subtitle,
            column1,
            column2,
          });
          notes = filled.notes;
          return filled.slide;
        });
        return `Slide ${index + 1} now reads: ${describeSlide(deck.slides[id], index)}${notes ? `\n${notes}` : ""}`;
      },
    }),
    tool({
      name: "set_layout",
      label: "Layout",
      description: "Change a slide's layout; its text moves into the new layout's boxes.",
      parameters: Type.Object({ slide: Type.Optional(Type.Number()), layout: layoutParam }),
      target: ({ slide }) => slideButton(slide, "Layout"),
      async execute({ slide, layout }) {
        const { id, index } = findSlide(ctx.deck(), slide, ctx.activeSlideId);
        ctx.select(id, null);
        await wait(250);
        const deck = update(id, (s) => applyLayout(s, LAYOUTS[layout] ?? "title-body"));
        return `Slide ${index + 1}: ${describeSlide(deck.slides[id], index)}`;
      },
    }),
  ];
}
