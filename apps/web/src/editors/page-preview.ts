import {
  pageFace,
  pageNumberAt,
  pageNumberText,
  type PageNumberSide,
  type PageSettings,
} from "@suiteleaf/core/document-layout";

export type PreviewPageRole = "last-even" | "last-odd" | "cover" | "next";

export type PreviewSlot =
  | { kind: "page"; index: number; role?: PreviewPageRole }
  | { kind: "skip"; firstIndex: number; lastIndex: number };

/**
 * The last even page and the last odd page, earlier page first.
 * A five-page file puts page 4 on the left and page 5 on the right.
 * A one-page file has only the odd page.
 */
function lastParitySlots(count: number): PreviewSlot[] {
  let lastEven = -1;
  let lastOdd = -1;
  for (let index = 0; index < count; index += 1) {
    if ((index + 1) % 2 === 0) lastEven = index;
    else lastOdd = index;
  }
  const slots: Array<Extract<PreviewSlot, { kind: "page" }>> = [];
  if (lastEven >= 0)
    slots.push({ kind: "page", index: lastEven, role: "last-even" });
  if (lastOdd >= 0) slots.push({ kind: "page", index: lastOdd, role: "last-odd" });
  slots.sort((a, b) => a.index - b.index);
  return slots;
}

/**
 * The cover, then the next sheet, so a blank cover and page 1 on the
 * outside edge are both visible before Apply.
 */
function coverSlots(count: number): PreviewSlot[] {
  const slots: PreviewSlot[] = [{ kind: "page", index: 0, role: "cover" }];
  if (count > 1) slots.push({ kind: "page", index: 1, role: "next" });
  return slots;
}

/**
 * Which miniature sheets Page setup draws.
 * A cover with odd and even pages already on shows the cover and the next
 * sheet, so the blank cover and the outside-edge number are visible before
 * Apply. Different odd and even pages otherwise shows the last even page
 * and the last odd page. Every other file shows each page it has, up to
 * three. A longer file shows the first sheet and the last sheet.
 */
export function previewPlan(
  pageCount: number,
  differentOddEven: boolean,
  coverHasNoNumber = false,
  differentFirstPage = false,
): { slots: PreviewSlot[]; total: number } {
  const count = Math.max(1, Math.floor(pageCount) || 1);
  if (coverHasNoNumber && differentOddEven)
    return { slots: coverSlots(count), total: count };
  // The letterhead stays in the preview, then the first even page and the first odd page.
  if (differentFirstPage && differentOddEven) {
    const slots: PreviewSlot[] = [{ kind: "page", index: 0 }];
    if (count > 1) slots.push({ kind: "page", index: 1 });
    if (count > 2) slots.push({ kind: "page", index: 2 });
    return { slots, total: count };
  }
  if (differentOddEven) return { slots: lastParitySlots(count), total: count };
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

export type PreviewNumberCorner =
  | "top-right"
  | "top-left"
  | "bottom-center"
  | "bottom-right"
  | "bottom-left"
  | "none";

/**
 * Where the numeral is drawn on the miniature page.
 * Top right is the top-right corner. Top left is the outside edge of an even
 * page once odd and even pages are on. Center is the bottom center.
 * The glyph is the page number itself, not a caption about the corner.
 */
export function previewNumberCorner(side: PageNumberSide): PreviewNumberCorner {
  if (side === "top-right") return "top-right";
  if (side === "top-left") return "top-left";
  if (side === "center") return "bottom-center";
  if (side === "left") return "bottom-left";
  if (side === "right") return "bottom-right";
  return "none";
}

/** The numerals on the miniature sheets, in order. Skipped pages are omitted. */
export function previewSheetNumbers(
  settings: PageSettings,
  pageCount: number,
): string[] {
  const plan = previewPlan(
    pageCount,
    settings.differentOddEven,
    settings.coverHasNoNumber,
    settings.differentFirstPage,
  );
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
