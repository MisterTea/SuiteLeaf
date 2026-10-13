import { expect, test } from "vitest";
import {
  applyMergeButton,
  mergeButtonLabel,
  type MergeRange,
} from "../apps/web/src/editors/sheet-merge";

function range(merged: boolean): MergeRange & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    isMerged: () => merged,
    merge: () => calls.push("merge"),
    breakApart: () => calls.push("breakApart"),
  };
}

test("the merge button reads Unmerge only for one merged range", () => {
  expect(mergeButtonLabel([])).toBe("Merge cells");
  expect(mergeButtonLabel([range(false)])).toBe("Merge cells");
  expect(mergeButtonLabel([range(true)])).toBe("Unmerge");
  expect(mergeButtonLabel([range(true), range(false)])).toBe("Merge cells");
});

test("unmerge calls breakApart and a plain range still merges", () => {
  const merged = range(true);
  applyMergeButton([merged], merged);
  expect(merged.calls).toEqual(["breakApart"]);

  const open = range(false);
  applyMergeButton([open], open);
  expect(open.calls).toEqual(["merge"]);

  const first = range(true);
  const second = range(false);
  applyMergeButton([first, second], second);
  expect(first.calls).toEqual([]);
  expect(second.calls).toEqual(["merge"]);
});
