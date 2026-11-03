import { describe, expect, it } from "vitest";
import { localSelectionMessage, remoteCaret } from "../apps/web/src/collab/selection";

describe("live carets", () => {
  it("sends a caret and ignores a message that carries the paragraph", () => {
    expect(localSelectionMessage(1, 4)).toEqual({ type: "selection", anchor: 1, head: 4 });
    expect(localSelectionMessage(-1, 4)).toBeNull();
    expect(localSelectionMessage(1.5, 4)).toBeNull();
    expect(
      remoteCaret({ type: "selection", name: "Maya", anchor: 1, head: 4 }, "Sam"),
    ).toEqual({ name: "Maya", anchor: 1, head: 4 });
    expect(
      remoteCaret(
        { type: "selection", name: "Maya", anchor: 1, head: 4, text: "Tomatoes are in" },
        "Sam",
      ),
    ).toBeNull();
    expect(remoteCaret({ type: "selection", name: "Sam", anchor: 1, head: 4 }, "Sam")).toBeNull();
  });
});
