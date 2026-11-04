/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SignUpPage from "../../apps/web/src/sign-up";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("sign-up page", () => {
  it("says a closed form is not taking responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            title: "Plot",
            accepting: false,
            questions: [{ id: "name", prompt: "Plot", kind: "text", required: true }],
          }),
          { status: 200 },
        ),
      ),
    );
    render(<SignUpPage token="sign-up-token" />);
    expect(await screen.findByText("This form is not taking more responses.")).toBeTruthy();
    expect(document.body.textContent).not.toContain("secret-value");
  });

  it("hides the beds question when the plot is large", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            title: "Plot",
            questions: [
              {
                id: "size",
                prompt: "Size",
                kind: "choice",
                required: true,
                choices: ["Small", "Large"],
                branches: [{ when: "Large", next: "note" }],
              },
              { id: "beds", prompt: "Beds", kind: "text", required: true },
              { id: "note", prompt: "Note", kind: "text", required: true },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    render(<SignUpPage token="sign-up-token" />);
    expect(await screen.findByLabelText("Beds")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Large"));
    expect(screen.queryByLabelText("Beds")).toBeNull();
    expect(screen.getByLabelText("Note")).toBeTruthy();
  });

  it("asks for a file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            title: "Plot",
            questions: [{ id: "photo", prompt: "Photo", kind: "file", required: true }],
          }),
          { status: 200 },
        ),
      ),
    );
    render(<SignUpPage token="sign-up-token" />);
    const input = await screen.findByLabelText("Photo");
    expect(input.getAttribute("type")).toBe("file");
  });

  it("says the deadline has passed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            title: "Plot",
            deadline: "2020-01-01T00:00:00.000Z",
            questions: [{ id: "name", prompt: "Plot", kind: "text", required: true }],
          }),
          { status: 200 },
        ),
      ),
    );
    render(<SignUpPage token="sign-up-token" />);
    expect(await screen.findByText("The deadline for this form has passed.")).toBeTruthy();
    expect(document.body.textContent).not.toContain("secret-value");
  });
});
