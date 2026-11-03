// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { DepartureNote } from "../../apps/web/src/admin/departure-note";

afterEach(cleanup);

it("reviews departure and does not show the device name", async () => {
  render(<DepartureNote />);
  expect(screen.getByRole("region", { name: "Employee departure" }).textContent).toContain(
    "This review does not remove the account or move any files.",
  );
  await userEvent.type(screen.getByLabelText("Departure device"), "secret-value");
  await userEvent.click(screen.getByRole("button", { name: "Review departure" }));
  expect(screen.getByRole("status").textContent).toBe(
    "The named device can be signed out. This note does not include the device name.",
  );
  expect(screen.getByRole("status").textContent).not.toContain("secret-value");
});
