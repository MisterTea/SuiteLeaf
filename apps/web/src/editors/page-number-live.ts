import type { PageSettings } from "@suiteleaf/core/document-layout";

/**
 * The page-number switch is drawn while Page setup is open.
 * Format, position, where numbering starts, the cover, and a different
 * first page stay on the saved page until Apply. Cancel drops the draft.
 */
export function livePageNumbers(
  base: PageSettings,
  draft: PageSettings,
): PageSettings {
  if (typeof draft.pageNumbers !== "boolean") return base;
  if (draft.pageNumbers === base.pageNumbers) return base;
  return { ...base, pageNumbers: draft.pageNumbers };
}
