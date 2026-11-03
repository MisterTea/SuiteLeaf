// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { HeldEditsPrompt } from "../../apps/web/src/ai/held-edits";
import { clearHeldEdits, holdToolEdit } from "../../apps/web/src/ai/tool-review";

afterEach(() => {
  cleanup();
  clearHeldEdits();
});

it("accepts a waiting edit and does not show the tool result", async () => {
  let ran = false;
  render(<HeldEditsPrompt />);
  act(() => {
    holdToolEdit(() => {
      ran = true;
      return "secret-value";
    });
  });
  const region = screen.getByRole("region", { name: "Waiting edits" });
  expect(region.textContent).toContain("1 edit is waiting.");
  expect(region.textContent).not.toContain("secret-value");
  await userEvent.click(screen.getByRole("button", { name: "Accept" }));
  expect(ran).toBe(true);
  expect(screen.queryByRole("region", { name: "Waiting edits" })).toBeNull();
  expect(document.body.textContent).not.toContain("secret-value");
});

it("rejects a waiting edit without running it", async () => {
  let ran = false;
  render(<HeldEditsPrompt />);
  act(() => {
    holdToolEdit(() => {
      ran = true;
    });
  });
  await userEvent.click(screen.getByRole("button", { name: "Reject" }));
  expect(ran).toBe(false);
  expect(screen.queryByRole("region", { name: "Waiting edits" })).toBeNull();
});
