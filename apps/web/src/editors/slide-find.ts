import type { Presentation, SlideElement } from "@suiteleaf/core";
import { hasTextRuns, plainText } from "./slide-runs";

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
