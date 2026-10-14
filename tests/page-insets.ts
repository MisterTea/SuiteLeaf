import type { Page } from "@playwright/test";

/** The document page's four insets, in inches. One inch is 96 CSS pixels. */
export async function pageEdgeInsets(page: Page) {
  return page.evaluate(() => {
    const content = document.querySelector(
      ".paginated-paper .document-content",
    ) as HTMLElement | null;
    if (!content) throw new Error("The page is not on screen.");
    const style = getComputedStyle(content);
    const inches = (value: string) => (parseFloat(value) || 0) / 96;
    return {
      left: inches(style.paddingLeft),
      right: inches(style.paddingRight),
      top: inches(style.paddingTop),
      bottom: inches(style.paddingBottom),
    };
  });
}
