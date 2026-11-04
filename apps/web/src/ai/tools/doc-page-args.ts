import {
  gutterAccepted,
  marginError,
  watermarkText,
  type MarginEdge,
  type PageNumberFormat,
  type PageNumberPosition,
  type PageSettings,
} from "@suiteleaf/core/document-layout";
import { ToolError } from "../host";
import { unwrapName } from "./doc-args";

export function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = String(value).trim().toLowerCase();
  if (/^(true|yes|on|1)$/.test(text)) return true;
  if (/^(false|no|off|0)$/.test(text)) return false;
  return undefined;
}

/** "page" draws "Page 1". "fraction" draws "1 / 2". */
export function pageNumberFormatArg(value: unknown): PageNumberFormat | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const text = String(value).trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (text === "page" || text === "page n" || text === "pagen" || text.startsWith("page ")) return "page";
  if (text === "fraction" || text === "1 / 2" || text === "1/2" || text.includes("/")) return "fraction";
  if (text === "roman" || text === "i" || text.includes("roman")) return "roman";
  throw new ToolError(
    'page_number_format must be "page" (shows "Page 1"), "fraction" (shows "1 / 2"), or "roman". Call page_setup again with page_number_format "page".',
  );
}

export function pageNumberPositionArg(value: unknown): PageNumberPosition | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const text = String(value).trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if ((text.includes("top") && text.includes("right")) || text === "topright") return "top-right";
  if (
    (text.includes("bottom") && (text.includes("center") || text.includes("centre"))) ||
    text === "center" ||
    text === "centre"
  )
    return "bottom-center";
  if ((text.includes("bottom") && text.includes("right")) || text === "bottomright") return "bottom-right";
  throw new ToolError(
    'page_number_position must be "top-right", "bottom-center", or "bottom-right". Call page_setup again with page_number_position "top-right".',
  );
}

export const PAGE_NUMBER_START_KEYS = [
  "page_number_start",
  "pageNumberStart",
  "start_at",
  "startAt",
  "start",
  "numbering_start",
];

export const COVER_HAS_NO_NUMBER_KEYS = [
  "cover_has_no_number",
  "coverHasNoNumber",
  "cover_has_no_page_number",
  "unnumbered_cover",
  "no_number_on_cover",
  "cover",
];

function argBag(args: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = args[key];
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return undefined;
}

export function firstArg(args: Record<string, unknown>, keys: string[]): unknown {
  const bags = [args, argBag(args, "page"), argBag(args, "settings"), argBag(args, "page_setup"), argBag(args, "setup")].filter(
    (bag): bag is Record<string, unknown> => !!bag,
  );
  for (const bag of bags) {
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(bag, key)) continue;
      const value = bag[key];
      if (value !== undefined && value !== null && value !== "") return value;
    }
  }
  return undefined;
}

/** A page-setup value from the top-level call or a nested headers object. */
export function bagValue(args: Record<string, unknown>, keys: string[]): unknown {
  const headers = argBag(args, "headers") ?? argBag(args, "page_headers");
  const bags = [args, argBag(args, "page"), argBag(args, "settings"), argBag(args, "page_setup"), argBag(args, "setup"), headers].filter(
    (bag): bag is Record<string, unknown> => !!bag,
  );
  for (const bag of bags) {
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(bag, key)) continue;
      const value = bag[key];
      if (value !== undefined && value !== null && value !== "") return value;
    }
    if (headers && bag === headers) {
      for (const key of keys) {
        const short = key.replace(/_header$|Header$/, "");
        if (short === key) continue;
        const value = bag[short];
        if (value !== undefined && value !== null && value !== "") return value;
      }
    }
  }
  return undefined;
}

/** Start at, a whole page from 1 through 9999. Missing means leave the stored start. */
export function pageNumberStartArg(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return pageNumberStartArg(record.start ?? record.value ?? record.page_number_start ?? record.page);
  }
  const text = String(value)
    .trim()
    .replace(/^["“”']+|["“”']+$/g, "")
    .replace(/^page\s+/i, "")
    .replace(/[.,;:]+$/g, "");
  if (!/^\d+$/.test(text))
    throw new ToolError(
      'page_number_start must be a whole number from 1 to 9999, such as 4. Nothing was changed. Call page_setup again with page_number_start 4 and cover_has_no_number true. Do not type the number into the footer.',
    );
  const start = Number(text);
  if (start < 1 || start > 9999)
    throw new ToolError(
      'page_number_start must be a whole number from 1 to 9999, such as 4. Nothing was changed. Call page_setup again with page_number_start 4 and cover_has_no_number true. Do not type the number into the footer.',
    );
  return start;
}

/** True hides the number on the first page and counts the next page as 1. */
export function coverHasNoNumberArg(value: unknown): boolean | undefined {
  const parsed = optionalBoolean(value);
  if (parsed !== undefined) return parsed;
  if (typeof value !== "string") return undefined;
  const text = value.trim().toLowerCase();
  if (!text) return undefined;
  if (/no\s*number|unnumbered|without/.test(text)) return true;
  return undefined;
}

export const MARGIN_EDGE_FIELDS = [
  ["margin_top_inches", "top"],
  ["margin_bottom_inches", "bottom"],
  ["margin_left_inches", "left"],
  ["margin_right_inches", "right"],
] as const;

export function coerceInches(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const text = value
    .trim()
    .toLowerCase()
    .replace(/inches|inch|in|["”″]/g, "")
    .trim()
    .replace(/\.$/, "");
  if (!text) return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

export function nestedMarginBag(args: Record<string, unknown>): Record<string, unknown> {
  for (const key of ["margins", "edges", "page_margins", "margin"]) {
    const value = args[key];
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  }
  return {};
}

export function pickMargin(sources: Record<string, unknown>[], keys: string[]): unknown {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (!wanted.has(key.toLowerCase()) || value === undefined || value === null || value === "") continue;
      return value;
    }
  }
  return undefined;
}

/** Pull per-edge inches out of the names FrogNano actually sends. */
export function marginEdgeArgs(args: Record<string, unknown>): Partial<Record<(typeof MARGIN_EDGE_FIELDS)[number][0], number>> {
  const bag = nestedMarginBag(args);
  const sources = [args, bag];
  const aliases: Record<(typeof MARGIN_EDGE_FIELDS)[number][0], string[]> = {
    margin_top_inches: ["margin_top_inches", "margin_top", "top_margin", "top_inches", "topMargin", "marginTop", "top"],
    margin_bottom_inches: ["margin_bottom_inches", "margin_bottom", "bottom_margin", "bottom_inches", "bottomMargin", "marginBottom", "bottom"],
    margin_left_inches: ["margin_left_inches", "margin_left", "left_margin", "left_inches", "leftMargin", "marginLeft", "left"],
    margin_right_inches: ["margin_right_inches", "margin_right", "right_margin", "right_inches", "rightMargin", "marginRight", "right"],
  };
  const out: Partial<Record<(typeof MARGIN_EDGE_FIELDS)[number][0], number>> = {};
  for (const [key] of MARGIN_EDGE_FIELDS) {
    const value = pickMargin(sources, aliases[key]);
    if (value === undefined) continue;
    const inches = coerceInches(value);
    if (inches === undefined)
      throw new ToolError(`${key} must be a number of inches, such as 1.5. Nothing was changed.`);
    out[key] = inches;
  }
  const sentence = [args.margins, args.margin_inches].find((value) => typeof value === "string") as string | undefined;
  if (sentence) {
    for (const match of sentence.matchAll(/\b(top|bottom|left|right)\b[^0-9]{0,16}(\d+(?:\.\d+)?)/gi)) {
      const key = `margin_${match[1].toLowerCase()}_inches` as (typeof MARGIN_EDGE_FIELDS)[number][0];
      if (out[key] === undefined) out[key] = Number(match[2]);
    }
  }
  return out;
}

/**
 * Inches for one edge, as CSS pixels. Below 0.25 or above 3 is refused
 * before anything is saved. The caller must not write page setup on throw.
 */
export function pageMarginEdges(args: Partial<Record<(typeof MARGIN_EDGE_FIELDS)[number][0], number>>): [MarginEdge, number][] {
  const out: [MarginEdge, number][] = [];
  for (const [key, edge] of MARGIN_EDGE_FIELDS) {
    const inches = args[key];
    if (inches === undefined) continue;
    const px = Math.round(inches * 96);
    if (!(inches >= 0.25) || marginError(px)) {
      const why = inches > 3 ? "A margin must be at most 3 inches." : "A margin must be at least 0.25 inches.";
      throw new ToolError(
        `${why} The ${edge} margin was refused and nothing was changed. Call page_setup again with ${key} from 0.25 to 3.`,
      );
    }
    out.push([edge, px]);
  }
  return out;
}

/**
 * CSS pixels for one margin on every edge. Below 0.25 or above 3 is refused
 * before anything is saved.
 */
export function uniformMarginPx(inches: number): number {
  const px = Math.round(inches * 96);
  if (!(inches >= 0.25) || marginError(px)) {
    const why = inches > 3 ? "A margin cannot be more than 3 inches." : "A margin must be at least 0.25 inches.";
    throw new ToolError(`${why} Nothing was changed. Call page_setup again with margin_inches from 0.25 to 3.`);
  }
  return px;
}

/** One inset for every edge, from the names FrogNano sends. Missing means leave it. */
export function uniformMarginInches(args: Record<string, unknown>): number | undefined {
  const keys = ["margin_inches", "marginInches", "page_margin", "pageMargin", "all_margins", "margin_in"];
  for (const key of keys) {
    const value = args[key];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "string" && /\b(top|bottom|left|right)\b/i.test(value)) continue;
    const inches = coerceInches(value);
    if (inches !== undefined) return inches;
  }
  for (const key of ["margin", "margins"]) {
    const value = args[key];
    if (typeof value !== "number" && typeof value !== "string") continue;
    if (typeof value === "string" && /\b(top|bottom|left|right)\b/i.test(value)) continue;
    const inches = coerceInches(value);
    if (inches !== undefined) return inches;
  }
  return undefined;
}

const GUTTER_KEYS = [
  "gutter_inches",
  "gutterInches",
  "gutter",
  "binding_gutter",
  "binding_gutter_inches",
  "bindingGutter",
  "inside_gutter",
  "inside_gutter_inches",
];

/** Binding gutter in inches, from the names FrogNano sends. Missing means leave it. */
export function gutterInchesFrom(args: Record<string, unknown>): number | undefined {
  const sources = [args, nestedMarginBag(args)];
  for (const key of GUTTER_KEYS) {
    const value = pickMargin(sources, [key]);
    if (value === undefined) continue;
    const inches = coerceInches(value);
    if (inches === undefined)
      throw new ToolError("gutter_inches must be a number of inches, such as 0.5. Nothing was changed.");
    return inches;
  }
  return undefined;
}

/**
 * CSS pixels for a binding gutter. Above 2 inches, or below 0, is refused
 * before anything is saved. 0 clears it. The caller must not write page setup on throw.
 */
export function bindingGutterPx(inches: number): number {
  const px = Math.round(inches * 96);
  if (!(inches >= 0) || inches > 2 || !gutterAccepted(px)) {
    const why =
      inches > 2
        ? "A gutter larger than 2 inches is refused and nothing was saved."
        : "A gutter must be from 0 to 2 inches. Nothing was saved.";
    throw new ToolError(
      `${why} Call page_setup again with gutter_inches 0.5 only. Do not pass margin_inches, margin_top_inches, margin_bottom_inches, margin_left_inches, or margin_right_inches. Odd pages keep the extra space on the left and even pages on the right.`,
    );
  }
  return inches === 0 ? 0 : px;
}

export function pageNumberPhrase(page: PageSettings): string {
  if (!page.pageNumbers) return "page numbers off";
  if (page.differentOddEven && !page.pageNumberPositionSet) {
    const cover = page.differentFirstPage ? "no number on page 1, " : "";
    return `page numbers on, ${cover}left on even pages, right on odd pages`;
  }
  const shown =
    page.pageNumberFormat === "page" ? '"Page N"' : page.pageNumberFormat === "roman" ? "roman numerals" : '"1 / 2"';
  const place = !page.pageNumberPositionSet
    ? "the bottom right"
    : page.pageNumberPosition === "top-right"
      ? "the top right"
      : page.pageNumberPosition === "bottom-center"
        ? "the bottom center"
        : "the bottom right";
  let phrase = `page numbers on as ${shown} at ${place}`;
  if (page.coverHasNoNumber)
    phrase += `. Cover has no number, so the first page has no number and the next page is Page 1. Start at ${page.pageNumberStart} is still stored`;
  else if (page.pageNumberStart !== 1) phrase += `, starting at ${page.pageNumberStart}`;
  return phrase;
}

/** Steering for the minutes file after Start at or the cover choice is written. */
export function minutesStartNote(title: string, touched: boolean, page: PageSettings): string {
  if (title !== "October minutes" || !touched) return "";
  const footer = page.footer ? ` The footer is still "${page.footer}".` : "";
  if (page.coverHasNoNumber && page.pageNumberStart === 4)
    return `${footer} The cover has no number. The next page is Page 1. Start at 4 is still stored. Stop. Do not call another tool. Do not type the page number into the footer.`;
  if (page.pageNumberStart === 4 && !page.coverHasNoNumber)
    return `${footer} Start at is 4. Next, call page_setup once with cover_has_no_number true only. Do not pass page_number_start, footer, or different_first_page. Do not type the number into the footer.`;
  if (page.coverHasNoNumber)
    return `${footer} The cover is on and Start at is ${page.pageNumberStart}. Call page_setup once with page_number_start 4 only. Leave cover_has_no_number true. Do not type Page 1 into the footer.`;
  return footer;
}

const WATERMARK_KEYS = [
  "watermark",
  "watermark_text",
  "watermarkText",
  "page_watermark",
  "behind_text",
  "behind",
];

/** The phrase drawn behind the text. Missing means leave it. Empty clears it. */
export function watermarkArg(args: Record<string, unknown>): string | undefined {
  const bags: Record<string, unknown>[] = [args];
  for (const key of ["page", "settings", "page_setup", "setup"]) {
    const nested = args[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) bags.push(nested as Record<string, unknown>);
  }
  for (const bag of bags) {
    for (const key of WATERMARK_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(bag, key)) continue;
      const value = bag[key];
      if (value === undefined || value === null) continue;
      if (typeof value === "boolean")
        throw new ToolError(
          'watermark is the word behind the text, such as "DRAFT". Call page_setup again with watermark "DRAFT". Do not type it into a paragraph.',
        );
      if (typeof value === "string" || typeof value === "number") return watermarkText(unwrapName(String(value)));
      if (typeof value === "object" && !Array.isArray(value)) {
        const inner = (value as Record<string, unknown>).text ?? (value as Record<string, unknown>).word ?? (value as Record<string, unknown>).value;
        if (typeof inner === "string" || typeof inner === "number") return watermarkText(unwrapName(String(inner)));
        if (inner === "") return "";
      }
    }
  }
  return undefined;
}
