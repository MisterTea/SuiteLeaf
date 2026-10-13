import { diffDocuments } from "./doc-diff";
import type { JsonNode } from "./index";

/** A changed top-level block the compare view can put back on its own. */
export interface ParagraphOffer {
  key: string;
  /** Short name used in the confirmation, such as "north-bed". */
  label: string;
  /** Plain text the block will have after restore. Empty when it is removed. */
  becomes: string;
  action: "replace" | "remove" | "insert";
  /** Where the block sits in the current document. Inserts go in at this index. */
  currentIndex: number;
  /** Where the block sits in the older document. Absent when the block is removed. */
  beforeIndex?: number;
}

export interface ParagraphCompare {
  content: JsonNode;
  changedParagraphs: number;
  /** Parallel to `content.content`. Null means the block matches the current document. */
  offers: (ParagraphOffer | null)[];
}

function textOf(node: JsonNode): string {
  if (node.text) return node.text;
  return (node.content ?? []).map(textOf).join("");
}

function flat(text: string) {
  const shown = text.replace(/\s+/g, " ").trim();
  return shown.length > 120 ? `${shown.slice(0, 119)}…` : shown;
}

function slug(text: string) {
  const clause = text.split(":")[0]?.trim() || text.trim();
  const words = clause.split(/\s+/).filter(Boolean).slice(0, 6).join(" ");
  const label = words
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return label || "chosen";
}

function labelFor(beforeText: string, afterText = "") {
  const left = beforeText.split(":")[0]?.trim() || beforeText.trim();
  const right = afterText.split(":")[0]?.trim() || afterText.trim();
  const chosen =
    left && right && left.toLowerCase() === right.toLowerCase()
      ? left
      : left || right;
  return slug(chosen);
}

function lcs<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): [number, number][] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = eq(a[i], b[j])
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (eq(a[i], b[j])) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

/**
 * One slot per block `diffDocuments` draws. The walk matches that function:
 * equal blocks stay unmarked, and a gap pairs blocks in order.
 */
function offerSlots(before: JsonNode, after: JsonNode): (ParagraphOffer | null)[] {
  const base = before.content ?? [];
  const next = after.content ?? [];
  const same = (a: JsonNode, b: JsonNode) =>
    a.type === b.type && textOf(a) === textOf(b);
  const pairs = lcs(base, next, same);
  const offers: (ParagraphOffer | null)[] = [];
  let i = 0;
  let j = 0;
  const flush = (bi: number, bj: number) => {
    const left = base.slice(i, bi);
    const right = next.slice(j, bj);
    const paired = Math.min(left.length, right.length);
    for (let k = 0; k < paired; k++) {
      const beforeIndex = i + k;
      const currentIndex = j + k;
      if (left[k].type === right[k].type) {
        const beforeText = textOf(left[k]);
        offers.push({
          key: `replace:${beforeIndex}`,
          label: labelFor(beforeText, textOf(right[k])),
          becomes: flat(beforeText),
          action: "replace",
          currentIndex,
          beforeIndex,
        });
      } else {
        offers.push(
          {
            key: `insert:${beforeIndex}`,
            label: labelFor(textOf(left[k])),
            becomes: flat(textOf(left[k])),
            action: "insert",
            currentIndex,
            beforeIndex,
          },
          {
            key: `remove:${currentIndex}`,
            label: labelFor(textOf(right[k])),
            becomes: "",
            action: "remove",
            currentIndex,
          },
        );
      }
    }
    for (let k = paired; k < left.length; k++) {
      const beforeIndex = i + k;
      offers.push({
        key: `insert:${beforeIndex}`,
        label: labelFor(textOf(left[k])),
        becomes: flat(textOf(left[k])),
        action: "insert",
        currentIndex: j + paired,
        beforeIndex,
      });
    }
    for (let k = paired; k < right.length; k++) {
      const currentIndex = j + k;
      offers.push({
        key: `remove:${currentIndex}`,
        label: labelFor(textOf(right[k])),
        becomes: "",
        action: "remove",
        currentIndex,
      });
    }
    i = bi;
    j = bj;
  };
  for (const [bi, bj] of pairs) {
    flush(bi, bj);
    offers.push(null);
    i = bi + 1;
    j = bj + 1;
  }
  flush(base.length, next.length);
  return offers;
}

/** Compare an older document with the current one, and mark which blocks can be restored. */
export function compareParagraphs(before: JsonNode, after: JsonNode): ParagraphCompare {
  const diff = diffDocuments(before, after);
  const offers = offerSlots(before, after);
  if ((diff.content.content ?? []).length !== offers.length)
    throw new Error("Paragraph restore fell out of step with the compare view.");
  return {
    content: diff.content,
    changedParagraphs: diff.changedParagraphs,
    offers,
  };
}

/**
 * Put one older block back into `current`. Every other block is the current
 * document's own node, marks included.
 */
export function applyParagraphRestore(
  current: JsonNode,
  before: JsonNode,
  key: string,
): JsonNode {
  const offer = offerSlots(before, current).find((item) => item?.key === key);
  if (!offer) throw new Error("That paragraph matches the current document.");
  const blocks = (current.content ?? []).map((block) => structuredClone(block));
  const older = before.content ?? [];
  if (offer.action === "remove") {
    blocks.splice(offer.currentIndex, 1);
  } else {
    const source = older[offer.beforeIndex ?? -1];
    if (!source) throw new Error("That paragraph is not in the chosen version.");
    const copy = structuredClone(source);
    if (offer.action === "replace") blocks[offer.currentIndex] = copy;
    else blocks.splice(offer.currentIndex, 0, copy);
  }
  return { ...current, content: blocks };
}

/** Shown before the button, so the click that restores is the confirmation. */
export function paragraphRestorePrompt(
  offer: Pick<ParagraphOffer, "label" | "becomes" | "action">,
  source: string,
) {
  const lead = `Restore the ${offer.label} paragraph from ${source}?`;
  const effect =
    offer.action === "remove"
      ? "It is removed."
      : `It becomes "${offer.becomes}".`;
  return `${lead} ${effect} The rest of the document stays as it is.`;
}
