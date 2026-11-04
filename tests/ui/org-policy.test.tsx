// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { OrgPolicyReview } from "../../apps/web/src/admin/org-policy";

afterEach(cleanup);

it("names the file that would change and does not write until apply", async () => {
  let applied = "";
  render(
    <OrgPolicyReview
      onReview={async () => ({
        changes: [{ itemName: "Garden", principalId: "priya", before: "editor", after: "viewer" }],
        effects: [
          {
            itemName: "Watering rota.sldoc",
            principalId: "priya",
            before: "editor",
            after: "viewer",
          },
        ],
        stamp: "plan-1",
        recovery: "Set each changed grant back to editor.",
      })}
      onApply={async (stamp) => {
        applied = stamp;
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Review editor access" }));
  expect(await screen.findByText(/Watering rota.sldoc/)).toBeTruthy();
  expect(document.body.textContent).toContain("priya on Garden would change from editor to viewer.");
  expect(document.body.textContent).not.toContain("secret-value");
  expect(applied).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Apply reviewed plan" }));
  expect(await screen.findByText("Those editor grants are now viewer.")).toBeTruthy();
  expect(applied).toBe("plan-1");
});

it("does not repeat a secret when the plan cannot be read", async () => {
  render(
    <OrgPolicyReview
      onReview={async () => {
        throw "secret-value";
      }}
      onApply={async () => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Review editor access" }));
  expect(await screen.findByText("The access plan could not be read.")).toBeTruthy();
  expect(document.body.textContent).not.toContain("secret-value");
});

it("repeats the plan-changed sentence and hides any other refusal", async () => {
  cleanup();
  const { unmount } = render(
    <OrgPolicyReview
      onReview={async () => {
        throw new Error("The access plan changed. Review it again.");
      }}
      onApply={async () => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Review editor access" }));
  expect(await screen.findByText("The access plan changed. Review it again.")).toBeTruthy();
  unmount();

  render(
    <OrgPolicyReview
      onReview={async () => ({
        changes: [],
        effects: [],
        stamp: "plan-1",
        recovery: "Set each changed grant back to editor.",
      })}
      onApply={async () => {
        throw new Error("The access plan changed. Review it again.");
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Review editor access" }));
  fireEvent.click(await screen.findByRole("button", { name: "Apply reviewed plan" }));
  expect(await screen.findByText("The access plan changed. Review it again.")).toBeTruthy();
  cleanup();

  render(
    <OrgPolicyReview
      onReview={async () => ({
        changes: [],
        effects: [],
        stamp: "plan-1",
        recovery: "Set each changed grant back to editor.",
      })}
      onApply={async () => {
        throw "secret-value";
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Review editor access" }));
  fireEvent.click(await screen.findByRole("button", { name: "Apply reviewed plan" }));
  expect(await screen.findByText("The reviewed plan was not applied.")).toBeTruthy();
  expect(document.body.textContent).not.toContain("secret-value");
});
