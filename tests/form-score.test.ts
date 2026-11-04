import { describe, expect, it } from "vitest";
import { formScore } from "../apps/web/src/form-score";

describe("form score", () => {
  it("scores the visible questions and skips a branched question", () => {
    const questions = [
      {
        id: "size",
        points: 1,
        answer: "Large",
        branches: [{ when: "Large", next: "note" }],
      },
      { id: "beds", points: 2, answer: "North" },
      { id: "note", points: 1, answer: "Ok" },
      { id: "blank", points: 0, answer: "secret-value" },
    ];
    expect(formScore(questions, { size: "Large", beds: "secret-value", note: "Ok" })).toEqual({
      score: 2,
      possible: 2,
    });
    expect(formScore(questions, { size: "Small", beds: "West", note: "Ok" })).toEqual({
      score: 1,
      possible: 4,
    });
    expect(JSON.stringify(formScore(questions, { size: "Large", note: "Ok" }))).not.toContain("secret-value");
    expect(
      formScore(
        [
          { id: "wide", points: 1001, answer: "Yes" },
          { id: "half", points: 1.5, answer: "Yes" },
          { id: "empty", points: 1, answer: " " },
        ],
        { wide: "Yes", half: "Yes", empty: " " },
      ),
    ).toEqual({ score: 0, possible: 1 });
    expect(formScore([{ id: "missing", points: 1, answer: "Yes" }], {})).toEqual({
      score: 0,
      possible: 1,
    });
    expect(formScore([{ id: "none", points: 1 }], { none: "Yes" })).toEqual({ score: 0, possible: 1 });
  });
});
