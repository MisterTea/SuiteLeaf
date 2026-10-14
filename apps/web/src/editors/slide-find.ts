import type { Presentation, SlideElement } from "@suiteleaf/core";
import { hasTextRuns, plainText, replaceRunRange } from "./slide-runs";

/** Element id used for a speaker-notes match. It is not a canvas box. */
export const SPEAKER_NOTES_ID = "speaker-notes";

/** One occurrence of the query, in slide order. Text boxes, then shapes, then notes. */
export type DeckMatch = {
  slideId: string;
  slideIndex: number;
  /** Slide name shown beside the count, such as Welcome. */
  place: string;
  elementId: string;
  /** True when this match is in the speaker notes, not a text box or shape. */
  inNotes: boolean;
  /** True when this match is text inside a shape, not a text box or the notes. */
  inShape: boolean;
  start: number;
};

/** Text a text box actually shows. Speaker notes, shapes, and tables are not boxes. */
export function textBoxText(el: Pick<SlideElement, "type" | "content" | "runs">): string {
  if (el.type !== "text") return "";
  if (hasTextRuns(el)) return plainText(el.runs ?? []);
  return el.content ?? "";
}

/** Text a shape shows. Empty shapes, text boxes, notes, and tables are skipped. */
export function shapeText(el: Pick<SlideElement, "type" | "content" | "runs">): string {
  if (el.type !== "shape") return "";
  if (hasTextRuns(el)) return plainText(el.runs ?? []);
  if (el.runs?.length) {
    const fromRuns = plainText(el.runs);
    if (fromRuns) return fromRuns;
  }
  return el.content ?? "";
}

function slidePlace(
  slide: Presentation["slides"][string] | undefined,
  index: number,
): string {
  const title = slide?.title?.trim();
  if (title) return title;
  const heading = slide?.elements.find((el) => textBoxText(el).trim());
  const line = heading ? textBoxText(heading).trim().split("\n")[0] : "";
  return line || `Slide ${index + 1}`;
}

function pushMatches(
  matches: DeckMatch[],
  text: string,
  needle: string,
  where: Omit<DeckMatch, "start">,
) {
  if (!text) return;
  const hay = text.toLowerCase();
  let from = 0;
  while (from <= hay.length - needle.length) {
    const at = hay.indexOf(needle, from);
    if (at < 0) break;
    matches.push({ ...where, start: at });
    from = at + needle.length;
  }
}

/**
 * Every match in slide order, including skipped slides, shapes, and speaker
 * notes. On one slide, text boxes come first, then shapes, then that slide's
 * notes. Tables are skipped. The deck is left unchanged. Matching is
 * case-insensitive.
 */
export function findDeckMatches(deck: Presentation, query: string): DeckMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const matches: DeckMatch[] = [];
  deck.slideOrder.forEach((slideId, slideIndex) => {
    const slide = deck.slides[slideId];
    if (!slide) return;
    const place = slidePlace(slide, slideIndex);
    for (const el of slide.elements) {
      if (el.type !== "text") continue;
      pushMatches(matches, textBoxText(el), needle, {
        slideId,
        slideIndex,
        place,
        elementId: el.id,
        inNotes: false,
        inShape: false,
      });
    }
    for (const el of slide.elements) {
      if (el.type !== "shape") continue;
      pushMatches(matches, shapeText(el), needle, {
        slideId,
        slideIndex,
        place,
        elementId: el.id,
        inNotes: false,
        inShape: true,
      });
    }
    pushMatches(matches, slide.notes ?? "", needle, {
      slideId,
      slideIndex,
      place,
      elementId: SPEAKER_NOTES_ID,
      inNotes: true,
      inShape: false,
    });
  });
  return matches;
}

/** The match after `current`, wrapping to the first after the last. */
export function nextMatchIndex(current: number, count: number): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return 0;
  return (current + 1) % count;
}

/** "1 of 2 on Welcome", "1 of 1 in the shape on Welcome", or "No matches". */
export function findStatus(
  query: string,
  matches: readonly { place: string; inNotes?: boolean; inShape?: boolean }[],
  index: number,
): string {
  if (!query.trim()) return "";
  if (!matches.length) return "No matches";
  const at = index >= 0 && index < matches.length ? index : 0;
  const match = matches[at];
  const place = match.inNotes
    ? `in the notes on ${match.place}`
    : match.inShape
      ? `in the shape on ${match.place}`
      : `on ${match.place}`;
  return `${at + 1} of ${matches.length} ${place}`;
}

/**
 * Find status for the bar. A notes match says it is in the notes. A shape
 * match says it is in the shape and names the slide. Canvas matches keep the
 * plain "on the slide" wording.
 */
export function findBarStatus(
  query: string,
  matches: readonly { place: string; inNotes?: boolean; inShape?: boolean }[],
  index: number,
): string {
  return findStatus(query, matches, index);
}

/** "Replace all 2". Zero matches are not offered a button. */
export function replaceAllLabel(count: number): string {
  return `Replace all ${count}`;
}

/** "2 replaced" after Replace all. */
export function replacedStatus(count: number): string {
  return `${count} replaced`;
}

/**
 * Status after Replace changes one speaker note. The bar says the change is
 * in the notes, then names the remaining match when one is still there.
 */
export function noteReplacedStatus(
  query: string,
  matches: readonly { place: string; inNotes?: boolean; inShape?: boolean }[],
  index: number,
): string {
  if (!matches.length) return "Replaced in the notes";
  return `Replaced in the notes. ${findStatus(query, matches, index)}`;
}

function needleOf(query: string): string {
  return query.trim().toLowerCase();
}

/**
 * Index of the match that should be current after replacing `before[index]`.
 * The following match stays put. Replacing the last match wraps to the first
 * one that is still there.
 */
export function indexAfterReplace(
  before: readonly DeckMatch[],
  index: number,
  after: readonly DeckMatch[],
  query: string,
  replacement: string,
): number {
  if (!after.length) return 0;
  const current = before[index];
  if (!current) return 0;
  const following = before[index + 1] ?? before.find((_, at) => at !== index);
  if (!following) return 0;
  const delta = replacement.length - needleOf(query).length;
  const start =
    following.slideId === current.slideId &&
    following.elementId === current.elementId &&
    following.start > current.start
      ? following.start + delta
      : following.start;
  const at = after.findIndex(
    (match) =>
      match.slideId === following.slideId &&
      match.elementId === following.elementId &&
      match.start === start,
  );
  return at >= 0 ? at : 0;
}

function visibleText(el: SlideElement): string {
  if (el.type === "shape") return shapeText(el);
  return textBoxText(el);
}

function replaceInElement(
  el: SlideElement,
  from: number,
  to: number,
  needle: string,
  replacement: string,
): SlideElement {
  const visible = visibleText(el);
  if (visible.slice(from, to).toLowerCase() !== needle) return el;
  const fromRuns = el.runs?.length ? plainText(el.runs) : "";
  if (el.runs?.length && (hasTextRuns(el) || fromRuns === visible)) {
    const runs = replaceRunRange(el.runs, from, to, replacement);
    return { ...el, runs, content: plainText(runs) };
  }
  const content = el.content ?? "";
  return {
    ...el,
    content: content.slice(0, from) + replacement + content.slice(to),
  };
}

function replaceInNotes(
  notes: string,
  from: number,
  to: number,
  needle: string,
  replacement: string,
): string {
  if (notes.slice(from, to).toLowerCase() !== needle) return notes;
  return notes.slice(0, from) + replacement + notes.slice(to);
}

function applyMatchReplacements(
  deck: Presentation,
  matches: readonly DeckMatch[],
  needle: string,
  replacement: string,
): Presentation {
  const groups = new Map<string, DeckMatch[]>();
  const noteGroups = new Map<string, DeckMatch[]>();
  for (const match of matches) {
    if (match.inNotes) {
      const list = noteGroups.get(match.slideId);
      if (list) list.push(match);
      else noteGroups.set(match.slideId, [match]);
      continue;
    }
    const key = `${match.slideId}\0${match.elementId}`;
    const list = groups.get(key);
    if (list) list.push(match);
    else groups.set(key, [match]);
  }
  let slides = deck.slides;
  for (const list of groups.values()) {
    const { slideId, elementId } = list[0];
    const slide = slides[slideId];
    if (!slide) continue;
    const ordered = [...list].sort((a, b) => b.start - a.start);
    let changed = false;
    const elements = slide.elements.map((el) => {
      if (el.id !== elementId) return el;
      let next = el;
      for (const match of ordered) {
        const updated = replaceInElement(
          next,
          match.start,
          match.start + needle.length,
          needle,
          replacement,
        );
        if (updated !== next) {
          next = updated;
          changed = true;
        }
      }
      return next;
    });
    if (!changed) continue;
    slides = {
      ...slides,
      [slideId]: { ...slide, elements },
    };
  }
  for (const list of noteGroups.values()) {
    const slideId = list[0].slideId;
    const slide = slides[slideId];
    if (!slide) continue;
    const ordered = [...list].sort((a, b) => b.start - a.start);
    let notes = slide.notes ?? "";
    let changed = false;
    for (const match of ordered) {
      const updated = replaceInNotes(
        notes,
        match.start,
        match.start + needle.length,
        needle,
        replacement,
      );
      if (updated !== notes) {
        notes = updated;
        changed = true;
      }
    }
    if (!changed) continue;
    slides = {
      ...slides,
      [slideId]: { ...slide, notes },
    };
  }
  if (slides === deck.slides) return deck;
  return { ...deck, slides };
}

/**
 * Replace one match with the typed text. Capitalization is kept as typed.
 * A notes match changes only that occurrence in the speaker notes. A shape
 * match changes only that occurrence inside the shape. Other text and
 * positions stay.
 */
export function replaceDeckMatch(
  deck: Presentation,
  match: DeckMatch,
  query: string,
  replacement: string,
): Presentation {
  const needle = needleOf(query);
  if (!needle) return deck;
  return applyMatchReplacements(deck, [match], needle, replacement);
}

/**
 * Replace every current match, including shapes and speaker notes. A query
 * that hits nothing returns the same deck.
 */
export function replaceAllDeckMatches(
  deck: Presentation,
  query: string,
  replacement: string,
): { deck: Presentation; count: number } {
  const needle = needleOf(query);
  if (!needle) return { deck, count: 0 };
  const matches = findDeckMatches(deck, query);
  if (!matches.length) return { deck, count: 0 };
  return {
    deck: applyMatchReplacements(deck, matches, needle, replacement),
    count: matches.length,
  };
}

/**
 * Scroll a notes box so the matched words sit in its visible area.
 * The note text is not edited.
 */
export function revealNotesMatch(
  area: HTMLTextAreaElement,
  start: number,
  length: number,
): void {
  const value = area.value;
  const from = Math.max(0, Math.min(start, value.length));
  const style = getComputedStyle(area);
  const mirror = area.ownerDocument.createElement("div");
  mirror.setAttribute("aria-hidden", "true");
  mirror.style.cssText = [
    "position:absolute",
    "visibility:hidden",
    "pointer-events:none",
    "left:0",
    "top:0",
    "white-space:pre-wrap",
    "overflow-wrap:break-word",
    `width:${area.clientWidth}px`,
    `font:${style.font}`,
    `line-height:${style.lineHeight}`,
    `letter-spacing:${style.letterSpacing}`,
    `padding:${style.padding}`,
    `border:${style.border}`,
    `box-sizing:${style.boxSizing}`,
  ].join(";");
  mirror.textContent = value.slice(0, from);
  const marker = area.ownerDocument.createElement("span");
  marker.textContent = value.slice(from, from + Math.max(length, 1)) || " ";
  mirror.appendChild(marker);
  area.ownerDocument.body.appendChild(mirror);
  const top = marker.offsetTop;
  const height = Math.max(marker.offsetHeight, 1);
  mirror.remove();
  const padding = Number.parseFloat(style.paddingTop) || 0;
  const target = Math.max(0, top - padding);
  const bottom = target + height;
  const viewBottom = area.scrollTop + area.clientHeight - padding;
  if (target < area.scrollTop + 4 || bottom > viewBottom - 4) {
    area.scrollTop = Math.max(0, target - (area.clientHeight - height) / 2);
  }
  const bar = area.ownerDocument.querySelector(".slide-find-bar");
  if (!(bar instanceof HTMLElement)) return;
  const box = area.getBoundingClientRect();
  const barBox = bar.getBoundingClientRect();
  const covered =
    box.top < barBox.bottom && box.bottom > barBox.top && box.left < barBox.right && box.right > barBox.left;
  if (covered) area.scrollIntoView({ block: "end", inline: "nearest" });
}

/**
 * Scroll a shape so the matched word is on screen and not under the find bar.
 * The shape text and its position are not edited.
 */
export function revealShapeMatch(shape: HTMLElement): void {
  const word = shape.querySelector(".shape-label");
  const target = word instanceof HTMLElement ? word : shape;
  const box = target.getBoundingClientRect();
  const bar = shape.ownerDocument.querySelector(".slide-find-bar");
  const barBox = bar instanceof HTMLElement ? bar.getBoundingClientRect() : null;
  const covered =
    !!barBox &&
    box.top < barBox.bottom &&
    box.bottom > barBox.top &&
    box.left < barBox.right &&
    box.right > barBox.left;
  const viewBottom = shape.ownerDocument.documentElement.clientHeight;
  const minTop = (barBox?.bottom ?? 0) + 8;
  const clipped = box.top < minTop || box.bottom > viewBottom - 8 || box.height <= 0;
  if (covered || clipped) target.scrollIntoView({ block: "center", inline: "nearest" });
}
