// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ExpansionNotice, FeatureMatrix } from "../../apps/web/src/packaging-view";

afterEach(cleanup);

it("shows the web feature matrix without a price", () => {
  render(<FeatureMatrix />);
  expect(screen.getByRole("region", { name: "What SuiteLeaf includes" })).toBeTruthy();
  expect(screen.getByText(/one software edition/i)).toBeTruthy();
  expect(screen.getByText(/does not publish a hosting price/)).toBeTruthy();
  expect(screen.getByText(/Edit a document on this computer/)).toBeTruthy();
  expect(screen.getByText(/Present a slideshow on this computer/)).toBeTruthy();
  expect(screen.getByText(/Share a file through SuiteDrive. Requires an account/)).toBeTruthy();
  expect(screen.getByText(/Assistant. No account. Requires the assistant/)).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/[$€£]/);
  expect(document.body.textContent).not.toContain("secret-value");
});

it("shows the expansion warning before a choice and adds no price", () => {
  render(<ExpansionNotice />);
  const status = screen.getByRole("status");
  expect(status.textContent).toContain("does not publish a storage price");
  expect(status.textContent).toContain("If you decline");
  expect(document.body.textContent).not.toMatch(/[$€£]/);
  expect(document.body.textContent).not.toContain("secret-value");
  fireEvent.click(screen.getByRole("button", { name: "Decline" }));
  expect(screen.getByRole("status").textContent).toContain("No paid storage expansion is applied");
  fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
  expect(screen.getByRole("status").textContent).toContain("No storage expansion was applied");
  fireEvent.change(screen.getByLabelText("Expansion choice"), { target: { value: "ai" } });
  expect(screen.getByRole("status").textContent).toContain("The assistant is optional");
  expect(screen.getByRole("status").textContent).not.toMatch(/[$€£]/);
});

it("warns when storage reaches its budget without repeating a bad count", () => {
  render(<ExpansionNotice />);
  fireEvent.change(screen.getByLabelText("Used bytes"), { target: { value: "1000" } });
  fireEvent.change(screen.getByLabelText("Budget bytes"), { target: { value: "1000" } });
  fireEvent.click(screen.getByRole("button", { name: "Check storage budget" }));
  expect(screen.getByRole("status").textContent).toContain("reached its budget");
  expect(screen.getByRole("status").textContent).toContain("If you decline");
  expect(screen.getByRole("status").textContent).not.toMatch(/[$€£]/);
  fireEvent.change(screen.getByLabelText("Used bytes"), { target: { value: "secret-value" } });
  fireEvent.click(screen.getByRole("button", { name: "Check storage budget" }));
  const status = screen.getByRole("status");
  expect(status.textContent).toBe("The storage count is not a whole number of bytes.");
  expect(status.textContent).not.toContain("secret-value");
});
