// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MemberPlanPreview } from "../../apps/web/src/admin/member-plan";

afterEach(cleanup);

it("shows the preview and does not add the person", async () => {
  const added = false;
  render(
    <MemberPlanPreview
      disabled={false}
      onPreview={async () => {
        return "Adding Sam to Garden club would change Watering rota.sldoc from no role to editor. Nothing is changed.";
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  const status = await screen.findByRole("status");
  expect(status.textContent).toContain("Watering rota.sldoc");
  expect(status.textContent).toContain("Nothing is changed.");
  expect(status.textContent).not.toContain("secret-value");
  expect(added).toBe(false);
  expect(screen.queryByRole("button", { name: "Apply reviewed plan" })).toBeNull();
});

it("applies the reviewed plan and hides a secret in the refusal", async () => {
  let applied = 0;
  render(
    <MemberPlanPreview
      disabled={false}
      onPreview={async () =>
        "Adding Sam to Garden club would change Watering rota.sldoc from no role to editor. Nothing is changed."
      }
      onApply={async () => {
        applied += 1;
        if (applied === 1) throw new Error("The access plan changed. Review it again. secret-value");
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Preview" }));
  fireEvent.click(await screen.findByRole("button", { name: "Apply reviewed plan" }));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("The reviewed plan was not applied.");
  expect(alert.textContent).not.toContain("secret-value");
  fireEvent.click(screen.getByRole("button", { name: "Apply reviewed plan" }));
  expect((await screen.findByRole("status")).textContent).toBe("The reviewed plan was applied.");
  expect(document.body.textContent).not.toContain("secret-value");
  expect(applied).toBe(2);
});
