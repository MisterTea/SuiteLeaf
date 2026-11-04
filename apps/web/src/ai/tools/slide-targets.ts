import type { Slide } from "@suiteleaf/core";
import { ToolError } from "../host";
import type { SlidesAgentContext } from "./slides";
import { type Deck, textOf } from "./slide-describe";

export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function plainArg(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const text = value.trim().replace(/^["']+|["']+$/g, "").trim();
    if (text) return text;
  }
  return undefined;
}

/** Find a slide by number (1-based) or by words in its title. */
export function findSlide(deck: Deck, which: string | number | undefined, fallback: string) {
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

/** A slide argument may be a number or a title. Numeric strings stay numbers so "6" is slide 6. */
export function asWhich(value: string | number | undefined): string | number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;
  const t = value.trim().replace(/^["']|["']$/g, "");
  if (/^\d+$/.test(t)) return Number(t);
  return t.replace(/^slide\s+/i, "");
}

export function splitSlideList(item: unknown): string[] {
  return String(item)
    .split(/\s*(?:,|&| and )\s*/i)
    .map((part) => part.replace(/^["']|["']$/g, "").trim())
    .filter(Boolean);
}

/** Numbers the model sends for a slide title field become strings before the schema check. */
export function stringArgs(args: Record<string, unknown>) {
  const next = { ...args };
  if (typeof next.slide === "number") next.slide = String(next.slide);
  if (typeof next.before === "number") next.before = String(next.before);
  if (typeof next.after === "number") next.after = String(next.after);
  if (Array.isArray(next.slides)) next.slides = next.slides.flatMap(splitSlideList);
  else if (typeof next.slides === "string" || typeof next.slides === "number") next.slides = splitSlideList(next.slides);
  if (typeof next.bold === "string") next.bold = /^(true|yes)$/i.test(next.bold);
  if (typeof next.italic === "string") next.italic = /^(true|yes|italic)$/i.test(next.italic);
  if (typeof next.align === "string") {
    const align = next.align.toLowerCase();
    next.align = align.includes("center") || align === "middle" ? "center" : align.includes("right") ? "right" : align.includes("left") ? "left" : next.align;
  }
  return next;
}

export function resolveIds(deck: Deck, which: (string | number)[], fallback: string) {
  const ids: string[] = [];
  for (const item of which) {
    const { id } = findSlide(deck, asWhich(item), fallback);
    if (!ids.includes(id)) ids.push(id);
  }
  if (!ids.length) throw new ToolError("Say which slides, by number or title.");
  return ids;
}

export const thumbnail = (index: number) => document.querySelectorAll(".thumbnail-row")[index];
export const canvas = () => document.querySelector(".slide-canvas");

/** A #rrggbb color, or a color named in one of the editor's menus ("sage green", "yellow"). */
export function pickColor(value: string, palette: { label: string; val: string }[], menu: string) {
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

/** Replace one slide with `change` of it and commit the deck. */
export function slideUpdater(ctx: SlidesAgentContext) {
  return (id: string, change: (s: Slide) => Slide) => {
    const deck = ctx.deck();
    const next = { ...deck, slides: { ...deck.slides, [id]: change(deck.slides[id]) } };
    ctx.commit(next);
    return next;
  };
}

/** A slide-level toolbar button (shown when nothing on the slide is selected), after showing that slide. */
export function slideButtonOf(ctx: SlidesAgentContext) {
  return async (slide: number | undefined, label: string) => {
    try {
      ctx.select(findSlide(ctx.deck(), slide, ctx.activeSlideId).id, null);
    } catch {
      // The tool reports the bad slide number.
    }
    await wait(120);
    return [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
  };
}
