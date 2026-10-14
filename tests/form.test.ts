import { describe, expect, it } from "vitest";
import { createFile, parseFile, serializeFile } from "@suiteleaf/core";

describe("forms", () => {
  it("round-trips an empty form and keeps choice answers", () => {
    const file = createFile("form", "Plot sign-ups");
    expect(file.kind).toBe("form");
    if (file.kind !== "form") return;
    file.content = {
      questions: [
        { id: "name", prompt: "Your name", kind: "text", required: true },
        {
          id: "plot",
          prompt: "Plot size",
          kind: "choice",
          required: true,
          choices: ["Small", "Medium", "Large"],
        },
      ],
      responses: [
        {
          id: "r1",
          at: "2026-10-14T15:00:00.000Z",
          answers: { name: "Rosa", plot: "Medium" },
        },
      ],
    };
    const again = parseFile(serializeFile(file));
    expect(again.kind).toBe("form");
    if (again.kind !== "form") return;
    expect(again.content.responses[0].answers.plot).toBe("Medium");
    expect(again.content.questions.map((q) => q.prompt)).toEqual([
      "Your name",
      "Plot size",
    ]);
  });

  it("rejects a document saved as a form", () => {
    const doc = createFile("doc", "Notes");
    expect(() => parseFile(serializeFile(doc), "form")).toThrow(/not a form/);
  });
});
