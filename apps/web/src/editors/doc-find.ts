export type Box = { left: number; top: number; right: number; bottom: number };
export type Point = { left: number; top: number };

const edge = 8;

/**
 * Where to move a floating dialog so it no longer covers `target` (the current
 * match), like Word's Find and Replace stepping aside. Prefers the nearest
 * spot above or below, then beside; null when it already clears or can't.
 */
export function positionClearOf(
  dialog: Box,
  target: Box,
  view: { width: number; height: number },
  gap = 16,
): Point | null {
  const covers =
    target.left - gap < dialog.right &&
    target.right + gap > dialog.left &&
    target.top - gap < dialog.bottom &&
    target.bottom + gap > dialog.top;
  if (!covers) return null;
  const width = dialog.right - dialog.left,
    height = dialog.bottom - dialog.top;
  const vertical = [target.bottom + gap, target.top - gap - height]
    .filter((top) => top >= edge && top + height <= view.height - edge)
    .sort((a, b) => Math.abs(a - dialog.top) - Math.abs(b - dialog.top));
  if (vertical.length) return { left: dialog.left, top: vertical[0] };
  const beside = [target.left - gap - width, target.right + gap].find(
    (left) => left >= edge && left + width <= view.width - edge,
  );
  return beside === undefined ? null : { left: beside, top: dialog.top };
}

/** Keep a dragged dialog's top-left corner inside the window. */
export function clampToView(
  point: Point,
  size: { width: number; height: number },
  view: { width: number; height: number },
): Point {
  return {
    left: Math.min(Math.max(point.left, edge), view.width - size.width - edge),
    top: Math.min(Math.max(point.top, edge), view.height - size.height - edge),
  };
}

/** The Find field's counter: "2 of 3", "3 results" between matches, or "No results". */
export function matchCounter(query: string, total: number, current: number) {
  if (!query) return "";
  if (!total) return "No results";
  if (current < 0) return total === 1 ? "1 result" : `${total} results`;
  return `${current + 1} of ${total}`;
}
