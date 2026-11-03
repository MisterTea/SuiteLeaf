/** The address of one slide, so a reload opens that slide again. */
export function presentationSlidePath(fileId: string, slideId: string): string {
  return `/file/${encodeURIComponent(fileId)}/${encodeURIComponent(slideId)}`;
}

/** The slide named in the address, or the first slide when the address has none. */
export function slideAtAddress(order: readonly string[], slideId: string | undefined): string {
  if (slideId && order.includes(slideId)) return slideId;
  return order[0] ?? "";
}
