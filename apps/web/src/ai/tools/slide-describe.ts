import type { Slide, SlideElement, SlideFile } from "@suiteleaf/core";
import { elementLabel } from "../../editors/slide-comments";
import { FADE_ON_CLICK } from "../../editors/slide-fade-in";

export type Deck = SlideFile["content"];

export const textOf = (el: SlideElement) => (el.type === "text" ? (el.content ?? "") : "");
export const titleOf = (slide: Slide) => textOf(slide.elements.find((e) => e.type === "text") ?? slide.elements[0] ?? ({} as SlideElement)) || "(untitled)";

/** What each text box of a layout is called, matching the text tools' arguments. */
const BOX_NAMES: Record<string, string[]> = {
  title: ["title", "subtitle"],
  "title-body": ["title", "body"],
  "two-column": ["title", "left column (column1)", "right column (column2)"],
  section: ["title"],
};
/** The text arguments each layout has a box for. */
export const LAYOUT_FIELDS: Record<string, string> = {
  title: "title and subtitle",
  "title-body": "title and body",
  "two-column": "title, column1 (left column) and column2 (right column)",
  section: "only a title",
  blank: "no text boxes",
};
export const boxName = (slide: Slide, i: number) => BOX_NAMES[slide.layout ?? ""]?.[i] ?? (i === 0 ? "title" : `box ${i + 1}`);

/** Where an object sits on the 960×540 slide, in the words positions use. */
export function whereOn(el: SlideElement) {
  const cx = el.x + el.width / 2,
    cy = el.y + el.height / 2;
  const v = cy < 180 ? "top" : cy > 360 ? "bottom" : "",
    h = cx < 320 ? "left" : cx > 640 ? "right" : "";
  return v && h ? `${v}-${h}` : v || h || "center";
}

function styleNote(el: SlideElement) {
  const bits = [
    el.italic ? "italic" : "",
    el.fontFamily && el.fontFamily !== "Arial" ? el.fontFamily : "",
    el.themeOverride ? "overrides theme" : "",
  ].filter(Boolean);
  const words = (el.runs ?? [])
    .map((run) => {
      const mark = [run.bold ? "bold" : "", run.italic ? "italic" : "", run.color ? run.color : ""].filter(Boolean);
      const label = run.text.trim();
      return mark.length && label ? `"${label}" ${mark.join(" ")}` : "";
    })
    .filter(Boolean);
  if (words.length) {
    bits.push(`words ${words.join(", ")}`);
    if (!el.themeOverride) bits.push("does not override the theme");
  }
  return bits.length ? ` [${bits.join(", ")}]` : "";
}

function commentSummary(slide: Slide) {
  const threads = slide.comments ?? [];
  if (!threads.length) return "";
  const bits = threads.map((thread) => {
    const el = slide.elements.find((item) => item.id === thread.elementId);
    const lines = thread.messages.map((message) => `${message.authorName}: "${message.text}"`).join("; ");
    return `${thread.resolved ? "resolved" : "open"} thread ${thread.id} on ${elementLabel(el)} (${lines})`;
  });
  return `; comments: ${bits.join(" | ")}`;
}

function animationNote(el: SlideElement) {
  return el.animation === FADE_ON_CLICK ? " [fades in on the next click]" : "";
}

export function describeSlide(slide: Slide, index: number) {
  const texts = slide.elements.filter((e) => e.type === "text");
  const parts = texts.map((e, i) => `${boxName(slide, i)}: ${textOf(e).replace(/\n/g, " / ") || "(empty)"}${styleNote(e)}${animationNote(e)}`);
  const others = slide.elements
    .filter((e) => e.type !== "text")
    .map((e) =>
      e.type === "shape"
        ? `${e.shapeType} shape (${e.fill ?? "no fill"}, ${e.width}×${e.height}, ${whereOn(e)})${animationNote(e)}`
        : e.type === "image"
          ? `image${e.alt ? ` "${e.alt}"` : ""} id ${e.id}${animationNote(e)}`
          : e.type === "audio" || e.type === "video"
            ? `${e.type}${e.alt ? ` "${e.alt}"` : ""} id ${e.id}${animationNote(e)}`
            : `${e.type}${animationNote(e)}`,
    );
  const transition = slide.transition ? `; transition ${slide.transition.type}` : "";
  return `Slide ${index + 1} [${slide.layout ?? "custom"}${slide.background?.color ? `, background ${slide.background.color}` : ""}] ${parts.join("; ")}${others.length ? `; also ${others.join(", ")}` : ""}${slide.notes ? `; notes: ${slide.notes.slice(0, 120)}` : ""}${commentSummary(slide)}${transition}`;
}

export function themeLine(deck: Deck) {
  const theme = deck.theme;
  return theme
    ? ` Theme ${theme.name} (background ${theme.background}, headings ${theme.headingFont}, body ${theme.bodyFont}, accent ${theme.accent}).`
    : "";
}

export const orderText = (deck: Deck) => deck.slideOrder.map((id, i) => `${i + 1}. ${titleOf(deck.slides[id])}`).join("; ");
