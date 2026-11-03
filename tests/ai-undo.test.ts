import { expect, it } from "vitest";
import { markBaseline, startRequest, undoOwnEdits } from "../apps/web/src/ai/guard";

it("undoes the assistant step and leaves the earlier edits", () => {
  startRequest("Change the harvest");
  const editor = {};
  markBaseline(editor, 2);
  const calls: number[] = [];
  expect(
    undoOwnEdits(editor, 3, () => {
      calls.push(calls.length + 1);
    }),
  ).toBe(1);
  expect(calls).toEqual([1]);
  expect(undoOwnEdits(editor, 2, () => calls.push(9))).toBe(0);
  expect(calls).toEqual([1]);
});
