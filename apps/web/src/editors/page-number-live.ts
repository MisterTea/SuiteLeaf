import type {
  PageNumberFormat,
  PageNumberPosition,
  PageSettings,
} from "@suiteleaf/core/document-layout";

const formats = new Set<PageNumberFormat>(["fraction", "page", "roman"]);
const positions = new Set<PageNumberPosition>([
  "bottom-right",
  "bottom-center",
  "top-right",
]);

/**
 * The page-number switch, the format, and the position are drawn while
 * Page setup is open. Where numbering starts, the cover, a different first
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
  if (
    draft.pageNumbers === base.pageNumbers &&
    pageNumberFormat === base.pageNumberFormat &&
    pageNumberPosition === base.pageNumberPosition &&
    pageNumberPositionSet === base.pageNumberPositionSet
  )
    return base;
  return {
    ...base,
    pageNumbers: draft.pageNumbers,
    pageNumberFormat,
    pageNumberPosition,
    pageNumberPositionSet,
  };
}
