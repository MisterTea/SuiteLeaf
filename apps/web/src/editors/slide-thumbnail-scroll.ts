/** Reveal a thumbnail inside its strip without moving the page or visual viewport. */
export function scrollThumbnailIntoView(
  strip: HTMLElement | null,
  thumbnail: HTMLElement | null,
) {
  if (!strip || !thumbnail) return;
  const horizontal = getComputedStyle(strip).flexDirection.startsWith("row");
  const container = strip.getBoundingClientRect();
  const item = thumbnail.getBoundingClientRect();
  const start = horizontal
    ? container.left + strip.clientLeft
    : container.top + strip.clientTop;
  const end = start + (horizontal ? strip.clientWidth : strip.clientHeight);
  const startDelta = (horizontal ? item.left : item.top) - start;
  const endDelta = (horizontal ? item.right : item.bottom) - end;
  // A thumbnail spanning the visible area is already as visible as it can be.
  if (startDelta < 0 && endDelta > 0) return;
  const delta =
    startDelta < 0
      ? Math.max(startDelta, endDelta)
      : endDelta > 0
        ? Math.min(startDelta, endDelta)
        : 0;
  if (horizontal) strip.scrollLeft += delta;
  else strip.scrollTop += delta;
}
