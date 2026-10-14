import type { Presentation, SlideElement } from "@suiteleaf/core";
import { hasTextRuns, plainText, replaceRunRange } from "./slide-runs";

/** One occurrence of the query in a text box, in slide order. */
export type DeckMatch = {
  slideId: string;
  slideIndex: number;
  /** Slide name shown beside the count, such as Welcome. */
  place: string;
  elementId: string;
  start: number;
};

/** Text a text box actually shows. Speaker notes, shapes, and tables are not boxes. */
export function textBoxText(el: Pick<SlideElement, "type" | "content" | "runs">): string {
  if (el.type !== "text") return "";
  if (hasTextRuns(el)) return plainText(el.runs ?? []);
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

/**
 * Every match in slide order, including skipped slides. Notes are not searched.
 * The deck is left unchanged.
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
      const text = textBoxText(el);
      if (!text) continue;
      const hay = text.toLowerCase();
      let from = 0;
      while (from <= hay.length - needle.length) {
        const at = hay.indexOf(needle, from);
        if (at < 0) break;
        matches.push({
          slideId,
          slideIndex,
          place,
          elementId: el.id,
          start: at,
        });
        from = at + needle.length;
      }
    }
  });
  return matches;
}

/** The match after `current`, wrapping to the first after the last. */
export function nextMatchIndex(current: number, count: number): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return 0;
  return (current + 1) % count;
}

/** "1 of 2 on Welcome", or "No matches" when the query hits nothing. */
export function findStatus(
  query: string,
  matches: readonly { place: string }[],
  index: number,
): string {
  if (!query.trim()) return "";
  if (!matches.length) return "No matches";
  const at = index >= 0 && index < matches.length ? index : 0;
  return `${at + 1} of ${matches.length} on ${matches[at].place}`;
}

/** "Replace all 2". Zero matches are not offered a button. */
export function replaceAllLabel(count: number): string {
  return `Replace all ${count}`;
}

/** "2 replaced" after Replace all. */
export function replacedStatus(count: number): string {
  return `${count} replaced`;
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

function replaceInElement(
  el: SlideElement,
  from: number,
  to: number,
  needle: string,
  replacement: string,
): SlideElement {
  const visible = textBoxText(el);
  if (visible.slice(from, to).toLowerCase() !== needle) return el;
  if (el.runs?.length && (hasTextRuns(el) || plainText(el.runs) === (el.content ?? ""))) {
    const runs = replaceRunRange(el.runs, from, to, replacement);
    return { ...el, runs, content: plainText(runs) };
  }
  const content = el.content ?? "";
  return {
    ...el,
    content: content.slice(0, from) + replacement + content.slice(to),
  };
}

function applyMatchReplacements(
  deck: Presentation,
  matches: readonly DeckMatch[],
  needle: string,
  replacement: string,
): Presentation {
  const groups = new Map<string, DeckMatch[]>();
  for (const match of matches) {
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
  if (slides === deck.slides) return deck;
  return { ...deck, slides };
}

/**
 * Replace one match with the typed text. Capitalization is kept as typed.
 * Other matches, notes, and box positions stay.
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
 * Replace every current match. A query that hits nothing returns the same deck.
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
