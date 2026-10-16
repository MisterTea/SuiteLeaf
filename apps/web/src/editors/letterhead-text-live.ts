import type { PageSettings } from "@suiteleaf/core/document-layout";
import { letterheadLiveEvent } from "./letterhead-live";

const textKeys = [
  "header",
  "footer",
  "firstHeader",
  "firstFooter",
  "evenHeader",
  "evenFooter",
  "oddHeader",
  "oddFooter",
] as const;

type TextKey = (typeof textKeys)[number];

/** The Page setup field stops at 500 characters, and so does the page. */
function letterheadText(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.slice(0, 500) : fallback;
}

/**
 * Header and footer wording is drawn while Page setup is open.
 * Distances, margins, paper size, and orientation are applied beside this.
 * Cancel drops the draft, and the saved words return.
 */
const imageKeys = [
  "headerImage",
  "footerImage",
  "firstHeaderImage",
  "firstFooterImage",
] as const;

/** Header and footer pictures are drawn while Page setup is open. */
export function liveFurnitureImages(base: PageSettings, draft: PageSettings): PageSettings {
  let next: PageSettings | null = null;
  for (const key of imageKeys) {
    const value = draft[key] ?? "";
    if (value === (base[key] ?? "")) continue;
    next ??= { ...base };
    next[key] = value;
  }
  return next ?? base;
}

export function liveLetterheadText(
  base: PageSettings,
  draft: PageSettings,
): PageSettings {
  let next: PageSettings | null = null;
  for (const key of textKeys) {
    const value = letterheadText(draft[key], base[key]);
    if (value === base[key]) continue;
    next ??= { ...base };
    next[key] = value;
  }
  return next ?? base;
}

/** Wording for the open dialog. Null means draw the saved words again. */
export function publishLiveLetterhead(
  root: HTMLElement,
  settings: PageSettings | null,
): void {
  const next = settings
    ? JSON.stringify(
        Object.fromEntries(textKeys.map((key) => [key, settings[key]])),
      )
    : "";
  if ((root.dataset.letterheadText ?? "") === next) return;
  if (next) root.dataset.letterheadText = next;
  else delete root.dataset.letterheadText;
  root.dispatchEvent(new Event(letterheadLiveEvent));
}

export function readLiveLetterhead(
  root: HTMLElement,
): Pick<PageSettings, TextKey> | null {
  const raw = root.dataset.letterheadText;
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const out = {} as Pick<PageSettings, TextKey>;
  for (const key of textKeys) {
    const value = record[key];
    if (typeof value !== "string") return null;
    out[key] = value.slice(0, 500);
  }
  return out;
}
