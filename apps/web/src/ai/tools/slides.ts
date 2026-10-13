import { Type } from "@earendil-works/pi-ai";
import type { Slide, SlideElement, SlideFile } from "@suiteleaf/core";
import { applyBackground, applyLayout, newSlide, reorder, type Layout } from "../../editors/slide-layouts";
import { ToolError, tool, type SuiteTool } from "../host";
import { requestFile } from "../file-request";

type Deck = SlideFile["content"];

/** What the Slides editor lends the agent. */
export interface SlidesAgentContext {
  title: string;
  deck: () => Deck;
  commit: (deck: Deck) => void;
  activeSlideId: string;
  select: (slideId: string, elementId?: string | null) => void;
  presenting: boolean;
  present: (fromIndex: number, withNotes: boolean) => void;
  goToShowSlide: (index: number) => void;
  showIndex: number;
  endShow: () => void;
  readImage: (file: File) => Promise<string>;
  exportAs: (format: "html" | "txt") => Promise<void>;
}

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
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const textOf = (el: SlideElement) => (el.type === "text" ? (el.content ?? "") : "");

function describeSlide(slide: Slide, index: number) {
  const texts = slide.elements.filter((e) => e.type === "text");
  const parts = texts.map((e, i) => `${i === 0 ? "title" : `box ${i + 1}`}: ${textOf(e).replace(/\n/g, " / ") || "(empty)"}`);
  const others = slide.elements.filter((e) => e.type !== "text").map((e) => (e.type === "shape" ? `${e.shapeType} shape` : e.type));
  return `Slide ${index + 1} [${slide.layout ?? "custom"}${slide.background?.color ? `, background ${slide.background.color}` : ""}] ${parts.join("; ")}${others.length ? `; also ${others.join(", ")}` : ""}${slide.notes ? `; notes: ${slide.notes.slice(0, 120)}` : ""}`;
}

/** Find a slide by number (1-based) or by words in its title. */
function findSlide(deck: Deck, which: string | number | undefined, fallback: string) {
  if (which === undefined || which === "" || which === "current") {
    const id = deck.slides[fallback] ? fallback : deck.slideOrder[0];
    return { id, index: deck.slideOrder.indexOf(id) };
  }
  const n = Number(which);
  if (Number.isInteger(n)) {
    if (n < 1 || n > deck.slideOrder.length) throw new ToolError(`There are ${deck.slideOrder.length} slides; slide ${n} does not exist.`);
    return { id: deck.slideOrder[n - 1], index: n - 1 };
  }
  const wanted = String(which).toLowerCase();
  const index = deck.slideOrder.findIndex((id) =>
    deck.slides[id].elements.some((e) => textOf(e).toLowerCase().includes(wanted)),
  );
  if (index < 0) throw new ToolError(`No slide mentions "${which}". Use read_presentation to see the slides.`);
  return { id: deck.slideOrder[index], index };
}

const thumbnail = (index: number) => document.querySelectorAll(".thumbnail-row")[index];
const canvas = () => document.querySelector(".slide-canvas");

/** Where a named position puts a box of this size on the 960×540 slide. */
function place(position: string | undefined, w: number, h: number, deck: Deck) {
  const W = deck.width || 960,
    H = deck.height || 540,
    m = 40;
  const x = { left: m, center: (W - w) / 2, right: W - w - m };
  const y = { top: m, middle: (H - h) / 2, bottom: H - h - m };
  const [v, hz] = (() => {
    const p = (position ?? "center").toLowerCase();
    if (p === "center" || p === "middle") return ["middle", "center"];
    const vert = p.includes("top") ? "top" : p.includes("bottom") ? "bottom" : "middle";
    const horiz = p.includes("left") ? "left" : p.includes("right") ? "right" : "center";
    return [vert, horiz];
  })();
  return { x: Math.round(x[hz as keyof typeof x]), y: Math.round(y[v as keyof typeof y]) };
}

/** Fill a slide's text boxes in order: title, then body (or subtitle, columns). */
function fillText(slide: Slide, texts: (string | undefined)[]): Slide {
  const boxes = slide.elements.filter((e) => e.type === "text");
  const elements = slide.elements.map((e) => {
    const i = boxes.indexOf(e);
    return i >= 0 && texts[i] !== undefined ? { ...e, content: texts[i] } : e;
  });
  return { ...slide, elements };
}

export function slideTools(ctx: SlidesAgentContext): SuiteTool[] {
  const update = (id: string, change: (s: Slide) => Slide) => {
    const deck = ctx.deck();
    const next = { ...deck, slides: { ...deck.slides, [id]: change(deck.slides[id]) } };
    ctx.commit(next);
    return next;
  };
  return [
    tool({
      name: "read_presentation",
      label: "Read slides",
      description: "List every slide: its number, layout, text in each box, other objects, background and speaker notes.",
      parameters: Type.Object({}),
      target: () => document.querySelector('[aria-label="Slide thumbnails"]'),
      execute() {
        const deck = ctx.deck();
        return `"${ctx.title}", ${deck.slideOrder.length} slide(s):\n${deck.slideOrder.map((id, i) => describeSlide(deck.slides[id], i)).join("\n")}`;
      },
    }),
    tool({
      name: "add_slide",
      label: "New slide",
      description:
        "Add a slide after slide `after` (default: the current slide) with a layout: title (title + subtitle), title-body (title + bulleted text), two-column, section (section header), blank. Fill its text: title, then body (use new lines for separate bullets), or subtitle for a title slide, and column2 for the second column.",
      parameters: Type.Object({
        layout: layoutParam,
        title: Type.Optional(Type.String()),
        body: Type.Optional(Type.String()),
        subtitle: Type.Optional(Type.String()),
        column2: Type.Optional(Type.String()),
        after: Type.Optional(Type.Number({ description: "Slide number to add after." })),
      }),
      target: () => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("New slide")),
      async execute({ layout, title, body, subtitle, column2, after }) {
        const deck = ctx.deck();
        const l = LAYOUTS[layout] ?? "title-body";
        const slide = fillText(newSlide(l), [title, l === "title" ? subtitle ?? body : body, column2]);
        const at = after !== undefined ? Math.max(0, Math.min(deck.slideOrder.length, after)) : deck.slideOrder.indexOf(ctx.activeSlideId) + 1;
        const order = [...deck.slideOrder];
        order.splice(at, 0, slide.id);
        ctx.commit({ ...deck, slideOrder: order, slides: { ...deck.slides, [slide.id]: slide } });
        ctx.select(slide.id, null);
        await wait(300);
        return `Added slide ${at + 1} (${l}). The presentation has ${order.length} slides.`;
      },
    }),
    tool({
      name: "set_slide_text",
      label: "Edit slide text",
      description:
        "Replace the text on a slide: title, body (new lines make separate bullets), subtitle (title slides), column2 (second column). Leave out what should not change.",
      parameters: Type.Object({
        slide: Type.Optional(Type.Number({ description: "Slide number; default the current slide." })),
        title: Type.Optional(Type.String()),
        body: Type.Optional(Type.String()),
        subtitle: Type.Optional(Type.String()),
        column2: Type.Optional(Type.String()),
      }),
      target: () => canvas()?.querySelector(".slide-element textarea") ?? canvas(),
      async execute({ slide, title, body, subtitle, column2 }) {
        const { id, index } = findSlide(ctx.deck(), slide, ctx.activeSlideId);
        ctx.select(id, null);
        await wait(250);
        const layout = ctx.deck().slides[id].layout;
        const second = layout === "title" ? (subtitle ?? body) : body;
        const deck = update(id, (s) => {
          const boxes = s.elements.filter((e) => e.type === "text");
          if (!boxes.length) {
            const box = newSlide("title-body").elements;
            return fillText({ ...s, elements: [...s.elements, ...box] }, [title, second, column2]);
          }
          return fillText(s, [title, second, column2]);
        });
        return `Slide ${index + 1} now reads: ${describeSlide(deck.slides[id], index)}`;
      },
    }),
    tool({
      name: "set_layout",
      label: "Layout",
      description: "Change a slide's layout; its text moves into the new layout's boxes.",
      parameters: Type.Object({ slide: Type.Optional(Type.Number()), layout: layoutParam }),
      target: () => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Layout"),
      async execute({ slide, layout }) {
        const { id, index } = findSlide(ctx.deck(), slide, ctx.activeSlideId);
        ctx.select(id, null);
        await wait(250);
        const deck = update(id, (s) => applyLayout(s, LAYOUTS[layout] ?? "title-body"));
        return `Slide ${index + 1}: ${describeSlide(deck.slides[id], index)}`;
      },
    }),
    tool({
      name: "add_shape",
      label: "Add shape",
      description:
        "Add a shape (rectangle, rounded rectangle, circle/ellipse) to a slide. position: top-left, top, top-right, left, center, right, bottom-left, bottom, bottom-right. Optional fill color (#rrggbb), size in pixels (slide is 960×540) and text inside it.",
      parameters: Type.Object({
        slide: Type.Optional(Type.Number()),
        shape: Type.String({ enum: ["rectangle", "rounded rectangle", "circle", "ellipse"] }),
        position: Type.Optional(Type.String()),
        fill: Type.Optional(Type.String()),
        width: Type.Optional(Type.Number()),
        height: Type.Optional(Type.Number()),
      }),
      target: ({ shape }) =>
        document.querySelector(`[aria-label="${shape === "circle" || shape === "ellipse" ? "Circle" : "Rectangle"}"]`),
      async execute({ slide, shape, position, fill, width, height }) {
        const { id, index } = findSlide(ctx.deck(), slide, ctx.activeSlideId);
        ctx.select(id, null);
        const round = shape === "circle" || shape === "ellipse";
        const w = Math.round(width ?? (round ? 160 : 220)),
          h = Math.round(height ?? (shape === "circle" ? w : round ? 160 : 140));
        const { x, y } = place(position, w, h, ctx.deck());
        const el: SlideElement = {
          id: crypto.randomUUID(),
          type: "shape",
          x,
          y,
          width: w,
          height: h,
          shapeType: round ? "ellipse" : shape === "rectangle" ? "rect" : "roundRect",
          fill: fill ?? "#e2e8f0",
          stroke: "#94a3b8",
          strokeWidth: 2,
        };
        update(id, (s) => ({ ...s, elements: [...s.elements, el] }));
        ctx.select(id, el.id);
        return `Added a ${shape} at the ${position ?? "center"} of slide ${index + 1}.`;
      },
    }),
    tool({
      name: "add_text_box",
      label: "Text box",
      description: "Add a text box with text to a slide at a position (top-left … bottom-right, center).",
      parameters: Type.Object({
        slide: Type.Optional(Type.Number()),
        text: Type.String(),
        position: Type.Optional(Type.String()),
        size: Type.Optional(Type.Number({ description: "Font size in points." })),
      }),
      target: () => document.querySelector('[aria-label="Text box"]') ?? canvas(),
      execute({ slide, text, position, size }) {
        const { id, index } = findSlide(ctx.deck(), slide, ctx.activeSlideId);
        const { x, y } = place(position, 400, 80, ctx.deck());
        const el: SlideElement = {
          id: crypto.randomUUID(),
          type: "text",
          x,
          y,
          width: 400,
          height: 80,
          content: text,
          fontSize: size ?? 22,
          fontFamily: "Arial",
          color: "#1e293b",
          align: "left",
        };
        update(id, (s) => ({ ...s, elements: [...s.elements, el] }));
        ctx.select(id, el.id);
        return `Added a text box to slide ${index + 1}.`;
      },
    }),
    tool({
      name: "insert_image",
      label: "Insert image",
      description: "Ask the user to choose a picture and put it on a slide at a position.",
      parameters: Type.Object({ slide: Type.Optional(Type.Number()), position: Type.Optional(Type.String()) }),
      target: () => document.querySelector('[aria-label="Insert image"]'),
      async execute({ slide, position }) {
        const file = await requestFile("Choose a picture for the slide", "image/png,image/jpeg,image/gif,image/webp");
        if (!file) return "The user did not choose a picture.";
        const { id, index } = findSlide(ctx.deck(), slide, ctx.activeSlideId);
        const src = await ctx.readImage(file);
        const { x, y } = place(position, 360, 240, ctx.deck());
        const el: SlideElement = { id: crypto.randomUUID(), type: "image", x, y, width: 360, height: 240, src, alt: file.name };
        update(id, (s) => ({ ...s, elements: [...s.elements, el] }));
        ctx.select(id, el.id);
        return `Put "${file.name}" on slide ${index + 1}.`;
      },
    }),
    tool({
      name: "insert_table",
      label: "Insert table",
      description: "Put a table on a slide. `cells` is a list of rows, each a list of cell texts; the first row is the header.",
      parameters: Type.Object({ slide: Type.Optional(Type.Number()), cells: Type.Array(Type.Array(Type.String())) }),
      target: () => canvas(),
      execute({ slide, cells }) {
        if (!cells.length) throw new ToolError("Give at least one row.");
        const { id, index } = findSlide(ctx.deck(), slide, ctx.activeSlideId);
        const width = 800,
          height = Math.min(360, 40 * cells.length);
        const { x, y } = place("bottom", width, height, ctx.deck());
        const el: SlideElement = { id: crypto.randomUUID(), type: "table", x, y: Math.max(140, y), width, height, rows: cells };
        update(id, (s) => ({ ...s, elements: [...s.elements, el] }));
        ctx.select(id, el.id);
        return `Added a ${cells.length}-row table to slide ${index + 1}.`;
      },
    }),
    tool({
      name: "set_background",
      label: "Background",
      description: "Set the background color (#rrggbb) of one slide, or of every slide with all_slides=true (section headers keep theirs).",
      parameters: Type.Object({ color: Type.String(), slide: Type.Optional(Type.Number()), all_slides: Type.Optional(Type.Boolean()) }),
      target: () => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Background"),
      execute({ color, slide, all_slides }) {
        const deck = ctx.deck();
        if (all_slides) {
          ctx.commit({ ...deck, slides: applyBackground(deck.slides, color, true) });
          return `Every slide now has a ${color} background.`;
        }
        const { id, index } = findSlide(deck, slide, ctx.activeSlideId);
        update(id, (s) => ({ ...s, background: { ...s.background, color } }));
        return `Slide ${index + 1} now has a ${color} background.`;
      },
    }),
    tool({
      name: "move_slide",
      label: "Reorder slides",
      description: "Move a slide to a new position (1 = first).",
      parameters: Type.Object({ slide: Type.Number(), to: Type.Number() }),
      target: ({ slide }) => thumbnail(slide - 1),
      async execute({ slide, to }) {
        const deck = ctx.deck();
        const { index } = findSlide(deck, slide, ctx.activeSlideId);
        const dest = Math.max(0, Math.min(deck.slideOrder.length - 1, to - 1));
        ctx.commit({ ...deck, slideOrder: reorder(deck.slideOrder, index, dest) });
        await wait(300);
        const after = ctx.deck();
        return `Moved slide ${slide} to position ${dest + 1}. Order: ${after.slideOrder.map((id, i) => `${i + 1}. ${textOf(after.slides[id].elements.find((e) => e.type === "text")!) || "(untitled)"}`).join("; ")}`;
      },
    }),
    tool({
      name: "delete_slide",
      label: "Delete slide",
      description: "Delete a slide.",
      parameters: Type.Object({ slide: Type.Number() }),
      target: ({ slide }) => thumbnail(slide - 1),
      execute({ slide }) {
        const deck = ctx.deck();
        if (deck.slideOrder.length <= 1) throw new ToolError("A presentation needs at least one slide.");
        const { id, index } = findSlide(deck, slide, ctx.activeSlideId);
        const slides = { ...deck.slides };
        delete slides[id];
        const order = deck.slideOrder.filter((x) => x !== id);
        ctx.commit({ ...deck, slideOrder: order, slides });
        ctx.select(order[Math.min(index, order.length - 1)], null);
        return `Deleted slide ${index + 1}; ${order.length} left.`;
      },
    }),
    tool({
      name: "set_speaker_notes",
      label: "Speaker notes",
      description: "Write the speaker notes for a slide (what to say; only the presenter sees them).",
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
    tool({
      name: "go_to_slide",
      label: "Go to slide",
      description: "Show a slide in the editor (or, while presenting, jump the show to it).",
      parameters: Type.Object({ slide: Type.Number() }),
      target: ({ slide }) => (ctx.presenting ? document.querySelector(".presenter-slide-box") : thumbnail(slide - 1)),
      execute({ slide }) {
        const { id, index } = findSlide(ctx.deck(), slide, ctx.activeSlideId);
        if (ctx.presenting) ctx.goToShowSlide(index);
        else ctx.select(id, null);
        return `Showing slide ${index + 1}.`;
      },
    }),
    tool({
      name: "start_presentation",
      label: "Present",
      description: "Start the slideshow from the first slide (or from `from_slide`), optionally with the speaker notes panel.",
      parameters: Type.Object({ from_slide: Type.Optional(Type.Number()), with_notes: Type.Optional(Type.Boolean()) }),
      target: () => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Slideshow"),
      async execute({ from_slide, with_notes }) {
        const index = from_slide ? findSlide(ctx.deck(), from_slide, ctx.activeSlideId).index : 0;
        ctx.present(index, !!with_notes);
        await wait(600);
        return `Presenting from slide ${index + 1}${with_notes ? " with speaker notes" : ""}. Use next_slide to advance and end_presentation to stop.`;
      },
    }),
    tool({
      name: "next_slide",
      label: "Next slide",
      description: "During the slideshow, go forward (or back with back=true) one slide.",
      parameters: Type.Object({ back: Type.Optional(Type.Boolean()) }),
      target: ({ back }) => [...document.querySelectorAll(".presenter-overlay button")].find((b) => b.textContent?.includes(back ? "Previous" : "Next")),
      execute({ back }) {
        if (!ctx.presenting) throw new ToolError("The slideshow is not running. Use start_presentation first.");
        const last = ctx.deck().slideOrder.length - 1;
        const next = Math.max(0, Math.min(last, ctx.showIndex + (back ? -1 : 1)));
        ctx.goToShowSlide(next);
        return `Showing slide ${next + 1} of ${last + 1}.${next === last && !back ? " This is the last slide." : ""}`;
      },
    }),
    tool({
      name: "end_presentation",
      label: "End show",
      description: "Stop the slideshow and go back to editing.",
      parameters: Type.Object({}),
      target: () => [...document.querySelectorAll(".presenter-overlay button")].find((b) => b.textContent?.includes("Exit")),
      execute() {
        ctx.endShow();
        return "Stopped the slideshow.";
      },
    }),
    tool({
      name: "export_presentation",
      label: "Export",
      description: "Export the slides as a web page (html) or plain text (txt). The file downloads.",
      parameters: Type.Object({ format: Type.String({ enum: ["html", "txt"] }) }),
      target: () => document.querySelector(".workspace-header [aria-haspopup]"),
      async execute({ format }) {
        await ctx.exportAs(format as "html");
        return `Exported "${ctx.title}.${format}".`;
      },
    }),
  ];
}

export function slideSnapshot(ctx: SlidesAgentContext) {
  const deck = ctx.deck();
  const current = deck.slideOrder.indexOf(ctx.activeSlideId) + 1;
  return `Open presentation: "${ctx.title}", ${deck.slideOrder.length} slide(s); slide ${current} is selected${ctx.presenting ? `; the slideshow is running on slide ${ctx.showIndex + 1}` : ""}.\n${deck.slideOrder
    .slice(0, 20)
    .map((id, i) => describeSlide(deck.slides[id], i))
    .join("\n")}`;
}
