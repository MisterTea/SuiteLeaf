import { describe, expect, it } from "vitest";
import { visibleQuestionIds, type BranchQuestion } from "../apps/web/src/form-branch";

describe("form branching", () => {
  it("skips questions until the named later question", () => {
    const questions = [
      { id: "size", branches: [{ when: "Large", next: "note" }, { when: "secret-value", next: "size" }] },
      { id: "beds" },
      { id: "note" },
    ];
    expect(visibleQuestionIds(questions, { size: "Large" })).toEqual(["size", "note"]);
    expect(visibleQuestionIds(questions, { size: "Small" })).toEqual(["size", "beds", "note"]);
    expect(visibleQuestionIds(questions, { size: "secret-value" })).toEqual(["size", "beds", "note"]);
    expect(visibleQuestionIds(questions, {})).toEqual(["size", "beds", "note"]);
    expect(
      visibleQuestionIds([{ id: "size" }, undefined as unknown as BranchQuestion], {}),
    ).toEqual(["size"]);
  });
});
