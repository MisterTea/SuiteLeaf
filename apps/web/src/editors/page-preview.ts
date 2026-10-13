import {
  pageFace,
  pageNumberAt,
  pageNumberText,
  type PageSettings,
} from "@suiteleaf/core/document-layout";

export type PreviewSlot =
  | { kind: "page"; index: number }
  | { kind: "skip"; firstIndex: number; lastIndex: number };

/**
 * Which miniature sheets Page setup draws.
 * Odd and even pages still sample the first three faces, so a left number
 * and a right number both appear. Every other file shows each page it has,
 * up to three. A longer file shows the first sheet and the last sheet.
 */
export function previewPlan(
  pageCount: number,
  differentOddEven: boolean,
): { slots: PreviewSlot[]; total: number } {
  const count = Math.max(1, Math.floor(pageCount) || 1);
  if (differentOddEven) {
    return {
      slots: [0, 1, 2].map((index) => ({ kind: "page", index })),
      total: Math.max(count, 3),
    };
  }
  if (count <= 3) {
    return {
      slots: Array.from({ length: count }, (_, index) => ({
        kind: "page" as const,
        index,
      })),
      total: count,
    };
  }
  return {
    slots: [
      { kind: "page", index: 0 },
      { kind: "skip", firstIndex: 1, lastIndex: count - 2 },
      { kind: "page", index: count - 1 },
    ],
    total: count,
  };
}

/** The numerals on the miniature sheets, in order. Skipped pages are omitted. */
export function previewSheetNumbers(
  settings: PageSettings,
  pageCount: number,
): string[] {
  const plan = previewPlan(pageCount, settings.differentOddEven);
  return plan.slots.flatMap((slot) => {
    if (slot.kind !== "page") return [];
    return [pageFace(settings, slot.index, plan.total).pageNumber];
  });
}

/**
 * Names the pages that have no sheet. Roman uses the same numerals as the
 * chip. A fraction or "Page N" file uses the page numbers themselves.
 */
export function previewSkipLabel(
  settings: PageSettings,
  firstIndex: number,
  lastIndex: number,
  pageCount: number,
): string {
  const pages = Math.max(1, lastIndex - firstIndex + 1);
  if (!settings.pageNumbers) {
    return pages === 1 ? "1 page skipped" : `${pages} pages skipped`;
  }
  const count = Math.max(1, Math.floor(pageCount) || 1);
  const numeral = (index: number) => {
    const shown = pageNumberAt(settings, index, count);
    if (settings.pageNumberFormat === "roman")
      return pageNumberText("roman", shown.page, shown.total);
    return String(shown.page);
  };
  const start = numeral(firstIndex);
  const end = numeral(lastIndex);
  if (pages === 1) return `Page ${start} skipped`;
  return `Pages ${start}\u2013${end} skipped`;
}
