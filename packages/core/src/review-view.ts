/**
 * Original shows the baseline. Final shows the current combined document.
 * Markup marks each block that differs. The documents passed in are not changed.
 */

import type { JsonNode } from "./index";

export type ReviewViewMode = "original" | "final" | "markup";

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** The document for one review view. */
export function reviewView(base: JsonNode, current: JsonNode, mode: ReviewViewMode): JsonNode | { reason: string } {
  if (base.type !== "doc" || current.type !== "doc") return { reason: "Selective review applies to a document." };
  if (mode === "original") return structuredClone(base);
  if (mode === "final") return structuredClone(current);
  const baseBlocks = base.content ?? [];
  const currentBlocks = current.content ?? [];
  const count = Math.max(baseBlocks.length, currentBlocks.length);
  const content: JsonNode[] = [];
  for (let index = 0; index < count; index += 1) {
    const before = baseBlocks[index];
    const after = currentBlocks[index];
    if (!after) {
      if (before) content.push({ type: before.type, attrs: { reviewMark: "removed" } });
      continue;
    }
    const copy = structuredClone(after);
    if (!same(before, after)) copy.attrs = { ...copy.attrs, reviewMark: "changed" };
    content.push(copy);
  }
  return { ...structuredClone(current), content };
}
