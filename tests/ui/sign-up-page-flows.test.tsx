// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicForm, PublicQuestion } from "../../apps/web/src/node-sign-up";
import SignUpPage from "../../apps/web/src/sign-up";

const question = (id: string, kind: PublicQuestion["kind"], extra: Partial<PublicQuestion> = {}): PublicQuestion => ({
  id,
  prompt: id,
  kind,
  required: false,
  ...extra,
});

let form: PublicForm | null;
let posts: { url: string; body: { answers: Record<string, string> } }[];
let reply: () => Response;

beforeEach(() => {
  posts = [];
  reply = () => new Response(null, { status: 204 });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push({ url, body: JSON.parse(String(init.body)) });
        return reply();
      }
      return form ? Response.json(form) : new Response("", { status: 404 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const open = async (next: PublicForm | null, token = "tok/1") => {
  form = next;
  render(<SignUpPage token={token} />);
  if (next) await screen.findByRole("heading", { name: next.title });
};
const submit = () => userEvent.click(screen.getByRole("button", { name: "Submit" }));
const alertText = () => screen.getByRole("alert").textContent;

describe("public sign-up page", () => {
  it("says the sign-up is closed when the link does not open", async () => {
    await open(null);
    expect(screen.getByText("Opening the sign-up…")).toBeTruthy();
    expect(await screen.findByText("This sign-up is closed.")).toBeTruthy();
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      "http://127.0.0.1:4173/api/respond/tok%2F1",
    );
  });

  it("explains a form that stopped taking responses or passed its deadline", async () => {
    form = { title: "Potluck", questions: [], accepting: false };
    render(<SignUpPage token="t" />);
    expect(await screen.findByText("This form is not taking more responses.")).toBeTruthy();
    cleanup();
    form = { title: "Potluck", questions: [], deadline: "2000-01-01T00:00:00Z" };
    render(<SignUpPage token="t" />);
    expect(await screen.findByText("The deadline for this form has passed.")).toBeTruthy();
  });

  it("shows no submit button for an empty form", async () => {
    await open({ title: "Empty", questions: [] });
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
  });

  it("checks each kind of answer before sending it", async () => {
    await open({
      title: "Volunteers",
      questions: [
        question("Name", "text", { required: true }),
        question("Shift", "choice", { choices: ["Morning", " ", "Evening"], required: true }),
        question("Mood", "rating"),
        question("Age", "number", { min: 18, max: 99 }),
        question("Grid", "grid", { rows: ["Mon", ""], columns: ["Yes", "No"], required: true }),
        question("Photo", "file"),
        question("", "text"),
      ],
    });
    expect(screen.getByText("Name (required)")).toBeTruthy();
    expect(screen.getByText("Untitled question")).toBeTruthy();
    expect(screen.getAllByRole("radio", { name: /Morning|Evening/ })).toHaveLength(2);

    await submit();
    expect(alertText()).toBe("Name is required");
    await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "  Ann  ");
    await submit();
    expect(alertText()).toBe("Shift is required");
    await userEvent.click(screen.getByRole("radio", { name: "Evening" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Age" }), "12");
    await submit();
    expect(alertText()).toBe("That number is outside the range.");
    await userEvent.clear(screen.getByRole("textbox", { name: "Age" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Age" }), "30");
    await submit();
    expect(alertText()).toBe("Grid is required");
    await userEvent.click(screen.getByRole("radio", { name: "Mon Yes" }));
    await userEvent.click(screen.getByRole("radio", { name: "4" }));

    const photo = screen.getByLabelText("Photo");
    fireEvent.change(photo, { target: { files: [new File(["x"], "secret.png")] } });
    expect(alertText()).toBe("That file is not an allowed upload.");
    fireEvent.change(photo, { target: { files: [] } });
    fireEvent.change(photo, { target: { files: [new File(["abc"], "me.png")] } });
    expect(screen.queryByRole("alert")).toBeNull();

    await submit();
    await screen.findByText("Your sign-up was received.");
    expect(posts).toEqual([
      {
        url: "http://127.0.0.1:4173/api/respond/tok%2F1",
        body: {
          answers: {
            Name: "Ann",
            Shift: "Evening",
            Mood: "4",
            Age: "30",
            Grid: JSON.stringify({ Mon: "Yes" }),
            Photo: "me.png|3",
          },
        },
      },
    ]);
  });

  it("refuses a number that is not a number and a rating outside 1 to 5", async () => {
    await open({
      title: "Survey",
      questions: [question("Count", "number", { required: true }), question("Score", "rating", { required: true })],
    });
    await submit();
    expect(alertText()).toBe("Count is required");
    await userEvent.type(screen.getByRole("textbox", { name: "Count" }), "lots");
    await submit();
    expect(alertText()).toBe("Enter a number.");
    await userEvent.clear(screen.getByRole("textbox", { name: "Count" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Count" }), "3");
    await submit();
    expect(alertText()).toBe("Score is required");
  });

  it("only asks the questions on the chosen branch", async () => {
    await open({
      title: "Branches",
      questions: [
        question("Coming", "choice", {
          choices: ["Yes", "No"],
          branches: [{ when: "No", next: "Why" }],
        }),
        question("Dish", "text", { required: true }),
        question("Why", "text"),
      ],
    });
    await userEvent.click(screen.getByRole("radio", { name: "No" }));
    expect(screen.queryByRole("textbox", { name: "Dish" })).toBeNull();
    await userEvent.type(screen.getByRole("textbox", { name: "Why" }), "Away");
    await submit();
    await screen.findByText("Your sign-up was received.");
    expect(posts[0].body.answers).toEqual({ Coming: "No", Why: "Away" });
  });

  it("shows the server's reason for a rejected answer and closes when the form closed", async () => {
    await open({ title: "Shifts", questions: [question("Name", "text")] });
    reply = () => Response.json({ error: "That shift is full." }, { status: 400 });
    await submit();
    await waitFor(() => expect(alertText()).toBe("That shift is full."));
    reply = () => new Response("nope", { status: 400 });
    await submit();
    expect(await screen.findByText("This sign-up is closed.")).toBeTruthy();
  });

  it("closes when the form stops taking answers after it opened", async () => {
    await open({ title: "Shifts", questions: [question("Name", "text")] });
    reply = () => Response.json({}, { status: 410 });
    await submit();
    expect(await screen.findByText("This sign-up is closed.")).toBeTruthy();
  });

  it("asks a grid question with no rows to be finished", async () => {
    await open({ title: "Grid", questions: [question("Empty grid", "grid", { rows: [], columns: ["A"] })] });
    expect(screen.getByText("Add rows and columns to this question.")).toBeTruthy();
  });
});
