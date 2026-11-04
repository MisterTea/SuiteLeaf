import { describe, expect, it } from "vitest";
import { formAnswerText, formResponseRows } from "../apps/web/src/form-responses";

describe("form response export", () => {
  it("keeps the question identity and writes a formula as text", () => {
    const questions = [
      { id: "plot", version: "2" },
      { id: "secret-value", version: "1" },
    ];
    const responses = [
      { id: "r1", answers: { plot: "=1+1", "secret-value": "North" } },
      { id: "r1", answers: { plot: "again" } },
      { id: "secret-value", answers: { plot: " +beds", missing: "no" } },
    ];
    const before = JSON.stringify({ questions, responses });
    const exported = formResponseRows(questions, responses);
    expect(exported.rows).toEqual([
      ["response", "plot@2", "question 2"],
      ["r1", "'=1+1", "North"],
      ["response", "' +beds", ""],
    ]);
    expect(exported.notice).toBe("1 repeated response was kept once.");
    expect(exported.notice).not.toContain("secret-value");
    expect(JSON.stringify(exported.rows[0])).not.toContain("secret-value");
    expect(formAnswerText("@cmd")).toBe("'@cmd");
    expect(formAnswerText("-1")).toBe("'-1");
    expect(formAnswerText("North")).toBe("North");
    expect(formResponseRows([{ id: " ", version: "1" }], []).rows[0]).toEqual(["response", "question 1"]);
    expect(formResponseRows([], []).notice).toBe("Every response was exported once.");
    expect(JSON.stringify({ questions, responses })).toBe(before);
  });
});
