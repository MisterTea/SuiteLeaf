import {
  defaultPageSettings,
  type PageNumberFormat,
  type PageSettings,
} from "./document-page-settings";

export type PageNumberSide =
  | "left"
  | "right"
  | "center"
  | "top-right"
  | "top-left"
  | "none";
export type PageFace = {
  header: string;
  footer: string;
  headerImage: string;
  footerImage: string;
  /** Outside edge when odd and even pages differ; otherwise the left. */
  headerAlign: "left" | "right";
  numberSide: PageNumberSide;
  /** Empty when this page has no number. Otherwise "2 / 3" or "Page 2". */
  pageNumber: string;
};
const ROMAN: [number, string][] = [
  [1000, "m"],
  [900, "cm"],
  [500, "d"],
  [400, "cd"],
  [100, "c"],
  [90, "xc"],
  [50, "l"],
  [40, "xl"],
  [10, "x"],
  [9, "ix"],
  [5, "v"],
  [4, "iv"],
  [1, "i"],
];
/** Lowercase roman, as in a contents page. Zero and negatives stay "0". */
export function lowerRoman(value: number): string {
  let n = Math.floor(value);
  if (n <= 0) return "0";
  let out = "";
  for (const [amount, glyph] of ROMAN) {
    while (n >= amount) {
      out += glyph;
      n -= amount;
    }
  }
  return out;
}
export function pageNumberText(
  format: PageNumberFormat,
  page: number,
  pageCount: number,
): string {
  const total = Math.max(pageCount, 1);
  if (format === "page") return `Page ${page}`;
  if (format === "roman") return lowerRoman(page);
  return `${page} / ${total}`;
}
/**
 * The roman chip lists only the pages that exist, from the first printed
 * number. One page starting at 4 is "iv". Two pages are "iv, v". Three
 * pages are "iv, v, vi". Longer than three, it shows the first, an ellipsis,
 * and the last, such as "iv … viii".
 */
export function romanPageChip(first: number, pageCount: number): string {
  const count = Math.max(1, Math.floor(pageCount) || 1);
  const start = Math.trunc(first);
  const at = (offset: number) => lowerRoman(start + offset);
  if (count > 3) return `${at(0)} … ${at(count - 1)}`;
  return Array.from({ length: count }, (_, offset) => at(offset)).join(", ");
}
/**
 * Labels for the fraction, "Page N", and roman chips. They use the number
 * on the first page, so a start of 4 on two pages reads "4 / 5", "Page 4",
 * and "iv, v". The roman chip does not add a page the file does not have.
 * Pass the last accepted start. The caller keeps that number when the field
 * is below 1, so the chips do not move.
 */
export function pageNumberFormatChips(
  start: number,
  pageCount: number,
): { fraction: string; page: string; roman: string } {
  const count = Math.max(1, Math.floor(pageCount) || 1);
  const shown = pageNumberAt(
    {
      ...defaultPageSettings,
      pageNumberStart: pageNumberStartValue(start),
    },
    0,
    count,
  );
  return {
    fraction: pageNumberText("fraction", shown.page, shown.total),
    page: pageNumberText("page", shown.page, shown.total),
    roman: romanPageChip(shown.page, count),
  };
}
/** A start number is a whole page from 1 through 9999. Anything else starts at 1. */
export const PAGE_NUMBER_START_MAX = 9999;
export function pageNumberStartValue(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return 1;
  if (value < 1 || value > PAGE_NUMBER_START_MAX) return 1;
  return value;
}
/**
 * The number drawn on a page, and the last number in the file.
 * A cover is not counted: the second page is 1, and Start at waits until the
 * cover is turned off.
 */
export function pageNumberAt(
  settings: PageSettings,
  pageIndex: number,
  pageCount: number,
): { page: number; total: number } {
  const cover = settings.coverHasNoNumber;
  const start = cover ? 1 : settings.pageNumberStart;
  const skip = cover ? 1 : 0;
  const count = Math.max(1, pageCount - skip);
  return {
    page: start + pageIndex - skip,
    total: start + count - 1,
  };
}
/**
 * Word's `w:start`, or null when the section still begins at 1.
 * A cover hides page 0, so the second page displays as 1.
 */
export function wordPageNumberStart(settings: PageSettings): number | null {
  if (!settings.pageNumbers) return null;
  if (settings.coverHasNoNumber) return 0;
  if (settings.pageNumberStart === 1) return null;
  return settings.pageNumberStart;
}
function chosenNumberSide(settings: PageSettings): PageNumberSide {
  if (settings.pageNumberPosition === "bottom-center") return "center";
  if (settings.pageNumberPosition === "top-right") return "top-right";
  return "right";
}
/**
 * The outside edge of a corner the reader already chose.
 * Top right stays on the right of an odd page and moves to the top left of an
 * even page. Bottom center and bottom right both sit on the outside bottom edge.
 */
function outsideNumberSide(settings: PageSettings, even: boolean): PageNumberSide {
  if (settings.pageNumberPosition === "top-right")
    return even ? "top-left" : "top-right";
  return even ? "left" : "right";
}
/**
 * Which header, footer, and page-number edge a page uses.
 * Page 1 keeps its letterhead when different first page is on.
 * With odd and even pages, the number sits on the outside edge: left on even
 * pages, right on odd pages. A chosen top-right corner stays at the top.
 * A cover is not a numbered sheet. The next page is page 1, so its number
 * sits on the outside right, and the page after that is page 2 on the left.
 * Otherwise every numbered page uses the chosen corner, or the bottom right.
 */
function spreadEven(
  settings: PageSettings,
  pageIndex: number,
  pageCount: number,
): boolean {
  const page = pageIndex + 1;
  if (!settings.coverHasNoNumber) return page % 2 === 0;
  // The cover keeps the odd-page header. Numbering starts on the next sheet.
  if (page === 1) return false;
  return pageNumberAt(settings, pageIndex, pageCount).page % 2 === 0;
}
export function pageFace(
  settings: PageSettings,
  pageIndex: number,
  pageCount: number,
  /** 0-based page where a heading restarts numbering at arabic 1. */
  arabicStart?: number | null,
): PageFace {
  const page = pageIndex + 1;
  const first = page === 1 && settings.differentFirstPage;
  const even = spreadEven(settings, pageIndex, pageCount);
  let header = settings.header;
  let footer = settings.footer;
  let headerImage = settings.headerImage;
  let footerImage = settings.footerImage;
  let headerAlign: "left" | "right" = "left";
  let numberSide: PageNumberSide = "none";
  if (settings.pageNumbers) {
    numberSide =
      settings.pageNumberPositionSet && !first
        ? chosenNumberSide(settings)
        : "right";
  }
  if (first) {
    header = settings.firstHeader;
    footer = settings.firstFooter;
    headerImage = settings.firstHeaderImage;
    footerImage = settings.firstFooterImage;
    numberSide = "none";
  } else if (settings.differentOddEven) {
    header = even ? settings.evenHeader : settings.oddHeader;
    footer = even ? settings.evenFooter : settings.oddFooter;
    headerAlign = even ? "left" : "right";
    if (settings.pageNumbers)
      numberSide = settings.pageNumberPositionSet
        ? outsideNumberSide(settings, even)
        : even
          ? "left"
          : "right";
  }
  // A cover keeps its footer and drops only the number. It is not page 1.
  if (page === 1 && settings.coverHasNoNumber) numberSide = "none";
  const shown = pageNumberAt(settings, pageIndex, pageCount);
  const restarted =
    typeof arabicStart === "number" &&
    Number.isInteger(arabicStart) &&
    arabicStart >= 0 &&
    pageIndex >= arabicStart;
  return {
    header,
    footer,
    headerImage,
    footerImage,
    headerAlign,
    numberSide,
    pageNumber:
      numberSide === "none"
        ? ""
        : restarted
          ? String(pageIndex - arabicStart + 1)
          : pageNumberText(settings.pageNumberFormat, shown.page, shown.total),
  };
}
/** Copy the shared header into the even and odd fields the first time they are used. */
export function setDifferentOddEven(
  settings: PageSettings,
  on: boolean,
): PageSettings {
  if (!on) return { ...settings, differentOddEven: false };
  const blank =
    !settings.evenHeader &&
    !settings.evenFooter &&
    !settings.oddHeader &&
    !settings.oddFooter;
  if (!blank) return { ...settings, differentOddEven: true };
  return {
    ...settings,
    differentOddEven: true,
    evenHeader: settings.header,
    evenFooter: settings.footer,
    oddHeader: settings.header,
    oddFooter: settings.footer,
  };
}
export function setDifferentFirstPage(
  settings: PageSettings,
  on: boolean,
): PageSettings {
  return { ...settings, differentFirstPage: on };
}
/** Where a chosen number goes once odd and even pages are on, or null when they are not. */
function mirroredNumberPlace(settings: PageSettings): string | null {
  if (!settings.differentOddEven || !settings.pageNumberPositionSet) return null;
  return settings.pageNumberPosition === "top-right"
    ? "Top left on even pages, top right on odd pages"
    : "Bottom left on even pages, bottom right on odd pages";
}
function numberPlace(settings: PageSettings): string {
  return settings.pageNumberPositionSet && settings.pageNumberPosition === "bottom-center"
    ? "Bottom center"
    : settings.pageNumberPositionSet && settings.pageNumberPosition === "top-right"
      ? "Top right"
      : "Bottom right";
}
export function pageNumberHint(settings: PageSettings, pageCount = 2): string {
  if (!settings.pageNumbers)
    return "Off on every page. Start at and the cover choice stay until you turn numbers on.";
  const kept = "Editing the footer leaves it in place.";
  if (settings.coverHasNoNumber) {
    const next = pageNumberAt(settings, 1, pageCount);
    const counted = pageNumberAt(
      { ...settings, coverHasNoNumber: false, pageNumberStart: 1 },
      1,
      pageCount,
    );
    const shown = pageNumberText(settings.pageNumberFormat, next.page, next.total);
    const asTwo = pageNumberText(
      settings.pageNumberFormat,
      counted.page,
      counted.total,
    );
    const edge = settings.differentOddEven
      ? " The next page’s number sits on the outside right, and the page after that on the left."
      : "";
    return `No number on the cover. The next page is “${shown}”, not “${asTwo}”. Start at stays for when the cover has a number.${edge} ${kept}`;
  }
  const mirrored = mirroredNumberPlace(settings);
  if (mirrored) {
    const where = settings.differentFirstPage
      ? `No number on page 1. ${mirrored}`
      : mirrored;
    if (settings.pageNumberStart !== 1) {
      const count = Math.max(1, Math.floor(pageCount) || 1);
      const first = pageNumberAt(settings, 0, count);
      const started = pageNumberText(
        settings.pageNumberFormat,
        first.page,
        first.total,
      );
      if (count < 2) return `${where}, “${started}”. ${kept}`;
      const second = pageNumberAt(settings, 1, count);
      const next = pageNumberText(
        settings.pageNumberFormat,
        second.page,
        second.total,
      );
      return `${where}, starting at “${started}”. The next page is “${next}”. ${kept}`;
    }
    const sample =
      settings.pageNumberFormat === "page"
        ? "Page 1"
        : settings.pageNumberFormat === "roman"
          ? settings.differentFirstPage
            ? "ii"
            : "i"
          : pageNumberText("fraction", 1, pageCount);
    return `${where}, as “${sample}”. ${kept}`;
  }
  if (settings.pageNumberStart !== 1) {
    const count = Math.max(1, Math.floor(pageCount) || 1);
    const first = pageNumberAt(settings, 0, count);
    const started = pageNumberText(
      settings.pageNumberFormat,
      first.page,
      first.total,
    );
    if (count < 2)
      return `${numberPlace(settings)} of the only page, “${started}”. ${kept}`;
    const second = pageNumberAt(settings, 1, count);
    const next = pageNumberText(
      settings.pageNumberFormat,
      second.page,
      second.total,
    );
    return `${numberPlace(settings)} of every page, starting at “${started}”. The next page is “${next}”. ${kept}`;
  }
  if (!settings.pageNumberPositionSet && settings.differentOddEven)
    return settings.differentFirstPage
      ? "No number on page 1. Left on even pages, right on odd pages."
      : "Left on even pages, right on odd pages.";
  if (
    settings.differentFirstPage &&
    !settings.pageNumberPositionSet &&
    settings.pageNumberFormat === "fraction"
  )
    return "Page 1 has no number. Page 2 shows 2.";
  const sample =
    settings.pageNumberFormat === "page"
      ? settings.differentFirstPage
        ? "Page 2"
        : "Page 1"
      : settings.pageNumberFormat === "roman"
        ? settings.differentFirstPage
          ? "ii"
          : "i"
        : pageNumberText("fraction", 1, pageCount);
  const place = numberPlace(settings);
  if (settings.differentFirstPage)
    return `No number on page 1. ${place} on later pages, as “${sample}”. ${kept}`;
  return `${place} of every page, as “${sample}”. ${kept}`;
}
