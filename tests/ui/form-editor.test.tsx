// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFile, type FormFile } from "../../packages/core/src";
import FormEditor from "../../apps/web/src/editors/Form";
import type { EditorActions } from "../../apps/web/src/ui";

afterEach(cleanup);

type Content = FormFile["content"];
type Question = Content["questions"][number];

function formFile(questions: Question[] = [], extra: Partial<Content> = {}): FormFile {
  const file = createFile("form", "Sign-up") as FormFile;
  return { ...file, content: { ...file.content, questions, responses: [], ...extra } };
}

const q = (id: string, prompt: string, kind: Question["kind"], extra: Partial<Question> = {}): Question => ({
  id,
  prompt,
  kind,
  required: false,
  ...extra,
});

function openForm(file: FormFile, props: Partial<Parameters<typeof FormEditor>[0]> = {}) {
  const onChange = vi.fn<(content: Content) => void>();
  let actions: EditorActions | null = null;
  const view = render(
    <FormEditor
      file={file}
      onChange={onChange}
      onActions={(next) => {
        actions = next;
      }}
      onError={() => {}}
      {...props}
    />,
  );
  return { ...view, onChange, actions: () => actions!, latest: () => onChange.mock.lastCall![0] };
}

const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));

describe("writing the questions", () => {
  it("adds a question, names it, and changes its answer type", () => {
    const { onChange, latest } = openForm(formFile());
    expect(screen.getByText("Add a question to start the sign-up.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add question" }));
    fireEvent.change(screen.getByLabelText("Question"), { target: { value: "Your name" } });
    fireEvent.click(screen.getByLabelText("Required"));
    expect(latest().questions[0]).toMatchObject({ prompt: "Your name", kind: "text", required: true });

    fireEvent.change(screen.getByLabelText("Answer type for question 1"), { target: { value: "choice" } });
    expect(latest().questions[0].choices).toEqual([""]);
    fireEvent.change(screen.getByLabelText("Choice"), { target: { value: "North" } });
    fireEvent.click(screen.getByRole("button", { name: "Add choice" }));
    fireEvent.change(screen.getAllByLabelText("Choice")[1], { target: { value: "South" } });
    expect(latest().questions[0].choices).toEqual(["North", "South"]);

    fireEvent.change(screen.getByLabelText("Answer type for question 1"), { target: { value: "grid" } });
    expect(latest().questions[0]).toMatchObject({ choices: undefined, rows: ["", ""], columns: ["", ""] });
    fireEvent.change(screen.getAllByLabelText("Row")[0], { target: { value: "Mon" } });
    fireEvent.click(screen.getByRole("button", { name: "Add row" }));
    fireEvent.change(screen.getAllByLabelText("Column")[1], { target: { value: "PM" } });
    fireEvent.click(screen.getByRole("button", { name: "Add column" }));
    expect(latest().questions[0]).toMatchObject({ rows: ["Mon", "", ""], columns: ["", "PM", ""] });

    fireEvent.change(screen.getByLabelText("Answer type for question 1"), { target: { value: "unknown" } });
    expect(latest().questions[0].kind).toBe("text");
    expect(onChange).toHaveBeenCalled();
  });

  it("keeps the questions read-only for a viewer", () => {
    openForm(formFile([q("a", "Plot", "choice", { choices: ["North"] }), q("b", "Days", "grid", { rows: ["Mon"], columns: ["AM"] })]), { readOnly: true });
    expect(screen.queryByRole("button", { name: "Add question" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add choice" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add row" })).toBeNull();
    expect(screen.getAllByLabelText("Question")[0]).toHaveProperty("disabled", true);
    tab("Add a response");
    expect(screen.queryByRole("button", { name: "Submit response" })).toBeNull();
  });

  it("offers print and refuses a plain export", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    const { actions } = openForm(formFile());
    await actions().print();
    expect(print).toHaveBeenCalled();
    await expect(actions().export("pdf")).rejects.toThrow("Download the SuiteLeaf file to keep this form.");
    await expect(actions().flush()).resolves.toBeUndefined();
    print.mockRestore();
  });

  it("takes in changes made to the file elsewhere", () => {
    const file = formFile([q("a", "Old", "text")]);
    const { rerender } = openForm(file);
    const next = formFile([q("a", "New", "text")]);
    rerender(<FormEditor file={{ ...file, content: next.content }} onChange={() => {}} onActions={() => {}} onError={() => {}} />);
    expect(screen.getByLabelText("Question")).toHaveProperty("value", "New");
  });
});

describe("collecting a response", () => {
  const all = () =>
    formFile([
      q("name", "Name", "text", { required: true }),
      q("plot", "Plot", "choice", { choices: ["North", " ", "South"], required: true }),
      q("days", "Days", "grid", { rows: ["Mon", "Tue"], columns: ["AM", "PM"], required: true }),
      q("score", "Score", "rating"),
      q("beds", "Beds", "number", { min: 1, max: 4, required: true }),
      q("photo", "Photo", "file"),
    ]);

  it("checks each answer, saves the response, and lists it", () => {
    const { latest } = openForm(all());
    tab("Add a response");
    const submit = () => fireEvent.click(screen.getByRole("button", { name: "Submit response" }));
    const alert = () => screen.getByRole("alert").textContent;

    submit();
    expect(alert()).toBe("Name is required");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  Rosa  " } });
    submit();
    expect(alert()).toBe("Plot is required");
    const plot = screen.getByRole("radiogroup", { name: "Plot" });
    expect(within(plot).getAllByRole("radio")).toHaveLength(2);
    fireEvent.click(within(plot).getByLabelText("South"));
    submit();
    expect(alert()).toBe("Days is required");
    fireEvent.click(screen.getByLabelText("Mon AM"));
    fireEvent.click(screen.getByLabelText("Tue PM"));
    submit();
    expect(alert()).toBe("Beds is required");
    fireEvent.change(screen.getByLabelText("Beds"), { target: { value: "9" } });
    submit();
    expect(alert()).toBe("That number is outside the range.");
    fireEvent.change(screen.getByLabelText("Beds"), { target: { value: "3" } });
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Score" })).getByLabelText("4"));

    const photo = screen.getByLabelText("Photo");
    fireEvent.change(photo, { target: { files: [new File(["x"], "secret.txt")] } });
    expect(alert()).toBe("That file is not an allowed upload.");
    fireEvent.change(photo, { target: { files: [new File(["abc"], "bed.png")] } });
    expect(screen.queryByRole("alert")).toBeNull();
    submit();

    const saved = latest().responses;
    expect(saved).toHaveLength(1);
    expect(saved[0].answers).toEqual({
      name: "Rosa",
      plot: "South",
      days: expect.stringContaining("Mon"),
      score: "4",
      beds: "3",
      photo: "bed.png|3",
    });
    expect(screen.getByLabelText("Name")).toHaveProperty("value", "");

    tab("Responses");
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Name",
      "Plot",
      "Days",
      "Score",
      "Beds",
      "Photo",
    ]);
    expect(table.textContent).toContain("bed.png (3 bytes)");
    expect(table.textContent).not.toContain("bed.png|3");
    expect(table.textContent).toContain("Mon: AM");
  });

  it("clears a file that was taken out of the picker", () => {
    const { latest } = openForm(formFile([q("photo", "Photo", "file")]));
    tab("Add a response");
    const photo = screen.getByLabelText("Photo");
    fireEvent.change(photo, { target: { files: [new File(["abc"], "bed.png")] } });
    fireEvent.change(photo, { target: { files: [] } });
    fireEvent.click(screen.getByRole("button", { name: "Submit response" }));
    expect(latest().responses[0].answers).toEqual({});
  });

  it("rejects an answer that is not one of the choices or columns", () => {
    openForm(formFile([q("n", "", "number"), q("g", "Days", "grid", { rows: ["Mon"], columns: ["AM"] })]));
    tab("Add a response");
    fireEvent.change(screen.getByLabelText("Number"), { target: { value: "lots" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit response" }));
    expect(screen.getByRole("alert").textContent).toBe("Enter a number.");
    expect(screen.getByText("Untitled question")).toBeTruthy();
  });

  it("skips questions a branch jumps over", () => {
    const { latest } = openForm(
      formFile([
        q("come", "Coming?", "choice", { choices: ["Yes", "No"], branches: [{ when: "No", next: "end" }] }),
        q("food", "Food", "text", { required: true }),
        q("end", "Anything else", "text"),
      ]),
    );
    tab("Add a response");
    expect(screen.getByLabelText("Food")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("No"));
    expect(screen.queryByLabelText("Food")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Submit response" }));
    expect(latest().responses[0].answers).toEqual({ come: "No" });
  });

  it("refuses responses once the form is closed or past its deadline", () => {
    const { unmount } = openForm(formFile([q("a", "Name", "text")], { accepting: false }));
    tab("Add a response");
    fireEvent.click(screen.getByRole("button", { name: "Submit response" }));
    expect(screen.getByRole("alert").textContent).toBe("This form is not taking more responses.");
    unmount();
    openForm(formFile([q("a", "Name", "text")], { deadline: "2000-01-01T00:00:00Z" }));
    tab("Add a response");
    fireEvent.click(screen.getByRole("button", { name: "Submit response" }));
    expect(screen.getByRole("alert").textContent).toBe("The deadline for this form has passed.");
    tab("Questions");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("lets a responder add an answer without seeing the questions or other answers", () => {
    const file = formFile([q("a", "Name", "text")]);
    file.content.responses = [{ id: "old", at: "2026-01-01T00:00:00Z", answers: { a: "Ada" } }];
    const { latest } = openForm(file, { respondOnly: true, readOnly: true, canSubmit: true });
    expect(screen.getAllByRole("tab").map((item) => item.textContent)).toEqual(["Add a response"]);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Rosa" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit response" }));
    expect(latest().responses.map((response) => response.answers.a)).toEqual(["Ada", "Rosa"]);
    expect(latest().questions).toEqual(file.content.questions);
  });

  it("explains an empty form and an empty response list", () => {
    openForm(formFile());
    tab("Add a response");
    expect(screen.getByText("Add a question before collecting answers.")).toBeTruthy();
    tab("Responses");
    expect(screen.getByText("No one has signed up yet.")).toBeTruthy();
  });
});
