import { describe, expect, it } from "vitest";
import { createFile, parseFile, serializeFile } from "@suiteleaf/core";
import {
  canonicalGridAnswer,
  filledLabels,
  formatGridAnswer,
  gridAnswerError,
} from "../apps/web/src/form-grid";
import { choiceAnswerError, listedChoice } from "../apps/web/src/form-choice";
import { appendFormResponse, keepFormQuestions } from "../apps/web/src/form-submit";

describe("forms", () => {
  it("keeps the questions when a response includes another field", () => {
    const questions = [{ id: "plot", prompt: "Plot" }];
    const stored = keepFormQuestions(questions, [], {
      id: "r2",
      answers: { plot: "North", extra: "secret-value" },
    });
    expect(stored.questions).toEqual(questions);
    expect(stored.responses).toEqual([{ id: "r2", answers: { plot: "North" } }]);
    expect(JSON.stringify(stored)).not.toContain("secret-value");
    expect(questions[0].prompt).toBe("Plot");
  });

  it("appends a response and keeps the other form fields", () => {
    const content = {
      title: "Beds",
      questions: [{ id: "plot", prompt: "Plot" }],
      responses: [{ id: "r1", answers: { plot: "North" } }],
      note: "Water the beds",
    };
    const next = appendFormResponse(content, {
      id: "r2",
      answers: { plot: "West", extra: "secret-value" },
    });
    expect(next.title).toBe("Beds");
    expect(next.note).toBe("Water the beds");
    expect(next.questions).toEqual(content.questions);
    expect(next.responses.map((response) => response.answers.plot)).toEqual(["North", "West"]);
    expect(next.responses[1].answers).toEqual({ plot: "West" });
    expect(JSON.stringify(next.responses)).not.toContain("secret-value");
    expect(content.responses).toHaveLength(1);
  });

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

  it("round-trips a rating and still opens a form that has none", () => {
    const file = createFile("form", "Talk feedback");
    expect(file.kind).toBe("form");
    if (file.kind !== "form") return;
    file.content = {
      questions: [
        {
          id: "talk",
          prompt: "How was the talk?",
          kind: "rating",
          required: true,
        },
      ],
      responses: [
        {
          id: "r1",
          at: "2026-10-17T12:00:00.000Z",
          answers: { talk: "4" },
        },
      ],
    };
    const again = parseFile(serializeFile(file));
    expect(again.kind).toBe("form");
    if (again.kind !== "form") return;
    expect(again.content.questions[0]).toMatchObject({
      prompt: "How was the talk?",
      kind: "rating",
      required: true,
    });
    expect(again.content.responses[0].answers.talk).toBe("4");

    const older = createFile("form", "Plot sign-ups");
    if (older.kind !== "form") return;
    older.content = {
      questions: [{ id: "name", prompt: "Your name", kind: "text", required: true }],
      responses: [],
    };
    const opened = parseFile(serializeFile(older));
    expect(opened.kind).toBe("form");
    if (opened.kind !== "form") return;
    expect(opened.content.questions[0].kind).toBe("text");
  });

  it("round-trips a grid and still opens a form that has none", () => {
    const file = createFile("form", "Day grid");
    expect(file.kind).toBe("form");
    if (file.kind !== "form") return;
    const stored = JSON.stringify({ Mon: "Yes", Tue: "No" });
    file.content = {
      questions: [
        { id: "name", prompt: "Your name", kind: "text", required: true },
        {
          id: "days",
          prompt: "Which days?",
          kind: "grid",
          required: true,
          rows: ["Mon", "Tue"],
          columns: ["Yes", "No"],
        },
        {
          id: "plot",
          prompt: "Plot size",
          kind: "choice",
          required: false,
          choices: ["Small", "Large"],
        },
        { id: "talk", prompt: "How was the talk?", kind: "rating", required: false },
      ],
      responses: [
        {
          id: "r1",
          at: "2026-10-17T12:00:00.000Z",
          answers: { name: "Rosa", days: stored, plot: "Large", talk: "4" },
        },
      ],
    };
    const again = parseFile(serializeFile(file));
    expect(again.kind).toBe("form");
    if (again.kind !== "form") return;
    expect(again.content.questions.map((q) => q.kind)).toEqual([
      "text",
      "grid",
      "choice",
      "rating",
    ]);
    expect(again.content.questions[1]).toMatchObject({
      prompt: "Which days?",
      kind: "grid",
      required: true,
      rows: ["Mon", "Tue"],
      columns: ["Yes", "No"],
    });
    expect(again.content.responses[0].answers).toEqual({
      name: "Rosa",
      days: stored,
      plot: "Large",
      talk: "4",
    });

    const older = createFile("form", "Plot sign-ups");
    if (older.kind !== "form") return;
    older.content = {
      questions: [{ id: "name", prompt: "Your name", kind: "text", required: true }],
      responses: [],
    };
    const opened = parseFile(serializeFile(older));
    expect(opened.kind).toBe("form");
    if (opened.kind !== "form") return;
    expect(opened.content.questions[0].kind).toBe("text");
    expect(opened.content.questions[0].rows).toBeUndefined();
    expect(opened.content.questions[0].columns).toBeUndefined();
  });

  it("requires every grid row and prints one line per row", () => {
    const rows = ["Mon", "Tue"];
    const columns = ["Yes", "No"];
    expect(gridAnswerError("Which days?", true, rows, columns, "")).toBe(
      "Which days? is required",
    );
    expect(
      gridAnswerError("Which days?", true, rows, columns, JSON.stringify({ Mon: "Yes" })),
    ).toBe("Which days? is required");
    const stored = JSON.stringify({ Tue: "No", Mon: "Yes" });
    expect(gridAnswerError("Which days?", true, rows, columns, stored)).toBeNull();
    expect(formatGridAnswer(rows, stored)).toBe("Mon: Yes\nTue: No");
    expect(canonicalGridAnswer(rows, columns, stored)).toBe(
      JSON.stringify({ Mon: "Yes", Tue: "No" }),
    );
    expect(
      gridAnswerError(
        "Which days?",
        true,
        rows,
        columns,
        JSON.stringify({ Mon: "Maybe", Tue: "No" }),
      ),
    ).toBe("Which days? must be one of the columns");
    expect(gridAnswerError("Which days?", false, rows, columns, "")).toBeNull();
    expect(
      gridAnswerError("Which days?", false, rows, columns, JSON.stringify({ Mon: "Yes" })),
    ).toBeNull();
  });

  it("rejects a document saved as a form", () => {
    const doc = createFile("doc", "Notes");
    expect(() => parseFile(serializeFile(doc), "form")).toThrow(/not a form/);
  });

  it("round-trips a grid answer longer than a text answer", () => {
    const file = createFile("form", "Day grid");
    expect(file.kind).toBe("form");
    if (file.kind !== "form") return;
    const column = "c".repeat(80);
    const rows = Array.from({ length: 20 }, (_, index) => {
      const mark = String(index).padStart(2, "0");
      return `${mark}${"r".repeat(78)}`;
    });
    const selected: Record<string, string> = {};
    for (const row of rows) selected[row] = column;
    const stored = JSON.stringify(selected);
    expect(stored.length).toBeGreaterThan(2000);
    file.content = {
      questions: [
        {
          id: "days",
          prompt: "Which days?",
          kind: "grid",
          required: true,
          rows,
          columns: [column],
        },
      ],
      responses: [
        {
          id: "r1",
          at: "2026-10-17T12:00:00.000Z",
          answers: { days: stored },
        },
      ],
    };
    const again = parseFile(serializeFile(file));
    expect(again.kind).toBe("form");
    if (again.kind !== "form") return;
    expect(again.content.responses[0].answers.days).toBe(stored);

    const names = createFile("form", "Names");
    if (names.kind !== "form") return;
    names.content = {
      questions: [{ id: "name", prompt: "Your name", kind: "text", required: true }],
      responses: [
        {
          id: "r1",
          at: "2026-10-17T12:00:00.000Z",
          answers: { name: "n".repeat(2001) },
        },
      ],
    };
    expect(() => serializeFile(names)).toThrow();
    names.content.responses[0].answers.name = stored;
    expect(() => serializeFile(names)).toThrow();

    const over = { ...selected, [rows[0]]: `${column}x` };
    file.content.responses[0].answers.days = JSON.stringify(over);
    expect(() => serializeFile(file)).toThrow();
    file.content.responses[0].answers.days = `${stored}${" ".repeat(40_000)}`;
    expect(() => serializeFile(file)).toThrow();
  });

  it("keeps a listed choice after trimming and refuses another answer", () => {
    const choices = [" Beds ", "Paths"];
    expect(listedChoice(choices, " Beds ")).toBe("Beds");
    expect(listedChoice(choices, "secret-value")).toBeNull();
    expect(choiceAnswerError("Plot size", true, choices, "secret-value")).toBe(
      "Plot size must be one of the choices",
    );
    expect(choiceAnswerError("Plot size", true, choices, " Beds ")).toBeNull();
    expect(choiceAnswerError("Plot size", true, choices, "secret-value")).not.toContain(
      "secret-value",
    );
    expect(choices[0]).toBe(" Beds ");
  });

  it("keeps a listed grid column after trimming and refuses another answer", () => {
    const rows = [" Mon "];
    const columns = [" Yes "];
    const value = JSON.stringify({ " Mon ": " Yes " });
    expect(gridAnswerError("Which days?", true, filledLabels(rows), filledLabels(columns), value)).toBeNull();
    expect(canonicalGridAnswer(filledLabels(rows), filledLabels(columns), value)).toBe(
      JSON.stringify({ Mon: "Yes" }),
    );
    const refused = gridAnswerError(
      "Which days?",
      true,
      filledLabels(rows),
      filledLabels(columns),
      JSON.stringify({ Mon: "secret-value" }),
    );
    expect(refused).toBe("Which days? must be one of the columns");
    expect(refused).not.toContain("secret-value");
    expect(rows[0]).toBe(" Mon ");
    expect(columns[0]).toBe(" Yes ");
  });
});
