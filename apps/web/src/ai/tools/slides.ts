import { Type } from "@earendil-works/pi-ai";
import type { Slide, SlideElement, SlideFile } from "@suiteleaf/core";
import {
  applyBackground,
  applyLayout,
  backgroundColors,
  fillColors,
  newSlide,
  reorder,
  type Layout,
} from "../../editors/slide-layouts";
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
const titleOf = (slide: Slide) => textOf(slide.elements.find((e) => e.type === "text") ?? slide.elements[0] ?? ({} as SlideElement)) || "(untitled)";

/** What each text box of a layout is called, matching the text tools' arguments. */
const BOX_NAMES: Record<string, string[]> = {
  title: ["title", "subtitle"],
  "title-body": ["title", "body"],
  "two-column": ["title", "left column (column1)", "right column (column2)"],
  section: ["title"],
};
/** The text arguments each layout has a box for. */
const LAYOUT_FIELDS: Record<string, string> = {
  title: "title and subtitle",
  "title-body": "title and body",
  "two-column": "title, column1 (left column) and column2 (right column)",
  section: "only a title",
  blank: "no text boxes",
};
const boxName = (slide: Slide, i: number) => BOX_NAMES[slide.layout ?? ""]?.[i] ?? (i === 0 ? "title" : `box ${i + 1}`);

/** Where an object sits on the 960×540 slide, in the words positions use. */
function whereOn(el: SlideElement) {
  const cx = el.x + el.width / 2,
    cy = el.y + el.height / 2;
  const v = cy < 180 ? "top" : cy > 360 ? "bottom" : "",
    h = cx < 320 ? "left" : cx > 640 ? "right" : "";
  return v && h ? `${v}-${h}` : v || h || "center";
}

function describeSlide(slide: Slide, index: number) {
  const texts = slide.elements.filter((e) => e.type === "text");
  const parts = texts.map((e, i) => `${boxName(slide, i)}: ${textOf(e).replace(/\n/g, " / ") || "(empty)"}`);
  const others = slide.elements
    .filter((e) => e.type !== "text")
    .map((e) => (e.type === "shape" ? `${e.shapeType} shape (${e.fill ?? "no fill"}, ${e.width}×${e.height}, ${whereOn(e)})` : e.type));
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

/** A slide show button, after bringing the hidden controls back the way moving the mouse does. */
async function showButton(label: string) {
  window.dispatchEvent(new Event("mousemove"));
  await wait(150);
  return [...document.querySelectorAll(".presenter-overlay button")].find((b) => b.textContent?.includes(label));
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

/** A #rrggbb color, or a color named in one of the editor's menus ("sage green", "yellow"). */
function pickColor(value: string, palette: { label: string; val: string }[], menu: string) {
  const v = value.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) {
    const named = palette.find((c) => c.val === v.toLowerCase());
    return { color: v, name: named ? `${named.label.toLowerCase()} (${v})` : v };
  }
  const words = v.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean);
  const label = (c: { label: string }) => c.label.toLowerCase().split(" ");
  const hit =
    palette.find((c) => label(c).join(" ") === words.join(" ")) ??
    palette.find((c) => label(c).every((w) => words.includes(w))) ??
    palette.find((c) => words.length > 0 && words.every((w) => label(c).includes(w)));
  if (!hit)
    throw new ToolError(`"${value}" is not a color here. Use a #rrggbb code or a ${menu} menu color: ${palette.map((c) => c.label).join(", ")}.`);
  return { color: hit.val, name: hit.val.startsWith("#") ? `${hit.label.toLowerCase()} (${hit.val})` : hit.label.toLowerCase() };
}

export function slideTools(ctx: SlidesAgentContext): SuiteTool[] {
  const update = (id: string, change: (s: Slide) => Slide) => {
    const deck = ctx.deck();
    const next = { ...deck, slides: { ...deck.slides, [id]: change(deck.slides[id]) } };
    ctx.commit(next);
    return next;
  };
  /** A slide-level toolbar button (shown when nothing on the slide is selected), after showing that slide. */
  const slideButton = async (slide: number | undefined, label: string) => {
    try {
      ctx.select(findSlide(ctx.deck(), slide, ctx.activeSlideId).id, null);
    } catch {
      // The tool reports the bad slide number.
    }
    await wait(120);
    return [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
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
    tool({
      name: "add_shape",
      label: "Add shape",
      description:
        `Add a shape (rectangle, rounded rectangle, circle/ellipse) to a slide. position: top-left, top, top-right, left, center, right, bottom-left, bottom, bottom-right. Optional fill: a color name such as yellow, blue, red or light green, or #rrggbb. Optional size in pixels (the slide is 960×540); a circle is always round.`,
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
        const paint = pickColor(fill ?? "#e2e8f0", fillColors, "Fill");
        ctx.select(id, null);
        const round = shape === "circle" || shape === "ellipse";
        const w = Math.round(width ?? (shape === "circle" ? height : undefined) ?? (round ? 160 : 220)),
          h = shape === "circle" ? w : Math.round(height ?? (round ? 160 : 140));
        const { x, y } = place(position, w, h, ctx.deck());
        const el: SlideElement = {
          id: crypto.randomUUID(),
          type: "shape",
          x,
          y,
          width: w,
          height: h,
          shapeType: round ? "ellipse" : shape === "rectangle" ? "rect" : "roundRect",
          fill: paint.color,
          stroke: "#94a3b8",
          strokeWidth: 2,
        };
        const deck = update(id, (s) => ({ ...s, elements: [...s.elements, el] }));
        ctx.select(id, el.id);
        return `Added a ${paint.name} ${shape}, ${w}×${h}, at the ${whereOn(el)} of slide ${index + 1} "${titleOf(deck.slides[id])}".${paint.color === "transparent" ? " It has no fill, so only its outline shows." : ""}`;
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
      description: `Set the background color of one slide (the current one, or \`slide\`), or of every slide with all_slides=true (section headers keep theirs). color: a name such as sage green, warm sand or deep navy, or #rrggbb.`,
      parameters: Type.Object({ color: Type.String(), slide: Type.Optional(Type.Number()), all_slides: Type.Optional(Type.Boolean()) }),
      target: ({ slide, all_slides }) => slideButton(all_slides ? undefined : slide, "Background"),
      execute({ color, slide, all_slides }) {
        const deck = ctx.deck();
        const paint = pickColor(color, backgroundColors, "Background");
        if (all_slides) {
          ctx.commit({ ...deck, slides: applyBackground(deck.slides, paint.color, true) });
          return `Every slide now has a ${paint.name} background.`;
        }
        const { id, index } = findSlide(deck, slide, ctx.activeSlideId);
        update(id, (s) => applyBackground({ [id]: s }, paint.color)[id]);
        ctx.select(id, null);
        return `Slide ${index + 1} "${titleOf(deck.slides[id])}" now has a ${paint.name} background; the other slides keep theirs.`;
      },
    }),
    tool({
      name: "move_slide",
      label: "Reorder slides",
      description: "Move a slide: to a position (`to`, 1 = first), or `before` / `after` another slide (its title or number).",
      parameters: Type.Object({
        slide: Type.Number({ description: "Number of the slide to move." }),
        to: Type.Optional(Type.Number()),
        before: Type.Optional(Type.String()),
        after: Type.Optional(Type.String()),
      }),
      target: ({ slide }) => thumbnail(slide - 1),
      async execute({ slide, to, before, after }) {
        const deck = ctx.deck();
        const { id, index } = findSlide(deck, slide, ctx.activeSlideId);
        let dest: number;
        if (before !== undefined || after !== undefined) {
          const other = findSlide(deck, (before ?? after)!, ctx.activeSlideId);
          if (other.id === id) throw new ToolError(`Slide ${slide} cannot move ${before !== undefined ? "before" : "after"} itself.`);
          dest = deck.slideOrder.filter((x) => x !== id).indexOf(other.id) + (before !== undefined ? 0 : 1);
        } else if (to !== undefined) dest = Math.max(0, Math.min(deck.slideOrder.length - 1, to - 1));
        else throw new ToolError("Say where the slide goes: `to` a position, or `before` or `after` another slide.");
        const order = reorder(deck.slideOrder, index, dest);
        const name = titleOf(deck.slides[id]);
        const prev = dest > 0 ? `after "${titleOf(deck.slides[order[dest - 1]])}"` : "",
          next = dest < order.length - 1 ? `before "${titleOf(deck.slides[order[dest + 1]])}"` : "";
        const neighbours = prev && next ? `${prev} and ${next}` : prev ? `last, ${prev}` : `first, ${next}`;
        const listing = order.map((x, i) => `${i + 1}. ${titleOf(deck.slides[x])}`).join("; ");
        if (dest === index) return `"${name}" is already slide ${index + 1} (${neighbours}); nothing changed. Order: ${listing}`;
        ctx.commit({ ...deck, slideOrder: order });
        ctx.select(id, null);
        await wait(300);
        return `Moved "${name}" from slide ${index + 1} to slide ${dest + 1}: it now comes ${neighbours}. Order: ${listing}`;
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
        const deck = ctx.deck();
        ctx.present(index, !!with_notes);
        await wait(600);
        const screen = document.fullscreenElement
          ? "in full screen"
          : "in the window (the browser allows full screen only right after the user clicks or presses a key; they can click Full screen in the show's controls)";
        return `Presenting ${screen} from slide ${index + 1} of ${deck.slideOrder.length}, "${titleOf(deck.slides[deck.slideOrder[index]])}"${with_notes ? ", with the speaker notes beside it" : ""}. Use next_slide to advance and end_presentation to stop.`;
      },
    }),
    tool({
      name: "next_slide",
      label: "Next slide",
      description: "During the slideshow, go forward (or back with back=true) one slide.",
      parameters: Type.Object({ back: Type.Optional(Type.Boolean()) }),
      repeatable: true,
      target: ({ back }) => showButton(back ? "Previous" : "Next"),
      execute({ back }) {
        if (!ctx.presenting) throw new ToolError("The slideshow is not running. Use start_presentation first.");
        const deck = ctx.deck();
        const last = deck.slideOrder.length - 1;
        const next = Math.max(0, Math.min(last, ctx.showIndex + (back ? -1 : 1)));
        const name = (i: number) => `slide ${i + 1} of ${last + 1}, "${titleOf(deck.slides[deck.slideOrder[i]])}"`;
        if (next === ctx.showIndex)
          throw new ToolError(
            `The show is already on the ${back ? "first" : "last"} slide (${name(next)}); there is no ${back ? "previous" : "next"} one. end_presentation stops the show.`,
          );
        ctx.goToShowSlide(next);
        return `Showing ${name(next)}.${next === last ? " This is the last slide." : ""}`;
      },
    }),
    tool({
      name: "end_presentation",
      label: "End show",
      description: "Stop the slideshow and go back to editing.",
      parameters: Type.Object({}),
      target: () => showButton("Exit"),
      execute() {
        if (!ctx.presenting) return "The slideshow was not running; the editor is showing.";
        ctx.endShow();
        return "Stopped the slideshow; the editor is showing again.";
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
