/** A selection the merge button can read. Univer ranges expose `isMerged()`. */
export type MergeSelection = {
  isMerged(): boolean;
};

/** The same range object `mergeCells` already uses. Unmerge is `breakApart`. */
export type MergeRange = MergeSelection & {
  merge(): void;
  breakApart(): void;
};

/**
 * The one toolbar button reads Unmerge only when the selection is exactly
 * one merged range. Every other selection still reads Merge cells.
 */
export function mergeButtonLabel(
  ranges: readonly MergeSelection[],
): "Merge cells" | "Unmerge" {
  return ranges.length === 1 && ranges[0].isMerged()
    ? "Unmerge"
    : "Merge cells";
}

/**
 * One click. A single merged range is broken apart; anything else merges
 * the active range through the same `merge()` call as before.
 */
export function applyMergeButton(
  ranges: readonly MergeRange[],
  active: MergeRange | null,
): void {
  if (mergeButtonLabel(ranges) === "Unmerge") {
    ranges[0].breakApart();
    return;
  }
  active?.merge();
}
