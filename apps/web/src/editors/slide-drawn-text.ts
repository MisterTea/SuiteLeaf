import type { SlideElement } from "@suiteleaf/core";

/**
 * PowerPoint currency keeps its runs. Marp inline math is `$...$` on a
 * marp box, or on a plain box that has no runs of its own.
 */
export function drawnTextKind(
  el: Pick<SlideElement, "preformatted" | "math" | "marpLines" | "content" | "runs">,
): "code" | "math" | "marp" | "runs" | "rich" | "plain" {
  if (el.preformatted) return "code";
  if (el.math) return "math";
  const dollars = !!el.content?.includes("$");
  const runs = !!el.runs?.some((run) => run.text);
  if (el.marpLines && dollars) return "marp";
  if (runs) return "runs";
  if (dollars) return "rich";
  return "plain";
}
