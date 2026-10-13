import {
  PAGE_NUMBER_START_MAX,
  pageNumberStartValue,
  type PageNumberFormat,
  type PageNumberPosition,
  type PageSettings,
} from "@suiteleaf/core/document-layout";

const formats = new Set<PageNumberFormat>(["fraction", "page", "roman"]);
const positions = new Set<PageNumberPosition>([
  "bottom-right",
  "bottom-center",
  "top-right",
]);

/**
 * A whole start from 1 up is drawn immediately. Below 1 is refused: the
 * caller keeps `current` on the page and can show `text` in the field.
 * Anything that is not a whole number yet (a blank box, a half-typed
 * minus) also keeps `current`.
 */
export function acceptPageNumberStart(
  current: number,
  raw: string,
): { start: number; refused: boolean; text: string } {
  const trimmed = raw.trim();
  if (!trimmed || !/^-?\d+$/.test(trimmed))
    return { start: current, refused: false, text: raw };
  const next = Number(trimmed);
  if (next < 1) return { start: current, refused: true, text: trimmed };
  const start = pageNumberStartValue(next);
  return { start, refused: false, text: String(start) };
}

/** A start the page can draw. Below 1, or anything that is not a whole page, stays on the saved number. */
function livePageNumberStart(base: number, draft: unknown): number {
  if (typeof draft !== "number" || !Number.isInteger(draft)) return base;
  if (draft < 1 || draft > PAGE_NUMBER_START_MAX) return base;
  return draft;
}

/**
 * The page-number switch, the format, the position, and where numbering
 * starts are drawn while Page setup is open. The cover, a different first
 * page, and the watermark stay on the saved page until Apply. Cancel drops
 * the draft.
 */
export function livePageNumbers(
  base: PageSettings,
  draft: PageSettings,
): PageSettings {
  if (typeof draft.pageNumbers !== "boolean") return base;
  const pageNumberFormat = formats.has(draft.pageNumberFormat)
    ? draft.pageNumberFormat
    : base.pageNumberFormat;
  const pageNumberPosition = positions.has(draft.pageNumberPosition)
    ? draft.pageNumberPosition
    : base.pageNumberPosition;
  const pageNumberPositionSet = draft.pageNumberPositionSet === true;
  const pageNumberStart = livePageNumberStart(
    base.pageNumberStart,
    draft.pageNumberStart,
  );
  if (
    draft.pageNumbers === base.pageNumbers &&
    pageNumberFormat === base.pageNumberFormat &&
    pageNumberPosition === base.pageNumberPosition &&
    pageNumberPositionSet === base.pageNumberPositionSet &&
    pageNumberStart === base.pageNumberStart
  )
    return base;
  return {
    ...base,
    pageNumbers: draft.pageNumbers,
    pageNumberFormat,
    pageNumberPosition,
    pageNumberPositionSet,
    pageNumberStart,
  };
}
