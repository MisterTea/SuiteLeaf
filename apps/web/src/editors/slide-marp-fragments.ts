import { Marp } from "@marp-team/marp-core";
import type { Presentation } from "@suiteleaf/core";
import { clickSteps, fadeOnClickIds } from "./slide-fade-in";

let previousSource: string | undefined;
let previousCounts: number[] = [];

/** Use MARP's parser so nested lists, code fences, and slide boundaries share its fragment order. */
export function marpFragmentCounts(source: string): readonly number[] {
  if (source !== previousSource) {
    const tokens: { type: string; attrGet: (name: string) => string | null }[] = new Marp({ html: true, math: false }).markdown.parse(source, {});
    previousCounts = tokens
      .filter((token) => token.type === "marpit_slide_open")
      .map((token) => Number(token.attrGet("data-marpit-fragments")) || 0);
    previousSource = source;
  }
  return previousCounts;
}

function fragmentCount(deck: Presentation, index: number): number {
  return deck.marp && deck.marpSource && !deck.marpSourceDirty
    ? marpFragmentCounts(deck.marpSource)[index] ?? 0
    : 0;
}

/** Existing object builds run first, followed by one click per MARP fragment. */
export function showBuildIds(deck: Presentation, index: number): string[] {
  const ids = fadeOnClickIds(deck.slides[deck.slideOrder[index]]?.elements ?? []);
  return [...ids, ...Array.from({ length: fragmentCount(deck, index) }, (_, n) => `marp-fragment-${n + 1}`)];
}

export function showBuildSteps(deck: Presentation, index: number): number[] {
  return [
    ...clickSteps(deck.slides[deck.slideOrder[index]]?.elements ?? []),
    ...Array<number>(fragmentCount(deck, index)).fill(1),
  ];
}

/** Undefined is a still image: all fragments stay visible outside the running show. */
export function marpFragmentStep(deck: Presentation, index: number, revealed: number): number | undefined {
  if (!deck.marp) return undefined;
  return Math.max(0, revealed - fadeOnClickIds(deck.slides[deck.slideOrder[index]]?.elements ?? []).length);
}

const FRAGMENT_STYLE = "data-suiteleaf-fragments";
export const INITIAL_FRAGMENT_STYLE = `<style ${FRAGMENT_STYLE}>[data-marpit-fragment]{visibility:hidden!important}</style>`;

/** Conceal unrevealed items without reflowing the list or reloading its frame. */
export function setMarpFragmentStep(doc: Document, step: number | undefined): void {
  let style = doc.querySelector<HTMLStyleElement>(`style[${FRAGMENT_STYLE}]`);
  if (step === undefined) {
    style?.remove();
    return;
  }
  if (!style) {
    style = doc.createElement("style");
    style.setAttribute(FRAGMENT_STYLE, "");
    doc.head.append(style);
  }
  const hidden: string[] = [];
  for (const el of doc.querySelectorAll<HTMLElement>("[data-marpit-fragment]")) {
    const fragment = Number(el.getAttribute("data-marpit-fragment"));
    const concealed = fragment > step;
    if (concealed) hidden.push(`[data-marpit-fragment="${fragment}"]`);
    if (concealed) el.setAttribute("aria-hidden", "true");
    else el.removeAttribute("aria-hidden");
  }
  style.textContent = hidden.length ? `${hidden.join(",")}{visibility:hidden!important}` : "";
}

/** A separate audience window receives the same revealed MARP items. */
export function marpAudienceDocument(html: string, step: number | undefined): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  setMarpFragmentStep(doc, step);
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}
