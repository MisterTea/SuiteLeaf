/** Chromium adds a final BR to keep an empty editing line reachable. */
export function isCaretBreak(node: HTMLElement): boolean {
  return node.hasAttribute("data-slide-caret") || node.tagName === "BR" && !node.hasAttribute("data-slide-break") &&
    !node.nextSibling && ((!node.previousSibling && startsTextBlock(node.parentNode)) ||
      (node.previousSibling instanceof HTMLElement && node.previousSibling.tagName === "BR"));
}

export function startsTextBlock(node: Node | null): boolean {
  return node instanceof HTMLElement && node.matches("div, p, [data-slide-para], [data-slide-line]");
}
