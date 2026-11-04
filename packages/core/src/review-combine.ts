/**
 * Combine two reviewers' copies of a document against a shared baseline.
 * An edit that only one reviewer made is kept. An edit both reviewers made
 * differently stays as the baseline and is listed as a decision.
 * The copies passed in are not changed. The decision does not copy block text.
 */

import type { JsonNode } from "./index";

export type ReviewCopy = { reviewer: string; doc: JsonNode };

export type ReviewDecision = { block: number; note: string };

export type ReviewCombine = {
  kept: { left: JsonNode; right: JsonNode };
  merged?: JsonNode;
  decisions: ReviewDecision[];
  reason?: string;
};

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function reviewerLabel(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || /secret|password|token|api[_-]?key/i.test(trimmed)) return "a reviewer";
  return trimmed;
}

/** Use one reviewer's text for a block that still needs a choice. Other blocks stay combined. */
export function applyReviewChoice(
  base: JsonNode,
  left: ReviewCopy,
  right: ReviewCopy,
  block: number,
  side: "left" | "right",
): ReviewCombine {
  if (!Number.isInteger(block) || block < 1) {
    const kept = { left: structuredClone(left.doc), right: structuredClone(right.doc) };
    return { kept, decisions: [], reason: "Name a block number." };
  }
  return reviewCombine(base, left, right, [{ block, side }]);
}

/** Drop the latest choice and combine again. Earlier choices stay. */
export function undoReviewChoice(
  base: JsonNode,
  left: ReviewCopy,
  right: ReviewCopy,
  choices: { block: number; side: "left" | "right" }[],
): ReviewCombine {
  if (choices.length === 0) {
    const combined = reviewCombine(base, left, right);
    return { ...combined, reason: combined.reason ?? "There is no choice to undo." };
  }
  return reviewCombine(base, left, right, choices.slice(0, -1));
}

/** Block numbers start at 1. A disputed block stays at the baseline. */
export function reviewCombine(
  base: JsonNode,
  left: ReviewCopy,
  right: ReviewCopy,
  choices?: { block: number; side: "left" | "right" }[],
): ReviewCombine {
  const kept = { left: structuredClone(left.doc), right: structuredClone(right.doc) };
  if (base.type !== "doc" || left.doc.type !== "doc" || right.doc.type !== "doc") {
    return { kept, decisions: [], reason: "Selective review applies to a document." };
  }
  const baseBlocks = base.content ?? [];
  const leftBlocks = left.doc.content ?? [];
  const rightBlocks = right.doc.content ?? [];
  const count = Math.max(baseBlocks.length, leftBlocks.length, rightBlocks.length);
  const merged: JsonNode[] = [];
  const decisions: ReviewDecision[] = [];
  const leftName = reviewerLabel(left.reviewer);
  const rightName = reviewerLabel(right.reviewer);
  let applied = 0;
  for (let index = 0; index < count; index += 1) {
    const baseBlock = baseBlocks[index];
    const leftBlock = leftBlocks[index];
    const rightBlock = rightBlocks[index];
    const leftSame = same(leftBlock, baseBlock);
    const rightSame = same(rightBlock, baseBlock);
    if (leftSame && rightSame) {
      if (baseBlock) merged.push(structuredClone(baseBlock));
      continue;
    }
    if (rightSame) {
      if (leftBlock) merged.push(structuredClone(leftBlock));
      continue;
    }
    if (leftSame) {
      if (rightBlock) merged.push(structuredClone(rightBlock));
      continue;
    }
    if (same(leftBlock, rightBlock)) {
      if (leftBlock) merged.push(structuredClone(leftBlock));
      continue;
    }
    const block = index + 1;
    const picked = choices?.find((item) => item.block === block);
    if (picked) {
      const chosen = picked.side === "left" ? leftBlock : rightBlock;
      if (chosen) merged.push(structuredClone(chosen));
      applied += 1;
      continue;
    }
    if (baseBlock) merged.push(structuredClone(baseBlock));
    decisions.push({
      block,
      note:
        leftName === rightName
          ? `Block ${block} needs a choice.`
          : `Block ${block} needs a choice. ${leftName} and ${rightName} both changed it.`,
    });
  }
  const reason = choices && applied !== choices.length ? "That block does not need a choice." : undefined;
  return { kept, merged: { ...structuredClone(base), content: merged }, decisions, reason };
}
